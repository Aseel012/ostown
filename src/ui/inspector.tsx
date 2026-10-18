import { useStore, getTopo, getUI, setUI, actions, sim, SCENARIOS, labelOf } from '../store';
import { TPLS, POLICIES, REPLACEMENT, DISK_SCHED, FIT, OOM_POLICY, parseBursts, parseRefString } from '../engine/data';
import type { Kind, NodeDef } from '../engine/types';
import { Icon } from './icons';
import { CAT } from './nodes';
import { SizeField, NumField, SelectField, SwitchField, TextField, Section } from './fields';
import { KB, MB, GB, TB, fmtBytes, fmtTicks, fmtRate, pct, fmtNum } from '../units';
import { useEffect, useRef, useState } from 'react';

/** Free-text burst list editor with parse-on-blur validation. */
function BurstField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const focus = useRef(false); const [txt, setTxt] = useState(value); const [err, setErr] = useState('');
  useEffect(() => { if (!focus.current) { setTxt(value); setErr(''); } }, [value]);
  const commit = (text: string) => {
    if (!text.trim()) { setErr(''); onChange(''); return; }
    const r = parseBursts(text); if (r.err) { setErr(r.err); return; }
    setErr(''); onChange(text.trim());
  };
  return <div className={`field ${err ? 'bad' : ''}`}><div className="flabel"><span>{label}</span></div>
    <div className="fin"><input className="wide" value={txt} spellCheck={false} placeholder="cpu 40, rd 2, cpu 25, wr 1" onFocus={e => { focus.current = true; e.target.select(); }} onChange={e => setTxt(e.target.value)} onBlur={() => { focus.current = false; commit(txt); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTxt(value); setErr(''); (e.target as HTMLInputElement).blur(); } }} /></div>
    {err ? <div className="ferr">{err}</div> : <div className="fhint">One iteration of the program: cpu bursts (multiples of 10 ms) and I/O operations (counts). Kinds: cpu, rd, wr, net, prn, usb, gpu, play. Repeats for the iteration count.</div>}
  </div>;
}

/** Free-text page reference string editor with parse-on-blur validation. */
function RefField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const focus = useRef(false); const [txt, setTxt] = useState(value); const [err, setErr] = useState('');
  useEffect(() => { if (!focus.current) { setTxt(value); setErr(''); } }, [value]);
  const commit = (text: string) => {
    if (!text.trim()) { setErr(''); onChange(''); return; }
    const r = parseRefString(text); if (r.err) { setErr(r.err); return; }
    setErr(''); onChange(text.trim());
  };
  return <div className={`field ${err ? 'bad' : ''}`}><div className="flabel"><span>{label}</span></div>
    <div className="fin"><input className="wide" value={txt} spellCheck={false} placeholder="0 1 2 3 0 4 1 5 2" onFocus={e => { focus.current = true; e.target.select(); }} onChange={e => setTxt(e.target.value)} onBlur={() => { focus.current = false; commit(txt); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTxt(value); setErr(''); (e.target as HTMLInputElement).blur(); } }} /></div>
    {err ? <div className="ferr">{err}</div> : <div className="fhint">Optional: the exact sequence of virtual pages this task touches, replayed in a loop. Leave empty for the default locality model. Numbers wrap modulo the task's page count.</div>}
  </div>;
}

const Hdr = ({ k }: { k: string }) => <div className="khead">{k}</div>;
const Row = ({ k, v, tone }: { k: string; v: any; tone?: string }) => <><span>{k}</span><b className={tone}>{v}</b></>;

