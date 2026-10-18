import { useSyncExternalStore } from 'react';
import { Sim } from './engine/sim';
import { LESSONS } from './engine/academy/lessons';
import { SCENARIOS, scenarioById, newId } from './engine/scenarios';
import { CATALOG, TPLS, canLink, linkWhy, nodeSize, taskDefaults } from './engine/data';
import { sanitizeTopology } from './engine/sanitize';
import { spreadNodes } from './geometry';
import type { Kind, NodeDef, Topology, TplId, Props } from './engine/types';

export interface UI {
  scenario: string; selected: { type: 'node' | 'edge' | 'none'; id?: string }; theme: 'dark' | 'light'; playing: boolean; speed: number;
  dock: 'metrics' | 'gantt' | 'graphs' | 'procs' | 'memory' | 'pages' | 'addr' | 'devices' | 'log' | 'problems'; dockOpen: boolean; left: boolean; right: boolean; rightTab: 'inspect' | 'guide'; logFilter: string;
  toast: { id: number; text: string; tone: 'info' | 'bad' | 'good' } | null; welcome: boolean; coachOff: boolean; dismissed: string[]; lang: 'en'; academy: boolean; academyLesson: string;
}

const LS = 'ostown.v32'; const LS_LEGACY = 'ostown2.v2';
export const ACADEMY_DONE_KEY = 'ostown2.academy.done';
export const clearSaved = () => { try { localStorage.removeItem(LS); localStorage.removeItem(LS_LEGACY); localStorage.removeItem(ACADEMY_DONE_KEY); } catch {} };
function loadSaved(): { topo?: unknown; ui?: Partial<UI> } {
  try {
    let raw = localStorage.getItem(LS);
    if (raw === null) { const old = localStorage.getItem(LS_LEGACY); if (old !== null) { raw = old; try { localStorage.setItem(LS, old); localStorage.removeItem(LS_LEGACY); } catch {} } }
    const v = JSON.parse(raw || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: { topo?: unknown; ui?: Partial<UI> } = {};
    if (v.topo && typeof v.topo === 'object') out.topo = v.topo;
    if (v.ui && typeof v.ui === 'object' && !Array.isArray(v.ui)) out.ui = v.ui;
    return out;
  } catch { return {}; }
}
const saved: { topo?: unknown; ui?: Partial<UI> } = typeof localStorage !== 'undefined' ? loadSaved() : {};
const firstScenario = scenarioById('workstation');

// A corrupted save must never take the app down: sanitize, repair, and fall back to a fresh canvas.
let topo: Topology = firstScenario.build(); const saveNotes: string[] = [];
try {
  if (saved.topo) {
    const r = sanitizeTopology(saved.topo);
    if (r) { topo = { nodes: spreadNodes(r.topo.nodes), edges: r.topo.edges }; saveNotes.push(...r.warnings); }
    else saveNotes.push('The saved canvas was not readable, so the default workstation was loaded.');
  }
} catch { topo = firstScenario.build(); saveNotes.push('The saved canvas was corrupted, so the default workstation was loaded.'); }
export const sim = new Sim(topo);
saveNotes.slice(0, 3).forEach(m => sim.say(`Restored save: ${m}`, 'warn', undefined, 'sys'));
const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
const savedScenario = saved.ui?.scenario;
const welcomeFirst = !saved.ui;
let ui: UI = {
  scenario: typeof savedScenario === 'string' && SCENARIOS.some(x => x.id === savedScenario) ? savedScenario : 'workstation',
  selected: { type: 'none' }, theme: saved.ui?.theme === 'light' ? 'light' : 'dark',
  playing: !welcomeFirst, // never auto-run behind the welcome overlay
  speed: [0.5, 1, 2, 4, 8, 16].includes(+(saved.ui?.speed ?? 1)) ? +(saved.ui?.speed ?? 1) : 1,
  dock: 'metrics', dockOpen: vw > 720 && (typeof window === 'undefined' || window.innerHeight >= 480), left: vw > 1100, right: vw > 1100, rightTab: 'inspect', logFilter: 'all', toast: null,
  welcome: welcomeFirst, coachOff: false, dismissed: [], lang: 'en', academy: false,
  academyLesson: typeof saved.ui?.academyLesson === 'string' ? saved.ui.academyLesson : 'cachehw',
};
export const MAX_WARM = 5000;
const DOCKS = ['metrics', 'gantt', 'graphs', 'procs', 'memory', 'pages', 'addr', 'devices', 'log', 'problems'];
/** Parse documented URL parameters (?s=, ?theme=, ?dock=, ?academy&lesson=, ?welcome, ?warm=, ?sel=). Every value is validated. */
export function parseUrlParams(search: string, base: UI): { patch: Partial<UI>; scenario?: string; warm: number; sel?: string; notes: string[] } {
  const q = new URLSearchParams(search); const patch: Partial<UI> = {}; const notes: string[] = []; let scenario: string | undefined;
  const sid = q.get('s'); if (sid) { if (SCENARIOS.some(x => x.id === sid)) { scenario = sid; patch.scenario = sid; } else notes.push(`Unknown scenario "${sid.slice(0, 30)}" in the link.`); }
  const th = q.get('theme'); if (th === 'dark' || th === 'light') patch.theme = th; else if (th) notes.push('Unknown theme in the link.');
  const dk = q.get('dock'); if (dk && DOCKS.includes(dk)) patch.dock = dk as UI['dock']; else if (dk) notes.push('Unknown dock tab in the link.');
  if (q.has('welcome')) patch.welcome = true; else if (q.has('demo')) patch.welcome = false;
  if (q.has('academy')) patch.academy = true;
  const ls = q.get('lesson'); if (ls) { if (LESSONS.some(l => l.id === ls)) { patch.academyLesson = ls; patch.academy = true; } else notes.push('Unknown lesson in the link.'); }
  const w = Math.floor(+(q.get('warm') || 0)); const warm = Number.isFinite(w) ? Math.min(MAX_WARM, Math.max(0, w)) : 0;
  void base; return { patch, scenario, warm, sel: q.get('sel') || undefined, notes };
}
if (typeof location !== 'undefined' && location.search) {
  const r = parseUrlParams(location.search, ui);
  if (r.scenario) { topo = scenarioById(r.scenario).build(); sim.reset(topo); }
  ui = { ...ui, ...r.patch };
  for (let i = 0; i < r.warm; i++) sim.tick();
  if (r.sel) { const n = topo.nodes.find(x => x.tpl === r.sel || x.kind === r.sel); if (n) ui = { ...ui, selected: { type: 'node', id: n.id } }; }
  r.notes.slice(0, 2).forEach(m => sim.say(m, 'warn', undefined, 'sys'));
}
let past: Topology[] = []; let future: Topology[] = []; let frame = 0; let lastPush = 0; let lastKey = '';
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
let persistT: any;
function persist() { clearTimeout(persistT); persistT = setTimeout(() => { try { localStorage.setItem(LS, JSON.stringify({ topo, ui: { scenario: ui.scenario, theme: ui.theme, speed: ui.speed, academyLesson: ui.academyLesson } })); } catch {} }, 300); }

export const getTopo = () => topo; export const getUI = () => ui; export const getFrame = () => frame;
export function useStore<T>(sel: () => T, dep: 'all' | 'ui' | 'topo' = 'all'): T {
  void dep; useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => frame * 1e6 + (topoVer + uiVer) % 1e6);
  return sel();
}
let topoVer = 0, uiVer = 0;
export function bump() { frame++; emit(); }

