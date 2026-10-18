import { describe, it, expect } from 'vitest';
import { Sim, SIM_MAX_FRAMES } from './sim';
import { scenarioById } from './scenarios';
import { sanitizeTopology, MAX_NODES } from './sanitize';
import { MB, GB } from '../units';

const base = (id: string, mod?: (t: any) => void) => { const t: any = scenarioById(id).build(); mod?.(t); return t; };
const kindN = (t: any, k: string) => t.nodes.find((n: any) => n.kind === k);
const ticks = (s: Sim, n: number) => { for (let i = 0; i < n; i++) s.tick(); return s; };

/** 64 B RAM, 4 B pages, no reserve, one CPU-only custom task touching pages 0 and 1. */
const pagingFixture = (res: number) => base('bytes', t => {
  const ram = kindN(t, 'ram'); Object.assign(ram.props, { size: 64, page: 4, reserved: 0, res });
  t.nodes = t.nodes.filter((n: any) => n.kind !== 'task'); const sched = kindN(t, 'scheduler');
  const id = 'custom-x'; t.nodes.push({ id, kind: 'task', tpl: 'custom', x: 0, y: 0, props: { loop: false, bursts: 'cpu 40', refstr: '0 1', size: 8, ws: 8, io: 1, repeat: 1, burst: 100, prio: 3, writePct: 0, arrival: 0, delay: 0, name: 'x' } });
  t.edges.push({ id: 'e-x', a: id, b: sched.id });
});

describe('P1-01 paging is independent of display resolution', () => {
  it('same faults/residency for resolution 8 and 16 (and 4096)', () => {
    const r = [8, 16, 4096].map(res => { const s = ticks(new Sim(pagingFixture(res)), 30); return { frames: s.frames.length, fb: s.fb, minor: s.stat.minor ?? [...s.tasks.values()][0].minor, major: s.stat.major, json: JSON.stringify(s.samples.map(x => [x.t, x.faults, x.ram])) }; });
    expect(r[0].fb).toBe(4); expect(r[0].frames).toBe(16);
    expect(r[1]).toEqual(r[0]); expect(r[2]).toEqual(r[0]);
  });
  it('touching page 0 does not make page 1 resident', () => {
    const s = ticks(new Sim(pagingFixture(8)), 30); const t = [...s.tasks.values()][0];
    expect(t.minor).toBe(2); // one fault per real page, never one fault covering a grouped pair
  });
  it('huge RAM beyond the simulation budget is explicitly approximate and capped', () => {
    const s = new Sim(base('workstation', t => { const r = kindN(t, 'ram'); r.props.size = 64 * GB; r.props.page = 4096; })); s.tick();
    expect(s.frames.length).toBeLessThanOrEqual(SIM_MAX_FRAMES); expect(s.memCfg()!.k).toBeGreaterThan(1);
  });
  it('changing only res never changes a scenario outcome', () => {
    const a = ticks(new Sim(base('thrash')), 1500); const b = ticks(new Sim(base('thrash', t => { kindN(t, 'ram').props.res = 4096; })), 1500);
    expect(b.stat.major).toBe(a.stat.major); expect(b.stat.minor).toBe(a.stat.minor);
  });
});

describe('P1-02 shrinking a media buffer releases pinned frames', () => {
  const pinned = (s: Sim, id: string) => s.frames.filter(f => f.owner === 'buf:' + id).length;
  it('32 MB -> 4 MB frees all but one frame; grow re-pins; invalid size releases', () => {
    const topo = base('workstation'); const s = new Sim(topo); const buf = kindN(topo, 'buffer'); ticks(s, 3);
    const fb = s.fb; expect(pinned(s, buf.id)).toBe(Math.ceil(32 * MB / fb));
    const shrink = (size: number) => { const t = { ...topo, nodes: topo.nodes.map((n: any) => n.id === buf.id ? { ...n, props: { ...n.props, size } } : n) }; s.sync(t); ticks(s, 2); };
    shrink(4 * MB); expect(pinned(s, buf.id)).toBe(Math.ceil(4 * MB / fb));
    expect(s.bufs.get(buf.id)!.frames.length).toBe(pinned(s, buf.id)); expect(s.bufs.get(buf.id)!.cap).toBeLessThanOrEqual(4 * MB);
    shrink(16 * MB); expect(pinned(s, buf.id)).toBe(Math.ceil(16 * MB / fb));
    shrink(8 * MB); expect(pinned(s, buf.id)).toBe(Math.ceil(8 * MB / fb));
    expect(s.ramUsage().free + s.ramUsage().task + s.ramUsage().pinned + s.ramUsage().kernel).toBe(s.frames.length);
  });
  it('removing the buffer node frees everything', () => {
    const topo = base('workstation'); const s = new Sim(topo); const buf = kindN(topo, 'buffer'); ticks(s, 3);
    s.sync({ nodes: topo.nodes.filter((n: any) => n.id !== buf.id), edges: topo.edges.filter((e: any) => e.a !== buf.id && e.b !== buf.id) }); ticks(s, 1);
    expect(pinned(s, buf.id)).toBe(0);
  });
});