function Config({ n }: { n: NodeDef }) {
  const set = (p: any) => actions.setProps(n.id, p); const P = n.props;
  switch (n.kind) {
    case 'scheduler': return <>
      <Section title="Policy"><SelectField label="Scheduling algorithm" value={P.policy} onChange={v => set({ policy: v })} options={Object.fromEntries(Object.entries(POLICIES).map(([k, v]) => [k, v.label]))} hint={(POLICIES as any)[P.policy].hint} />
        {(P.policy === 'rr' || P.policy === 'mlfq') && <NumField label="Time quantum" unit="ms" value={P.quantum} min={10} max={5000} step={10} onChange={v => set({ quantum: v })} presets={[10, 30, 60, 100, 200]} hint="Base quantum. Simulation resolution is 10 ms." />}
        {P.policy === 'mlfq' && <NumField label="Priority boost interval" unit="ms" value={P.boost} min={100} max={60000} step={100} onChange={v => set({ boost: v })} hint="All tasks return to the top queue this often, preventing starvation." />}</Section>
      <Section title="Overhead"><NumField label="Context switch cost" unit="ms" value={P.ctxCost} min={0} max={100} step={0.5} onChange={v => set({ ctxCost: v })} hint="Time a core spends switching tasks, doing no useful work." /></Section></>;
    case 'cpu': { const cf = sim.cacheF.get(n.id) ?? 1; return <>
      <Section title="Core"><NumField label="Clock speed" unit="GHz" value={P.ghz} min={0.5} max={6} step={0.1} onChange={v => set({ ghz: v })} hint="Relative to 3 GHz. A 1.5 GHz core takes twice as long for the same work." presets={[1.5, 2, 3, 4]} /></Section>
      <Section title="On-chip cache hierarchy">
        <SwitchField label="Model cache misses" value={P.cacheOn !== false} onChange={v => set({ cacheOn: v })} hint="On: tasks whose working set outgrows the caches run slower, because more accesses reach RAM (~200 cycles)." />
        {P.cacheOn !== false && <><SizeField label="L1 cache" value={P.l1} min={1} max={16 * MB} defUnit="KB" presets={[16 * KB, 32 * KB, 64 * KB, 128 * KB]} onChange={v => set({ l1: v })} hint="Fastest, smallest: about 1 cycle." />
        <SizeField label="L2 cache" value={P.l2} min={1} max={64 * MB} defUnit="KB" presets={[128 * KB, 256 * KB, 512 * KB, 1 * MB, 2 * MB]} onChange={v => set({ l2: v })} hint="About 12 cycles." />
        <SizeField label="L3 cache" value={P.l3} min={1} max={4 * GB} defUnit="MB" presets={[2 * MB, 8 * MB, 16 * MB, 32 * MB, 96 * MB]} onChange={v => set({ l3: v })} hint="Shared between cores, about 40 cycles." />
        <div className="kv"><Row k="Current cache speed factor" v={`${(cf * 100).toFixed(0)}% of ideal`} tone={cf < 0.7 ? 'warn' : undefined} /></div></>}</Section></>; }
    case 'mmu': return <>
      <Section title="Page replacement"><SelectField label="Algorithm" value={P.repl} onChange={v => set({ repl: v })} options={REPLACEMENT as any} hint="Chooses the victim frame when RAM is full." />
        <NumField label="Prefetch (read-ahead)" unit="pages" value={P.prefetch} min={0} max={64} int onChange={v => set({ prefetch: v })} hint="Extra sequential pages loaded from swap with each major fault, if free frames exist." /></Section>
      <Section title="TLB"><NumField label="TLB entries" value={P.tlb} min={0} max={1024} int onChange={v => set({ tlb: v })} hint="0 disables the TLB. Every access then needs a page-table walk." />
        <NumField label="TLB miss penalty" unit="ns" value={P.tlbMiss} min={0} max={10000} int onChange={v => set({ tlbMiss: v })} hint="Cost of a page-table walk on a TLB miss, in nanoseconds. Typical: 60-100 ns. It slows the task down and feeds the effective access time (EAT)." presets={[0, 20, 60, 100, 200]} />
        <SwitchField label="Address-space IDs (ASID)" value={P.asid !== false} onChange={v => set({ asid: v })} hint="Off: the TLB is flushed on every context switch." /></Section></>;
    case 'ram': { const cfg = sim.memCfg(); const real = cfg && !cfg.err ? Math.floor(cfg.size / cfg.page) : 0; return <>
      <Section title="Capacity"><SizeField label="RAM size" value={P.size} min={2} max={64 * TB} defUnit="GB" presets={[256 * MB, 512 * MB, 1 * GB, 2 * GB, 4 * GB, 8 * GB, 16 * GB]} onChange={v => set({ size: v })} hint="Type any amount with a unit, e.g. 8 GB, 640 MB, 12 bytes." />
        <SizeField label="Page / frame size" value={P.page} min={1} max={2 * GB} defUnit="KB" presets={[1, 512, 4 * KB, 64 * KB, 2 * MB]} onChange={v => set({ page: v })} />
        <SizeField label="Kernel reserved" value={P.reserved} min={0} max={Math.max(0, P.size - 1)} defUnit="MB" onChange={v => set({ reserved: v })} hint="Pinned memory the kernel keeps for itself. Must stay smaller than RAM." /></Section>
      <Section title="Allocation"><SelectField label="Contiguous fit strategy" value={P.fit} onChange={v => set({ fit: v })} options={FIT as any} hint="Only used when there is no MMU." />
        <SelectField label="OOM victim policy" value={P.oom} onChange={v => set({ oom: v })} options={OOM_POLICY as any} />
        <NumField label="Memory map resolution" unit="cells" value={P.res} min={8} max={4096} int onChange={v => set({ res: v })} hint="Display only: how many cells the memory map draws. It never changes simulation results." /></Section>
      <Section title="Derived">{cfg && !cfg.err ? <div className="kv"><Row k="Real frames" v={fmtNum(real)} /><Row k="Simulated frames" v={fmtNum(cfg.F)} /><Row k="Simulated frame size" v={fmtBytes(cfg.fb)} /><Row k="Pages per sim frame" v={cfg.k} /><Row k="Accuracy" v={cfg.k > 1 ? `Approximate (${cfg.k} pages grouped; RAM above 4096 pages)` : "Exact (every real page tracked)"} /></div> : <div className="ferr">{cfg?.err}</div>}</Section>
      <div className="row gap"><button className="btn" onClick={() => actions.fitWorkloads()}>Fit workloads to RAM</button>{sim.an.mem.mode === 'contig' && <button className="btn" onClick={() => actions.compact()}>Compact memory</button>}</div></>; }
    case 'cache': return <Section title="Page cache"><SizeField label="Cache size" value={P.size} min={1} max={64 * GB} defUnit="MB" presets={[8 * MB, 32 * MB, 64 * MB, 256 * MB, 1 * GB]} onChange={v => set({ size: v })} /><SelectField label="Eviction policy" value={P.policy} onChange={v => set({ policy: v })} options={{ lru: 'LRU', fifo: 'FIFO' }} /></Section>;
    case 'buffer': return <Section title="Media buffer"><SizeField label="Buffer size" value={P.size} min={1} max={16 * GB} defUnit="MB" presets={[4 * MB, 16 * MB, 32 * MB, 64 * MB, 128 * MB]} onChange={v => set({ size: v })} hint="Pinned in RAM, so it takes frames away from tasks." /><NumField label="Start playback at" unit="% full" value={P.start} min={0} max={100} int onChange={v => set({ start: v })} hint="Also the level the buffer must reach before resuming after a stall." /></Section>;
    case 'storage': return <>
      <Section title="Device"><SelectField label="Type" value={P.type} onChange={v => set({ type: v })} options={{ hdd: 'HDD (spinning, seek time)', ssd: 'SSD (no seek time)' }} />
        <SizeField label="Capacity" value={P.cap} min={1} max={256 * TB} defUnit="GB" presets={[1 * GB, 64 * GB, 256 * GB, 1024 * GB]} onChange={v => set({ cap: v })} />
        <SizeField label="Used space" value={P.used} min={0} max={P.cap} defUnit="GB" onChange={v => set({ used: v })} />
        <SizeField label="Swap partition" value={P.swap} min={0} max={P.cap} defUnit="GB" presets={[0, 512 * MB, 2 * GB, 4 * GB, 16 * GB]} onChange={v => set({ swap: v })} hint="Used when this disk is linked to the MMU. 0 means no swap." /></Section>
      <Section title="Performance"><SizeField label="Sequential throughput" rate value={P.rate} min={1} max={TB} defUnit="MB" presets={[1 * MB, 40 * MB, 120 * MB, 500 * MB]} onChange={v => set({ rate: v })} />
        {P.type !== 'ssd' && <NumField label="Full-stroke seek time" unit="ms" value={P.seek} min={0} max={500} onChange={v => set({ seek: v })} />}
        <SelectField label="Queue scheduling" value={P.sched} onChange={v => set({ sched: v })} options={DISK_SCHED as any} hint={P.type === 'ssd' ? 'SSDs have no head, so ordering barely matters (FCFS is used).' : undefined} /></Section>
      <div className="row gap"><button className="btn" onClick={() => actions.freeSpace(n.id)}>Free 25% of used space</button></div></>;
    case 'usb': return <Section title="USB drive"><SwitchField label="Plugged in" value={P.plugged} onChange={v => set({ plugged: v })} /><SizeField label="Capacity" value={P.cap} min={1} max={256 * TB} defUnit="GB" onChange={v => set({ cap: v })} /><SizeField label="Used space" value={P.used} min={0} defUnit="MB" onChange={v => set({ used: v })} /><SizeField label="Transfer rate" rate value={P.rate} min={1} defUnit="MB" onChange={v => set({ rate: v })} /><div className="row gap"><button className="btn" onClick={() => actions.freeSpace(n.id)}>Free 25% of used space</button></div></Section>;
    case 'printer': return <Section title="Printer"><SwitchField label="Online" value={P.online} onChange={v => set({ online: v })} /><SizeField label="Spool rate" rate value={P.rate} min={1} max={GB} defUnit="KB" presets={[64 * KB, 512 * KB, 1536 * KB, 4 * MB]} onChange={v => set({ rate: v })} /></Section>;
    case 'gpu': return <Section title="GPU"><NumField label="Frame rate limit" unit="fps" value={P.fps} min={10} max={1000} step={10} int onChange={v => set({ fps: v })} hint="Frames the GPU can render per simulated second. Each frame a task hands over queues here." presets={[60, 120, 240, 480]} /></Section>;
    case 'nic': return <Section title="Network"><SizeField label="Bandwidth" rate value={P.bw} min={1} max={TB} defUnit="MB" presets={[256 * KB, 1 * MB, 3 * MB, 12 * MB, 125 * MB]} onChange={v => set({ bw: v })} hint="12 MB/s is roughly 100 Mbit/s. Shared fairly between active flows." /><NumField label="Latency" unit="ms" value={P.latency} min={0} max={5000} int onChange={v => set({ latency: v })} /></Section>;
    case 'driver': return <p className="hintline">Drivers have no settings. Everything reachable only through a driver is offline without it.</p>;
    case 'container': return <>
      <Section title="cgroup limits"><TextField label="Name" value={P.name} onChange={v => set({ name: v })} />
        <SizeField label="Memory limit" value={P.mem} min={1} max={64 * TB} defUnit="MB" presets={[64 * MB, 160 * MB, 512 * MB, 1 * GB, 2 * GB]} onChange={v => set({ mem: v })} />
        <NumField label="CPU quota" unit="% of all cores" value={P.cpuPct} min={5} max={100} step={5} int onChange={v => set({ cpuPct: v })} />
        <SwitchField label="Allow swap" value={P.swapOK} onChange={v => set({ swapOK: v })} hint="Off: exceeding the limit triggers an OOM kill. On: pages go to swap and the task slows down." /></Section>
      <Section title="Lifecycle"><SelectField label="Restart policy" value={P.restart} onChange={v => set({ restart: v })} options={{ always: 'Always restart looping tasks', no: 'Never restart after a kill' }} /></Section></>;
    case 'task': { const tpl = TPLS[n.tpl!]; return <>
      <Section title="Memory"><SizeField label="Virtual size" value={P.size} min={1} max={64 * TB} defUnit="MB" presets={[tpl.size]} onChange={v => set({ size: v })} /><SizeField label="Working set" value={P.ws} min={1} max={64 * TB} defUnit="MB" presets={[tpl.ws]} onChange={v => set({ ws: v })} hint="The hot part that is touched repeatedly. Must fit in RAM to avoid thrashing." />
        <NumField label="Write ratio" unit="% of accesses" value={P.writePct} min={0} max={100} int onChange={v => set({ writePct: v })} hint="Written pages become dirty and must be written to swap when evicted." /></Section>
      <Section title="CPU and I/O"><NumField label="Priority (1 is highest)" value={P.prio} min={1} max={9} int onChange={v => set({ prio: v })} /><NumField label="CPU burst scale" unit="%" value={P.burst} min={10} max={1000} step={10} int onChange={v => set({ burst: v })} /><NumField label="Iterations" value={P.repeat} min={1} max={5000} int onChange={v => set({ repeat: v })} />
        <SizeField label="I/O request size" value={P.io} min={1} max={GB} defUnit="KB" presets={[4 * KB, 256 * KB, 1 * MB, 4 * MB, 16 * MB]} onChange={v => set({ io: v })} />
        <SelectField label="Write destination" value={P.dest} onChange={v => set({ dest: v })} options={{ auto: 'Disk', usb: 'USB drive (if present)' }} />
        {n.tpl === 'video' && <><NumField label="Frame rate" unit="fps" value={P.fps} min={1} max={120} int onChange={v => set({ fps: v })} /><SizeField label="Stream bitrate" rate value={P.bitrate} min={1} max={GB} defUnit="KB" presets={[256 * KB, 1 * MB, 4 * MB]} onChange={v => set({ bitrate: v })} /></>}</Section>
      {n.tpl === 'custom' && <Section title="Custom program">
        <BurstField label="Burst list" value={String(P.bursts ?? '')} onChange={v => set({ bursts: v })} />
        <NumField label="Arrival time" unit="ms" value={+P.arrival || 0} min={0} max={3600000} step={100} int onChange={v => set({ arrival: v })} hint="Absolute simulation time at which the task arrives (0 = at once). Combined with the start delay below, the later of the two wins." />
        <RefField label="Page reference string" value={String(P.refstr ?? '')} onChange={v => set({ refstr: v })} />
      </Section>}
      <Section title="Lifecycle"><NumField label="Start delay" unit="ms" value={P.delay} min={0} max={600000} step={100} int onChange={v => set({ delay: v })} /><SwitchField label="Restart when finished" value={P.loop} onChange={v => set({ loop: v })} /></Section>
      <div className="row gap"><button className="btn" onClick={() => actions.restartTask(n.id)}>Restart</button><button className="btn danger" onClick={() => actions.killTask(n.id)}>Kill</button></div></>; }
    default: return null;
  }
}

