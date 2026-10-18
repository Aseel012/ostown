import { Base } from './types';

export type Mode = 'poll' | 'irq' | 'dma';
export interface Seg { start: number; end: number; kind: 'app' | 'poll' | 'handler' | 'setup' | 'copy' | 'idle' }

/** Programmed I/O vs interrupts vs DMA, on one timeline. */
export class IrqSim extends Base {
  mode: Mode = 'poll'; t = 0; cpu: Seg[] = []; devEnd = 0; done = false; useful = 0; wasted = 0; transfers = 0;
  phase = 0;
  setMode(m: Mode) { this.mode = m; this.reset(); this.say(m === 'poll' ? 'Programmed I/O: the CPU asks "done yet?" in a loop and cannot do anything else.' : m === 'irq' ? 'Interrupt-driven: the CPU works on something else; the device raises an interrupt when ready.' : 'DMA: the CPU programs the transfer once; the device writes RAM directly and raises a single interrupt at the end.'); }
  reset() { this.t = 0; this.cpu = []; this.devEnd = 0; this.done = false; this.useful = 0; this.wasted = 0; this.transfers = 0; this.phase = 0; }
  /** One block transfer of 60 units of device time; copying costs the CPU 8 units; handler 4; useful app work fills idle gaps. */
  runBlock() {
    if (this.phase >= 3) { this.done = true; return; }
    const start = this.t; const dev = 60;
    if (this.mode === 'poll') {
      this.cpu.push({ start, end: start + dev, kind: 'poll' }); this.wasted += dev;
      this.cpu.push({ start: start + dev, end: start + dev + 8, kind: 'copy' }); this.wasted += 8;
      this.t = start + dev + 8;
      this.say(`Block ${this.phase + 1}: CPU polled for ${dev} cycles doing nothing, then copied the data itself.`);
    } else if (this.mode === 'irq') {
      this.cpu.push({ start, end: start + 20, kind: 'app' }); this.useful += 20;
      this.cpu.push({ start: start + 20, end: start + dev, kind: 'idle' });
      this.cpu.push({ start: start + dev, end: start + dev + 4, kind: 'handler' });
      this.cpu.push({ start: start + dev + 4, end: start + dev + 12, kind: 'copy' }); this.wasted += 4;
      this.t = start + dev + 12;
      this.say(`Block ${this.phase + 1}: device signalled an interrupt when ready. The CPU ran a short handler, then still copied the data by hand.`);
    } else {
      this.cpu.push({ start, end: start + 4, kind: 'setup' });
      this.cpu.push({ start: start + 4, end: start + dev, kind: 'app' }); this.useful += Math.min(56, dev - 4);
      this.cpu.push({ start: start + dev, end: start + dev + 2, kind: 'handler' });
      this.t = start + dev + 2;
      this.say(`Block ${this.phase + 1}: DMA moved the bytes without the CPU. One interrupt at the end. The CPU did useful work the whole time.`, 'good');
    }
    this.devEnd = start + dev; this.transfers++; this.phase++;
    if (this.phase >= 3) { this.done = true; this.say(`Transfer complete. CPU cycles wasted on I/O bookkeeping: ${this.wasted}. Useful app cycles: ${this.useful}.`, 'info'); }
  }
}