function setTopo(next: Topology, record = true, coalesceKey = '') {
  if (record) {
    const now = performance.now();
    const merge = !!coalesceKey && coalesceKey === lastKey && now - lastPush < 1500;
    if (!merge) { past.push(topo); if (past.length > 80) past.shift(); }
    lastPush = now; lastKey = coalesceKey; future = [];
  }
  topo = next; topoVer++; sim.sync(topo); persist(); emit();
}
/** Responsive panel state: below the compact breakpoint only one overlay may be open; crossing a breakpoint re-derives defaults. */
export const COMPACT_W = 1100, PHONE_W = 720;
let lastW = vw;
export function applyViewport(w: number, h = 900) {
  const wasCompact = lastW <= COMPACT_W, wasPhone = lastW <= PHONE_W; lastW = w;
  const compact = w <= COMPACT_W, phone = w <= PHONE_W; const p: Partial<UI> = {};
  if (compact && !wasCompact) { p.left = false; p.right = false; }
  else if (!compact && wasCompact) { p.left = true; p.right = true; }
  if (compact && (p.left ?? ui.left) && (p.right ?? ui.right)) { p.left = false; p.right = false; }
  if (phone && !wasPhone) p.dockOpen = false; else if (!phone && wasPhone) p.dockOpen = h >= 480;
  if (Object.keys(p).length) setUI(p);
}
if (typeof window !== 'undefined') window.addEventListener('resize', () => applyViewport(window.innerWidth, window.innerHeight));
export function setUI(p: Partial<UI>) { ui = { ...ui, ...p }; uiVer++; persist(); emit(); }
export function toast(text: string, tone: 'info' | 'bad' | 'good' = 'info') { const id = Date.now(); setUI({ toast: { id, text, tone } }); setTimeout(() => { if (ui.toast?.id === id) setUI({ toast: null }); }, 4200); }