const CONCEPT: Record<string, { t: string; d: string }> = {
  scheduler: { t: 'Who runs next?', d: 'The scheduler picks which ready task gets a core and for how long. The policy decides the order, the quantum decides how long, and every switch costs time.' },
  cpu: { t: 'One task at a time', d: 'A core runs one task at once. When a task blocks on I/O or a page fault the scheduler gives the core to another ready task (a context switch). Its L1/L2/L3 caches decide how often it waits on RAM: working sets that fit run at full speed, larger ones pay the RAM latency.' },
  mmu: { t: 'Virtual memory', d: 'Every task sees its own address space. The MMU translates virtual pages to physical frames using a page table, with a small TLB to cache translations. A missing page raises a page fault and the OS loads it, possibly evicting another page.' },
  ram: { t: 'Physical frames', d: 'RAM is a grid of frames. With paging, a task can use any free frame, so there is no external fragmentation. Without an MMU a task needs one contiguous block, and holes appear.' },
  cache: { t: 'Page cache', d: 'Recently read disk blocks are kept in memory. A repeated read is served without touching the disk, saving seek and transfer time.' },
  buffer: { t: 'Streaming buffer', d: 'Network data arrives in bursts, a player consumes it steadily. The buffer absorbs the difference. When it runs dry playback stalls. Its frames are pinned in RAM.' },
  storage: { t: 'Disk and queueing', d: 'Requests queue at the disk. Service time is seek + transfer. HDD head movement can be reduced by reordering requests (SSTF, SCAN, C-SCAN) at the risk of starving far requests. A swap partition lives here too.' },
  usb: { t: 'Removable storage', d: 'A hot-pluggable device. While unplugged, requests wait in the queue. When plugged back in, the driver raises an interrupt and work resumes.' },
  printer: { t: 'Slow device', d: 'Orders of magnitude slower than the CPU. The task blocks, and the CPU runs something else until the interrupt arrives.' },
  nic: { t: 'Shared bandwidth', d: 'Bandwidth is a fixed pipe divided fairly between active flows. A download and a video stream each get half.' },
  gpu: { t: 'A second, specialised processor', d: 'The CPU prepares work and hands frames to the GPU, which renders them at its own pace. If frames arrive faster than the GPU renders, its queue grows and the task blocks. Games need both a fast CPU and a fast GPU.' },
  driver: { t: 'Driver', d: 'Translates between kernel and device and delivers the device interrupts. A device without a driver cannot be used.' },
  container: { t: 'Container', d: 'Not a virtual machine: the same kernel, with namespaces for isolation and cgroups for limits. Going over the memory limit triggers an OOM kill inside the container only, while the CPU quota throttles it.' },
  task: { t: 'Workload', d: 'A process with CPU bursts and I/O requests. The parcel on the link shows where it is. A blocked task uses no CPU.' },
};

