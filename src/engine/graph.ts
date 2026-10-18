import type { Hint, Kind, NodeDef, Topology } from './types';
import { TPLS } from './data';

export interface Attach { ok: boolean; sched?: string; container?: string; why?: string }
export interface Analysis {
  adj: Map<string, Set<string>>;
  byId: Map<string, NodeDef>;
  scheduler?: NodeDef;
  cores: NodeDef[];
  mem: { mode: 'paging' | 'contig' | 'none'; ram?: NodeDef; mmu?: NodeDef };
  swap?: NodeDef;
  online: Set<string>; // devices reachable via driver->scheduler
  driverOf: Map<string, string>;
  cacheOf: Map<string, NodeDef>;
  attach: Map<string, Attach>;
  buffers: { node: NodeDef; ok: boolean; nic?: NodeDef; ram?: NodeDef; tasks: string[] }[];
}

export function analyze(topo: Topology): Analysis {
  const adj = new Map<string, Set<string>>();
  const byId = new Map<string, NodeDef>();
  topo.nodes.forEach(n => { byId.set(n.id, n); adj.set(n.id, new Set()); });
  topo.edges.forEach(e => { adj.get(e.a)?.add(e.b); adj.get(e.b)?.add(e.a); });
  const nb = (n: NodeDef, kind: Kind) => [...(adj.get(n.id) ?? [])].map(i => byId.get(i)!).filter(x => x && x.kind === kind);
  const scheduler = topo.nodes.find(n => n.kind === 'scheduler');
  const cores = scheduler ? nb(scheduler, 'cpu') : [];
  let mem: Analysis['mem'] = { mode: 'none' };
  for (const c of cores) {
    for (const m of nb(c, 'mmu')) { const r = nb(m, 'ram')[0]; if (r) { mem = { mode: 'paging', ram: r, mmu: m }; break; } }
    if (mem.mode === 'paging') break;
  }
  if (mem.mode === 'none') for (const c of cores) { const r = nb(c, 'ram')[0]; if (r) { mem = { mode: 'contig', ram: r }; break; } }
  const online = new Set<string>(); const driverOf = new Map<string, string>(); const cacheOf = new Map<string, NodeDef>();
  if (scheduler) for (const d of nb(scheduler, 'driver'))
    for (const k of ['storage', 'usb', 'printer', 'nic', 'gpu'] as Kind[]) for (const dev of nb(d, k)) { online.add(dev.id); driverOf.set(dev.id, d.id); }
  for (const c of topo.nodes.filter(n => n.kind === 'cache')) { const s = nb(c, 'storage')[0]; if (s) cacheOf.set(s.id, c); }
  let swap: NodeDef | undefined;
  if (mem.mmu) swap = nb(mem.mmu, "storage").find(s => online.has(s.id));
  const attach = new Map<string, Attach>();
  for (const t of topo.nodes.filter(n => n.kind === 'task')) {
    if (!scheduler) { attach.set(t.id, { ok: false, why: 'There is no Scheduler' }); continue; }
    if (adj.get(t.id)!.has(scheduler.id)) { attach.set(t.id, { ok: true, sched: scheduler.id }); continue; }
    const cont = nb(t, 'container').find(c => adj.get(c.id)!.has(scheduler.id));
    if (cont) attach.set(t.id, { ok: true, sched: scheduler.id, container: cont.id });
    else attach.set(t.id, { ok: false, why: nb(t, 'container').length ? 'The container is not connected to the Scheduler' : 'The task is not connected to the Scheduler' });
  }
  const buffers = topo.nodes.filter(n => n.kind === 'buffer').map(b => {
    const nic = nb(b, 'nic').find(n => online.has(n.id)); const ram = nb(b, 'ram')[0];
    return { node: b, ok: !!(nic && ram && mem.ram && ram.id === mem.ram.id), nic, ram, tasks: nb(b, 'task').map(t => t.id) };
  });
  return { adj, byId, scheduler, cores, mem, swap, online, driverOf, cacheOf, attach, buffers };
}

export interface Req { ok: boolean; text: string; hint?: Hint }
export function requirements(an: Analysis, topo: Topology, taskId: string): Req[] {
  const t = an.byId.get(taskId); if (!t || !t.tpl) return [];
  const tpl = TPLS[t.tpl]; const out: Req[] = [];
  const at = an.attach.get(taskId)!;
  out.push({ ok: at.ok, text: 'Path to the Scheduler', hint: at.ok ? undefined : { text: at.why === 'There is no Scheduler' ? 'Add a Scheduler (Kernel group).' : 'Connect this task to the Scheduler (or to a container that is connected to the Scheduler).', a: 'task', b: 'scheduler', fromId: taskId } });
  out.push({ ok: an.cores.length > 0, text: 'CPU core', hint: an.cores.length ? undefined : { text: 'No CPU core is connected to the Scheduler. Add a CPU and connect it.', a: 'scheduler', b: 'cpu' } });
  out.push({ ok: an.mem.mode !== 'none', text: 'Path to RAM (CPU, MMU, RAM)', hint: an.mem.mode !== 'none' ? undefined : { text: 'Connect CPU to MMU and MMU to RAM. Without an MMU, connect the CPU directly to RAM for contiguous allocation.', a: 'cpu', b: 'mmu' } });
  const steps = new Set(tpl.pattern.map(s => s.k));
  const devOK = (k: Kind) => topo.nodes.some(n => n.kind === k && an.online.has(n.id));
  const needDriver = (k: Kind, name: string) => ({ text: `Connect the ${name} to a Driver, and the Driver to the Scheduler.`, a: k, b: 'driver' as Kind });
  if (steps.has('rd') || steps.has('wr')) out.push({ ok: topo.nodes.some(n => n.kind === 'storage' && an.online.has(n.id)), text: 'Disk (behind a driver)', hint: devOK('storage') ? undefined : needDriver('storage', 'disk') });
  if (steps.has('net')) out.push({ ok: devOK('nic'), text: 'Network card (behind a driver)', hint: devOK('nic') ? undefined : needDriver('nic', 'network card') });
  if (steps.has('prn')) out.push({ ok: devOK('printer'), text: 'Printer (behind a driver)', hint: devOK('printer') ? undefined : needDriver('printer', 'printer') });
  if (steps.has('usb')) out.push({ ok: devOK('usb'), text: 'USB drive (behind a driver)', hint: devOK('usb') ? undefined : needDriver('usb', 'USB drive') });
  if (steps.has('gpu')) out.push({ ok: devOK('gpu'), text: 'GPU (behind a driver)', hint: devOK('gpu') ? undefined : needDriver('gpu', 'GPU') });
  if (steps.has('play')) {
    const b = an.buffers.find(x => x.tasks.includes(taskId));
    out.push({ ok: !!b && b.ok, text: 'Media buffer (linked to NIC, RAM and the task)', hint: b && b.ok ? undefined : { text: 'Connect the Media Buffer to the task, the network card and RAM.', a: 'buffer', b: 'task', toId: taskId } });
  }
  return out;
}
