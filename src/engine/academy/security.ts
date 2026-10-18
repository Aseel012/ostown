import { Base } from './types';

export interface Attempt { label: string; actor: string; ring: 0 | 3; action: string; ok: boolean; why: string }
/** Privilege rings and access checks: why user code must ask the kernel. */
export class SecuritySim extends Base {
  attempts: Attempt[] = [];
  cases: Attempt[] = [
    { label: 'App adds two numbers', actor: 'calculator', ring: 3, action: 'ALU add', ok: true, why: 'Plain arithmetic and its own memory need no privilege. Runs directly at ring 3.' },
    { label: 'App writes to the disk controller', actor: 'calculator', ring: 3, action: 'outb to I/O port', ok: false, why: 'I/O instructions are privileged. The CPU raises a general-protection fault and the kernel kills the process. This is why drivers live in the kernel.' },
    { label: 'App reads /etc/shadow', actor: 'alice', ring: 3, action: 'open("/etc/shadow")', ok: false, why: 'The file is 0600 root. The kernel\'s VFS permission check fails with EACCES. alice cannot read other users\' password hashes.' },
    { label: 'passwd changes a password', actor: 'alice via /usr/bin/passwd', ring: 3, action: 'open("/etc/shadow", O_RDWR)', ok: true, why: 'passwd is setuid root: while it runs, its effective UID is 0, so the check passes. The program is trusted to change only your own entry.' },
    { label: 'Process pokes another process\'s RAM', actor: 'game', ring: 3, action: 'write to victim\'s page', ok: false, why: 'The page tables the MMU uses simply do not map the victim\'s frames into the attacker\'s address space. A page fault ends the attempt.' },
  ];
  run(i: number) {
    const c = this.cases[i]; if (!c) return; this.t++;
    if (!this.attempts.includes(c)) this.attempts.push(c);
    this.say(`${c.label}: ${c.ok ? 'allowed' : 'denied'} - ${c.why}`, c.ok ? 'good' : 'bad');
  }
}
