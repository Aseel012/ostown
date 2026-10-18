import { Fragment, useState } from 'react';
import { useStore, getUI, setUI, actions, sim, labelOf, getTopo } from '../store';
import { TPLS } from '../engine/data';
import type { TplId } from '../engine/types';
import { Icon } from './icons';
import { ownerColor, ownerName, Bar, frameCells } from './nodes';
import { fitView } from './Canvas';
import { fmtBytes, fmtRate, fmtTicks, fmtNum, pct, TICKS_PER_SEC } from '../units';

const KV = ({ rows }: { rows: [string, any, string?][] }) => <div className="kv">{rows.map(([k, v, tone]) => <Fragment key={k}><span>{k}</span><b className={tone}>{v}</b></Fragment>)}</div>;
const Card = ({ title, children, tone }: { title: string; children: any; tone?: string }) => <div className={`mcard ${tone ?? ''}`}><h5>{title}</h5>{children}</div>;
const labelOfId = (id: string) => { const n = sim.an.byId.get(id); return n ? labelOf(n) : id; };

function Metrics() {
  const s = sim.stat; const secs = Math.max(0.01, sim.t / TICKS_PER_SEC); const u = sim.ramUsage(); const info = sim.holeInfo(); const cores = [...sim.cores.values()];
  const totalUtil = s.tot ? s.busy / s.tot : 0; const acc = sim.accesses(); const slots = sim.swapSlots();
  const disks = [...sim.devs.values()].filter(d => sim.nodeOf(d.id).kind === 'storage'); const nics = [...sim.devs.values()].filter(d => sim.nodeOf(d.id).kind === 'nic');
  const bufs = [...sim.bufs.values()]; const conts = [...sim.conts.values()];
  const thr = sim.thrashing() > 14 && sim.utilNow() < 0.8;
  return <div className="mgrid">
    <Card title="CPU and scheduling"><KV rows={[['Utilisation (average)', pct(totalUtil, 1)], ['Utilisation (now)', pct(sim.utilNow())], ['Throughput', `${(s.done / (secs / 60)).toFixed(1)} tasks/min`], ['Avg turnaround', s.done ? fmtTicks(sim.avg('turn')) : '-'], ['Avg waiting', s.done ? fmtTicks(sim.avg('wait')) : '-'], ['Avg response', s.done ? fmtTicks(sim.avg('resp')) : '-'], ['Context switches', `${fmtNum(s.ctx)} (${(s.ctx / secs).toFixed(1)}/s)`], ['Switch overhead', pct(s.tot ? s.ctxTicks / s.tot : 0, 2)], ['Tasks finished / killed', `${s.done} / ${s.killed}`]]} />
      {cores.map((c, i) => <div key={c.id} className="mini"><span>Core {i + 1} · {sim.nodeOf(c.id).props.ghz} GHz</span><Bar v={c.ticks ? c.busy / c.ticks : 0} color="var(--text)" /></div>)}</Card>
    <Card title="Memory" tone={thr ? 'bad' : ''}><KV rows={[['RAM in use', `${fmtBytes((u.total - u.free) * sim.fb)} of ${fmtBytes(u.total * sim.fb)}`], ['Tasks / pinned / kernel', `${fmtBytes(u.task * sim.fb)} / ${fmtBytes(u.pinned * sim.fb)} / ${fmtBytes(u.kernel * sim.fb)}`], ['Page faults (major / minor)', `${fmtNum(s.major)} / ${fmtNum(s.minor)}`], ['Major fault rate', `${(s.win.filter(x => sim.t - x < 300).length / Math.min(3, secs)).toFixed(1)}/s`, thr ? 'bad' : ''], ['Fault ratio', acc ? pct((s.major + s.minor) / acc, 2) : '-'], ['Avg major fault time', s.majorN ? fmtTicks(s.majorTicks / s.majorN) : '-'], ['TLB hit rate', (+(sim.an.mem.mmu?.props.tlb) || 0) > 0 ? pct(sim.tlbRate(), 1) : 'off'], ['Effective access time', acc ? `${sim.eat() >= 1e6 ? (sim.eat() / 1e6).toFixed(2) + ' ms' : sim.eat() >= 1e3 ? (sim.eat() / 1e3).toFixed(1) + ' us' : sim.eat().toFixed(0) + ' ns'}` : '-', thr ? 'bad' : ''], ['Evictions / prefetched', `${fmtNum(s.evict)} / ${fmtNum(s.prefetched)}`], ['Swap used', slots ? `${fmtBytes(sim.swapUsed * sim.fb)} of ${fmtBytes(slots * sim.fb)}` : 'no swap'], ['Swap in / out', `${fmtNum(s.swapIn)} / ${fmtNum(s.swapOut)}`], ['OOM kills', s.oom, s.oom ? 'bad' : ''], ['External fragmentation', sim.an.mem.mode === 'contig' ? `${pct(info.ext)} (${info.holes} holes)` : 'n/a with paging'], ['Internal waste', fmtBytes(sim.internalWaste())]]} />{thr && <div className="note bad">Thrashing: tasks spend their time waiting for page faults, and the CPU idles.</div>}</Card>
    <Card title="Storage">{disks.length ? disks.map(d => { const n = sim.nodeOf(d.id); return <div key={d.id}><div className="mini"><b>{n.props.type.toUpperCase()} · {n.props.sched.toUpperCase()}</b></div><KV rows={[['Space used', `${fmtBytes(d.used)} of ${fmtBytes(n.props.cap)}`], ['Utilisation', pct(sim.t ? d.busy / sim.t : 0)], ['Requests served', `${fmtNum(d.served)} (${(d.served / secs).toFixed(1)}/s)`], ['Throughput', fmtRate(d.bytes / secs)], ['Avg latency', d.ops ? fmtTicks(d.latSum / d.ops) : '-'], ['Queue (avg / max / now)', `${(d.qN ? d.qSum / d.qN : 0).toFixed(1)} / ${d.maxQ} / ${d.queue.length}`], ['Head travel', n.props.type === 'ssd' ? 'n/a' : `${fmtNum(d.travel)} tracks`], ['Page cache hit rate', (d.hits + d.misses) ? pct(d.hits / (d.hits + d.misses)) : 'no cache']]} /></div>; }) : <p className="muted small">No disk connected.</p>}</Card>
    <Card title="Network and buffers">{nics.map(d => <KV key={d.id} rows={[['Bandwidth', fmtRate(sim.nodeOf(d.id).props.bw)], ['Link utilisation', pct(sim.t ? d.busy / sim.t : 0)], ['Data moved', fmtBytes(d.bytes)], ['Current share per flow', fmtRate(d.share * TICKS_PER_SEC)]]} />)}
      {bufs.map(b => <div key={b.id}><div className="mini"><span>Buffer {fmtBytes(b.level)} / {fmtBytes(b.cap)}</span><Bar v={b.cap ? b.level / b.cap : 0} color="var(--text)" warn={b.active && b.level < 1} /></div><KV rows={[['Peak level', fmtBytes(b.peak)], ['Pinned frames', `${b.frames.length} of ${b.need}`]]} /></div>)}
      {[...sim.tasks.values()].filter(t => t.tpl === 'video').map(t => <KV key={t.id} rows={[['Frames played', fmtNum(t.framesShown)], ['Rebuffer events', t.underruns, t.underruns ? 'warn' : ''], ['Time stalled', fmtTicks(t.stallTicks)]]} />)}
      {!nics.length && !bufs.length && <p className="muted small">No network card connected.</p>}</Card>
    {conts.length > 0 && <Card title="Containers">{conts.map(c => { const n = sim.nodeOf(c.id); const members = [...sim.tasks.values()].filter(t => sim.an.attach.get(t.id)?.container === c.id); const res = sim.frames.filter(f => f.owner && members.some(m => m.id === f.owner)).length * sim.fb; return <div key={c.id}><div className="mini"><b>{n.props.name}</b></div><KV rows={[['Memory', `${fmtBytes(res)} of ${fmtBytes(n.props.mem)}`], ['CPU quota', `${n.props.cpuPct}%`], ['Throttled ticks', fmtNum(c.throttled)], ['OOM kills / restarts', `${c.oom} / ${c.restarts}`]]} /></div>; })}</Card>}
  </div>;
}

