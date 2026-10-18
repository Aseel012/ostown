import { describe, it, expect } from 'vitest';
import { Sim, SIM_MAX_FRAMES } from './sim';
import { SCENARIOS, scenarioById } from './scenarios';
import { parseSize, fmtBytes, GB, MB } from '../units';

const run = (id: string, n: number, mod?: (t: any) => void) => { const topo = scenarioById(id).build(); mod?.(topo); const s = new Sim(topo); for (let i = 0; i < n; i++) s.tick(); return s; };

describe('units', () => {
  it('parses free-typed sizes', () => {
    expect(parseSize('8', 'GB')).toEqual({ ok: true, bytes: 8 * GB });
    expect(parseSize('12 bytes')).toEqual({ ok: true, bytes: 12 });
    expect(parseSize('6')).toEqual({ ok: true, bytes: 6 * MB });
    expect(parseSize('1.5 kb')).toEqual({ ok: true, bytes: 1536 });
    expect(parseSize('12/s MB').ok).toBe(false);
    expect(parseSize('0.5 B').ok).toBe(false);
    expect(parseSize('abc').ok).toBe(false);
  });
  it('formats', () => { expect(fmtBytes(12)).toBe('12 B'); expect(fmtBytes(1536)).toBe('1.5 KB'); expect(fmtBytes(8 * GB)).toBe('8 GB'); });
});

describe('every scenario runs', () => {
  for (const sc of SCENARIOS) it(sc.id, () => { const s = new Sim(sc.build()); for (let i = 0; i < 3000; i++) s.tick(); expect(Number.isFinite(s.utilNow())).toBe(true); });
});

describe('memory', () => {
  it('thrashing produces major faults and low CPU', () => { const s = run('thrash', 4000); expect(s.stat.major).toBeGreaterThan(50); expect(s.utilNow()).toBeLessThan(0.9); });
  it('more RAM reduces faults', () => { const a = run('thrash', 4000); const b = run('thrash', 4000, t => { t.nodes.find((n: any) => n.kind === 'ram').props.size = 2 * GB; }); expect(b.stat.major).toBeLessThan(a.stat.major); });
  it('bytes lab uses exactly 6 frames of 2 bytes', () => { const s = run('bytes', 10); expect(s.frames.length).toBe(6); expect(s.fb).toBe(2); });
  it('RAM of 12 bytes with 1 byte pages gives 12 frames', () => { const s = run('bytes', 10, t => { const r = t.nodes.find((n: any) => n.kind === 'ram'); r.props.size = 12; r.props.page = 1; }); expect(s.frames.length).toBe(12); });
  it('huge RAM with tiny pages is an explicit approximation capped at SIM_MAX_FRAMES', () => { const s = run('workstation', 5, t => { const r = t.nodes.find((n: any) => n.kind === 'ram'); r.props.size = 8 * GB; r.props.page = 4096; }); expect(s.frames.length).toBeLessThanOrEqual(SIM_MAX_FRAMES); expect(s.pagesPerFrame).toBeGreaterThan(1); });
  it('rejects RAM smaller than two pages', () => { const s = run('bytes', 5, t => { const r = t.nodes.find((n: any) => n.kind === 'ram'); r.props.size = 3; r.props.page = 2; }); expect(s.problems().some(p => p.level === 'error')).toBe(true); });
  it('contiguous mode fragments', () => { const s = run('frag', 3000); expect(s.holeInfo().holes).toBeGreaterThan(0); });
  it('swap size 0 means OOM kills instead of swapping', () => { const s = run('thrash', 6000, t => { t.nodes.find((n: any) => n.kind === 'storage').props.swap = 0; }); expect(s.stat.oom).toBeGreaterThan(0); expect(s.stat.swapOut).toBe(0); });
  it('tlb tracks hits', () => { const s = run('workstation', 2000); expect(s.stat.tlbHit + s.stat.tlbMiss).toBeGreaterThan(0); });
});

