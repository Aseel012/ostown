import type { NodeDef, TplId } from '../engine/types';
import { CATALOG, TPLS, nodeSize } from '../engine/data';
import { sim } from '../store';
import { Icon } from './icons';
import { fmtBytes, fmtNum, fmtRate, pct } from '../units';

export const CAT: Record<string, string> = { scheduler: '#d8d8d8', cpu: '#d8d8d8', mmu: '#d8d8d8', ram: '#d8d8d8', cache: '#d8d8d8', buffer: '#d8d8d8', storage: '#d8d8d8', usb: '#d8d8d8', printer: '#d8d8d8', nic: '#d8d8d8', gpu: '#d8d8d8', driver: '#d8d8d8', container: '#d8d8d8', task: '#d8d8d8' };
export const ownerColor = (id: string | null): string => { if (!id) return 'transparent'; if (id === 'kernel') return '#5a5a5a'; if (id.startsWith('buf:')) return '#8892b0'; const n = sim.an.byId.get(id); return n?.tpl ? TPLS[n.tpl].color : '#999'; };
export const ownerName = (id: string | null) => { if (!id) return 'free'; if (id === 'kernel') return 'Kernel (reserved)'; if (id.startsWith('buf:')) return 'Media buffer (pinned)'; const n = sim.an.byId.get(id); return n?.tpl ? TPLS[n.tpl].name : id; };
export const Chip = ({ id, size = 22 }: { id: string; size?: number }) => { const n = sim.an.byId.get(id); if (!n?.tpl) return null; return <span className="chip-av" title={TPLS[n.tpl].name} style={{ background: TPLS[n.tpl].color, width: size, height: size, fontSize: Math.max(8, size * 0.42) }}>{TPLS[n.tpl].name[0]}</span>; };
export const Bar = ({ v, color, warn }: { v: number; color?: string; warn?: boolean }) => <div className="bar"><i style={{ width: `${Math.max(0, Math.min(1, v || 0)) * 100}%`, background: warn ? 'var(--bad)' : color }} /></div>;

/** Aggregate up to many frames into at most `max` visible cells. */
export function frameCells(max: number) {
  const F = sim.frames; const disp = sim.memCfg()?.res ?? max; const g = Math.max(1, Math.ceil(F.length / Math.min(max, disp))); const cells: { owner: string | null; loading: boolean; pinned: boolean; dirty: boolean; ref: boolean; n: number; from: number }[] = [];
  for (let i = 0; i < F.length; i += g) {
    let owner: string | null = null, loading = false, pinned = false, dirty = false, ref = false;
    for (let j = i; j < Math.min(F.length, i + g); j++) { const f = F[j]; if (f.owner && !owner) owner = f.owner; loading ||= f.loading; pinned ||= f.pinned; dirty ||= f.dirty && !!f.owner; ref ||= f.ref; }
    cells.push({ owner, loading, pinned, dirty, ref, n: Math.min(g, F.length - i), from: i });
  }
  return { cells, g };
}

