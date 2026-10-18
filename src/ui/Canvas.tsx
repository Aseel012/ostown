import { useEffect, useRef, useState } from 'react';
import { useStore, getTopo, getUI, actions, sim, setUI, toast } from '../store';
import { NodeCard, CAT } from './nodes';
import { Icon } from './icons';
import { centerOf, edgeGeo, qpoint, rectOf, anchor, type Pt } from '../geometry';
import { TPLS, canLink } from '../engine/data';
import type { NodeDef, TplId } from '../engine/types';

export const view = { x: 120, y: 90, z: 0.62 };
let viewEl: HTMLDivElement | null = null;
const applyView = () => { if (viewEl) viewEl.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`; const g = document.getElementById('gridbg'); if (g) { const s = 24 * view.z; g.style.setProperty('background-size', s + 'px ' + s + 'px', 'important'); g.style.backgroundPosition = `${view.x}px ${view.y}px`; } const zl = document.getElementById('zlabel'); if (zl) zl.textContent = Math.round(view.z * 100) + '%'; };
/** Visible-area insets from the panels that are actually rendered (measured, not hard-coded). */
function panelInsets(W: number, H: number) {
  let L = 46, R = 46, T = 90, B = 60;
  const vis = (sel: string) => { const el = document.querySelector(sel) as HTMLElement | null; return el && el.getClientRects().length ? el.getBoundingClientRect() : null; };
  const tb = vis('.topbar'); if (tb) T = Math.max(T, tb.bottom + 14);
  const pal = vis('.palette'); if (pal && pal.left <= 20 && pal.top < H * 0.6) L = Math.max(L, pal.right + 14); // side palette (not the phone bottom sheet)
  const insp = vis('.inspector'); if (insp && insp.right >= W - 20 && insp.top < H * 0.6) R = Math.max(R, W - insp.left + 14);
  for (const sel of ['.dock', '.palette', '.inspector']) {
    const r = vis(sel); if (!r) continue;
    if (r.left <= 8 && r.right >= W - 8 && r.top > H * 0.25) B = Math.max(B, H - r.top + 14); // full-width bottom sheet
  }
  if (L > W * 0.45) L = W * 0.45; if (R > W * 0.45) R = W * 0.45; if (B > H * 0.6) B = H * 0.6; if (T > H * 0.4) T = H * 0.4;
  return { L, R, T, B };
}
export function fitView(w?: number, h?: number) {
  const nodes = getTopo().nodes; const el = document.getElementById('stage'); if (!el || !nodes.length) { view.x = 120; view.y = 90; view.z = 0.7; applyView(); return; }
  const W = w ?? el.clientWidth, H = h ?? el.clientHeight; const { L, R, T, B: Bm } = panelInsets(W, H);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; nodes.forEach(n => { const r = rectOf(n); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h + 40); });
  const z = Math.max(0.25, Math.min(1.1, Math.min((W - L - R) / (x1 - x0), (H - T - Bm) / (y1 - y0))));
  view.z = z; view.x = L + (W - L - R - (x1 - x0) * z) / 2 - x0 * z; view.y = T + (H - T - Bm - (y1 - y0) * z) / 2 - y0 * z; applyView();
}
export const ZMIN = 0.2, ZMAX = 2.0;
const clampZ = (z: number) => Math.max(ZMIN, Math.min(ZMAX, z));
function zoomToPoint(nz0: number, cx: number, cy: number) {
  const nz = clampZ(nz0); if (nz === view.z) return;
  view.x = cx - ((cx - view.x) / view.z) * nz; view.y = cy - ((cy - view.y) / view.z) * nz; view.z = nz; applyView();
}
let zoomAnim = 0;
export function animateZoom(target: number, cx: number, cy: number, dur = 160) {
  cancelAnimationFrame(zoomAnim); target = clampZ(target); if (target === view.z) return;
  const z0 = view.z, t0 = performance.now();
  const tick = (t: number) => { const u = Math.min(1, (t - t0) / dur); zoomToPoint(z0 + (target - z0) * (1 - Math.pow(1 - u, 3)), cx, cy); if (u < 1) zoomAnim = requestAnimationFrame(tick); };
  zoomAnim = requestAnimationFrame(tick);
}
export const zoomBy = (f: number) => { const el = document.getElementById('stage'); if (!el) return; animateZoom(view.z * f, el.clientWidth / 2, el.clientHeight / 2); };
export const toWorld = (cx: number, cy: number): Pt => { const el = document.getElementById('stage')!.getBoundingClientRect(); return { x: (cx - el.left - view.x) / view.z, y: (cy - el.top - view.y) / view.z }; };

// ---- couriers ----
interface Cr { x: number; y: number; route: Pt[]; at: string; target: string; el: SVGGElement | null; moving: boolean; dir: number }
const crs = new Map<string, Cr>();
function bfs(from: string, to: string): string[] { if (from === to) return [from]; const prev = new Map<string, string>([[from, '']]); const q = [from]; while (q.length) { const c = q.shift()!; for (const nx of sim.an.adj.get(c) ?? []) { if (prev.has(nx)) continue; prev.set(nx, c); if (nx === to) { const out = [to]; let p = c; while (p) { out.unshift(p); p = prev.get(p)!; } return out; } q.push(nx); } } return []; }
function targetOf(id: string): { node: string; slot: number; carry?: string; bubble?: string } {
  const t = sim.tasks.get(id)!; const home = id;
  if (!t) return { node: home, slot: 0 };
  if (t.state === 'running') { const c = [...sim.cores.values()].find(c => c.task === id); if (c) return { node: c.id, slot: 0, carry: 'CPU', bubble: '' }; }
  if (t.state === 'ready') return { node: sim.an.scheduler?.id ?? home, slot: sim.readyQ.indexOf(id), carry: 'ready', bubble: '' };
  if (t.state === 'new' && sim.an.mem.ram) return { node: sim.an.mem.ram.id, slot: 0, carry: 'alloc', bubble: '' };
  if (t.state === 'blocked') {
    const op = t.opq[0];
    if (op && op.fault) { const sw = sim.an.swap?.id ?? sim.an.mem.mmu?.id; return { node: op.kind === 'zero' ? (sim.an.mem.mmu?.id ?? home) : sw ?? home, slot: 0, carry: `P${t.faultPage ?? ''}`, bubble: op.kind === 'zero' ? 'page fault' : 'swap in' }; }
    if (op?.dev) { const d = sim.devs.get(op.dev); const idx = d ? d.queue.indexOf(op) + d.cur.length : 0; return { node: op.dev, slot: Math.max(0, idx), carry: op.kind === 'rd' ? 'read' : op.kind === 'net' ? 'data' : op.kind === 'prn' ? 'page' : 'write', bubble: idx > 0 ? '' : '' }; }
    const s = t.steps[t.idx]; if (s?.k === 'play') { const b = sim.an.buffers.find(x => x.tasks.includes(id)); if (b) return { node: b.node.id, slot: 0, carry: 'frame', bubble: t.stalled ? 'stalled' : '' }; }
    return { node: home, slot: 0, bubble: '?' };
  }
  return { node: home, slot: 0 };
}
const SPEED = 330;
const REDUCED = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function stepCouriers(dt: number) {
  const topo = getTopo(); const live = new Set<string>();
  for (const n of topo.nodes) {
    if (n.kind !== 'task') continue; live.add(n.id); const t = sim.tasks.get(n.id); if (!t) continue;
    let c = crs.get(n.id); const hc = centerOf(n);
    if (!c) { c = { x: hc.x, y: hc.y - 6, route: [], at: n.id, target: n.id, el: null, moving: false, dir: 1 }; crs.set(n.id, c); }
    const tg = targetOf(n.id); const tn = sim.an.byId.get(tg.node) ?? n;
    const r = rectOf(tn); const stand: Pt = tn.id === n.id ? { x: r.x - 22, y: hc.y + 40 } : { x: r.x + 26 + (tg.slot % 6) * 30, y: r.y - 6 - Math.floor(tg.slot / 6) * 28 };
    const key = tg.node + ':' + Math.round(stand.x) + ':' + Math.round(stand.y);
    if (c.target !== key) {
      c.target = key; const path = bfs(c.at === n.id || sim.an.byId.has(c.at) ? c.at : n.id, tg.node);
      const pts: Pt[] = []; let prevNode = sim.an.byId.get(path[0]);
      for (let i = 1; i < path.length; i++) { const a = sim.an.byId.get(path[i - 1])!, b = sim.an.byId.get(path[i])!; const g = edgeGeo(a, b); for (let u = 0; u <= 1.001; u += 0.2) pts.push(qpoint(g, u)); prevNode = b; }
      void prevNode; pts.push(stand); c.route = pts; c.at = tg.node;
      if (!path.length) { c.route = [stand]; }
    }
    c.moving = false;
    let budget = REDUCED() ? Infinity : SPEED * dt;
    while (budget > 0 && c.route.length) { const p = c.route[0]; const dx = p.x - c.x, dy = p.y - c.y; const d = Math.hypot(dx, dy); if (d <= budget) { c.x = p.x; c.y = p.y; budget -= d; c.route.shift(); c.moving = d > 0.5 || c.moving; } else { c.x += (dx / d) * budget; c.y += (dy / d) * budget; c.moving = true; if (Math.abs(dx) > 1) c.dir = dx > 0 ? 1 : -1; budget = 0; } }
    if (!c.route.length) { c.x += (stand.x - c.x) * Math.min(1, dt * 8); c.y += (stand.y - c.y) * Math.min(1, dt * 8); }
    c.el?.setAttribute('transform', `translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})`);
    c.el?.classList.toggle('moving', c.moving);
  }
  for (const k of [...crs.keys()]) if (!live.has(k)) crs.delete(k);
}
let raf = 0, lastT = 0; const loopCb = new Set<(dt: number) => void>();
export function startCourierLoop() { cancelAnimationFrame(raf); const f = (t: number) => { const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016); lastT = t; stepCouriers(dt); raf = requestAnimationFrame(f); }; raf = requestAnimationFrame(f); }

function Couriers({ topo }: { topo: NodeDef[] }) {
  return <svg className="layer couriers" width="1" height="1" style={{ overflow: 'visible' }}>
    {topo.filter(n => n.kind === 'task').map(n => { const t = sim.tasks.get(n.id); if (!t) return null; const tg = targetOf(n.id); const active = t.state !== 'idle' && t.state !== 'done' && t.state !== 'killed'; const col = TPLS[n.tpl as TplId].color; void col;
      return <g key={n.id} ref={el => { let c2 = crs.get(n.id); if (c2) c2.el = el; else { const hc = centerOf(n); crs.set(n.id, { x: hc.x, y: hc.y, route: [], at: n.id, target: '', el, moving: false, dir: 1 }); } }} className={`packet ${active ? '' : 'rest'}`}>
        <circle r="13" fill={col} opacity=".18" className="halo" /><circle r="6.5" fill={col} stroke="#000" strokeWidth="2" />
        {active && tg.carry && <g transform="translate(0 -19)"><rect x={-tg.carry.length * 3.3 - 6} y="-9" width={tg.carry.length * 6.6 + 12} height="17" rx="8.5" className="plabel" /><text textAnchor="middle" y="3" className="ptext">{tg.carry}</text></g>}
      </g>; })}
  </svg>;
}

function Edges({ topo, selected }: { topo: NodeDef[]; selected?: string }) {
  const T = getTopo(); const by = new Map(T.nodes.map(n => [n.id, n])); void topo;
  const hints = new Map<string, { a: NodeDef; b: NodeDef }>();
  const sel = getUI().selected; const tid = sel.type === 'node' && by.get(sel.id!)?.kind === 'task' ? sel.id! : undefined;
  const taskIds = tid ? [tid] : T.nodes.filter(n => n.kind === 'task').map(n => n.id);
  for (const id of taskIds) for (const r of sim.reqs(id)) { if (r.ok || !r.hint?.a || !r.hint.b) continue; const h = r.hint; const A = (h.fromId && by.get(h.fromId)) || T.nodes.find(n => n.kind === h.a); const Bn = (h.toId && by.get(h.toId)) || T.nodes.find(n => n.kind === h.b); if (A && Bn && A.id !== Bn.id && !T.edges.some(e => (e.a === A.id && e.b === Bn.id) || (e.a === Bn.id && e.b === A.id))) hints.set(A.id + Bn.id, { a: A, b: Bn }); }
  return <svg className="layer edges" width="1" height="1" style={{ overflow: 'visible' }}>
    {[...hints.values()].map((h, i) => { const g = edgeGeo(h.a, h.b); return <g key={i}><path d={g.d} className="ghost" /><text className="ghosttxt" x={g.c.x} y={g.c.y - 10} textAnchor="middle">connect here</text></g>; })}
    {T.edges.map(e => { const a = by.get(e.a), b = by.get(e.b); if (!a || !b) return null; const g = edgeGeo(a, b); const col = CAT[a.kind === 'task' ? b.kind : a.kind] ?? '#888'; const busy = edgeBusy(a, b);
      return <g key={e.id} className={`edge ${selected === e.id ? 'sel' : ''} ${busy ? 'busy' : ''}`} style={{ ['--c' as any]: col }}>
        <path d={g.d} className="hit" onPointerDown={ev => { ev.stopPropagation(); actions.select({ type: 'edge', id: e.id }); }} />
        <path d={g.d} className="line" /><path d={g.d} className="flow" />
        <circle cx={g.p0.x} cy={g.p0.y} r="4" fill={col} /><circle cx={g.p1.x} cy={g.p1.y} r="4" fill={col} />
        {selected === e.id && <g className="edel" transform={`translate(${g.c.x} ${g.c.y})`} onPointerDown={ev => { ev.stopPropagation(); actions.removeEdge(e.id); }}><circle r="13" /><path d="M-4.5 -4.5l9 9M4.5 -4.5l-9 9" /></g>}
      </g>; })}
  </svg>;
}
function edgeBusy(a: NodeDef, b: NodeDef) { const k = [a.kind, b.kind]; if (k.includes('task')) { const t = sim.tasks.get((a.kind === 'task' ? a : b).id); return !!t && (t.state === 'running' || t.state === 'ready'); } if (k.includes('driver')) { return [...sim.devs.values()].some(d => sim.t - d.irqAt < 8 || d.cur.length > 0); } if (k.includes('cpu')) return [...sim.cores.values()].some(c => c.task); if (k.includes('nic') && k.includes('buffer')) return [...sim.bufs.values()].some(x => x.active); return false; }

export function Canvas() {
  const topo = useStore(() => getTopo()); const ui = useStore(() => getUI()); const stageRef = useRef<HTMLDivElement>(null); const worldRef = useRef<HTMLDivElement>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; mx: number; my: number } | null>(null);
  const endGesture = useRef<(() => void) | null>(null);
  const cancelGesture = () => { endGesture.current?.(); endGesture.current = null; stageRef.current?.classList.remove('panning'); };
  const [conn, setConn] = useState<{ from: string; to: Pt } | null>(null); const [target, setTarget] = useState<string>('');
  useEffect(() => { viewEl = worldRef.current; applyView(); startCourierLoop(); setTimeout(() => fitView(), 50); let rt: any; const onR = () => { clearTimeout(rt); rt = setTimeout(() => fitView(), 120); }; window.addEventListener('resize', onR); return () => { cancelAnimationFrame(raf); clearTimeout(rt); window.removeEventListener('resize', onR); }; }, []);
  useEffect(() => { setTimeout(() => fitView(), 40); }, [ui.scenario]);
  useEffect(() => { const t = setTimeout(() => fitView(), 60); return () => clearTimeout(t); }, [ui.left, ui.right, ui.dockOpen]);
  const byId = new Map(topo.nodes.map(n => [n.id, n]));

  const down = (e: React.PointerEvent) => {
    // Buttons and form controls (zoom bar, etc.) must receive their own click: never capture the pointer for them.
    if ((e.target as HTMLElement).closest?.('button,a,input,select,textarea,.zoombar')) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    if (ptrs.current.size === 2) {
      cancelGesture(); setConn(null); setTarget('');
      const [a, b] = [...ptrs.current.values()];
      pinch.current = { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (ptrs.current.size > 2) return;
    const el = e.target as HTMLElement; const portEl = el.closest('[data-port]') as HTMLElement | null; const nodeEl = el.closest('[data-node]') as HTMLElement | null;
    if ((el.closest('button,select,input,.nbtn')) ) return;
    if (portEl) { const id = portEl.dataset.port!; const from = byId.get(id)!; e.preventDefault(); try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* stale pointer */ } setConn({ from: id, to: toWorld(e.clientX, e.clientY) }); actions.select({ type: 'node', id }); return; }
    if (nodeEl) {
      const id = nodeEl.dataset.node!; const n = byId.get(id)!; actions.select({ type: 'node', id }); const p0 = toWorld(e.clientX, e.clientY); const off = { x: p0.x - n.x, y: p0.y - n.y }; let began = false;
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* stale pointer */ }
      const mv = (ev: PointerEvent) => { const p = toWorld(ev.clientX, ev.clientY); if (!began) { if (Math.hypot(p.x - p0.x, p.y - p0.y) < 3) return; began = true; actions.beginChange(); } actions.move(id, p.x - off.x, p.y - off.y); };
      const upL = () => cancelGesture();
      endGesture.current = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upL); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upL); return;
    }
    // pan
    actions.select({ type: 'none' }); const sx = e.clientX, sy = e.clientY, vx = view.x, vy = view.y; const mv = (ev: PointerEvent) => { view.x = vx + ev.clientX - sx; view.y = vy + ev.clientY - sy; applyView(); };
    const upL = () => cancelGesture();
    endGesture.current = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upL); };
    stageRef.current?.classList.add('panning'); window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upL);
  };
  const move = (e: React.PointerEvent) => {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const r = stageRef.current!.getBoundingClientRect();
      cancelAnimationFrame(zoomAnim);
      view.x += mx - pinch.current.mx; view.y += my - pinch.current.my; applyView();
      zoomToPoint(view.z * (d / pinch.current.d), mx - r.left, my - r.top);
      pinch.current = { d, mx, my };
      return;
    }
    if (!conn) return; const p = toWorld(e.clientX, e.clientY); setConn({ ...conn, to: p }); const hit = topo.nodes.find(n => { const r = rectOf(n); return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h && n.id !== conn.from; }); setTarget(hit?.id ?? ''); };
  const ptrCancel = (e: React.PointerEvent) => { ptrs.current.delete(e.pointerId); pinch.current = null; cancelGesture(); setConn(null); setTarget(''); };
  const up = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
    if (!conn) return; const p = toWorld(e.clientX, e.clientY); const hit = topo.nodes.find(n => { const r = rectOf(n); return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h && n.id !== conn.from; }); if (hit) actions.connect(conn.from, hit.id); setConn(null); setTarget(''); };
  useEffect(() => {
    const el = stageRef.current!;
    const h = (e: WheelEvent) => {
      e.preventDefault(); cancelAnimationFrame(zoomAnim);
      const r = el.getBoundingClientRect();
      const mode = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) { view.x -= (e.deltaY || e.deltaX) * mode; applyView(); return; }
      zoomToPoint(view.z * Math.exp(-e.deltaY * mode * 0.0022), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);
  const drop = (e: React.DragEvent) => { e.preventDefault(); const d = e.dataTransfer.getData('text/ostown'); if (!d) return; const [kind, tpl] = d.split(':'); const p = toWorld(e.clientX, e.clientY); actions.addNode(kind as any, (tpl || undefined) as any, p.x - 90, p.y - 40); };
  useEffect(() => { const k = (e: KeyboardEvent) => {
    if (getUI().academy || getUI().welcome) return; // modal UI owns the keyboard
    const el = e.target as HTMLElement;
    const typing = !!el.closest('input,select,textarea,[contenteditable="true"]');
    const key = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && key === 'z' && !typing) { e.preventDefault(); e.shiftKey ? actions.redo() : actions.undo(); return; }
    if ((e.metaKey || e.ctrlKey) && key === 'y' && !typing) { e.preventDefault(); actions.redo(); return; }
    if (typing) return;
    const s = getUI().selected;
    if ((e.key === 'Delete' || e.key === 'Backspace') && s.id && !el.closest('button')) { s.type === 'node' ? actions.removeNode(s.id) : actions.removeEdge(s.id); }
    if (e.key === ' ') { if (el.closest('button,a,[role="button"],[role="switch"],summary,label')) return; e.preventDefault(); setUI({ playing: !getUI().playing }); }
  }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const fromNode = conn ? byId.get(conn.from) : undefined; let tmp = '';
  if (conn && fromNode) { const c = conn.to; const a = anchor(fromNode, c); tmp = `M${a.x},${a.y} L${c.x},${c.y}`; }
  const tNode = target ? byId.get(target) : undefined; const ok = tNode && fromNode ? canLink(fromNode.kind, tNode.kind) : true;
  return <div id="stage" ref={stageRef} className="stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={ptrCancel} onDragOver={e => e.preventDefault()} onDrop={drop}>
    <div id="gridbg" className="gridbg" />
    <div ref={worldRef} className="world">
      <Edges topo={topo.nodes} selected={ui.selected.type === 'edge' ? ui.selected.id : undefined} />
      {topo.nodes.map(n => <NodeCard key={n.id} n={n} selected={ui.selected.type === 'node' && ui.selected.id === n.id} active={false} />)}
      <Couriers topo={topo.nodes} />
      {conn && <svg className="layer" width="1" height="1" style={{ overflow: 'visible' }}><path d={tmp} className={`tmp ${ok ? '' : 'badl'}`} /></svg>}
      {topo.nodes.length === 0 && <div className="emptyhint"><Icon name="spark" size={34} /><h3>Empty canvas</h3><p>Drag a Scheduler in from the palette, then a CPU, an MMU and RAM.<br />Drag from the dot on a node's edge to another node to connect them.</p></div>}
    </div>
    <ZoomBar />
  </div>;
}
function ZoomBar() { return <div className="zoombar glass"><button onClick={() => zoomBy(1 / 1.2)} title="Zoom out" aria-label="Zoom out"><Icon name="minus" size={16} /></button><span id="zlabel" className="mono">62%</span><button onClick={() => zoomBy(1.2)} title="Zoom in" aria-label="Zoom in"><Icon name="plus" size={16} /></button><button onClick={() => fitView()} title="Fit to screen" aria-label="Fit to screen"><Icon name="fit" size={16} /></button></div>; }