describe('devices and containers', () => {
  it('docker OOM stays in the container', () => { const s = run('docker', 6000); expect([...s.conts.values()][0].oom).toBeGreaterThan(0); });
  it('buffer fills and video plays', () => { const s = run('buffer', 4000); expect([...s.tasks.values()].some(t => t.framesShown > 0)).toBe(true); });
  it('page cache hits with a cache', () => { const s = run('disk', 4000); expect(s.stat.cacheHit).toBeGreaterThan(0); });
  it('scan travels less than fcfs', () => { const f = run('disk', 5000, t => { t.nodes.find((n: any) => n.kind === 'storage').props.sched = 'fcfs'; }); const c = run('disk', 5000, t => { t.nodes.find((n: any) => n.kind === 'storage').props.sched = 'scan'; }); const per = (s: Sim) => [...s.devs.values()].reduce((a, d) => a + d.travel, 0) / Math.max(1, [...s.devs.values()].reduce((a, d) => a + d.served, 0)); expect(per(c)).toBeLessThanOrEqual(per(f)); });
});

describe('hardware: gpu and cpu caches', () => {
  it('game renders frames through the GPU', () => { const s = run('rig', 3000); expect([...s.tasks.values()].some(t => t.framesShown > 0)).toBe(true); });
  it('game without a GPU reports the requirement', () => { const topo = scenarioById('rig').build(); topo.nodes = topo.nodes.filter((n: any) => n.kind !== 'gpu'); const s = new Sim(topo); const g: any = topo.nodes.find((n: any) => n.tpl === 'game'); expect(s.reqs(g.id).some(r => !r.ok && /GPU/.test(r.text))).toBe(true); });
  it('cache penalty slows CPU work for large working sets', () => {
    const a = run('cpu', 2000); const sum = (s: Sim) => [...s.tasks.values()].reduce((x, t) => x + t.cpuDone, 0);
    const b = run('cpu', 2000, t => t.nodes.forEach((n: any) => { if (n.kind === 'cpu') n.props.cacheOn = false; }));
    expect(sum(b)).toBeGreaterThan(sum(a)); // cacheOn=false means "no penalty model", i.e. idealised
  });
  it('cacheFactor is 1 when the working set fits and drops when it does not', () => {
    const topo = scenarioById('cpu').build(); const s = new Sim(topo); for (let i = 0; i < 50; i++) s.tick();
    const cpu: any = topo.nodes.find((n: any) => n.kind === 'cpu'); const t = [...s.tasks.values()][0];
    t.wsPages = 1; expect(s.cacheFactor(t, cpu)).toBe(1);
    t.wsPages = Math.ceil((8 * 1024 * 1024 * 4) / s.fb); expect(s.cacheFactor(t, cpu)).toBeLessThan(1);
  });
});

describe('custom workloads', () => {
  const customScenario = (bursts: string, extra: any = {}, policy = 'rr') => scenarioById('cpu').build();
  const mkCustom = (t: any, tplFrom: string, props: any, policy?: string) => {
    const n = t.nodes.find((x: any) => x.tpl === tplFrom); n.tpl = 'custom'; Object.assign(n.props, props);
    if (policy) t.nodes.find((x: any) => x.kind === 'scheduler').props.policy = policy;
    return n;
  };
  it('runs a typed burst list with an arrival time', () => {
    const topo = customScenario(''); const n = mkCustom(topo, 'zip', { bursts: 'cpu 5, rd 1, cpu 5', repeat: 2, arrival: 1000, delay: 0 });
    const s = new Sim(topo);
    for (let i = 0; i < 60; i++) s.tick();
    expect(s.tasks.get(n.id)!.state).toBe('idle'); // arrival at 1 s = tick 100
    for (let i = 0; i < 120; i++) s.tick();
    const t = s.tasks.get(n.id)!;
    expect(t.state).not.toBe('idle');
    expect(t.total).toBe(20); // (5+5) cpu x 2 iterations
  });
  it('rejects a bad burst list with a config error, not a crash', () => {
    const topo = scenarioById('cpu').build(); const n = mkCustom(topo, 'zip', { bursts: 'banana split' });
    const s = new Sim(topo); for (let i = 0; i < 60; i++) s.tick();
    expect(s.tasks.get(n.id)!.cfgErr).toMatch(/Cannot read/);
    expect(Number.isFinite(s.utilNow())).toBe(true);
  });
  it('replays a page reference string deterministically', () => {
    const topo = scenarioById('bytes').build(); const n = mkCustom(topo, 'print', { refstr: '0 1 2 1 0 3', size: 7, ws: 5 });
    const s = new Sim(topo); for (let i = 0; i < 400; i++) s.tick();
    const t = s.tasks.get(n.id)!;
    expect(t.refIdx).toBeGreaterThan(0);
    // determinism: a second identical run touches pages in the same order
    const s2 = new Sim(topo); for (let i = 0; i < 400; i++) s2.tick();
    expect(s2.tasks.get(n.id)!.major + s2.tasks.get(n.id)!.minor).toBe(t.major + t.minor);
  });
});

