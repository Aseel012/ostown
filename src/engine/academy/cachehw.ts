import { Base } from './types';

export interface Level { name: string; sizeKB: number; cycles: number; hits: number; misses: number; ways: number; sets: number[][] }
export type Pattern = 'seq' | 'rand' | 'loop';
export const LINE = 64; // bytes

/** Memory hierarchy simulator: L1 -> L2 -> L3 -> RAM with configurable associativity (LRU within a set). */
export class CacheSim extends Base {
  levels: Level[]; wsKB: number; pattern: Pattern = 'loop';
  pos = 0; accesses = 0; cycles = 0; seed = 7; loopLen = 0;
  constructor(wsKB = 1024) {
    super();
    this.wsKB = wsKB;
    this.levels = [
      { name: 'L1', sizeKB: 32, cycles: 1, hits: 0, misses: 0, ways: 0, sets: [[]] },
      { name: 'L2', sizeKB: 256, cycles: 12, hits: 0, misses: 0, ways: 0, sets: [[]] },
      { name: 'L3', sizeKB: 8192, cycles: 40, hits: 0, misses: 0, ways: 0, sets: [[]] },
    ];
    this.say('A stream of memory accesses begins. Watch which level serves each one.');
  }
  get ramCycles() { return 220; }
  /** ways = 0 means fully associative; otherwise the number of ways per set. */
  assocLabel(lv: Level) { return lv.ways === 0 ? 'fully associative' : lv.ways === 1 ? 'direct mapped' : `${lv.ways}-way`; }
  capLines(lv: Level) { return Math.max(1, Math.floor((lv.sizeKB * 1024) / LINE)); }
  numSets(lv: Level) { return lv.ways > 0 ? Math.max(1, Math.floor(this.capLines(lv) / lv.ways)) : 1; }
  totalLines(lv: Level) { return lv.sets.reduce((a, st) => a + st.length, 0); }
  private setOf(lv: Level, line: number): number[] {
    const si = lv.ways > 0 ? line % this.numSets(lv) : 0;
    while (lv.sets.length <= si) lv.sets.push([]);
    return lv.sets[si];
  }
  private rnd() { this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff; return this.seed / 0x7fffffff; }
  private nextLine(): number {
    const lines = Math.max(1, Math.floor((this.wsKB * 1024) / LINE));
    if (this.pattern === 'seq') { const l = this.pos % lines; this.pos++; return l; }
    if (this.pattern === 'rand') return Math.floor(this.rnd() * lines);
    // loop: tight repeated window (at most 256 lines = 16 KB) = high locality
    const win = Math.min(Math.max(2, Math.floor(lines / 8)), 256); const l = this.pos % win; this.pos++; return l;
  }
  private touch(lv: Level, line: number) {
    const set = this.setOf(lv, line);
    const i = set.indexOf(line); if (i >= 0) set.splice(i, 1);
    set.unshift(line);
    const cap = lv.ways > 0 ? lv.ways : this.capLines(lv);
    if (set.length > cap) set.pop();
  }
  /** One access. Returns the level index that served it, or -1 for RAM. */
  step(): { line: number; hit: number } {
    const line = this.nextLine(); this.accesses++;
    let hit = -1;
    for (let i = 0; i < this.levels.length; i++) {
      const lv = this.levels[i]; this.cycles += lv.cycles;
      if (this.setOf(lv, line).includes(line)) { lv.hits++; hit = i; this.touch(lv, line); break; }
      lv.misses++;
    }
    if (hit < 0) { this.cycles += this.ramCycles; for (const lv of this.levels) this.touch(lv, line); }
    if (this.accesses === 1) this.say('First access: a cold miss, the line is fetched all the way from RAM.');
    return { line, hit };
  }
  run(n: number) { for (let i = 0; i < n; i++) this.step(); }
  setPattern(p: Pattern) { this.pattern = p; this.say(`Access pattern set to ${p === 'seq' ? 'sequential sweep' : p === 'rand' ? 'random' : 'tight loop (high locality)'}.`); }
  setSize(i: number, kb: number) { const lv = this.levels[i]; lv.sizeKB = Math.max(4, kb); lv.sets = [[]]; this.say(`${lv.name} resized to ${lv.sizeKB} KB. Cached lines flushed.`); }
  setAssoc(i: number, ways: number) { const lv = this.levels[i]; lv.ways = ways; lv.sets = [[]]; this.say(`${lv.name} is now ${this.assocLabel(lv)} (${this.numSets(lv)} set${this.numSets(lv) === 1 ? '' : 's'}). Cached lines flushed.`); }
  avgCycles() { return this.accesses ? this.cycles / this.accesses : 0; }
  hitRate(i: number) { const lv = this.levels[i]; const t = lv.hits + lv.misses; return t ? lv.hits / t : 0; }
  resetStats() { this.levels.forEach(l => { l.hits = 0; l.misses = 0; l.sets = [[]]; }); this.accesses = 0; this.cycles = 0; this.pos = 0; }
}
