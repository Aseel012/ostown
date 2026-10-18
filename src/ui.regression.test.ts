import { describe, it, expect } from 'vitest';
import { actions, getTopo, getUI, applyViewport, parseUrlParams, MAX_WARM, setUI } from './store';
import { parseDone } from './ui/academy';

const nodes = () => getTopo().nodes.length;

describe('P1-08 undo keeps distinct rapid operations', () => {
  it('Blank Canvas, Add CPU, Add RAM, Undo removes only the RAM', () => {
    actions.loadScenario('workstation'); const ram = getTopo().nodes.find(n => n.kind === 'ram')!;
    actions.setProps(ram.id, { size: 256 * 1024 * 1024 }); // prior edit
    actions.loadScenario('blank'); expect(nodes()).toBe(0);
    actions.addNode('cpu', undefined, 0, 0); actions.addNode('ram', undefined, 300, 0); expect(nodes()).toBe(2);
    actions.undo(); expect(getTopo().nodes.map(n => n.kind)).toEqual(['cpu']);
    actions.undo(); expect(nodes()).toBe(0); expect(actions.canUndo()).toBe(false);
  });
  it('first operation after a scenario switch is undoable immediately', () => {
    actions.loadScenario('workstation'); actions.addNode('printer', undefined, 0, 0); const n = nodes(); expect(actions.canUndo()).toBe(true); actions.undo(); expect(nodes()).toBe(n - 1);
  });
  it('different fields edited quickly produce separate undo steps; same field still merges', () => {
    actions.loadScenario('workstation'); const ram = getTopo().nodes.find(n => n.kind === 'ram')!; const g = () => getTopo().nodes.find(n => n.id === ram.id)!.props;
    const sz = g().size, rs = g().reserved;
    actions.setProps(ram.id, { size: 1 }); actions.setProps(ram.id, { size: 2 }); actions.setProps(ram.id, { reserved: 0 });
    actions.undo(); expect(g().reserved).toBe(rs); expect(g().size).toBe(2); actions.undo(); expect(g().size).toBe(sz);
  });
  it('undo then redo then new op keeps history consistent', () => {
    actions.loadScenario('blank'); actions.addNode('cpu', undefined, 0, 0); actions.undo(); actions.redo(); actions.addNode('ram', undefined, 300, 0);
    actions.undo(); expect(nodes()).toBe(1); actions.undo(); expect(nodes()).toBe(0);
  });
});

describe('P1-06 responsive drawer state', () => {
  it('desktop -> phone closes both drawers and the dock; phone -> desktop restores them', () => {
    applyViewport(1440, 900); setUI({ left: true, right: true, dockOpen: true });
    applyViewport(390, 844); expect(getUI().left).toBe(false); expect(getUI().right).toBe(false); expect(getUI().dockOpen).toBe(false);
    applyViewport(1440, 900); expect(getUI().left && getUI().right).toBe(true);
  });
  it('never leaves both drawers open below the breakpoint', () => {
    applyViewport(1440, 900); applyViewport(900, 700); setUI({ left: true, right: true }); applyViewport(880, 700);
    expect(getUI().left && getUI().right).toBe(false);
    applyViewport(1440, 900);
  });
});

describe('P1-10 corrupt Academy progress', () => {
  it.each([[null], ['{}'], ['null'], ['"x"'], ['{"a":'], ['[1,2,null,{"a":1}]'], ['[["vfs"]]']])('parseDone(%s) is a string array', raw => { const d = parseDone(raw as any); expect(Array.isArray(d)).toBe(true); d.forEach(x => expect(typeof x).toBe('string')); });
  it('keeps only known lesson ids and removes duplicates', () => { expect(parseDone('["vfs","nope","vfs",3]')).toEqual(['vfs']); });
});

describe('P2-01 / P2-13 URL parameters', () => {
  const base = getUI();
  it('parses academy deep links without needing ?demo', () => { const r = parseUrlParams('?academy&lesson=vfs', base); expect(r.patch.academy).toBe(true); expect(r.patch.academyLesson).toBe('vfs'); });
  it('rejects unknown scenario, theme, dock and lesson', () => { const r = parseUrlParams('?s=__proto__&theme=evil&dock=zzz&lesson=../x', base); expect(r.scenario).toBeUndefined(); expect(r.patch.theme).toBeUndefined(); expect(r.patch.dock).toBeUndefined(); expect(r.patch.academyLesson).toBeUndefined(); expect(r.notes.length).toBe(4); });
  it('caps warm-up ticks and handles garbage', () => { expect(parseUrlParams('?warm=999999999999', base).warm).toBe(MAX_WARM); expect(parseUrlParams('?warm=abc', base).warm).toBe(0); expect(parseUrlParams('?warm=-5', base).warm).toBe(0); });
});
