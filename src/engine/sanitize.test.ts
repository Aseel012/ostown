import { describe, it, expect } from 'vitest';
import { sanitizeTopology } from './sanitize';
import { scenarioById } from './scenarios';

describe('sanitizeTopology', () => {
  it('rejects non-topologies', () => {
    expect(sanitizeTopology(null)).toBeNull();
    expect(sanitizeTopology({})).toBeNull();
    expect(sanitizeTopology({ nodes: 'x' })).toBeNull();
    expect(sanitizeTopology('[]')).toBeNull();
  });
  it('accepts a scenario build without warnings', () => {
    const r = sanitizeTopology(JSON.parse(JSON.stringify(scenarioById('workstation').build())));
    expect(r).not.toBeNull(); expect(r!.warnings).toEqual([]);
  });
  it('drops unknown kinds and unknown workload templates', () => {
    const r = sanitizeTopology({ nodes: [
      { id: 'a', kind: 'warp-drive', x: 0, y: 0, props: {} },
      { id: 'b', kind: 'task', tpl: 'cryo-miner', x: 0, y: 0, props: {} },
      { id: 'c', kind: 'scheduler', x: 0, y: 0, props: {} },
    ], edges: [] });
    expect(r!.topo.nodes.map(n => n.id)).toEqual(['c']);
    expect(r!.warnings.some(w => /unknown/.test(w))).toBe(true);
  });
  it('rejects dangling edges, duplicates and self-loops', () => {
    const r = sanitizeTopology({ nodes: [
      { id: 's', kind: 'scheduler', x: 0, y: 0, props: {} },
      { id: 'c', kind: 'cpu', x: 0, y: 0, props: {} },
    ], edges: [
      { id: 'e1', a: 's', b: 'c' }, { id: 'e2', a: 'c', b: 's' },
      { id: 'e3', a: 's', b: 'ghost' }, { id: 'e4', a: 's', b: 's' },
    ] });
    expect(r!.topo.edges).toHaveLength(1);
    expect(r!.warnings.some(w => /missing nodes/.test(w))).toBe(true);
    expect(r!.warnings.some(w => /duplicate/.test(w))).toBe(true);
  });
  it('rejects duplicate node ids', () => {
    const r = sanitizeTopology({ nodes: [
      { id: 'x', kind: 'scheduler', x: 0, y: 0, props: {} },
      { id: 'x', kind: 'cpu', x: 0, y: 0, props: {} },
    ], edges: [] });
    expect(r!.topo.nodes).toHaveLength(1);
    expect(r!.warnings.some(w => /duplicate ids/.test(w))).toBe(true);
  });
  it('defaults missing props and clamps numbers', () => {
    const r = sanitizeTopology({ nodes: [{ id: 'm', kind: 'mmu', x: 0, y: 0, props: { tlb: -5, tlbMiss: 9e9 } }], edges: [] });
    const m = r!.topo.nodes[0];
    expect(m.props.repl).toBe('lru'); // defaulted
    expect(m.props.tlb).toBe(0); // clamped to range
    expect(m.props.tlbMiss).toBe(10000); // clamped to max
  });
  it('caps iterations and repairs bad enum values', () => {
    const r = sanitizeTopology({ nodes: [{ id: 't', kind: 'task', tpl: 'zip', x: 0, y: 0, props: { repeat: 99999999, dest: 'floppy' } }], edges: [] });
    expect(r!.topo.nodes[0].props.repeat).toBe(5000);
    expect(r!.topo.nodes[0].props.dest).toBe('auto');
    expect(r!.warnings.some(w => /Invalid value/.test(w))).toBe(true);
  });
  it('clamps absurd byte sizes and repairs non-finite input', () => {
    const r = sanitizeTopology({ nodes: [{ id: 'r', kind: 'ram', x: 0, y: 0, props: { size: Number.POSITIVE_INFINITY, page: 4 * 1024 } }], edges: [] });
    expect(r!.topo.nodes[0].props.size).toBe(512 * 1024 * 1024); // fell back to default
  });
  it('clamps node positions to a sane canvas range', () => {
    const r = sanitizeTopology({ nodes: [{ id: 's', kind: 'scheduler', x: 1e12, y: NaN, props: {} }], edges: [] });
    expect(r!.topo.nodes[0].x).toBeLessThanOrEqual(100000);
    expect(r!.topo.nodes[0].y).toBe(0);
  });
});
