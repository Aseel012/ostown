import { Base } from './types';

export type LockId = 'A' | 'B';
export interface Thread { id: string; program: LockId[]; step: number; held: LockId[]; waiting: LockId | null; state: 'ready' | 'blocked' | 'done' }

/** Two threads, two mutexes. Shows lock ordering, the wait-for graph and deadlock. */
export class ThreadSim extends Base {
  threads: Thread[]; owner: Record<LockId, string | null> = { A: null, B: null };
  deadlocked = false; turn = 0;
  constructor() {
    super();
    this.threads = [
      { id: 'T1', program: ['A', 'B'], step: 0, held: [], waiting: null, state: 'ready' },
      { id: 'T2', program: ['B', 'A'], step: 0, held: [], waiting: null, state: 'ready' },
    ];
    this.say('T1 wants A then B. T2 wants B then A. Step the scheduler and watch the wait-for graph.');
  }
  setOrder(t: string, order: LockId[]) { const th = this.threads.find(x => x.id === t)!; th.program = order; this.reset(); }
  waitForEdges(): [string, string][] {
    const out: [string, string][] = [];
    for (const th of this.threads) if (th.waiting) { const o = this.owner[th.waiting]; if (o) out.push([th.id, o]); }
    return out;
  }
  /** Advance one thread by one lock attempt / release / finish. */
  stepSched() {
    if (this.deadlocked) { this.say('Deadlocked. Neither thread can ever proceed. Use Restart, or make both threads take locks in the same order.', 'bad'); return; }
    this.t++;
    const order = this.threads.filter(th => th.state !== 'done');
    if (!order.length) return;
    const th = order[this.turn++ % order.length];
    if (th.state === 'blocked') { this.say(`${th.id} is blocked waiting for mutex ${th.waiting}. The scheduler skips it.`); return; }
    if (th.step >= th.program.length) {
      for (const l of [...th.held]) { this.owner[l] = null; this.say(`${th.id} released mutex ${l}.`); }
      th.held = []; th.state = 'done'; this.say(`${th.id} finished its critical work and released all locks.`, 'good');
      this.wake(th); return;
    }
    const want = th.program[th.step];
    if (this.owner[want] === null) {
      this.owner[want] = th.id; th.held.push(want); th.step++;
      this.say(`${th.id} acquired mutex ${want}.`);
      if (th.step >= th.program.length) this.say(`${th.id} now holds every lock it needs: it can do its critical work.`, 'good');
    } else if (this.owner[want] === th.id) { th.step++; }
    else { th.waiting = want; th.state = 'blocked'; this.say(`${th.id} wants mutex ${want}, held by ${this.owner[want]}. It blocks.`, 'warn'); }
    this.checkDeadlock();
  }
  private wake(fin: Thread) {
    for (const th of this.threads) if (th.state === 'blocked' && th.waiting && this.owner[th.waiting] === null) { th.state = 'ready'; th.waiting = null; this.say(`${th.id} wakes up: the mutex it waited for is free.`); }
    void fin;
  }
  private checkDeadlock() {
    const edges = this.waitForEdges();
    for (const [a, b] of edges) if (edges.some(([c, d]) => c === b && d === a)) {
      this.deadlocked = true;
      this.say(`Circular wait: ${a} waits for ${b} and ${b} waits for ${a}. Both sleep forever. This is a deadlock (hold-and-wait + circular wait).`, 'bad');
    }
  }
  reset() { const p = this.threads.map(t => t.program); Object.assign(this, new ThreadSim()); this.threads.forEach((t, i) => t.program = p[i]); this.say('Restarted.'); }
}
