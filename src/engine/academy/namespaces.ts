import { Base } from './types';

export interface Ns { id: string; name: string; what: string; isolated: boolean }
/** Container isolation: which namespaces separate two containers on one kernel. */
export class NamespaceSim extends Base {
  ns: Ns[]; cpuLimit = 50; memLimitMB = 256; hostMemMB = 1024;
  constructor() {
    super();
    this.ns = [
      { id: 'pid', name: 'PID', what: 'Process IDs. A container sees only its own processes, starting from its own PID 1.', isolated: true },
      { id: 'net', name: 'Network', what: 'Interfaces, addresses and ports. Two containers can both listen on port 80 without clashing.', isolated: true },
      { id: 'mnt', name: 'Mount', what: 'The filesystem view. The container root is just a directory on the host (overlayfs).', isolated: true },
      { id: 'uts', name: 'UTS', what: 'Hostname. The container gets its own name.', isolated: true },
      { id: 'ipc', name: 'IPC', what: 'Shared memory segments and message queues stay private.', isolated: true },
      { id: 'user', name: 'User', what: 'UID mapping: root inside can be an ordinary user outside.', isolated: false },
    ];
    this.say('A container is not a VM. It is ordinary host processes boxed in by namespaces (what you can see) and cgroups (how much you may use).');
  }
  toggle(id: string) { const n = this.ns.find(x => x.id === id)!; n.isolated = !n.isolated; this.say(n.isolated ? `${n.name} namespace on: the container no longer shares this with the host.` : `${n.name} namespace off: container and host now share this. ${n.id === 'pid' ? 'The container can see (and signal!) host processes.' : ''}`, n.isolated ? 'good' : 'warn'); }
  setCpu(pct: number) { this.cpuLimit = pct; this.say(`cgroup cpu.max set to ${pct}%: the kernel scheduler throttles the container past its quota.`); }
  setMem(mb: number) { this.memLimitMB = mb; this.say(`cgroup memory.max set to ${mb} MB: crossing it triggers the container's own OOM killer, the host is fine.`); }
}