function Gantt() {
  const cores = [...sim.cores.values()]; const ids = [...sim.tasks.keys()];
  if (!cores.length) return <div className="empty">Connect a CPU core to the Scheduler and the Gantt chart will fill in.</div>;
  return <div className="gantt">{cores.map((c, ci) => <div key={c.id} className="grow-row"><span className="gl mono">CPU {ci + 1}</span><div className="gtrack">{c.trace.map((x, i) => <i key={i} style={{ background: x ? ownerColor(x) : 'transparent' }} title={x ? labelOfId(x) : 'idle'} />)}</div></div>)}
    <div className="glegend">{ids.map(id => <span key={id}><i style={{ background: ownerColor(id) }} />{labelOfId(id)}</span>)}<span className="muted">1 cell = 10 ms · last {cores[0].trace.length * 10} ms</span></div></div>;
}

function Spark({ k, color, label, fmt, max }: { k: keyof import('../engine/sim').Sample; color: string; label: string; fmt: (v: number) => string; max?: number }) {
  const vals = sim.samples.map(x => x[k] as number); const mx = max ?? Math.max(1, ...vals); const W = 240, H = 64; const N = 119; const pts = vals.map((v, i) => `${(i / N) * W},${H - (v / mx) * (H - 6) - 3}`);
  const last = vals[vals.length - 1] ?? 0;
  return <div className="spark"><div className="row sp"><small>{label}</small><b className="mono">{fmt(last)}</b></div><svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">{[0.25, 0.5, 0.75].map(g => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} stroke="var(--line)" strokeWidth="1" />)}{pts.length > 1 && <polyline points={pts.join(' ')} fill="none" stroke="var(--text)" strokeWidth="1.6" strokeLinejoin="round" />}</svg></div>;
}
const Graphs = () => <div className="graphs"><Spark k="util" color="" label="CPU utilisation" fmt={v => pct(v)} max={1} /><Spark k="faults" color="" label="Major faults per 80 ms" fmt={v => String(v)} /><Spark k="ram" color="" label="RAM in use" fmt={v => pct(v)} max={1} /><Spark k="swap" color="" label="Swap in use" fmt={v => pct(v)} max={1} /><Spark k="tlb" color="" label="TLB hit rate" fmt={v => pct(v)} max={1} /><Spark k="ready" color="" label="Ready queue length" fmt={v => String(v)} /><Spark k="io" color="" label="Device queue depth" fmt={v => String(v)} /><Spark k="buf" color="" label="Buffer level" fmt={v => fmtBytes(v)} /><Spark k="disk" color="" label="Disk busy (cumulative)" fmt={v => pct(v)} max={1} /></div>;