export const actions = {
  select(sel: UI['selected']) { setUI({ selected: sel }); },
  loadScenario(id: string) { const sc = scenarioById(id); past = []; future = []; lastKey = ''; lastPush = 0; topo = sc.build(); topoVer++; sim.reset(topo); setUI({ scenario: id, selected: { type: 'none' }, rightTab: id === 'blank' ? 'guide' : 'inspect', dismissed: [] }); persist(); },
  resetSim() { sim.reset(topo); emit(); },
  step(n = 1) { for (let i = 0; i < n; i++) sim.tick(); bump(); },
  move(id: string, x: number, y: number) { setTopo({ ...topo, nodes: topo.nodes.map(n => (n.id === id ? { ...n, x, y } : n)) }, false); },
  beginChange() { past.push(topo); if (past.length > 80) past.shift(); future = []; lastPush = performance.now(); },
  setProps(id: string, patch: Props) {
    const n = topo.nodes.find(x => x.id === id); if (!n) return;
    if (n.kind === 'usb' && 'plugged' in patch && patch.plugged !== n.props.plugged) sim.unplugNote(patch.plugged);
    setTopo({ ...topo, nodes: topo.nodes.map(x => (x.id === id ? { ...x, props: { ...x.props, ...patch } } : x)) }, true, `props:${id}:${Object.keys(patch).sort().join(',')}`);
  },
  addNode(kind: Kind, tpl: TplId | undefined, x: number, y: number) {
    const base = kind === 'task' ? taskDefaults(tpl!) : { ...(CATALOG as any)[kind].defaults };
    if (kind === 'container') base.name = 'app-' + (topo.nodes.filter(n => n.kind === 'container').length + 1);
    const node: NodeDef = { id: newId(tpl ?? kind), kind, tpl, x, y, props: base };
    setTopo({ ...topo, nodes: spreadNodes([...topo.nodes, node]) }); setUI({ selected: { type: 'node', id: node.id } }); return node;
  },
  removeNode(id: string) { setTopo({ nodes: topo.nodes.filter(n => n.id !== id), edges: topo.edges.filter(e => e.a !== id && e.b !== id) }); setUI({ selected: { type: 'none' } }); },
  removeEdge(id: string) { setTopo({ ...topo, edges: topo.edges.filter(e => e.id !== id) }); setUI({ selected: { type: 'none' } }); },
  connect(a: string, b: string): boolean {
    if (a === b) return false;
    const na = topo.nodes.find(n => n.id === a)!, nb = topo.nodes.find(n => n.id === b)!;
    if (topo.edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))) { toast('These two are already connected.', 'info'); return false; }
    if (!canLink(na.kind, nb.kind)) { toast(linkWhy(na.kind, nb.kind), 'bad'); return false; }
    if (na.kind === 'task' && nb.kind === 'scheduler' || nb.kind === 'task' && na.kind === 'scheduler') { const t = na.kind === 'task' ? na : nb; if (topo.edges.some(e => (e.a === t.id || e.b === t.id) && topo.nodes.find(n => n.id === (e.a === t.id ? e.b : e.a))?.kind === 'container')) { toast('This task lives inside a container. Connect the container to the Scheduler instead.', 'bad'); return false; } }
    if (na.kind === 'task' && nb.kind === 'container' || nb.kind === 'task' && na.kind === 'container') { const t = na.kind === 'task' ? na : nb; if (topo.edges.some(e => (e.a === t.id || e.b === t.id) && topo.nodes.find(n => n.id === (e.a === t.id ? e.b : e.a))?.kind === 'scheduler')) { toast('Remove the task\'s direct Scheduler link first, then put it in the container.', 'bad'); return false; } }
    setTopo({ ...topo, edges: [...topo.edges, { id: newId('e'), a, b }] }); toast(`${labelOf(na)} connected to ${labelOf(nb)}.`, 'good'); return true;
  },
  undo() { const p = past.pop(); if (!p) return; lastKey = ''; lastPush = 0; future.push(topo); topo = p; topoVer++; sim.sync(topo); persist(); emit(); },
  redo() { const f = future.pop(); if (!f) return; lastKey = ''; lastPush = 0; past.push(topo); topo = f; topoVer++; sim.sync(topo); persist(); emit(); },
  canUndo: () => past.length > 0, canRedo: () => future.length > 0,
  importTopo(raw: unknown): boolean {
    const r = sanitizeTopology(raw);
    if (!r) return false;
    past.push(topo); future = []; lastKey = ''; lastPush = 0;
    topo = { nodes: spreadNodes(r.topo.nodes), edges: r.topo.edges };
    topoVer++; sim.reset(topo); setUI({ selected: { type: 'none' } }); persist();
    if (r.warnings.length) sim.say(`Import repaired: ${r.warnings[0]}${r.warnings.length > 1 ? ` (+${r.warnings.length - 1} more note(s))` : ''}`, 'warn', undefined, 'sys');
    return true;
  },
  compact() { sim.compact(); emit(); },
  freeSpace(id: string, bytes?: number) { sim.freeSpace(id, bytes); emit(); },
  fitWorkloads() {
    const ram = topo.nodes.find(n => n.kind === 'ram'); if (!ram) { toast('Add a RAM node first.', 'bad'); return; }
    const r = ram.props.size / (512 * 1024 * 1024); const sc = (v: number) => Math.max(1, Math.round(v * r));
    actions.beginChange(); topo = { ...topo, nodes: topo.nodes.map(n => n.kind === 'task' ? { ...n, props: { ...n.props, size: sc(TPLS[n.tpl!].size), ws: sc(TPLS[n.tpl!].ws), io: sc(TPLS[n.tpl!].io) } } : n.kind === 'container' ? { ...n, props: { ...n.props, mem: sc(n.props.mem) } } : n) };
    topoVer++; sim.sync(topo); sim.say('Workload sizes were scaled to match the RAM size.', 'info'); persist(); emit(); toast('Workloads scaled to the RAM size.', 'good');
  },
  restartTask(id: string) { sim.restartTask(id); emit(); },
  killTask(id: string) { const t = sim.tasks.get(id); if (t && t.state !== 'idle') { sim.killTask(t, 'Stopped by you'); sim.say(`${TPLS[t.tpl as TplId].name} was stopped manually.`, 'warn', id, 'sched'); emit(); } },
};
export const labelOf = (n: NodeDef) => (n.kind === 'task' ? TPLS[n.tpl!].name : (CATALOG as any)[n.kind].label);
export { SCENARIOS, nodeSize };