function live(n: NodeDef): string {
  const u = sim.ramUsage();
  if (n.kind === 'ram') { const i = sim.holeInfo(); return sim.an.mem.mode === 'contig' ? `${fmtBytes((u.total - u.free) * sim.fb)} of ${fmtBytes(u.total * sim.fb)} in use. ${i.free} frames are free but the largest hole is ${i.largest} (external fragmentation ${pct(i.ext)}). Internal waste: ${fmtBytes(sim.internalWaste())}.` : `${fmtBytes((u.total - u.free) * sim.fb)} of ${fmtBytes(u.total * sim.fb)} in use: ${fmtBytes(u.task * sim.fb)} tasks, ${fmtBytes(u.pinned * sim.fb)} pinned buffers, ${fmtBytes(u.kernel * sim.fb)} kernel. Internal fragmentation (last-page waste): ${fmtBytes(sim.internalWaste())}.`; }
  if (n.kind === 'mmu') return `${fmtNum(sim.stat.major)} major and ${fmtNum(sim.stat.minor)} minor faults so far. ${sim.thrashing() > 14 ? 'The system is thrashing: add RAM or reduce the workload.' : sim.stat.major > 0.15 * (sim.stat.major + sim.stat.minor) ? 'Many faults need the disk: RAM is under pressure.' : 'Fault rate is low.'}`;
  if (n.kind === 'scheduler') return `${sim.readyQ.length} ready, ${fmtNum(sim.stat.ctx)} context switches, ${pct(sim.stat.tot ? sim.stat.ctxTicks / sim.stat.tot : 0, 1)} of CPU time lost to switching.`;
  if (n.kind === 'gpu') { const d = sim.devs.get(n.id); return d ? `${fmtNum(d.served)} frames rendered, ${d.queue.length} queued, busy ${pct(sim.t ? d.busy / sim.t : 0)} of the time.` : ''; }
  if (n.kind === 'cpu') { const cf = sim.cacheF.get(n.id); return cf !== undefined && n.props.cacheOn !== false ? `Cache speed factor right now: ${(cf * 100).toFixed(0)}% of the ideal (working set vs L1+L2+L3).` : ''; }
  if (n.kind === 'storage') { const d = sim.devs.get(n.id); return d ? `Queue ${d.queue.length}, head travel ${fmtNum(d.travel)} tracks, ${fmtNum(d.served)} requests served. Swap in use: ${fmtBytes(sim.swapUsed * sim.fb)} of ${fmtBytes(n.props.swap)}.` : ''; }
  if (n.kind === 'buffer') { const b = sim.bufs.get(n.id); return b ? `${fmtBytes(b.level)} of ${fmtBytes(b.cap)} buffered. ${b.active ? 'Data is arriving.' : 'No data arriving: connect NIC, RAM and a task.'}` : ''; }
  return '';
}

