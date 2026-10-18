import { useEffect, useRef, useState } from 'react';
import { setUI, getUI } from '../store';
import { LESSONS, SECTIONS, lessonById } from '../engine/academy/lessons';
import { Base, type Tone } from '../engine/academy/types';
import { CacheSim, type Pattern } from '../engine/academy/cachehw';
import { BootSim } from '../engine/academy/boot';
import { ProcTree } from '../engine/academy/proctree';
import { SyscallSim } from '../engine/academy/syscall';
import { Vfs, USERS, permStr } from '../engine/academy/vfs';
import { PipeSim } from '../engine/academy/pipes';
import { NetStack, LAYERS } from '../engine/academy/netstack';
import { SystemdSim } from '../engine/academy/systemd';
import { ThreadSim, type LockId } from '../engine/academy/threads';
import { IrqSim, type Mode } from '../engine/academy/irq';
import { NamespaceSim } from '../engine/academy/namespaces';
import { SecuritySim } from '../engine/academy/security';
import { Icon } from './icons';
import { useModal } from './modal';

import { ACADEMY_DONE_KEY as DONE_KEY } from "../store";
export const parseDone = (raw: string | null): string[] => {
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && LESSONS.some(l => l.id === x)))] : []; } catch { return []; }
};
const loadDone = (): string[] => { let raw: string | null = null; try { raw = localStorage.getItem(DONE_KEY); } catch { return []; } const d = parseDone(raw); if (raw !== null && JSON.stringify(d) !== raw) { try { localStorage.setItem(DONE_KEY, JSON.stringify(d)); } catch {} } return d; };

type Eng = Base;
function makeEngine(id: string): Eng {
  switch (id) {
    case 'cachehw': return new CacheSim();
    case 'boot': return new BootSim();
    case 'proctree': return new ProcTree();
    case 'syscall': return new SyscallSim();
    case 'vfs': return new Vfs();
    case 'pipes': return new PipeSim();
    case 'netstack': return new NetStack();
    case 'systemd': return new SystemdSim();
    case 'threads': return new ThreadSim();
    case 'irq': return new IrqSim();
    case 'namespaces': return new NamespaceSim();
    case 'security': return new SecuritySim();
    default: return new Base();
  }
}

const toneIcon: Record<Tone, string> = { info: 'list', good: 'check', warn: 'flag', bad: 'x' };
export function Log({ e }: { e: Eng }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight); }, [e.log.length]);
  return <div className="alog" ref={ref}>{e.log.map((l, i) => <div key={i} className={`aline ${l.tone}`}><Icon name={toneIcon[l.tone]} size={13} /><span>{l.text}</span></div>)}</div>;
}

/* ---------- per-lesson stages ---------- */

