import { describe, it, expect } from 'vitest';
import { CacheSim } from './cachehw';
import { BootSim } from './boot';
import { ProcTree } from './proctree';
import { Vfs, permStr } from './vfs';
import { ThreadSim } from './threads';
import { IrqSim } from './irq';
import { PipeSim } from './pipes';
import { NetStack, LAYERS } from './netstack';
import { SyscallSim } from './syscall';
import { SystemdSim } from './systemd';
import { SecuritySim } from './security';
import { NamespaceSim } from './namespaces';
import { LESSONS, SECTIONS } from './lessons';

describe('cache hierarchy', () => {
  it('loop pattern has high locality, random over big set does not', () => {
    const loop = new CacheSim(64 * 1024); loop.setPattern('loop'); loop.run(2000);
    const rand = new CacheSim(64 * 1024); rand.setPattern('rand'); rand.run(2000);
    const tot = (c: CacheSim) => c.levels.reduce((a, l) => a + l.hits, 0) / c.accesses;
    expect(tot(loop)).toBeGreaterThan(tot(rand));
    expect(loop.avgCycles()).toBeLessThan(rand.avgCycles());
  });
  it('never exceeds capacity and counts every access', () => {
    const c = new CacheSim(4096); c.run(500);
    // each access consults levels until the first hit, so L1 sees every access
    expect(c.levels[0].hits + c.levels[0].misses).toBe(500); expect(c.accesses).toBe(500);
    for (const l of c.levels) expect(c.totalLines(l) * 64).toBeLessThanOrEqual(l.sizeKB * 1024);
  });
});

describe('cache associativity', () => {
  it('direct mapping causes at least as many misses as fully associative on a conflict pattern', () => {
    const full = new CacheSim(1024); full.setPattern('seq'); full.run(4000);
    const direct = new CacheSim(1024); direct.setPattern('seq'); direct.levels.forEach((_, i) => direct.setAssoc(i, 1)); direct.run(4000);
    const miss = (c: CacheSim) => c.levels[0].misses;
    expect(miss(direct)).toBeGreaterThanOrEqual(miss(full));
  });
  it('never exceeds the way capacity per set', () => {
    const c = new CacheSim(4096); c.levels.forEach((_, i) => c.setAssoc(i, 2)); c.run(3000);
    for (const l of c.levels) { expect(l.sets.length).toBeLessThanOrEqual(c.numSets(l)); for (const st of l.sets) expect(st.length).toBeLessThanOrEqual(2); }
  });
  it('labels the mapping', () => { const c = new CacheSim(); expect(c.assocLabel(c.levels[0])).toBe('fully associative'); c.setAssoc(0, 1); expect(c.assocLabel(c.levels[0])).toBe('direct mapped'); c.setAssoc(0, 4); expect(c.assocLabel(c.levels[0])).toBe('4-way'); });
});

describe('boot chain', () => {
  it('reaches login with no faults', () => { const b = new BootSim(); b.power(); for (let i = 0; i < 400; i++) b.tick(); expect(b.done).toBe(true); });
  it('fails at BIOS without a disk', () => { const b = new BootSim(); b.setFault('disk', false); b.power(); for (let i = 0; i < 400; i++) b.tick(); expect(b.failed).toBe('bios'); expect(b.done).toBe(false); });
  it('fails at kernel with a corrupt image', () => { const b = new BootSim(); b.setFault('kernel', false); b.power(); for (let i = 0; i < 400; i++) b.tick(); expect(b.failed).toBe('kernel'); });
});

describe('process tree', () => {
  it('fork assigns fresh pids and exec renames', () => { const p = new ProcTree(); const c = p.fork(1)!; expect(c.ppid).toBe(1); p.exec(c.pid, 'nginx'); expect(p.get(c.pid)!.name).toBe('nginx'); });
  it('exit makes a zombie that wait reaps', () => { const p = new ProcTree(); const c = p.fork(1)!; p.exit(c.pid); expect(p.get(c.pid)!.state).toBe('zombie'); p.wait(1); expect(p.get(c.pid)!.state).toBe('dead'); });
  it('orphans are re-parented to PID 1', () => { const p = new ProcTree(); const a = p.fork(1)!; const b = p.fork(a.pid)!; p.exit(a.pid); expect(p.get(b.pid)!.ppid).toBe(1); });
  it('SIGKILL always kills, SIGSTOP freezes, SIGCONT resumes', () => { const p = new ProcTree(); const c = p.fork(1)!; c.handler = false; p.signal(c.pid, 'STOP'); expect(p.get(c.pid)!.state).toBe('stopped'); p.signal(c.pid, 'CONT'); expect(p.get(c.pid)!.state).toBe('running'); p.signal(c.pid, 'KILL'); expect(p.get(c.pid)!.state).toBe('zombie'); });
});