const STATE: Record<string, string> = { running: 'Running', ready: 'Ready', blocked: 'Blocked', new: 'Admitting', idle: 'Idle', done: 'Finished', killed: 'Killed' };

function NodeInfo({ n }: { n: NodeDef }) {
  const c = CONCEPT[n.kind]; const t = n.kind === 'task' ? sim.tasks.get(n.id) : undefined; const reqs = n.kind === 'task' ? sim.reqs(n.id) : [];
  const probs = sim.problems().filter(p => p.node === n.id);
  return <div><div className="nh" style={{ ['--c' as any]: CAT[n.kind] }}><span className="nicon big"><Icon name={n.kind === 'task' ? 'task' : n.kind} size={26} /></span><div><h2>{labelOf(n)}</h2><div className="tag">{c.t}</div></div></div>
    {n.kind === 'task' && <p className="lead small">{TPLS[n.tpl!].blurb}</p>}
    <p className="lead">{c.d}</p>
    {probs.map((p, i) => <div key={i} className={`callout ${p.level}`}><b>{p.level === 'error' ? 'Problem:' : p.level === 'warn' ? 'Warning:' : 'Note:'}</b> {p.text}</div>)}
    {live(n) && <div className="callout live"><b>Now:</b> {live(n)}</div>}
    {t && <div className="callout live"><b>{STATE[t.state]}:</b> {t.why}</div>}
    {t && <><h4>Statistics</h4><div className="kv">
      <Row k="Turnaround (last / avg)" v={t.completed ? `${fmtTicks(t.finish - t.arrival)} / ${fmtTicks(t.turnSum / t.completed)}` : '-'} /><Row k="Ready-queue wait" v={fmtTicks(t.waitT)} /><Row k="I/O and fault wait" v={fmtTicks(t.ioT)} /><Row k="Response time" v={t.firstRun >= 0 ? fmtTicks(t.firstRun - t.arrival) : '-'} /><Row k="CPU work" v={fmtTicks(t.cpuDone)} />
      <Row k="Faults (major / minor)" v={`${t.major} / ${t.minor}`} /><Row k="Page hits" v={fmtNum(t.hits)} /><Row k="Swap in / out" v={`${t.swapIns} / ${t.swapOuts}`} /><Row k="Pages" v={`${fmtNum(t.pages)} sim frames (working set ${fmtNum(t.wsPages)})`} /><Row k="Internal waste" v={fmtBytes(t.waste)} /><Row k="I/O moved" v={fmtBytes(t.ioBytes)} /><Row k="Completed runs" v={t.completed} />{t.underruns > 0 && <Row k="Rebuffer events" v={`${t.underruns} (${fmtTicks(t.stallTicks)})`} tone="warn" />}</div></>}
    {reqs.length > 0 && <><h4>Requirements</h4><ul className="reqs">{reqs.map((r, i) => <li key={i} className={r.ok ? 'ok' : 'no'}><Icon name={r.ok ? 'check' : 'x'} size={14} /><span>{r.text}{!r.ok && r.hint && <em>{r.hint.text}</em>}</span></li>)}</ul></>}
    <h4>Settings</h4><Config n={n} />
    <button className="btn danger wide" onClick={() => actions.removeNode(n.id)}><Icon name="trash" size={15} /> Remove</button></div>;
}

