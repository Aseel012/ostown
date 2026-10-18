import { Base } from './types';

export interface TraceRow { call: string; mode: 'user' | 'kernel'; detail: string; ret: string }
/** A tiny program executing through the user/kernel boundary, one system call at a time. */
export class SyscallSim extends Base {
  rows: TraceRow[] = []; idx = -1; mode: 'user' | 'kernel' = 'user';
  program: { call: string; detail: string; ret: string }[] = [
    { call: 'x = 2 + 3', detail: 'Ordinary arithmetic runs entirely in user mode. The kernel is not involved.', ret: 'x = 5' },
    { call: 'fd = open("data.txt", O_RDONLY)', detail: 'A library stub puts the syscall number (2 on x86-64) in a register and executes the syscall instruction. The CPU traps to ring 0 and jumps to the kernel\'s entry point.', ret: 'fd = 3' },
    { call: 'n = read(fd, buf, 4096)', detail: 'The kernel checks the fd table, asks the driver for the bytes, copies them into the user buffer, then returns to ring 3.', ret: 'n = 4096' },
    { call: 'pid = fork()', detail: 'The kernel clones the process: new PID, copy-on-write memory. It returns twice: 0 in the child, the child PID in the parent.', ret: 'pid = 4124 (parent) / 0 (child)' },
    { call: 'execve("./worker", ...)', detail: 'The child replaces its memory image with the new program. PID, fds and signal handlers survive.', ret: '(only returns on error)' },
    { call: 'write(1, "hello", 5)', detail: 'Every byte to the terminal crosses the boundary: user buffer -> kernel -> tty driver -> screen.', ret: '5' },
    { call: 'exit_group(0)', detail: 'The thread group dies. The kernel frees memory, closes fds and turns the process into a zombie for its parent to reap.', ret: '(never returns)' },
  ];
  get doneAll() { return this.idx >= this.program.length - 1; }
  step(): TraceRow | null {
    if (this.doneAll) return null; this.t++;
    this.idx++; const p = this.program[this.idx];
    const isCall = p.call.includes('(');
    this.mode = isCall ? 'kernel' : 'user';
    if (isCall) this.say(`Trap: CPU switches ring 3 -> ring 0 for ${p.call.split('(')[0]}.`);
    else this.say('Plain user-mode work: no trap, no kernel.', 'info');
    const row: TraceRow = { call: p.call, mode: this.mode, detail: p.detail, ret: p.ret };
    this.rows.push(row);
    if (isCall) this.say(`Kernel work done, iret back to user mode. Return value: ${p.ret}`, 'good');
    this.mode = 'user';
    return row;
  }
}