function CacheViz({ e, bump }: { e: CacheSim; bump: () => void }) {
  const [last, setLast] = useState('');
  const step = (n: number) => {
    let r = { line: 0, hit: -1 };
    for (let i = 0; i < n; i++) r = e.step();
    setLast(`Access to line ${r.line}: ${r.hit < 0 ? 'RAM (miss everywhere)' : e.levels[r.hit].name + ' hit'}`);
    bump();
  };
  const pats: [Pattern, string][] = [['loop', 'Tight loop'], ['seq', 'Sequential'], ['rand', 'Random']];
  const sizes: [number, number[]][] = [[0, [8, 16, 32, 64]], [1, [128, 256, 512, 1024]], [2, [2048, 8192, 16384, 32768]]];
  return <div className="stagebox">
    <div className="pyr">
      {e.levels.map((l, i) => <div className="plvl" key={l.name} style={{ width: `${34 + i * 22}%` }}>
        <b>{l.name}</b><span className="mono">{l.sizeKB >= 1024 ? `${l.sizeKB / 1024} MB` : `${l.sizeKB} KB`} · ~{l.cycles} cycles · {e.assocLabel(l)}</span>
        <div className="bar"><i style={{ width: `${e.hitRate(i) * 100}%` }} /></div>
        <span className="mono small">hits {l.hits} · misses {l.misses} · {Math.round(e.hitRate(i) * 100)}% hit</span>
      </div>)}
      <div className="plvl ram" style={{ width: '100%' }}><b>RAM</b><span className="mono">GBs · ~{e.ramCycles} cycles</span><span className="mono small">served when all levels miss</span></div>
    </div>
    <div className="stat-row">
      <div className="stat big"><small>Average cycles per access</small><b>{e.avgCycles().toFixed(1)}</b></div>
      <div className="stat"><small>Accesses</small><b>{e.accesses}</b></div>
    </div>
    {last && <div className="callout live">{last}</div>}
    <div className="btnrow">
      <button className="btn" onClick={() => step(1)}>One access</button>
      <button className="btn" onClick={() => step(1000)}>Run 1000 accesses</button>
      {pats.map(([p, l]) => <button key={p} className={`chip ${e.pattern === p ? 'on' : ''}`} onClick={() => { e.setPattern(p); bump(); }}>{l}</button>)}
      <button className="chip" onClick={() => { e.resetStats(); setLast(''); bump(); }}>Reset</button>
    </div>
    <div className="btnrow">{sizes.map(([i, opts]) => <span key={i} className="chips"><em>{e.levels[i].name}:</em>{opts.map(kb => <button key={kb} className={`chip ${e.levels[i].sizeKB === kb ? 'on' : ''}`} onClick={() => { e.setSize(i, kb); bump(); }}>{kb >= 1024 ? `${kb / 1024}MB` : `${kb}KB`}</button>)}</span>)}</div>
    <div className="btnrow">{e.levels.map((lv, i) => <span key={i} className="chips"><em>{lv.name} mapping:</em>{([[0, 'Full'], [1, 'Direct'], [2, '2-way'], [4, '4-way'], [8, '8-way']] as [number, string][]).map(([w, l]) => <button key={w} className={`chip ${lv.ways === w ? 'on' : ''}`} onClick={() => { e.setAssoc(i, w); bump(); }}>{l}</button>)}</span>)}</div>
  </div>;
}

function BootViz({ e, bump }: { e: BootSim; bump: () => void }) {
  useEffect(() => { if (!e.running) return; const id = setInterval(() => { e.tick(); bump(); }, 40); return () => clearInterval(id); });
  return <div className="stagebox">
    <div className="btnrow">
      <button className="btn primary" onClick={() => { e.power(); bump(); }} disabled={e.running || e.done || !!e.failed}><Icon name="bolt" size={15} /> Power on</button>
      {(['disk', 'boot', 'kernel'] as const).map(k => <button key={k} className={`chip ${e.ok[k] ? '' : 'bad'}`} onClick={() => { e.setFault(k, !e.ok[k]); bump(); }}>{k === 'disk' ? 'disk OK' : k === 'boot' ? 'bootloader OK' : 'kernel OK'}</button>)}
      <button className="chip" onClick={() => { e.reset(); bump(); }}>Reset</button>
      <span className="grow" /><span className="mono small">{Math.round(e.progress * 100)}%</span>
    </div>
    <div className="prog"><i style={{ width: `${e.progress * 100}%` }} /></div>
    <div className="stages">{e.stages.map(s => <div key={s.id} className={`bstage ${s.state}`}>
      <span className="sdot">{s.state === 'done' ? <Icon name="check" size={13} /> : s.state === 'fail' ? <Icon name="x" size={13} /> : s.state === 'active' ? <Icon name="step" size={13} /> : null}</span>
      <div><b>{s.name}</b><p>{s.desc}</p></div></div>)}
    </div>
  </div>;
}