export function Missions() {
  const T = getTopo(); const has = (k: Kind) => T.nodes.some(n => n.kind === k); const lk = (a: Kind, b: Kind) => T.edges.some(e => { const x = T.nodes.find(n => n.id === e.a)?.kind, y = T.nodes.find(n => n.id === e.b)?.kind; return (x === a && y === b) || (x === b && y === a); });
  const tasks = T.nodes.filter(n => n.kind === 'task');
  const list: [string, string, boolean][] = [
    ['Add a Scheduler', 'From the Kernel group. It owns the ready queue.', has('scheduler')], ['Connect a CPU core', 'Drag from the Scheduler to a CPU.', lk('scheduler', 'cpu')],
    ['Add an MMU and RAM', 'CPU to MMU to RAM enables virtual memory.', lk('cpu', 'mmu') && lk('mmu', 'ram')], ['Add a driver and a disk', 'Scheduler to Driver to Disk. Also link the MMU to the disk for swap.', lk('scheduler', 'driver') && lk('driver', 'storage') && lk('mmu', 'storage')],
    ['Size your RAM', 'Open the RAM node and type any amount, e.g. 8 GB or 12 bytes. Then press "Fit workloads to RAM".', T.nodes.some(n => n.kind === 'ram' && n.props.size !== 512 * MB)], ['Start a workload', 'Add a task and connect it to the Scheduler.', tasks.some(t => sim.an.attach.get(t.id)?.ok)],
    ['Finish a task', 'Press play and wait for a task to reach Finished.', sim.stat.done > 0], ['Cause a page fault', 'Shrink RAM so a task no longer fits and watch major faults.', sim.stat.major > 0],
    ['Use a container', 'Connect a container to the Scheduler and a task to the container.', T.nodes.some(n => n.kind === 'container' && tasks.some(t => sim.an.attach.get(t.id)?.container === n.id))],
  ];
  const done = list.filter(l => l[2]).length;
  return <div><h2>Build guide</h2><p className="lead">Follow the steps to build a working system from an empty canvas. Steps tick off automatically.</p><div className="prog"><i style={{ width: `${(done / list.length) * 100}%` }} /></div><ol className="missions">{list.map(([t, d, ok], i) => <li key={i} className={ok ? 'ok' : i === list.findIndex(x => !x[2]) ? 'next' : ''}><span className="dot">{ok ? <Icon name="check" size={13} /> : i + 1}</span><span><b>{t}</b><small>{d}</small></span></li>)}</ol></div>;
}

