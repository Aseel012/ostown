import { Base } from './types';

export interface Unit { name: string; after: string[]; dur: number; state: 'pending' | 'active' | 'done'; startedAt: number; doneAt: number }
const UNITS: [string, string[], number][] = [
  ['syslog.service', [], 20], ['dbus.service', ['syslog.service'], 15],
  ['network.service', ['dbus.service'], 30], ['sshd.service', ['network.service'], 10],
  ['nginx.service', ['network.service'], 12], ['cron.service', ['syslog.service'], 8],
  ['getty@tty1.service', [], 5], ['multi-user.target', ['sshd.service', 'nginx.service', 'cron.service', 'getty@tty1.service'], 0],
];
/** Parallel, dependency-ordered service startup (systemd) vs sequential SysV init. */
export class SystemdSim extends Base {
  units: Unit[]; t = 0; running = false; done = false; seqTotal = 0;
  constructor() { super(); this.units = UNITS.map(([name, after, dur]) => ({ name, after, dur, state: 'pending', startedAt: -1, doneAt: -1 })); this.seqTotal = UNITS.reduce((a, u) => a + u[2], 0); }
  start() { if (!this.running && !this.done) { this.running = true; this.say('systemd is PID 1. It starts every unit whose dependencies are satisfied, in parallel.'); } }
  tick() {
    if (!this.running || this.done) return; this.t++;
    for (const u of this.units) {
      if (u.state === 'pending' && u.after.every(a => this.units.find(x => x.name === a)!.state === 'done')) {
        u.state = 'active'; u.startedAt = this.t; this.say(`Starting ${u.name}...`);
      }
      if (u.state === 'active' && this.t - u.startedAt >= u.dur) { u.state = 'done'; u.doneAt = this.t; this.say(`${u.name} is up.`, 'good'); }
    }
    if (this.units.every(u => u.state === 'done')) { this.done = true; this.say(`Reached multi-user.target in ${this.t} ticks. Sequential SysV init would have needed ${this.seqTotal}. Parallel startup is the point.`, 'good'); }
  }
}