function ProcViz({ e, bump }: { e: ProcTree; bump: () => void }) {
  const [sel, setSel] = useState(1);
  const p = e.get(sel);
  const rows = (pid: number, depth: number): any[] => [{ pid, depth }, ...e.children(pid).flatMap(c => rows(c.pid, depth + 1))];
  const act = (f: () => void) => { f(); bump(); };
  return <div className="stagebox">
    <div className="ptree">{rows(1, 0).map(({ pid, depth }) => { const q = e.get(pid)!; return <button key={pid} className={`pnode ${q.state} ${sel === pid ? 'sel' : ''}`} style={{ marginLeft: depth * 26 }} onClick={() => setSel(pid)}>
      <span className="mono">PID {pid}</span><b>{q.name}</b><span className={`badge ${q.state}`}>{q.state}{q.state === 'zombie' ? ` (exit ${q.exitCode})` : ''}</span>
    </button>; })}</div>
    {p && p.state !== 'dead' && <div className="btnrow">
      <button className="btn" onClick={() => act(() => { const c = e.fork(sel); if (c) setSel(c.pid); })}>fork()</button>
      <button className="btn" onClick={() => act(() => e.exec(sel, 'nginx'))}>execve("nginx")</button>
      <button className="btn" onClick={() => act(() => e.exit(sel))}>exit(0)</button>
      <button className="btn" onClick={() => act(() => e.wait(sel))}>wait()</button>
      <span className="chips"><em>kill:</em>
        <button className="chip" onClick={() => act(() => e.signal(sel, 'TERM'))}>TERM</button>
        <button className="chip bad" onClick={() => act(() => e.signal(sel, 'KILL'))}>KILL</button>
        <button className="chip" onClick={() => act(() => e.signal(sel, 'STOP'))}>STOP</button>
        <button className="chip" onClick={() => act(() => e.signal(sel, 'CONT'))}>CONT</button></span>
    </div>}
    <div className="btnrow"><label className="chip lbl"><input type="checkbox" checked={!!p?.handler} onChange={ev => { if (p) p.handler = ev.target.checked; bump(); }} /> SIGTERM handler installed on PID {sel}</label></div>
  </div>;
}

function SyscallViz({ e, bump }: { e: SyscallSim; bump: () => void }) {
  const cur = e.rows[e.rows.length - 1];
  return <div className="stagebox">
    <div className="stat-row">
      <div className={`stat big ${e.mode === 'kernel' ? 'warn' : ''}`}><small>CPU privilege</small><b>{e.mode === 'kernel' ? 'ring 0 (kernel)' : 'ring 3 (user)'}</b></div>
      <div className="stat"><small>Program position</small><b>{e.idx + 1} / {e.program.length}</b></div>
    </div>
    <button className="btn primary" onClick={() => { e.step(); bump(); }} disabled={e.doneAll}>{e.doneAll ? 'Program finished' : 'Execute next line'}</button>
    {cur && <div className="callout live"><b>{cur.call}</b> &rarr; {cur.ret}<br />{cur.detail}</div>}
    <table className="ttab"><thead><tr><th>Line</th><th>Mode</th><th>Result</th></tr></thead><tbody>
      {e.rows.map((r, i) => <tr key={i}><td className="mono">{r.call}</td><td>{r.mode === 'kernel' ? <span className="badge warn">trap to kernel</span> : <span className="badge">user</span>}</td><td className="mono">{r.ret}</td></tr>)}
    </tbody></table>
  </div>;
}

function VfsViz({ e, bump }: { e: Vfs; bump: () => void }) {
  const [dir, setDir] = useState('/');
  const entries = e.resolve(dir)?.children ?? [];
  const act = (f: () => void) => { f(); bump(); };
  const dirs = ['/', '/home', '/home/alice', '/home/bob', '/etc'];
  return <div className="stagebox">
    <div className="btnrow">
      <span className="chips"><em>user:</em>{Object.keys(USERS).map(u => <button key={u} className={`chip ${e.uid === u ? 'on' : ''}`} onClick={() => act(() => e.who(u))}>{u}</button>)}</span>
      <span className="chips"><em>dir:</em>{dirs.map(d => <button key={d} className={`chip ${dir === d ? 'on' : ''}`} onClick={() => setDir(d)}>{d}</button>)}</span>
      <button className="chip" onClick={() => act(() => e.mkfile(dir, 'new.txt'))}>touch new.txt here</button>
    </div>
    <table className="ttab"><thead><tr><th>perms</th><th>owner:group</th><th>inode</th><th>links</th><th>name</th><th>try as {e.uid}</th></tr></thead><tbody>
      {entries.map(n => { const path = (dir === '/' ? '' : dir) + '/' + n.name; return <tr key={n.name}>
        <td className="mono">{permStr(n.perms, n.dir)}</td><td className="mono">{n.owner}:{n.group}</td><td className="mono">{n.ino}</td><td className="mono">{n.links}</td>
        <td>{n.dir ? <button className="linkb" onClick={() => setDir(path)}>{n.name}/</button> : n.name}</td>
        {!n.dir && <td className="rowbtns">
          <button className="chip" onClick={() => act(() => e.open(path, 'read'))}>open r</button>
          <button className="chip" onClick={() => act(() => e.open(path, 'write'))}>open w</button>
          <button className="chip" onClick={() => act(() => e.link(path))}>ln</button>
          <button className="chip" onClick={() => act(() => e.unlink(path))}>rm</button>
          <button className="chip" onClick={() => act(() => e.chmod(path, { o: { r: true, w: false, x: false } }))}>chmod o+r</button>
        </td>}</tr>; })}
    </tbody></table>
  </div>;
}