function Procs() {
  const rows = [...sim.tasks.values()]; if (!rows.length) return <div className="empty">No workloads yet. Add some from the palette.</div>;
  return <table className="ttab"><thead><tr><th>Process</th><th>State</th><th>Prio</th><th>Size</th><th>Resident</th><th>Faults maj/min</th><th>Hit rate</th><th>CPU</th><th>Wait</th><th>I/O wait</th><th>Runs</th><th>Reason</th></tr></thead><tbody>{rows.map(t => { const res = sim.frames.reduce((a, f) => a + (f.owner === t.id ? 1 : 0), 0) * sim.fb; const tot = t.hits + t.major + t.minor; return <tr key={t.id} onClick={() => actions.select({ type: 'node', id: t.id })}><td><i className="dot" style={{ background: ownerColor(t.id) }} />{TPLS[t.tpl as TplId].name}</td><td><span className={`state s-${t.state}`}>{t.state}</span></td><td className="mono">{t.prio}</td><td className="mono">{fmtBytes(t.sizeB)}</td><td className="mono">{fmtBytes(res)}</td><td className="mono">{t.major}/{t.minor}</td><td className="mono">{tot ? pct(t.hits / tot) : '-'}</td><td className="mono">{fmtTicks(t.cpuDone)}</td><td className="mono">{fmtTicks(t.waitT)}</td><td className="mono">{fmtTicks(t.ioT)}</td><td className="mono">{t.runs}</td><td className="why2">{t.why}</td></tr>; })}</tbody></table>;
}

