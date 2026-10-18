import { Base } from './types';

export type PState = 'running' | 'sleeping' | 'zombie' | 'stopped' | 'dead';
export interface Proc { pid: number; ppid: number; name: string; state: PState; handler: boolean; exitCode: number | null; waited: boolean }

/** Linux process tree: fork, exec, exit, wait, signals, zombies and orphans. */
export class ProcTree extends Base {
  procs = new Map<number, Proc>(); nextPid = 2;
  constructor() {
    super();
    this.procs.set(1, { pid: 1, ppid: 0, name: 'systemd', state: 'running', handler: true, exitCode: null, waited: false });
    this.say('PID 1 (systemd) is running. Every process descends from it.');
  }
  get(pid: number) { return this.procs.get(pid); }
  children(pid: number) { return [...this.procs.values()].filter(p => p.ppid === pid && p.state !== 'dead'); }
  alive() { return [...this.procs.values()].filter(p => p.state !== 'dead'); }
  fork(parent: number): Proc | null {
    const p = this.procs.get(parent); if (!p || p.state === 'dead' || p.state === 'zombie') return null;
    const c: Proc = { pid: this.nextPid++, ppid: parent, name: p.name + ' (child)', state: 'running', handler: p.handler, exitCode: null, waited: false };
    this.procs.set(c.pid, c); this.t++;
    this.say(`fork(): PID ${parent} cloned itself. The child got PID ${c.pid} and an exact copy of the parent's memory (copy-on-write).`, 'good');
    return c;
  }
  exec(pid: number, program: string) {
    const p = this.procs.get(pid); if (!p || p.state === 'dead' || p.state === 'zombie') return;
    p.name = program; this.t++;
    this.say(`execve("${program}"): PID ${pid} keeps its PID and open files, but its whole memory image is replaced by ${program}.`, 'info');
  }
  exit(pid: number, code = 0) {
    const p = this.procs.get(pid); if (!p || p.state === 'dead' || p.state === 'zombie' || pid === 1) return;
    p.state = 'zombie'; p.exitCode = code; this.t++;
    this.say(`PID ${pid} exited with code ${code}. It stays as a zombie until its parent (PID ${p.ppid}) calls wait() to collect the exit code.`, 'warn');
    for (const c of this.children(pid)) { c.ppid = 1; this.say(`PID ${c.pid} was orphaned and re-parented to PID 1.`, 'warn'); }
  }
  wait(parent: number) {
    const z = this.children(parent).find(c => c.state === 'zombie');
    if (z) { z.state = 'dead'; z.waited = true; this.t++; this.say(`PID ${parent} called wait() and reaped zombie PID ${z.pid} (exit code ${z.exitCode}). The slot in the process table is freed.`, 'good'); }
    else this.say(`PID ${parent} called wait() but has no zombie child. It would block until one exits.`, 'info');
  }
  signal(pid: number, sig: 'TERM' | 'KILL' | 'STOP' | 'CONT') {
    const p = this.procs.get(pid); if (!p || p.state === 'dead' || p.state === 'zombie') return;
    this.t++;
    if (sig === 'KILL') { this.say(`kill -9 ${pid}: SIGKILL cannot be caught or ignored. The kernel ends the process immediately.`); this.exit(pid, 137); }
    else if (sig === 'TERM') {
      if (p.handler) { this.say(`kill ${pid}: SIGTERM delivered, but the process installed a handler: it cleans up and exits gracefully.`); this.exit(pid, 0); }
      else { this.say(`kill ${pid}: SIGTERM delivered. No handler installed, so the default action runs: terminate.`); this.exit(pid, 143); }
    } else if (sig === 'STOP') { p.state = 'stopped'; this.say(`SIGSTOP: PID ${pid} is frozen. It cannot refuse. Resume it with SIGCONT.`, 'warn'); }
    else { if (p.state === 'stopped') { p.state = 'running'; this.say(`SIGCONT: PID ${pid} resumes.`, 'good'); } else this.say(`SIGCONT sent to PID ${pid}, which was not stopped. No effect.`); }
  }
}