function PipeViz({ e, bump }: { e: PipeSim; bump: () => void }) {
  const tick = (n: number) => { for (let i = 0; i < n; i++) e.tick(); bump(); };
  return <div className="stagebox">
    <div className="pipeflow">
      <div className={`pend ${e.pState}`}><b>Producer</b><span className={`badge ${e.pState === 'blocked' ? 'warn' : e.pState}`}>{e.pState}</span><span className="mono small">{e.written}/{e.total} B written</span></div>
      <div className="tube">{Array.from({ length: e.cap }).map((_, i) => <i key={i} className={i < e.buf.length ? 'full' : ''} />)}</div>
      <div className={`pend ${e.cState}`}><b>Consumer</b><span className={`badge ${e.cState === 'blocked' ? 'warn' : e.cState}`}>{e.cState}</span><span className="mono small">{e.read} B read</span></div>
    </div>
    <div className="btnrow">
      <button className="btn" onClick={() => tick(1)}>Step</button><button className="btn" onClick={() => tick(10)}>Step x10</button>
      {[['4x producer', 4, 1], ['balanced', 2, 2], ['4x consumer', 1, 4]].map(([l, p, c]) => <button key={l as string} className="chip" onClick={() => { e.setRates(p as number, c as number); bump(); }}>{l}</button>)}
      <button className="chip" onClick={() => { const p = new PipeSim(); Object.assign(e, p); bump(); }}>Reset</button>
    </div>
  </div>;
}

function NetViz({ e, bump }: { e: NetStack; bump: () => void }) {
  const pos = e.pos;
  const stackSide = (up: boolean) => <div className="nstack">{(up ? [...LAYERS].reverse() : LAYERS).map(l => {
    const li = LAYERS.indexOf(l); const here = !up ? pos === li : pos === 8 - li;
    const wrapped = !up && pos > li; const stripped = up && pos > 8 - li;
    return <div key={l.name} className={`nlayer ${here ? 'here' : ''} ${wrapped || stripped ? 'done' : ''}`} style={{ ['--c' as any]: l.color }}>
      <b>{l.name}</b><span className="mono small">{wrapped || (here && !up) ? '+ ' + l.header : stripped ? '- ' + l.header.split(' ')[0] + '...' : ''}</span>
    </div>; })}</div>;
  return <div className="stagebox">
    <div className="btnrow">
      <button className="btn primary" onClick={() => { e.send(); bump(); }} disabled={e.sent}>Send request</button>
      <button className="btn" onClick={() => { e.step(); bump(); }} disabled={!e.sent || pos >= 9}>Hop</button>
      <button className={`chip ${e.lossy ? 'bad' : ''}`} onClick={() => { e.lossy = !e.lossy; bump(); }}>packet loss {e.lossy ? 'on' : 'off'}</button>
      <button className="chip" onClick={() => { e.reset(); bump(); }}>Reset</button>
      {e.retransmits > 0 && <span className="badge warn">{e.retransmits} retransmit</span>}
    </div>
    <div className="netwrap">{stackSide(false)}<div className={`wire ${pos === 4 ? 'hot' : ''}`}>{pos === 4 ? ')))' : ''}</div>{stackSide(true)}</div>
  </div>;
}

