import { useEffect, useRef, useState } from 'react';
import { useModal } from './modal';
import { useStore, getTopo, getUI, setUI, actions, sim, SCENARIOS, toast } from '../store';
import { CATALOG, TPLS, GROUPS } from '../engine/data';
import type { Kind, TplId } from '../engine/types';
import { Icon } from './icons';
import { CAT } from './nodes';
import { fmtTicks, pct, fmtBytes } from '../units';
export { Inspector } from './inspector';
export { Dock } from './dock';

const Stat = ({ label, value, big, tone }: { label: string; value: string; big?: boolean; tone?: string }) => <div className={`stat ${big ? 'big' : ''} ${tone ?? ''}`}><small>{label}</small><b>{value}</b></div>;

export function Topbar() {
  const ui = useStore(() => getUI()); useStore(() => 0); const [menu, setMenu] = useState(false); const fileRef = useRef<HTMLInputElement>(null);
  const s = sim.stat; const util = sim.utilNow(); const fr = sim.thrashing(); const u = sim.ramUsage(); const ramU = u.total ? (u.total - u.free) / u.total : 0;
  const sc = SCENARIOS.find(x => x.id === ui.scenario); const np = sim.problems().filter(p => p.level === 'error').length;
  const dl = (name: string, text: string, type: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); };
  const exp = () => dl('ostown-setup.json', JSON.stringify(getTopo(), null, 1), 'application/json');
  const csv = () => { const rows = ['sim_ms,cpu_util,major_faults_per_window,ram_used,swap_used,ready_queue,device_queue,buffer_bytes,tlb_hit,link_busy,disk_busy', ...sim.samples.map(x => [x.t * 10, x.util.toFixed(4), x.faults, x.ram.toFixed(4), x.swap.toFixed(4), x.ready, x.io, Math.round(x.buf), x.tlb.toFixed(4), x.net.toFixed(4), x.disk.toFixed(4)].join(','))]; dl('ostown-metrics.csv', rows.join('\n'), 'text/csv'); };
  return <div className="topbar">
    <div className="brand glass"><div className="logo"><svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"><rect x="4" y="4" width="10" height="10" rx="2.5"/><rect x="18" y="4" width="10" height="10" rx="2.5"/><rect x="4" y="18" width="10" height="10" rx="2.5"/><rect x="18" y="18" width="10" height="10" rx="2.5" fill="currentColor"/></svg></div><div><b>OSTown</b><small>v3.3 · Systems Lab</small></div>
      <div className="menuwrap"><button className="pill" onClick={() => setMenu(!menu)}><span className="ptitle">{sc?.title ?? 'Custom'}</span><Icon name="chevD" size={14} /></button>
        {menu && <div className="menu glass" onMouseLeave={() => setMenu(false)}>{SCENARIOS.map(x => <button key={x.id} className={x.id === ui.scenario ? 'on' : ''} onClick={() => { actions.loadScenario(x.id); setMenu(false); }}><span><b>{x.title}</b><small>{x.tag}</small></span><em>{x.hook.slice(0, 80)}...</em></button>)}</div>}</div>
    </div>
    <div className="hud glass">
      <div className="ctl"><button className="ibtn big" aria-label="Play or pause (Space)" onClick={() => setUI({ playing: !ui.playing })} title="Play / pause (Space)">{ui.playing ? <Icon name="pause" /> : <Icon name="play" />}</button><button className="ibtn" aria-label="Step one tick" onClick={() => { setUI({ playing: false }); actions.step(1); }} title="Step one tick (10 ms)"><Icon name="step" /></button><button className="ibtn" aria-label="Reset simulation" onClick={actions.resetSim} title="Reset simulation"><Icon name="reset" /></button><button className="ibtn" aria-label="Undo (Ctrl+Z)" disabled={!actions.canUndo()} onClick={actions.undo} title="Undo (Ctrl+Z)"><Icon name="undo" /></button><button className="ibtn" aria-label="Redo (Ctrl+Shift+Z or Ctrl+Y)" disabled={!actions.canRedo()} onClick={actions.redo} title="Redo (Ctrl+Shift+Z / Ctrl+Y)"><Icon name="redo" /></button>
        <div className="speed">{[0.5, 1, 2, 4, 8, 16].map(v => <button key={v} className={ui.speed === v ? 'on' : ''} onClick={() => setUI({ speed: v })}>{v}x</button>)}</div></div>
      <div className="stats">
        <Stat label="CPU" value={pct(util)} big tone={util < 0.35 && fr > 8 ? 'bad' : ''} />
        <Stat label="RAM" value={pct(ramU)} tone={ramU > 0.95 ? 'warn' : ''} /><Stat label="Major faults" value={String(s.major)} tone={fr > 14 ? 'bad' : ''} /><Stat label="Finished" value={String(s.done)} /><Stat label="OOM" value={String(s.oom)} tone={s.oom ? 'bad' : ''} /><Stat label="Sim time" value={fmtTicks(sim.t)} />
      </div>
    </div>
    <div className="right glass">{np > 0 && <button className="ibtn alertb" onClick={() => setUI({ dock: 'problems', dockOpen: true })} title={`${np} configuration error(s)`}><Icon name="x" /><i>{np}</i></button>}<button className="ibtn" aria-label="Toggle theme" onClick={() => setUI({ theme: ui.theme === 'dark' ? 'light' : 'dark' })} title="Theme">{ui.theme === 'dark' ? <Icon name="sun" /> : <Icon name="moon" />}</button><button className="ibtn" aria-label="Export setup (JSON)" onClick={exp} title="Export setup (JSON)"><Icon name="download" /></button><button className="ibtn" aria-label="Export metrics (CSV)" onClick={csv} title="Export metrics (CSV)"><Icon name="list" /></button><button className="ibtn" aria-label="Import setup" onClick={() => fileRef.current?.click()} title="Import setup"><Icon name="upload" /></button><button className="pill learnb" onClick={() => setUI({ academy: true })} title="OSTown Academy: guided, interactive lessons"><Icon name="book" size={15} /> Academy</button><button className="ibtn" aria-label="Help" onClick={() => setUI({ welcome: true })} title="Help"><Icon name="help" /></button>
      <input ref={fileRef} type="file" accept="application/json" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { if (f.size > 2_000_000) throw 0; const j = JSON.parse(await f.text()); if (!actions.importTopo(j)) throw 0; toast('Setup loaded.', 'good'); } catch { toast('That file is not a valid setup.', 'bad'); } e.target.value = ''; }} /></div>
  </div>;
}