function MemoryMap() {
  const F = sim.frames; if (!F.length) return <div className="empty">{sim.cfgErr || 'No RAM connected yet.'}</div>;
  const { cells, g } = frameCells(1024); const owners = [...new Set(F.map(f => f.owner).filter(Boolean) as string[])];
  return <div className="mmap"><div className="row sp"><b>Physical memory map</b><span className="mono small muted">{F.length} frames of {fmtBytes(sim.fb)} · hover a frame for details{g > 1 ? ` · ${g} frames per cell` : ''}</span></div>
    <div className="mgridcells" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cells.length > 400 ? 12 : cells.length > 150 ? 18 : 26}px, 1fr))` }}>{cells.map((c, i) => { const f = F[c.from]; return <i key={i} className={`cell ${c.loading ? 'loading' : ''} ${c.pinned && c.owner !== 'kernel' ? 'pin' : ''} ${c.owner ? 'on' : ''}`} style={c.owner ? { background: ownerColor(c.owner), opacity: 0.5 + (c.ref ? 0.5 : 0.2) } : undefined} title={`Frame ${c.from}${g > 1 ? '-' + (c.from + c.n - 1) : ''}\nRange ${fmtBytes(c.from * sim.fb)} to ${fmtBytes((c.from + c.n) * sim.fb)}\nOwner: ${ownerName(c.owner)}${c.owner && !c.owner.startsWith('buf:') && c.owner !== 'kernel' ? `\nVirtual page: ${f.page}\nLoaded: ${fmtTicks(f.loadedAt)} · Last used: ${fmtTicks(f.lastUse)}\nUses: ${f.uses}` : ''}\n${c.dirty ? 'Dirty ' : ''}${c.ref ? 'Referenced ' : ''}${c.pinned ? 'Pinned ' : ''}${c.loading ? 'Loading' : ''}`} />; })}</div>
    <div className="glegend">{owners.map(o => <span key={o}><i style={{ background: ownerColor(o) }} />{ownerName(o)}</span>)}<span className="muted">Bright = recently referenced · dot = dirty · hatched = pinned</span></div></div>;
}

function PageTable() {
  const ui = getUI(); const id = ui.selected.type === 'node' && sim.tasks.has(ui.selected.id!) ? ui.selected.id! : [...sim.tasks.values()].find(t => t.pt.length)?.id; const t = id ? sim.tasks.get(id) : undefined;
  if (sim.an.mem.mode === 'contig') return <div className="empty">Contiguous mode has no page tables. {t && t.base >= 0 ? `${TPLS[t.tpl as TplId].name} occupies frames ${t.base} to ${t.base + t.pages - 1} (base register ${t.base}, limit ${t.pages}).` : 'Connect an MMU to enable paging.'}</div>;
  if (!t || !t.pt.length) return <div className="empty">Select a running task to see its page table.</div>;
  const pr = sim.pageReal || 1; const k = sim.pagesPerFrame;
  const shown = Math.min(t.pagesReal, 400);
  const cells: { rp: number; present: boolean; onSwap: boolean; frame: number }[] = [];
  for (let rp = 0; rp < shown; rp++) { const pte = t.pt[Math.min(t.pages - 1, Math.floor(rp / k))]; cells.push({ rp, present: pte.present, onSwap: pte.onSwap, frame: pte.frame }); }
  const resident = t.pt.filter(p => p.present).length; const onSwap = t.pt.filter(p => p.onSwap && !p.present).length;
  return <div className="pt"><div className="row sp"><b>{TPLS[t.tpl as TplId].name}: virtual pages to physical frames</b><span className="mono small">{fmtNum(t.pagesReal)} pages of {fmtBytes(pr)} · {resident} frame page(s) resident · {onSwap} on swap</span></div>
    <div className="ptgrid">{cells.map(c => <div key={c.rp} className={`pte ${c.present ? 'on' : ''} ${c.onSwap && !c.present ? 'swap' : ''} ${c.rp < t.wsPagesReal ? 'ws' : ''}`}><small>P{c.rp}</small><b className="mono">{c.present ? 'F' + c.frame : c.onSwap ? 'swap' : '-'}</b></div>)}</div>
    {t.pagesReal > shown && <div className="small muted">Showing the first {shown} of {fmtNum(t.pagesReal)} pages.</div>}
    <div className="small muted">Solid = resident in RAM. Dashed = swapped out. Top bar = working set (pages touched repeatedly). Page size here is {fmtBytes(pr)}{k > 1 ? ` - the simulator groups ${fmtNum(k)} real pages into one frame page of ${fmtBytes(sim.fb)} for capacity, so a fault loads all of its pages at once` : ''}.</div></div>;
}

/** Step-through address translation: virtual address -> page+offset -> TLB -> PTE -> frame -> physical address. */
function Translate() {
  const taskIds = [...sim.tasks.keys()];
  const ui = getUI(); const selId = ui.selected.type === 'node' && sim.tasks.has(ui.selected.id!) ? ui.selected.id! : undefined;
  const [picked, setPicked] = useState('');
  const taskId = picked && sim.tasks.has(picked) ? picked : selId ?? taskIds[0] ?? '';
  const [va, setVa] = useState('0x5000');
  const [shown, setShown] = useState(() => (typeof location !== 'undefined' && location.search.includes('demo') ? 99 : 0));
  const t = taskId ? sim.tasks.get(taskId) : undefined;
  const res = t ? sim.translate(taskId, va) : { steps: [] as import('../engine/sim').TransStep[] };
  const steps = res.steps; const all = steps.length;
  return <div className="pt">
    <div className="row gap" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div className="field" style={{ minWidth: 180 }}><div className="flabel"><span>Task</span></div><div className="fin"><select className="wide" value={taskId} onChange={e => { setPicked(e.target.value); setShown(0); }}>{taskIds.map(id => <option key={id} value={id}>{labelOfId(id)}</option>)}</select></div></div>
      <div className="field" style={{ minWidth: 200, flex: 1 }}><div className="flabel"><span>Virtual address (decimal or 0x hex)</span></div><div className="fin"><input className="wide" value={va} spellCheck={false} onChange={e => { setVa(e.target.value); setShown(0); }} /></div></div>
      <button className="btn primary" onClick={() => setShown(1)} disabled={!t}>Translate</button>
      <button className="btn" onClick={() => setShown(Math.min(all, shown + 1))} disabled={!shown || shown >= all}>Next step</button>
      <button className="btn" onClick={() => setShown(all)} disabled={!t}>All steps</button>
      <button className="btn" onClick={() => setShown(0)} disabled={!shown}>Reset</button>
    </div>
    {!t && <div className="empty">Add and start a task to walk one of its addresses.</div>}
    {t && sim.an.mem.mode === 'paging' && <div className="small muted" style={{ margin: '4px 0 8px' }}>Page size {fmtBytes(sim.pageReal || 1)} · frame page {fmtBytes(sim.fb)}{sim.pagesPerFrame > 1 ? ` (${fmtNum(sim.pagesPerFrame)} real pages)` : ''} · TLB {sim.an.mem.mmu?.props.tlb ? `${sim.an.mem.mmu.props.tlb} entries` : 'off'}</div>}
    {shown > 0 && <div className="tsteps">{steps.slice(0, Math.max(1, shown)).map((st, i) => <div key={i} className={`tstep ${st.tone}`}>
      <span className="tnum mono">{i + 1}</span>
      <div><b>{st.title}</b><p>{st.detail}</p></div>
      {i === shown - 1 && (st.tone === 'ok' || st.tone === 'bad') && <span className={`badge ${st.tone === 'ok' ? 'good' : 'bad'}`}>{st.tone === 'ok' ? 'done' : 'fault'}</span>}
    </div>)}</div>}
    {shown > 0 && shown < all && <div className="small muted">Step {shown} of {all} - press "Next step".</div>}
  </div>;
}

function Devices() {
  const rows = [...sim.devs.values()]; if (!rows.length) return <div className="empty">No devices connected.</div>;
  return <table className="ttab"><thead><tr><th>Device</th><th>Reachable</th><th>Queue</th><th>In service</th><th>Served</th><th>Busy</th><th>Data moved</th><th>Avg latency</th><th>State</th></tr></thead><tbody>{rows.map(d => { const n = sim.nodeOf(d.id); const dead = (n.kind === 'usb' && !n.props.plugged) || (n.kind === 'printer' && !n.props.online); return <tr key={d.id} onClick={() => actions.select({ type: 'node', id: d.id })}><td>{labelOf(n)}</td><td>{sim.an.online.has(d.id) ? 'via driver' : <span className="warn">no driver</span>}</td><td className="mono">{d.queue.length}</td><td className="mono">{d.cur.length}</td><td className="mono">{fmtNum(d.served)}</td><td className="mono">{pct(sim.t ? d.busy / sim.t : 0)}</td><td className="mono">{fmtBytes(d.bytes)}</td><td className="mono">{d.ops ? fmtTicks(d.latSum / d.ops) : '-'}</td><td>{dead ? <span className="warn">{n.kind === 'usb' ? 'unplugged' : 'offline'}</span> : d.cur.length ? 'busy' : 'idle'}</td></tr>; })}</tbody></table>;
}

function LogView() {
  const ui = getUI(); const cats = ['all', 'sched', 'mem', 'io', 'net', 'docker', 'sys']; const names: Record<string, string> = { all: 'All', sched: 'Scheduler', mem: 'Memory', io: 'Storage', net: 'Network', docker: 'Containers', sys: 'System' };
  const rows = [...sim.log].reverse().filter(l => ui.logFilter === 'all' || l.cat === ui.logFilter).slice(0, 150);
  return <div><div className="chips">{cats.map(c => <button key={c} className={ui.logFilter === c ? 'on' : ''} onClick={() => setUI({ logFilter: c })}>{names[c]}</button>)}</div><div className="log wide">{rows.map((l, i) => <div key={i} className={`le ${l.tone}`}><span className="mono">{fmtTicks(l.t)}</span><span className="mono cat">{names[l.cat]}</span><p>{l.text}</p></div>)}{!rows.length && <div className="empty">No events yet.</div>}</div></div>;
}

function Problems() {
  const ps = sim.problems(); if (!ps.length) return <div className="empty">No problems found. Configuration looks consistent.</div>;
  return <div className="probs">{ps.map((p, i) => <div key={i} className={`prob ${p.level}`} onClick={() => p.node && actions.select({ type: 'node', id: p.node })}><span className="tag">{p.level}</span><p>{p.text}</p></div>)}</div>;
}

type Tab = 'metrics' | 'gantt' | 'graphs' | 'procs' | 'memory' | 'pages' | 'addr' | 'devices' | 'log' | 'problems';
export function Dock() {
  const ui = useStore(() => getUI()); useStore(() => 0);
  if (!ui.dockOpen) return <button className="dock-open glass" aria-label="Open telemetry dock" onClick={() => { setUI({ dockOpen: true }); setTimeout(() => fitView(), 30); }}><Icon name="chevU" size={15} /> Telemetry</button>;
  const np = sim.problems().filter(p => p.level !== 'info').length;
  const tabs: [Tab, string, string][] = [['metrics', 'Metrics', 'chart'], ['gantt', 'Gantt', 'list'], ['graphs', 'Graphs', 'chart'], ['procs', 'Processes', 'task'], ['memory', 'Memory map', 'grid'], ['pages', 'Page table', 'grid'], ['addr', 'Translate', 'mmu'], ['devices', 'Devices', 'storage'], ['log', 'Event log', 'list'], ['problems', np ? `Problems (${np})` : 'Problems', 'x']];
  return <div className="dock glass"><div className="tabs">{tabs.map(([k, l, ic]) => <button key={k} className={`${ui.dock === k ? 'on' : ''} ${k === 'problems' && np ? 'alert' : ''}`} onClick={() => setUI({ dock: k })}><Icon name={ic} size={14} />{l}</button>)}<span className="grow" /><button className="ibtn s" aria-label="Close dock" onClick={() => setUI({ dockOpen: false })}><Icon name="chevD" size={15} /></button></div>
    <div className="dbody">{ui.dock === 'metrics' && <Metrics />}{ui.dock === 'gantt' && <Gantt />}{ui.dock === 'graphs' && <Graphs />}{ui.dock === 'procs' && <Procs />}{ui.dock === 'memory' && <MemoryMap />}{ui.dock === 'pages' && <PageTable />}{ui.dock === 'addr' && <Translate />}{ui.dock === 'devices' && <Devices />}{ui.dock === 'log' && <LogView />}{ui.dock === 'problems' && <Problems />}</div></div>;
}
void getTopo;