function SystemdViz({ e, bump }: { e: SystemdSim; bump: () => void }) {
  useEffect(() => { if (!e.running || e.done) return; const id = setInterval(() => { e.tick(); bump(); }, 60); return () => clearInterval(id); });
  const max = Math.max(e.seqTotal, e.t, 1);
  return <div className="stagebox">
    <div className="btnrow">
      <button className="btn primary" onClick={() => { e.start(); bump(); }} disabled={e.running}>Boot user space</button>
      <span className="mono small">parallel: {e.t} ticks · sequential sysvinit would take: {e.seqTotal} ticks</span>
    </div>
    <div className="units">{e.units.map(u => <div key={u.name} className={`unit ${u.state}`}>
      <b className="mono">{u.name}</b><small>{u.after.length ? 'After: ' + u.after.join(', ') : 'no dependencies'}</small>
      <div className="ubar"><i style={{ left: `${(u.startedAt < 0 ? 0 : u.startedAt) / max * 100}%`, width: `${(u.doneAt < 0 ? (u.startedAt < 0 ? 0 : e.t - u.startedAt) : u.doneAt - u.startedAt) / max * 100}%` }} /></div>
    </div>)}</div>
  </div>;
}

function ThreadsViz({ e, bump }: { e: ThreadSim; bump: () => void }) {
  const edges = e.waitForEdges();
  const act = (f: () => void) => { f(); bump(); };
  const ord = (t: number): LockId[] => e.threads[t].program;
  const setOrd = (t: number, o: LockId[]) => { const p = e.threads.map(x => [...x.program]); p[t] = o; e.reset(); e.threads.forEach((x, i) => x.program = p[i]); bump(); };
  return <div className="stagebox">
    <div className="threads">
      {e.threads.map((th, i) => <div key={th.id} className={`thread ${th.state}`}>
        <div className="thead"><b>{th.id}</b><span className={`badge ${th.state === 'blocked' ? 'warn' : th.state}`}>{th.state}</span></div>
        <div className="mono small">locks wanted: {th.program.join(' then ')}</div>
        <div className="mono small">holding: {th.held.join(', ') || 'nothing'}{th.waiting ? ` · waiting for ${th.waiting}` : ''}</div>
        <div className="btnrow"><span className="chips"><em>order:</em>
          <button className={`chip ${ord(i).join('') === 'AB' ? 'on' : ''}`} onClick={() => setOrd(i, ['A', 'B'])}>A then B</button>
          <button className={`chip ${ord(i).join('') === 'BA' ? 'on' : ''}`} onClick={() => setOrd(i, ['B', 'A'])}>B then A</button></span></div>
      </div>)}
      <div className={`wfg ${e.deadlocked ? 'dead' : ''}`}>
        <b>Wait-for graph</b>
        <div className="mono">{edges.length ? edges.map(([a, b]) => `${a} -> ${b}`).join('   ') : 'no waits'}</div>
        {e.deadlocked && <div className="badge bad">cycle: deadlock</div>}
      </div>
      <div className="locks">{(['A', 'B'] as LockId[]).map(l => <div key={l} className={`lock ${e.owner[l] ? 'held' : ''}`}><b>mutex {l}</b><span className="mono small">{e.owner[l] ? `held by ${e.owner[l]}` : 'free'}</span></div>)}</div>
    </div>
    <div className="btnrow"><button className="btn" onClick={() => act(() => e.stepSched())}>Step scheduler</button><button className="chip" onClick={() => act(() => e.reset())}>Restart</button></div>
  </div>;
}