export function Palette() {
  const ui = useStore(() => getUI()); const [q, setQ] = useState('');
  if (!ui.left) return <button className="edge-toggle l glass" aria-label="Open components palette" title="Components" onClick={() => setUI(window.innerWidth <= 1100 ? { left: true, right: false } : { left: true })}><Icon name="plus" size={18} /></button>;
  const items: { kind: Kind; tpl?: TplId; label: string; group: string; blurb: string }[] = [...Object.values(CATALOG).map(c => ({ kind: c.kind as Kind, label: c.label, group: c.group, blurb: c.blurb })), ...Object.values(TPLS).map(t => ({ kind: 'task' as Kind, tpl: t.id, label: t.name, group: 'Workloads', blurb: t.blurb }))];
  const add = (it: typeof items[0]) => { const el = document.getElementById('stage')!; const r = el.getBoundingClientRect(); const view = (window as any).__view; const cx = (r.width / 2 - view.x) / view.z, cy = (r.height / 2 - view.y) / view.z; const k = getTopo().nodes.length; actions.addNode(it.kind, it.tpl, cx - 110 + (k % 4) * 60, cy - 90 + (k % 5) * 50); if (window.innerWidth <= 720) setUI({ left: false }); };
  return <div className="palette glass"><div className="phead"><b>Components</b><span className="mono">{items.length}</span><button className="ibtn s" aria-label="Close palette" onClick={() => setUI({ left: false })}><Icon name="x" size={15} /></button></div>
    <label className="search"><Icon name="search" size={15} /><input placeholder="Search components" value={q} onChange={e => setQ(e.target.value)} /></label>
    <div className="plist">{GROUPS.map(g => { const list = items.filter(i => i.group === g && (i.label + i.blurb).toLowerCase().includes(q.toLowerCase())); if (!list.length) return null; return <div key={g}><div className="gtitle">{g}</div>{list.map(it => <button key={it.label} className="pitem" draggable onDragStart={e => e.dataTransfer.setData('text/ostown', `${it.kind}:${it.tpl ?? ''}`)} onClick={() => add(it)} title={it.blurb}><span className="pic" style={{ ['--c' as any]: CAT[it.kind] }}><Icon name={it.kind === 'task' ? 'task' : it.kind} size={17} /></span><span><b>{it.label}</b></span></button>)}</div>; })}</div>
    <div className="phint">Click to add, or drag onto the canvas</div></div>;
}

