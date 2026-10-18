import { Base, type Tone } from './types';

/** A Unix pipe: bounded buffer, blocking reads and writes, EOF on close. */
export class PipeSim extends Base {
  cap = 8; buf: number[] = []; prodRate = 2; consRate = 1; written = 0; read = 0; closed = false;
  pState: 'running' | 'blocked' | 'done' = 'running'; cState: 'running' | 'blocked' | 'done' = 'running';
  total = 24; // bytes the producer wants to write
  constructor() { super(); this.say('A pipe with an 8-byte buffer connects a producer to a consumer. Step time and watch blocking.'); }
  setRates(p: number, c: number) { this.prodRate = p; this.consRate = c; this.say(`Rates: producer ${p} B/tick, consumer ${c} B/tick.`); }
  consumerDone() { return this.cState === 'done'; }
  tick() {
    if (this.consumerDone()) return; this.t++;
    // producer
    if (this.pState !== 'done') {
      const room = this.cap - this.buf.length; const want = Math.min(this.prodRate, this.total - this.written);
      if (want <= 0) { this.pState = 'done'; this.closed = true; this.say('Producer finished and closed its end. The consumer will see EOF once the buffer drains.', 'info'); }
      else if (room === 0) { if (this.pState !== 'blocked') this.say('Pipe full: the producer blocks inside write() until space frees up.', 'warn'); this.pState = 'blocked'; }
      else { const n = Math.min(room, want); for (let i = 0; i < n; i++) this.buf.push(1); this.written += n; if (this.pState === 'blocked') this.say('Space freed: the producer wakes and continues writing.', 'good'); this.pState = 'running'; }
    }
    // consumer
    if (this.buf.length === 0) {
      if (this.closed) { if (!this.consumerDone()) this.say('Buffer empty and write end closed: read() returns 0 (EOF). The consumer exits.', 'good'); this.cState = 'done'; }
      else { if (this.cState !== 'blocked') this.say('Buffer empty: the consumer blocks inside read() until bytes arrive.', 'warn'); this.cState = 'blocked'; }
    } else { const n = Math.min(this.consRate, this.buf.length); this.buf.splice(0, n); this.read += n; if (this.cState === 'blocked') this.say('Bytes arrived: the consumer wakes.', 'good'); this.cState = 'running'; }
  }
  get logTone(): Tone { return 'info'; }
}