function RamBody({ n }: { n: NodeDef }) {
  const m = sim.an.mem; const active = m.ram?.id === n.id; const info = sim.holeInfo(); const u = sim.ramUsage();
  if (!active) return <div className="note">Connect this RAM to a CPU or MMU.</div>;
  if (sim.cfgErr) return <div className="note bad">{sim.cfgErr}</div>;
  const { cells, g } = frameCells(256); const cols = cells.length > 128 ? 24 : cells.length > 64 ? 16 : 8;
  const legend = [...new Set(sim.frames.filter(f => f.owner && !isSysOwner(f.owner)).map(f => f.owner!))];
  return <>
    <div className="ramgrid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {cells.map((f, i) => <i key={i} className={`cell ${f.loading ? 'loading' : ''} ${f.pinned && f.owner !== 'kernel' ? 'pin' : ''} ${f.owner ? 'on' : ''}`} title={`Frame ${f.from}${g > 1 ? ` to ${f.from + f.n - 1}` : ''}: ${ownerName(f.owner)}`} style={f.owner ? { background: ownerColor(f.owner), opacity: f.loading ? 0.6 : 0.5 + (f.ref ? 0.5 : 0.2) } : undefined}>{f.dirty ? <b /> : null}</i>)}
    </div>
    <div className="row sp"><span className="mono">{fmtBytes((u.total - u.free) * sim.fb)} / {fmtBytes(u.total * sim.fb)} · {pct((u.total - u.free) / Math.max(1, u.total))}</span><span className="tag">{m.mode === 'paging' ? 'Paging' : 'Contiguous'}</span></div>
    <div className="mono small muted">{u.total} frames of {fmtBytes(sim.fb)}{sim.pagesPerFrame > 1 ? ` (${sim.pagesPerFrame} x ${fmtBytes(sim.pageReal)} pages)` : ''}</div>
    {m.mode === 'contig' && <div className="row sp mono small"><span>free {info.free}</span><span>largest hole {info.largest}</span><span>{info.holes} holes</span></div>}
    <div className="legend">{legend.map(id => <Chip key={id} id={id} size={16} />)}{u.kernel > 0 && <span className="kleg">kernel</span>}{u.pinned > 0 && <span className="pinleg">pinned</span>}</div>
  </>;
}
const isSysOwner = (o: string) => o === 'kernel' || o.startsWith('buf:');

const STATE_LABEL: Record<string, string> = { running: 'Running', ready: 'Ready', blocked: 'Blocked', new: 'Admitting', idle: 'Idle', done: 'Finished', killed: 'Killed' };
function TaskBody({ n }: { n: NodeDef }) {
  const t = sim.tasks.get(n.id); const tpl = TPLS[n.tpl!]; if (!t) return null;
  const prog = t.steps.length ? Math.max(0, t.idx) / t.steps.length : 0;
  const res = sim.frames.reduce((a, f) => a + (f.owner === t.id ? 1 : 0), 0) * sim.fb;
  return <>
    <div className="row sp"><span className={`state s-${t.state}`}>{STATE_LABEL[t.state]}</span><span className="mono small">{t.major} maj · {t.minor} min</span></div>
    <Bar v={t.state === 'done' ? 1 : prog} color={tpl.color} />
    <div className="mono small muted">{fmtBytes(res)} resident of {fmtBytes(+n.props.size || tpl.size)}</div>
    <div className="why">{t.why}</div>
  </>;
}