describe('P1-03 disk and USB used space are live', () => {
  it('editing Disk used space updates the runtime device immediately', () => {
    const topo = base('workstation'); const s = new Sim(topo); const d = kindN(topo, 'storage'); ticks(s, 5);
    const apply = (used: number) => s.sync({ ...topo, nodes: topo.nodes.map((n: any) => n.id === d.id ? { ...n, props: { ...n.props, used } } : n) });
    apply(10 * GB); expect(s.devs.get(d.id)!.used).toBe(10 * GB);
    apply(20 * GB); expect(s.devs.get(d.id)!.used).toBe(20 * GB);
    apply(d.props.cap * 2); expect(s.devs.get(d.id)!.used).toBe(d.props.cap); // clamped to capacity
  });
  it('writes after the edit add to the new value, not the old one', () => {
    const topo = base('usb'); const s = new Sim(topo); const u = kindN(topo, 'usb'); ticks(s, 5);
    const cap = u.props.cap; const target = Math.floor(cap / 4); s.sync({ ...topo, nodes: topo.nodes.map((n: any) => n.id === u.id ? { ...n, props: { ...n.props, used: target } } : n) });
    const dev = s.devs.get(u.id)!; expect(dev.used).toBe(target); ticks(s, 2000); expect(dev.used).toBeGreaterThanOrEqual(target); expect(dev.used).toBeLessThanOrEqual(cap);
  });
});

describe('P1-04 multi-core container CPU quota', () => {
  const fixture = (cores: number, pct: number) => {
    const t: any = scenarioById('docker').build(); const cont = kindN(t, 'container'); cont.props.cpuPct = pct; cont.props.mem = 64 * GB;
    const cpu = t.nodes.find((n: any) => n.kind === 'cpu'); const sched = kindN(t, 'scheduler'); const mmu = kindN(t, 'mmu');
    for (let i = 1; i < cores; i++) { const id = 'cpu-x' + i; t.nodes.push({ id, kind: 'cpu', x: 0, y: 0, props: { ...cpu.props } }); t.edges.push({ id: 'ea' + i, a: sched.id, b: id }, { id: 'eb' + i, a: id, b: mmu.id }); }
    t.nodes = t.nodes.filter((n: any) => n.kind !== 'task');
    for (let i = 0; i < 4; i++) { const id = 'cpuhog' + i; t.nodes.push({ id, kind: 'task', tpl: 'custom', x: 0, y: 0, props: { loop: true, bursts: 'cpu 100000', size: 4096, ws: 4096, io: 1, repeat: 1, burst: 100, prio: 3, writePct: 0, arrival: 0, delay: 0, name: 'h' + i } }); t.edges.push({ id: 'tc' + i, a: id, b: cont.id }); }
    return t;
  };
  for (const cores of [1, 2, 4, 8]) for (const pct of [100, 50, 25]) it(`${cores} cores @ ${pct}% quota is honoured (neither a 2-core ceiling nor over quota)`, () => {
    const s = new Sim(fixture(cores, pct)); ticks(s, 400); const busy0 = s.stat.busy; ticks(s, 2000); const busy = (s.stat.busy - busy0) / 2000;
    const usable = Math.min(cores, 4); const want = Math.min(usable, cores * pct / 100);
    expect(busy).toBeGreaterThan(want * 0.85); expect(busy).toBeLessThan(want * 1.1 + 0.05);
  });
});

describe('P1-11 import validation uses own-property checks and global limits', () => {
  const node = (over: any) => ({ id: 'n1', kind: 'task', tpl: 'constructor', x: 0, y: 0, props: {}, ...over });
  it('rejects inherited workload names', () => { for (const tpl of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) { const r = sanitizeTopology({ nodes: [node({ tpl })], edges: [] })!; expect(r.topo.nodes).toHaveLength(0); } });
  it('an accepted import never throws in the engine', () => { const r = sanitizeTopology({ nodes: [node({ tpl: 'browser' })], edges: [] })!; expect(() => ticks(new Sim(r.topo), 50)).not.toThrow(); });
  it('inherited prop and enum names are not trusted', () => {
    const r = sanitizeTopology({ nodes: [{ id: 'r', kind: 'ram', x: 0, y: 0, props: { constructor: 1, toString: 'x', __proto__: { size: 1 }, fit: 'constructor' } }], edges: [] })!;
    expect(Object.prototype.hasOwnProperty.call(r.topo.nodes[0].props, 'constructor')).toBe(false); expect(r.topo.nodes[0].props.fit).toBe('first'); expect(r.topo.nodes[0].props.size).toBe(512 * MB);
  });
  it('drops edges whose kinds cannot connect', () => {
    const r = sanitizeTopology({ nodes: [{ id: 'a', kind: 'ram' }, { id: 'b', kind: 'printer' }, { id: 'c', kind: 'cpu' }, { id: 'd', kind: 'scheduler' }], edges: [{ a: 'a', b: 'b' }, { a: 'c', b: 'd' }] })!;
    expect(r.topo.edges).toHaveLength(1);
  });
  it('caps node and edge counts', () => {
    const nodes = Array.from({ length: MAX_NODES + 50 }, (_, i) => ({ id: 'n' + i, kind: 'cpu' }));
    expect(sanitizeTopology({ nodes, edges: [] })!.topo.nodes).toHaveLength(MAX_NODES);
  });
  it('expanded custom-workload steps are bounded', () => {
    const t: any = pagingFixtureLike(); const s = new Sim(t); ticks(s, 5); expect([...s.tasks.values()][0].steps.length).toBeLessThanOrEqual(50000);
  });
});
function pagingFixtureLike() { const t: any = scenarioById('bytes').build(); const sched = t.nodes.find((n: any) => n.kind === 'scheduler'); t.nodes = t.nodes.filter((n: any) => n.kind !== 'task'); t.nodes.push({ id: 'big', kind: 'task', tpl: 'custom', x: 0, y: 0, props: { loop: false, bursts: 'cpu 1, rd 1, cpu 1, wr 1', repeat: 5000, burst: 100, size: 4, ws: 4, io: 1, prio: 3, writePct: 0, arrival: 0, delay: 0, name: 'b' } }); t.edges.push({ id: 'eb', a: 'big', b: sched.id }); return t; }
