import { describe, it, expect, beforeEach, vi } from 'vitest';
const VALID_KINDS = ['scheduler','cpu','mmu','ram','storage','usb','printer','nic','driver','cache','buffer','container','task','gpu'];
import { actions, getTopo } from './store';

describe('undo coalescing', () => {
  it('rapid edits to the same field merge into one undo step', () => {
    actions.loadScenario('workstation');
    const ram = getTopo().nodes.find(n => n.kind === 'ram')!;
    const before = ram.props.size;
    actions.setProps(ram.id, { size: 256 * 1024 * 1024 });
    actions.setProps(ram.id, { size: 128 * 1024 * 1024 });
    expect(getTopo().nodes.find(n => n.kind === 'ram')!.props.size).toBe(128 * 1024 * 1024);
    actions.undo();
    expect(getTopo().nodes.find(n => n.kind === 'ram')!.props.size).toBe(before);
    expect(actions.canUndo()).toBe(false);
  });
  it('importTopo rejects garbage and keeps the current canvas', () => {
    actions.loadScenario('blank');
    expect(getTopo().nodes).toHaveLength(0);
    expect(actions.importTopo({ not: 'a topology' })).toBe(false);
    expect(getTopo().nodes).toHaveLength(0);
  });
  it('importTopo repairs a messy but usable topology', () => {
    actions.loadScenario('blank');
    const ok = actions.importTopo({ nodes: [
      { id: 's', kind: 'scheduler', x: 0, y: 0, props: {} },
      { id: 'c', kind: 'cpu', x: 5, y: 5, props: {} },
      { id: 'junk', kind: 'warp', x: 0, y: 0, props: {} },
    ], edges: [{ id: 'e1', a: 's', b: 'c' }, { id: 'e2', a: 's', b: 'gone' }] });
    expect(ok).toBe(true);
    const t = getTopo();
    expect(t.nodes).toHaveLength(2);
    expect(t.edges).toHaveLength(1);
    // the overlapping pair was spread apart
    expect(t.nodes[0].x !== t.nodes[1].x || t.nodes[0].y !== t.nodes[1].y).toBe(true);
  });
});

// ---- corrupted saved state recovery ----
describe('corrupted save recovery', () => {
  let mem: Record<string, string>;
  const localStorage = {
    getItem: (k: string) => (k in mem ? mem[k] : null),
    setItem: (k: string, v: string) => { mem[k] = String(v); },
    removeItem: (k: string) => { delete mem[k]; },
    clear: () => { mem = {}; },
  };
  beforeEach(() => {
    mem = {};
    vi.stubGlobal('localStorage', localStorage);
    vi.resetModules();
  });
  it('unparseable JSON falls back to default topology without throwing', async () => {
    localStorage.setItem('ostown.v32', '{not valid json!!!');
    const m = await import('./store');
    expect(m.getTopo().nodes.length).toBeGreaterThan(0);
    expect(m.getTopo().nodes.every(n => VALID_KINDS.includes(n.kind))).toBe(true);
  });
  it('schema-broken topology is sanitized on load (unknown kinds dropped, dangling edges removed)', async () => {
    const bad = {
      nodes: [
        { id: 'sched', kind: 'scheduler', tpl: 'sched-rr', name: 'Sched', x: 0, y: 0, props: {} },
        { id: 'ghost', kind: 'warp-drive', tpl: 'x', name: 'Ghost', x: 0, y: 0, props: {} },
      ],
      edges: [{ id: 'e1', a: 'sched', b: 'ghost' }, { id: 'e2', a: 'sched', b: 'missing' }],
      nextNum: 1,
    };
    localStorage.setItem('ostown.v32', JSON.stringify({ ui: { scenario: 'x', theme: 'graphite', speed: 1, accent: 'white' }, topo: bad }));
    const m = await import('./store');
    const t = m.getTopo();
    expect(t.nodes.map(n => n.id)).toEqual(['sched']);
    expect(t.edges).toEqual([]);
    expect(m.getUI().theme).toBe('dark'); // unknown theme reset to default
  });
  it('legacy ostown2.v2 key is migrated', async () => {
    const legacy = { nodes: [{ id: 'k', kind: 'scheduler', tpl: 'sched-fcfs', name: 'S', x: 0, y: 0, props: {} }], edges: [], nextNum: 2 };
    localStorage.setItem('ostown2.v2', JSON.stringify({ ui: { scenario: 'old', theme: 'pure', speed: 1, accent: 'white' }, topo: legacy }));
    const m = await import('./store');
    expect(m.getTopo().nodes[0].id).toBe('k');
  });
});