describe('vfs permissions', () => {
  it('alice cannot read /etc/shadow, root can', () => { const v = new Vfs(); expect(v.open('/etc/shadow')).toBe(false); v.who('root'); expect(v.open('/etc/shadow')).toBe(true); });
  it('owner chmod works, non-owner chmod denied', () => { const v = new Vfs(); v.chmod('/home/bob/todo.txt', { o: { r: true, w: false, x: false } }); const before = permStr(v.resolve('/home/bob/todo.txt')!.perms, false); expect(before).toBe('-rw-r--r--'); });
  it('creating needs write on the directory', () => { const v = new Vfs(); v.mkfile('/etc', 'x'); expect(v.resolve('/etc/x')).toBeNull(); v.mkfile('/home/alice', 'x'); expect(v.resolve('/home/alice/x')).not.toBeNull(); });
  it('hard links share the inode and link count', () => { const v = new Vfs(); const n = v.resolve('/welcome.txt')!; v.link('/welcome.txt'); expect(n.links).toBe(2); v.unlink('/welcome.txt'); expect(n.links).toBe(1); });
});

describe('threads and deadlock', () => {
  it('opposite lock orders deadlock', () => { const s = new ThreadSim(); for (let i = 0; i < 8 && !s.deadlocked; i++) s.stepSched(); expect(s.deadlocked).toBe(true); expect(s.waitForEdges().length).toBe(2); });
  it('same lock order completes', () => { const s = new ThreadSim(); s.threads[1].program = ['A', 'B']; s.reset(); s.threads[0].program = ['A', 'B']; s.threads[1].program = ['A', 'B']; for (let i = 0; i < 12; i++) s.stepSched(); expect(s.deadlocked).toBe(false); expect(s.threads.every(t => t.state === 'done')).toBe(true); });
});

describe('irq vs poll vs dma', () => {
  it('dma wastes the fewest cpu cycles', () => {
    const p = new IrqSim(); p.setMode('poll'); while (!p.done) p.runBlock();
    const i = new IrqSim(); i.setMode('irq'); while (!i.done) i.runBlock();
    const d = new IrqSim(); d.setMode('dma'); while (!d.done) d.runBlock();
    expect(d.wasted).toBeLessThan(i.wasted); expect(i.wasted).toBeLessThan(p.wasted);
  });
});

describe('pipes', () => {
  it('fast producer blocks on a full pipe, consumer hits EOF', () => { const s = new PipeSim(); s.setRates(4, 1); for (let i = 0; i < 200 && s.cState !== 'done'; i++) s.tick(); expect(s.cState).toBe('done'); expect(s.read).toBe(s.total); });
});

describe('network stack', () => {
  it('delivers after descending and ascending', () => { const n = new NetStack(); n.send(); for (let i = 0; i < 10; i++) n.step(); expect(n.pos).toBe(9); });
  it('loss causes one retransmit', () => { const n = new NetStack(); n.lossy = true; n.send(); for (let i = 0; i < 14; i++) n.step(); expect(n.retransmits).toBe(1); expect(n.pos).toBe(9); });
  it('has the four classic layers', () => { expect(LAYERS.map(l => l.name)).toEqual(['Application', 'TCP', 'IP', 'Ethernet']); });
});

describe('syscalls', () => {
  it('traps only for syscalls and completes the program', () => { const s = new SyscallSim(); while (!s.doneAll) s.step(); expect(s.rows.length).toBe(s.program.length); expect(s.rows.filter(r => r.mode === 'kernel').length).toBe(6); expect(s.mode).toBe('user'); });
});

describe('systemd', () => {
  it('parallel startup beats sequential sum', () => { const s = new SystemdSim(); s.start(); for (let i = 0; i < 200 && !s.done; i++) s.tick(); expect(s.done).toBe(true); expect(s.t).toBeLessThan(s.seqTotal); });
});

describe('security', () => {
  it('verdicts match expectations', () => { const s = new SecuritySim(); for (let i = 0; i < s.cases.length; i++) s.run(i); expect(s.attempts.length).toBe(5); expect(s.attempts[0].ok).toBe(true); expect(s.attempts[1].ok).toBe(false); expect(s.attempts[3].ok).toBe(true); });
});

describe('namespaces', () => {
  it('toggles isolation and sets limits', () => { const s = new NamespaceSim(); s.toggle('pid'); expect(s.ns.find(n => n.id === 'pid')!.isolated).toBe(false); s.setMem(512); expect(s.memLimitMB).toBe(512); });
});

describe('lesson catalog', () => {
  it('every lesson has steps with bodies and belongs to a known section', () => {
    for (const l of LESSONS) { expect(SECTIONS).toContain(l.section); expect(l.steps.length).toBeGreaterThanOrEqual(2); for (const s of l.steps) { expect(s.title.length).toBeGreaterThan(3); expect(s.body.length).toBeGreaterThan(30); } }
  });
  it('lesson ids are unique', () => { expect(new Set(LESSONS.map(l => l.id)).size).toBe(LESSONS.length); });
});