export function Coach() {
  const ui = useStore(() => getUI()); useStore(() => 0); if (ui.coachOff) return null;
  const tips: { id: string; text: string; tone: string }[] = []; const T = [...sim.tasks.values()];
  const fr = sim.thrashing(); const util = sim.utilNow(); const orphan = T.filter(t => t.state === 'idle' && t.why.includes('not connected')).length;
  if (sim.t > 150 && fr > 14 && util < 0.7) tips.push({ id: 'thrash', tone: 'bad', text: 'High major fault rate with an idling CPU: this is thrashing. Add RAM, shrink the working sets or reduce the number of tasks.' });
  if (T.some(t => t.why.startsWith('External fragmentation'))) tips.push({ id: 'frag', tone: 'warn', text: 'There is enough free RAM in total, but not in one piece (external fragmentation). Compact memory or add an MMU.' });
  if (T.some(t => t.stalled)) tips.push({ id: 'underrun', tone: 'warn', text: `The video buffer ran dry. The stream needs more network bandwidth than it is getting. Raise bandwidth or the buffer size.` });
  if (T.some(t => t.why.includes('is full'))) tips.push({ id: 'full', tone: 'warn', text: 'A device is full and a task is blocked. Select the device and free some space.' });
  if (T.some(t => t.why.includes('unplugged'))) tips.push({ id: 'usb', tone: 'warn', text: 'The USB drive is unplugged. The task is blocked, not burning CPU. Plug the drive back in.' });
  if (T.some(t => t.cfgErr)) tips.push({ id: 'cfg', tone: 'warn', text: 'A task is too large to simulate at this RAM size. Select RAM and press "Fit workloads to RAM".' });
  if (sim.stat.oom > 0 && sim.t % 2 === 0) tips.push({ id: 'oom', tone: 'bad', text: 'The OOM killer stopped a task. Inside a container the kill stays local, otherwise it hits the whole system.' });
  if (orphan > 0) tips.push({ id: 'orphan', tone: 'info', text: `${orphan} task(s) are not connected. Drag from the dot on a task's edge to the Scheduler.` });
  const tip = tips.find(t => !ui.dismissed.includes(t.id)); if (!tip) return null;
  return <div className={`coach ${tip.tone}`}><div>{tip.text}</div><button onClick={() => setUI({ dismissed: [...ui.dismissed, tip.id] })}><Icon name="x" size={13} /></button></div>;
}

export function Toast() { const ui = useStore(() => getUI()); return ui.toast ? <div className={`toast ${ui.toast.tone}`} key={ui.toast.id}>{ui.toast.text}</div> : null; }

export function Welcome() {
  const ui = useStore(() => getUI()); if (!ui.welcome) return null;
  const close = () => setUI({ welcome: false, playing: true });
  return <WelcomeBody close={close} />;
}
function WelcomeBody({ close }: { close: () => void }) {
  const ref = useRef<HTMLDivElement>(null); useModal(ref);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [close]);
  return <div className="welcome" onClick={close}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Welcome to OSTown" className="wcard glass" onClick={e => e.stopPropagation()}><button className="ibtn s wclose" aria-label="Close welcome" onClick={close}><Icon name="x" size={14} /></button>
    <h1>OSTown <em>v3.3</em></h1><p className="lead">An operating-systems systems lab. No code, no assembly. Wire components together, type real sizes, and watch scheduling, paging, virtual memory, buffers, devices and containers behave.</p>
    <div className="wgrid"><div><b>1. Build</b><small>Add components from the palette. Drag from the dot on a node's edge to connect it.</small></div><div><b>2. Configure</b><small>Select any node. Type RAM, disk, cache and buffer sizes in B, KB, MB, GB or TB (try 12 bytes or 8 GB).</small></div><div><b>3. Measure</b><small>Metrics, Gantt, graphs, memory map, page tables and event log update live. Export CSV any time.</small></div></div>
    <div className="row gap center"><button className="btn primary" onClick={close}>Open the Everyday Workstation</button><button className="btn" onClick={() => { actions.loadScenario('bytes'); close(); }}>Bytes Lab</button><button className="btn" onClick={() => { actions.loadScenario('blank'); close(); }}>Blank canvas</button></div>
  </div></div>;
}
void fmtBytes;