export function NodeCard({ n, selected, active }: { n: NodeDef; selected: boolean; active: boolean }) {
  const sz = nodeSize(n.kind); const cat = CAT[n.kind]; const isTask = n.kind === 'task';
  const title = isTask ? TPLS[n.tpl!].name : CATALOG[n.kind as keyof typeof CATALOG].label;
  let body: any = null; let sub = ''; let hot = false; const d = sim.devs.get(n.id); const P = n.props;
  if (n.kind === 'scheduler') {
    sub = ({ fcfs: 'FCFS', sjf: 'SJF', srtf: 'SRTF', prio: 'Priority', priop: 'Priority-P', rr: `RR ${P.quantum} ms`, mlfq: 'MLFQ' } as any)[P.policy];
    body = <><div className="lbl">Ready queue ({sim.readyQ.length})</div><div className="queue">{sim.readyQ.slice(0, 7).map(id => <Chip key={id} id={id} />)}{!sim.readyQ.length && <span className="muted small">empty</span>}</div><div className="mono small muted">{sim.stat.ctx} context switches</div></>;
  } else if (n.kind === 'cpu') {
    const c = sim.cores.get(n.id); const t = c?.task ? sim.tasks.get(c.task) : undefined; hot = !!t && t.state === 'running';
    sub = `${P.ghz} GHz · ${hot ? 'busy' : 'idle'}`; body = <div className="cpuface"><div className={`ring ${hot ? 'on' : ''}`}><Icon name="cpu" size={26} /></div><div><div className="small">{t ? TPLS[t.tpl as TplId].name : c ? 'Idle' : 'Connect to Scheduler'}</div>{c && <div className="mono small muted">{pct(c.ticks ? c.busy / c.ticks : 0)} utilised</div>}</div></div>;
  } else if (n.kind === 'mmu') {
    sub = ({ fifo: 'FIFO', lru: 'LRU', clock: 'Clock', lfu: 'LFU', random: 'Random' } as any)[P.repl]; const active = sim.an.mem.mmu?.id === n.id;
    body = <div className="mono small"><div className="kvl"><span>minor faults</span><b>{sim.stat.minor}</b></div><div className="kvl"><span>major faults</span><b className="warn">{sim.stat.major}</b></div><div className="kvl"><span>TLB {P.tlb ? `(${P.tlb})` : 'off'}</span><b>{P.tlb ? pct(sim.tlbRate()) : '-'}</b></div><div className="muted">{active ? 'paging active' : 'connect CPU and RAM'}</div></div>;
  } else if (n.kind === 'ram') { sub = `${fmtBytes(P.size)} · ${fmtBytes(P.page)} pages`; body = <RamBody n={n} />; }
  else if (n.kind === 'cache') {
    sub = fmtBytes(P.size); const dd = [...sim.devs.values()].find(x => sim.an.cacheOf.get(x.id)?.id === n.id); const h = dd?.hits ?? 0, m = dd?.misses ?? 0;
    body = <><Bar v={dd ? dd.cacheUsed / Math.max(1, P.size) : 0} color="var(--text)" /><div className="mono small">{fmtBytes(dd?.cacheUsed ?? 0)} used · {dd?.cache.length ?? 0} blocks</div><div className="mono small">hit {h} · miss {m} · {h + m ? Math.round((h / (h + m)) * 100) : 0}%</div></>;
  }
  else if (n.kind === 'buffer') { const b = sim.bufs.get(n.id); const lv = b && b.cap ? b.level / b.cap : 0; hot = !!b?.active; sub = fmtBytes(P.size); body = <><div className="tank"><i style={{ height: `${lv * 100}%` }} className={lv < 0.1 && b?.active ? 'low' : ''} /></div><div className="mono small"><div>{fmtBytes(b?.level ?? 0)} / {fmtBytes(b?.cap ?? 0)}</div><div>{b?.frames.length ? `${b.frames.length} pinned frames` : 'connect NIC, RAM and a task'}</div>{b?.starved && <div className="warn">Not enough free RAM to pin</div>}</div></>; }
  else if (n.kind === 'storage' || n.kind === 'usb') {
    const used = d?.used ?? 0; const full = used >= P.cap * 0.995; hot = !!d && d.cur.length > 0; sub = n.kind === 'usb' ? (P.plugged ? 'plugged' : 'UNPLUGGED') : `${P.type.toUpperCase()} · ${P.sched.toUpperCase()}`;
    body = <><div className="row sp small mono"><span>{fmtBytes(used)} / {fmtBytes(P.cap)}</span>{full && <span className="warn">FULL</span>}</div><Bar v={used / P.cap} color={cat} warn={full} />
      {n.kind === 'storage' && d && P.type !== 'ssd' && <div className="track"><i style={{ left: `${d.head}%` }} /></div>}
      <div className="queue">{d?.cur.map((o, k) => <span key={'c' + k} className="qchip cur"><Chip id={o.task} size={18} /></span>)}{d?.queue.slice(0, 5).map((o, k) => <Chip key={k} id={o.task} size={18} />)}</div>
      {n.kind === 'storage' && d && <div className="mono small muted">{fmtRate(P.rate)} · swap {fmtBytes(P.swap)}</div>}</>;
  } else if (n.kind === 'printer') { hot = !!d && d.cur.length > 0; sub = P.online ? 'online' : 'offline'; body = <><div className="paper">{hot && <i />}</div><div className="queue">{d?.cur.map((o, k) => <Chip key={'c' + k} id={o.task} size={18} />)}{d?.queue.map((o, k) => <Chip key={k} id={o.task} size={18} />)}</div><div className="mono small muted">{fmtRate(P.rate)}</div></>; }
  else if (n.kind === 'nic') { const flows = (d?.cur.length ?? 0) + [...sim.bufs.values()].filter(b => b.active).length; hot = flows > 0; sub = fmtRate(P.bw); body = <><div className="mono small">{flows ? `${flows} flows · ${fmtRate((d?.share ?? 0) * 100)} each` : 'idle'}</div><Bar v={flows ? 1 : 0} color="var(--text)" /><div className="queue">{d?.cur.map((o, k) => <Chip key={k} id={o.task} size={18} />)}</div></>; }
  else if (n.kind === 'gpu') { hot = !!d && d.cur.length > 0; sub = `${P.fps} fps cap`; body = <><div className="mono small">{d ? `${fmtNum(d.served)} frames rendered · queue ${d.queue.length}` : 'idle'}</div><div className="queue">{d?.cur.map((o, k) => <Chip key={'c' + k} id={o.task} size={18} />)}{d?.queue.map((o, k) => <Chip key={k} id={o.task} size={18} />)}</div></>; }
  else if (n.kind === 'driver') { const irq = [...sim.devs.values()].some(x => sim.an.driverOf.get(x.id) === n.id && sim.t - x.irqAt < 6); hot = irq; sub = irq ? 'interrupt' : 'listening'; body = <div className="small muted">Serving {[...sim.an.driverOf.entries()].filter(([, v]) => v === n.id).length} device(s)</div>; }
  else if (n.kind === 'container') {
    const cr = sim.conts.get(n.id); const members = [...sim.tasks.values()].filter(t => sim.an.attach.get(t.id)?.container === n.id); const lim = Math.max(1, Math.floor(P.mem / Math.max(1, sim.fb))); const res = sim.frames.filter(f => f.owner && members.some(m => m.id === f.owner)).length;
    sub = P.name; hot = res >= lim; body = <><div className="row sp small mono"><span>mem {fmtBytes(res * sim.fb)} / {fmtBytes(P.mem)}</span><span>OOM {cr?.oom ?? 0}</span></div><Bar v={res / lim} color={cat} warn={res >= lim} /><div className="row sp small mono"><span>CPU quota {P.cpuPct}%</span><span>{cr?.throttled ?? 0} throttled</span></div><Bar v={(cr?.tokens ?? 0) / 2} color="#ffb547" /><div className="ns">{['PID', 'NET', 'MNT'].map(x => <span key={x}>{x}</span>)}</div><div className="queue">{members.map(m => <Chip key={m.id} id={m.id} size={20} />)}</div></>;
  } else if (isTask) body = <TaskBody n={n} />;
  return (
    <div className={`node k-${n.kind} ${selected ? 'sel' : ''} ${hot ? 'hot' : ''} ${isTask && sim.tasks.get(n.id)?.state === 'killed' ? 'dead' : ''}`} style={{ left: n.x, top: n.y, width: sz.w, minHeight: sz.h, ['--c' as any]: cat }} data-node={n.id}>
      <div className="nhead" data-drag><span className="nicon"><Icon name={isTask ? 'task' : n.kind} size={19} /></span><div className="ntitle"><b>{title}</b>{sub && <small>{sub}</small>}</div>{n.kind === 'task' && <span className="prio" title="Priority (1 is highest)">P{n.props.prio ?? TPLS[n.tpl!].prio}</span>}</div>
      <div className="nbody">{body}</div>
      {['t', 'r', 'b', 'l'].map(s => <span key={s} className={`port p-${s}`} data-port={n.id} />)}
      {active && <span className="pulse" />}
    </div>
  );
}