describe('address translation', () => {
  it('walks a resident page to a physical address', () => {
    const s = run('bytes', 400); const t = [...s.tasks.values()].find(x => x.pt.some(p => p.present))!;
    const pageIdx = t.pt.findIndex(p => p.present);
    const va = pageIdx * s.pageReal;
    const r = s.translate(t.id, '0x' + va.toString(16));
    expect(r.physical).toBe(t.pt[pageIdx].frame * s.fb);
    expect(r.steps.some(x => /TLB/.test(x.title))).toBe(true);
    // decimal form agrees
    expect(s.translate(t.id, String(va)).physical).toBe(r.physical);
  });
  it('flags addresses beyond the task size', () => {
    const s = run('bytes', 400); const t = [...s.tasks.values()][0];
    const r = s.translate(t.id, String(t.pagesReal * s.pageReal + 4096));
    expect(r.physical).toBeUndefined();
    expect(r.steps.some(x => x.tone === 'bad' && /beyond/.test(x.detail))).toBe(true);
  });
  it('rejects garbage input without throwing', () => {
    const s = run('bytes', 50); const t = [...s.tasks.values()][0];
    expect(s.translate(t.id, 'hello').steps[0].tone).toBe('bad');
  });
});

describe('SRTF uses total remaining work', () => {
  it('a shorter total job wins over a smaller current burst with more work behind it', () => {
    const topo = scenarioById('cpu').build();
    const sch: any = topo.nodes.find((n: any) => n.kind === 'scheduler'); sch.props.policy = 'srtf';
    const big: any = topo.nodes.find((n: any) => n.tpl === 'zip'); big.tpl = 'custom'; Object.assign(big.props, { bursts: 'cpu 4, cpu 100', delay: 0, prio: 5 });
    const small: any = topo.nodes.find((n: any) => n.tpl === 'browser'); small.tpl = 'custom'; Object.assign(small.props, { bursts: 'cpu 10', delay: 0, prio: 5 });
    const s = new Sim(topo); for (let i = 0; i < 30; i++) s.tick();
    const a = s.tasks.get(big.id)!, b = s.tasks.get(small.id)!;
    expect(b.firstRun).toBeGreaterThanOrEqual(0);
    expect(a.firstRun === -1 || b.firstRun < a.firstRun).toBe(true);
  });
});

describe('TLB miss penalty in nanoseconds', () => {
  it('a larger penalty raises the effective access time', () => {
    const a = run('workstation', 2500, t => { t.nodes.find((n: any) => n.kind === 'mmu').props.tlbMiss = 20; });
    const b = run('workstation', 2500, t => { t.nodes.find((n: any) => n.kind === 'mmu').props.tlbMiss = 9000; });
    expect(a.accesses()).toBeGreaterThan(0); expect(b.accesses()).toBeGreaterThan(0);
    expect(b.eat()).toBeGreaterThan(a.eat());
  });
});

describe('layout helpers', () => {
  it('spreadNodes separates overlapping nodes and leaves clear ones alone', async () => {
    const { spreadNodes } = await import('../geometry');
    const mk = (id: string, x: number, y: number) => ({ id, kind: 'ram' as const, x, y, props: {} });
    const out = spreadNodes([mk('a', 0, 0), mk('b', 10, 10), mk('c', 2000, 2000)]);
    const rect = (n: any) => ({ x: n.x, y: n.x + 380, yy: n.y, y2: n.y + 300 });
    const a = out[0], b = out[1];
    const overlap = a.x < b.x + 380 && b.x < a.x + 380 && a.y < b.y + 300 && b.y < a.y + 300;
    expect(overlap).toBe(false);
    expect(out[2].x).toBe(2000); expect(out[2].y).toBe(2000);
    void rect;
  });
});