function IrqViz({ e, bump }: { e: IrqSim; bump: () => void }) {
  const seg = (s: { start: number; end: number; kind: string }, i: number) => <i key={i} className={`seg ${s.kind}`} style={{ left: s.start / 200 * 100 + '%', width: (s.end - s.start) / 200 * 100 + '%' }} title={`${s.kind} ${s.start}-${s.end}`} />;
  const dev = e.transfers || e.phase ? [{ start: Math.max(0, e.devEnd - 60), end: e.devEnd, kind: 'copy' }] : [];
  return <div className="stagebox">
    <div className="btnrow">
      {(['poll', 'irq', 'dma'] as Mode[]).map(m => <button key={m} className={`chip ${e.mode === m ? 'on' : ''}`} onClick={() => { e.setMode(m); bump(); }}>{m === 'poll' ? 'Programmed I/O' : m === 'irq' ? 'Interrupts' : 'DMA'}</button>)}
      <button className="btn" onClick={() => { e.runBlock(); bump(); }} disabled={e.done}>Transfer block {Math.min(3, e.phase + 1)}/3</button>
      <button className="chip" onClick={() => { e.reset(); bump(); }}>Reset</button>
    </div>
    <div className="lanes">
      <div className="lane"><span>CPU</span><div className="track2">{e.cpu.map(seg)}</div></div>
      <div className="lane"><span>Device</span><div className="track2">{dev.map(seg)}</div></div>
    </div>
    <div className="legend mono small"><i className="seg app" /> app work <i className="seg poll" /> polling <i className="seg idle" /> idle <i className="seg handler" /> IRQ handler <i className="seg copy" /> copying <i className="seg setup" /> DMA setup</div>
    <div className="stat-row">
      <div className="stat"><small>CPU cycles wasted on I/O</small><b className={e.wasted > 100 ? 'warn' : ''}>{e.wasted}</b></div>
      <div className="stat"><small>Useful app cycles</small><b>{e.useful}</b></div>
    </div>
  </div>;
}

function NsViz({ e, bump }: { e: NamespaceSim; bump: () => void }) {
  return <div className="stagebox">
    <div className="nstwo">
      <div className="nsbox"><b>Host</b><span className="mono small">sees all PIDs, all interfaces, real root fs</span><span className="mono small">{e.hostMemMB} MB RAM</span></div>
      <div className="nsbox cont"><b>Container</b><span className="mono small">own PID 1, own port 80, own hostname</span><span className="mono small">limits: {e.cpuLimit}% CPU · {e.memLimitMB} MB RAM</span></div>
    </div>
    <table className="ttab"><thead><tr><th>Namespace</th><th>Isolates</th><th>State</th></tr></thead><tbody>
      {e.ns.map(n => <tr key={n.id}><td className="mono">{n.name}</td><td>{n.what}</td>
        <td><button className={`switch ${n.isolated ? 'on' : ''}`} role="switch" aria-checked={n.isolated} onClick={() => { e.toggle(n.id); bump(); }}><i /></button></td></tr>)}
    </tbody></table>
    <div className="btnrow"><span className="chips"><em>cgroup CPU:</em>{[25, 50, 100].map(p => <button key={p} className={`chip ${e.cpuLimit === p ? 'on' : ''}`} onClick={() => { e.setCpu(p); bump(); }}>{p}%</button>)}</span>
      <span className="chips"><em>cgroup memory:</em>{[128, 256, 512].map(m => <button key={m} className={`chip ${e.memLimitMB === m ? 'on' : ''}`} onClick={() => { e.setMem(m); bump(); }}>{m} MB</button>)}</span></div>
  </div>;
}

function SecViz({ e, bump }: { e: SecuritySim; bump: () => void }) {
  return <div className="stagebox">
    <div className="btnrow col">{e.cases.map((c, i) => {
      const ran = e.attempts.includes(c);
      return <button key={i} className={`attempt ${ran ? (c.ok ? 'ok' : 'no') : ''}`} onClick={() => { e.run(i); bump(); }}>
        <span><b>{c.label}</b><small className="mono">{c.actor} · ring {c.ring} · {c.action}</small></span>
        {ran && <span className={`badge ${c.ok ? 'good' : 'bad'}`}>{c.ok ? 'allowed' : 'denied'}</span>}
      </button>; })}</div>
    {e.attempts.length > 0 && <div className="callout live"><b>{e.attempts[e.attempts.length - 1].label}:</b> {e.attempts[e.attempts.length - 1].why}</div>}
  </div>;
}

/* ---------- player shell ---------- */

