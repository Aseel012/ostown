import type { NodeDef } from './engine/types';
import { nodeSize } from './engine/data';
export interface Pt { x: number; y: number }
export const rectOf = (n: NodeDef) => { const s = nodeSize(n.kind); return { x: n.x, y: n.y, w: s.w, h: s.h }; };
export const centerOf = (n: NodeDef): Pt => { const r = rectOf(n); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
export function anchor(n: NodeDef, toward: Pt): Pt {
  const r = rectOf(n); const c = centerOf(n); const dx = toward.x - c.x, dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c; const sx = (r.w / 2) / Math.abs(dx || 1e-9), sy = (r.h / 2) / Math.abs(dy || 1e-9); const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}
export interface EdgeGeo { p0: Pt; p1: Pt; c: Pt; d: string; len: number }
export function edgeGeo(a: NodeDef, b: NodeDef): EdgeGeo {
  const ca = centerOf(a), cb = centerOf(b); const p0 = anchor(a, cb), p1 = anchor(b, ca);
  const dx = p1.x - p0.x, dy = p1.y - p0.y; const len = Math.hypot(dx, dy) || 1; const bend = Math.min(60, len * 0.18);
  const c = { x: (p0.x + p1.x) / 2 - (dy / len) * bend, y: (p0.y + p1.y) / 2 + (dx / len) * bend };
  return { p0, p1, c, d: `M${p0.x},${p0.y} Q${c.x},${c.y} ${p1.x},${p1.y}`, len };
}
export const qpoint = (g: EdgeGeo, u: number): Pt => { const v = 1 - u; return { x: v * v * g.p0.x + 2 * v * u * g.c.x + u * u * g.p1.x, y: v * v * g.p0.y + 2 * v * u * g.c.y + u * u * g.p1.y }; };

const rectOverlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, pad: number) =>
  a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;

/**
 * Return a copy of the node list where every node that overlaps an earlier one is
 * nudged right (and then down) until it sits clear. Deterministic, bounded.
 */
export function spreadNodes(nodes: NodeDef[]): NodeDef[] {
  const out = nodes.map(n => ({ ...n, props: n.props }));
  for (let i = 1; i < out.length; i++) {
    const n = out[i]; const x0 = n.x; let guard = 0;
    while (guard++ < 60 && out.slice(0, i).some(m => rectOverlap(rectOf(n), rectOf(m), 14))) {
      if (guard % 4 === 0) { n.x = x0; n.y += 64; } else n.x += 56;
    }
  }
  return out;
}