export function Inspector() {
  const ui = useStore(() => getUI()); useStore(() => 0); const T = getTopo();
  if (!ui.right) return <button className="edge-toggle r glass" aria-label="Open inspector" title="Inspector" onClick={() => setUI(window.innerWidth <= 1100 ? { right: true, left: false } : { right: true })}><Icon name="chevL" size={16} /></button>;
  const sc = SCENARIOS.find(x => x.id === ui.scenario); const n = ui.selected.type === 'node' ? T.nodes.find(x => x.id === ui.selected.id) : undefined;
  return <div className="inspector glass">
    <div className="tabs"><button className={ui.rightTab === 'inspect' ? 'on' : ''} onClick={() => setUI({ rightTab: 'inspect' })}>Inspector</button><button className={ui.rightTab === 'guide' ? 'on' : ''} onClick={() => setUI({ rightTab: 'guide' })}>Guide</button><span className="grow" /><button className="ibtn s" aria-label="Close inspector" onClick={() => setUI({ right: false })}><Icon name="x" size={15} /></button></div>
    <div className="ibody">
      {ui.rightTab === 'inspect' && (n ? <NodeInfo n={n} /> : ui.selected.type === 'edge' ? <div><h2>Connection</h2><p className="lead">A link between two components. Press Delete or use the X in the middle of the line to remove it.</p></div> : sc ? <ScenarioInfo /> : <p className="lead">Select a component to inspect and configure it.</p>)}
      {ui.rightTab === 'guide' && (sc && sc.id !== 'blank' ? <><ScenarioInfo /><hr /><Missions /></> : <Missions />)}
    </div></div>;
}
function ScenarioInfo() {
  const ui = getUI(); const sc = SCENARIOS.find(x => x.id === ui.scenario); if (!sc) return null;
  return <div><div className="tag">{sc.tag}</div><h2>{sc.title}</h2><p className="lead">{sc.hook}</p><h4>What to watch</h4><ul>{sc.watch.map(w => <li key={w}>{w}</li>)}</ul><h4>Experiments</h4><ul className="try">{sc.try.map(w => <li key={w}>{w}</li>)}</ul><div className="callout">Click any component to see what it does, its live statistics and every setting. Sizes accept free typing: try 12 bytes, 640 MB or 8 GB.</div></div>;
}
export { fmtRate };