export function Academy() {
  const ui = getUI();
  const id = ui.academyLesson || 'cachehw';
  const lesson = lessonById(id) ?? LESSONS[0];
  const engRef = useRef<Map<string, Eng>>(new Map());
  const [, setVer] = useState(0);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<string[]>(loadDone);
  const dlg = useRef<HTMLDivElement>(null); useModal(dlg);
  const bump = () => setVer(v => v + 1);
  const eng = engRef.current.get(lesson.id) ?? (() => { const e = makeEngine(lesson.id); engRef.current.set(lesson.id, e); return e; })();
  const openLesson = (lid: string) => { setUI({ academyLesson: lid }); setStep(0); };
  const finish = () => { const d = [...new Set([...done, lesson.id])]; setDone(d); try { localStorage.setItem(DONE_KEY, JSON.stringify(d)); } catch {} const next = LESSONS[LESSONS.indexOf(lesson) + 1]; if (next) openLesson(next.id); };
  const st = lesson.steps[Math.min(step, lesson.steps.length - 1)];
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setUI({ academy: false }); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const viz = (() => {
    switch (lesson.id) {
      case 'cachehw': return <CacheViz e={eng as CacheSim} bump={bump} />;
      case 'boot': return <BootViz e={eng as BootSim} bump={bump} />;
      case 'proctree': return <ProcViz e={eng as ProcTree} bump={bump} />;
      case 'syscall': return <SyscallViz e={eng as SyscallSim} bump={bump} />;
      case 'vfs': return <VfsViz e={eng as Vfs} bump={bump} />;
      case 'pipes': return <PipeViz e={eng as PipeSim} bump={bump} />;
      case 'netstack': return <NetViz e={eng as NetStack} bump={bump} />;
      case 'systemd': return <SystemdViz e={eng as SystemdSim} bump={bump} />;
      case 'threads': return <ThreadsViz e={eng as ThreadSim} bump={bump} />;
      case 'irq': return <IrqViz e={eng as IrqSim} bump={bump} />;
      case 'namespaces': return <NsViz e={eng as NamespaceSim} bump={bump} />;
      case 'security': return <SecViz e={eng as SecuritySim} bump={bump} />;
      default: return null;
    }
  })();
  return <div className="acad" ref={dlg} tabIndex={-1} role="dialog" aria-modal="true" aria-label="OSTown Academy">
    <div className="ahead glass">
      <div className="logo"><svg viewBox="0 0 32 32" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"><rect x="4" y="4" width="10" height="10" rx="2.5" /><rect x="18" y="4" width="10" height="10" rx="2.5" /><rect x="4" y="18" width="10" height="10" rx="2.5" /><rect x="18" y="18" width="10" height="10" rx="2.5" fill="currentColor" /></svg></div>
      <b>Academy</b><small>{done.length} of {LESSONS.length} lessons done</small>
      <span className="grow" />
      <button className="ibtn" onClick={() => setUI({ academy: false })} title="Back to the lab (Esc)" aria-label="Back to the lab"><Icon name="x" /></button>
    </div>
    <div className="abody">
      <div className="alist glass">
        {SECTIONS.map(sec => <div key={sec}><div className="gtitle">{sec}</div>
          {LESSONS.filter(l => l.section === sec).map(l => <button key={l.id} className={`litem ${l.id === lesson.id ? 'on' : ''}`} onClick={() => openLesson(l.id)}>
            <span className={`ldot ${done.includes(l.id) ? 'done' : ''}`}>{done.includes(l.id) && <Icon name="check" size={11} />}</span>
            <span><b>{l.title}</b><small>{l.minutes} min</small></span></button>)}
        </div>)}
      </div>
      <div className="lmain">
        <div className="lhead glass"><div className="tag">{lesson.section}</div><h2>{lesson.title}</h2><p className="muted">{lesson.tagline}</p>
          <div className="stepdots">{lesson.steps.map((_, i) => <button key={i} className={i === step ? 'on' : i < step ? 'past' : ''} onClick={() => setStep(i)} aria-label={`Step ${i + 1}`} />)}</div>
        </div>
        <div className="lstep glass"><h3>{st.title}</h3><p>{st.body}</p>{st.ask && <div className="callout live"><b>Try it:</b> {st.ask}</div>}
          <div className="btnrow">
            <button className="btn" onClick={() => setStep(step - 1)} disabled={step === 0}>Back</button>
            {step < lesson.steps.length - 1 ? <button className="btn primary" onClick={() => setStep(step + 1)}>Next</button>
              : <button className="btn primary" onClick={finish}>{LESSONS.indexOf(lesson) < LESSONS.length - 1 ? 'Finish, next lesson' : 'Finish'}</button>}
          </div></div>
        <div className="lstage glass">{viz}</div>
        <div className="llog glass"><Log e={eng} /></div>
      </div>
    </div>
  </div>;
}
