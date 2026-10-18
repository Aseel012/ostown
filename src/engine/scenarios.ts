import type { Kind, NodeDef, EdgeDef, Topology, TplId, Props } from './types';
import { CATALOG, taskDefaults } from './data';
import { KB, MB, GB } from '../units';

let uid = 0;
export const newId = (p: string) => `${p}-${Date.now().toString(36)}${(uid++).toString(36)}`;

class B {
  nodes: NodeDef[] = []; edges: EdgeDef[] = []; n = 0;
  add(kind: Kind, x: number, y: number, props: Props = {}, tpl?: TplId) {
    const id = `${tpl ?? kind}${++this.n}`;
    const base = kind === 'task' ? taskDefaults(tpl!) : { ...(CATALOG as any)[kind].defaults };
    if (kind === 'task') base.loop = false;
    this.nodes.push({ id, kind, x: Math.round(x * 0.86), y: kind === 'task' ? y : Math.round(y * 0.9), tpl, props: { ...base, ...props } }); return id;
  }
  link(...p: string[]) { for (let i = 0; i < p.length - 1; i++) this.edges.push({ id: `e${this.edges.length}-${p[i]}-${p[i + 1]}`, a: p[i], b: p[i + 1] }); }
  out(): Topology { return { nodes: this.nodes, edges: this.edges }; }
}

export interface Scenario { id: string; title: string; tag: string; hook: string; watch: string[]; try: string[]; build: () => Topology }

interface CoreOpts { cores?: number; ram?: Props; mmu?: Props | false; sched?: Props; disk?: Props; storage?: boolean }
function core(b: B, o: CoreOpts = {}) {
  const s = b.add('scheduler', 360, 210, o.sched ?? {});
  const cpus: string[] = []; for (let i = 0; i < (o.cores ?? 1); i++) { const c = b.add('cpu', 740, 40 + i * 140); cpus.push(c); b.link(s, c); }
  // Teaching-scale pages: pick a power-of-two page so the machine has at most ~128 real frames (every page is simulated exactly).
  const rp: Props = { ...(o.ram ?? {}) }; if (rp.page === undefined) { const sz = +(rp.size ?? 512 * MB); let pg = 1; while (sz / pg > 128) pg *= 2; rp.page = Math.max(4 * KB, pg); }
  const ram = b.add('ram', 1060, 150, rp);
  let mmu: string | undefined;
  if (o.mmu !== false) { mmu = b.add('mmu', 760, 310, o.mmu ?? {}); cpus.forEach(c => b.link(c, mmu!)); b.link(mmu, ram); } else cpus.forEach(c => b.link(c, ram));
  const drv = b.add('driver', 420, 520); b.link(s, drv);
  let st: string | undefined;
  if (o.storage !== false) { st = b.add('storage', 700, 520, o.disk ?? {}); b.link(drv, st); if (mmu) b.link(mmu, st); }
  return { s, cpus, ram, mmu, drv, st };
}
const col = (b: B, s: string, tasks: [TplId, Props?][], x = -20, y0 = 20, dy = 158) => tasks.map(([t, p], i) => { const id = b.add('task', x, y0 + i * dy, { loop: true, ...(p ?? {}) }, t); b.link(id, s); return id; });

export const SCENARIOS: Scenario[] = [
  { id: 'workstation', title: 'Everyday Workstation', tag: 'Overview', hook: 'A complete desktop: browser, video, file copy and compression sharing one CPU, 512 MB of RAM, a disk and a network card.',
    watch: ['Parcels on the links show where each task currently is. At the CPU means running. At a disk means waiting for I/O.', 'RAM frames change colour as different tasks own them. Hover a frame for details.', 'The Gantt chart under the canvas shows who held the CPU.'],
    try: ['Switch the Scheduler to FCFS and compare turnaround times in Metrics.', 'Type a new RAM size, for example 256 MB or 2 GB, and watch the page fault rate.', 'Disable the TLB on the MMU and watch effective access time.'],
    build() { const b = new B(); const c = core(b); col(b, c.s, [['browser'], ['video'], ['copy'], ['zip', { delay: 400 }]]);
      const nic = b.add('nic', 380, 700, { bw: 12 * MB }); b.link(c.drv, nic); const buf = b.add('buffer', 700, 700); b.link(buf, nic); b.link(buf, c.ram); b.link(buf, b.nodes.find(n => n.tpl === 'video')!.id); const ca = b.add('cache', 980, 540); b.link(ca, c.st!);
      return b.out(); } },
  { id: 'cpu', title: 'CPU Scheduling Arena', tag: 'Scheduling', hook: 'One core, four tasks with different burst lengths and priorities. Change the policy and compare waiting and response time.',
    watch: ['Each colour in the Gantt chart is a task.', 'Metrics shows average turnaround, waiting and response time, plus context switch overhead.', 'SRTF lets short jobs jump the queue.'],
    try: ['Compare FCFS and SRTF. How does the Compression task wait change?', 'Try Round Robin with a 10 ms and a 200 ms quantum, then add a 5 ms context switch cost.', 'Add a second CPU core and set its clock speed.'],
    build() { const b = new B(); const c = core(b, { sched: { policy: 'fcfs' }, ram: { size: 1 * GB } }); col(b, c.s, [['zip', { prio: 5 }], ['browser', { prio: 3 }], ['print', { prio: 1 }], ['photo', { prio: 2, delay: 100 }]]); const p = b.add('printer', 1000, 560); b.link(c.drv, p); const n = b.add('nic', 330, 700); b.link(c.drv, n); return b.out(); } },
  { id: 'thrash', title: 'Thrashing: Too Little RAM', tag: 'Virtual Memory', hook: 'Three memory hungry tasks on 192 MB of RAM. Pages are constantly swapped in and out and the CPU sits idle waiting for the disk.',
    watch: ['Major faults climb while CPU utilisation falls.', 'The Photo Editor working set alone is most of RAM.', 'Effective access time explodes because faults cost milliseconds, not nanoseconds.'],
    try: ['Type 1 GB into the RAM size. Does the thrashing stop?', 'Compare FIFO, LRU, Clock, LFU and Random replacement.', 'Set prefetch to 4 on the MMU and watch major faults and disk load.', 'Switch the disk from HDD to SSD.'],
    build() { const b = new B(); const c = core(b, { ram: { size: 192 * MB }, mmu: { repl: 'fifo' }, disk: { rate: 40 * MB, seek: 80 } }); col(b, c.s, [['photo'], ['zip'], ['browser']]); const n = b.add('nic', 330, 700); b.link(c.drv, n); return b.out(); } },
  { id: 'frag', title: 'Fragmentation Lab', tag: 'Memory', hook: 'No virtual memory. Every task needs one contiguous block of RAM. There is free memory, but only in scattered holes.',
    watch: ['Free frames appear between allocated blocks.', 'A new task waits because no single hole is big enough (external fragmentation).', 'Press "Compact memory" on the RAM inspector.'],
    try: ['Switch First-fit, Best-fit and Worst-fit and restart.', 'Set the page size to 64 MB and compare internal fragmentation.', 'Connect an MMU between CPU and RAM and watch the problem disappear.'],
    build() { const b = new B(); const c = core(b, { mmu: false, ram: { size: 512 * MB, page: 16 * MB, res: 128, reserved: 32 * MB } }); col(b, c.s, [['print', { loop: false }], ['browser', { delay: 50 }], ['copy', { loop: false, delay: 100 }], ['usbcopy', { delay: 150 }], ['zip', { delay: 200 }], ['browser', { delay: 4000, loop: false }]], -20, -120, 158); const n = b.add('nic', 330, 700); b.link(c.drv, n); const u = b.add('usb', 940, 560); b.link(c.drv, u); const p = b.add('printer', 1000, 700); b.link(c.drv, p); return b.out(); } },
  { id: 'bytes', title: 'Bytes Lab (textbook sizes)', tag: 'Memory', hook: 'A tiny machine you can reason about by hand: 12 bytes of RAM, 2 byte pages, three tiny processes. Edit any number and see the effect.',
    watch: ['Only 6 frames exist. Count page faults yourself and compare with the log.', 'Page tables show every virtual page of each process.', 'Internal fragmentation is visible because process sizes are not multiples of 2 bytes.'],
    try: ['Change RAM to 8 bytes, then 6, then 16.', 'Change the page size to 1 byte or 4 bytes.', 'Switch the replacement policy and compare fault counts.'],
    build() { const b = new B(); const c = core(b, { ram: { size: 12, page: 2, reserved: 0, res: 64 }, mmu: { tlb: 4, repl: 'fifo' }, disk: { swap: 1 * MB, rate: 4 * KB, type: 'hdd' } });
      const mk = (tpl: TplId, sz: number, ws: number, y: number, d: number) => { const id = b.add('task', -20, y, { loop: true, size: sz, ws, io: 1, delay: d, repeat: 6 }, tpl); b.link(id, c.s); return id; };
      mk('print', 7, 5, 20, 0); mk('copy', 9, 6, 178, 0); mk('browser', 5, 4, 336, 0); return b.out(); } },
  { id: 'buffer', title: 'Video Buffer and Bandwidth', tag: 'Buffers', hook: 'A video stream and two downloads share a 3 MB/s network link. The media buffer smooths bursts until it runs dry.',
    watch: ['The buffer level in bytes against its capacity.', 'Each downloader gets an equal share of bandwidth.', 'Rebuffer count and stall time in the Metrics tab.'],
    try: ['Raise the network bandwidth to 8 MB/s.', 'Increase the buffer from 32 MB to 128 MB.', 'Lower the video bitrate or remove a download.'],
    build() { const b = new B(); const c = core(b); const v = col(b, c.s, [['video', { bitrate: 1 * MB }], ['download', { delay: 600 }], ['download', { delay: 900 }]])[0]; const nic = b.add('nic', 380, 700, { bw: 3 * MB, latency: 40 }); b.link(c.drv, nic); const buf = b.add('buffer', 700, 700, { size: 32 * MB, start: 50 }); b.link(buf, nic); b.link(buf, c.ram); b.link(buf, v); return b.out(); } },
  { id: 'disk', title: 'Disk Scheduling and Page Cache', tag: 'Storage', hook: 'Several tasks read and write the same HDD. The head swings across the platter, and a page cache can absorb repeat reads.',
    watch: ['Total head travel and average request latency on the Disk node.', 'Cache hit rate when you add or resize a page cache.', 'Queue depth in the Metrics tab.'],
    try: ['Compare FCFS, SSTF, SCAN and C-SCAN. Which has the least head travel? Which can starve requests?', 'Resize the page cache (for example 16 MB versus 256 MB).', 'Change the disk from HDD to SSD.'],
    build() { const b = new B(); const c = core(b, { ram: { size: 1 * GB } }); col(b, c.s, [['database'], ['copy'], ['zip'], ['usbcopy']]); const cache = b.add('cache', 960, 560, { size: 32 * MB }); b.link(cache, c.st!); const u = b.add('usb', 960, 700); b.link(c.drv, u); return b.out(); } },
  { id: 'docker', title: 'Docker Resource Limits', tag: 'Containers', hook: 'A container has a 160 MB memory limit and 50% CPU quota. When a task inside exceeds it, only that container sees an OOM kill.',
    watch: ['Container memory and CPU quota bars.', 'OOM kills stay inside the container and the host browser keeps running.', 'Restart count under the restart policy.'],
    try: ['Type a new memory limit, for example 512 MB or 1 GB.', 'Turn on swap for the container.', 'Set the restart policy to "never" and watch the task stay dead.', 'Lower the CPU quota to 25% to see throttling.'],
    build() { const b = new B(); const c = core(b, { ram: { size: 512 * MB } }); const br = b.add('task', -20, 20, { loop: true }, 'browser'); b.link(br, c.s); const z = b.add('task', -20, 160, { loop: true }, 'zip'); b.link(z, c.s); const ct = b.add('container', 20, 330, { mem: 160 * MB, cpuPct: 50, swapOK: false, name: 'webapp' }); b.link(ct, c.s); const h = b.add('task', -250, 380, { loop: true }, 'memhog'); b.link(h, ct); return b.out(); } },
  { id: 'usb', title: 'Hot-Unplugging a USB Drive', tag: 'Devices', hook: 'A backup task writes to a USB drive. Unplug it mid-copy and watch the task block, then resume on re-insert.',
    watch: ['The task is blocked and uses no CPU.', 'The driver raises an interrupt when the drive returns.'],
    try: ['Toggle Plugged on the USB drive.', 'Shrink the USB capacity to fill it and watch the "disk full" state.', 'Type a slower transfer rate such as 1 MB/s.'],
    build() { const b = new B(); const c = core(b); col(b, c.s, [['usbcopy'], ['browser']]); const u = b.add('usb', 960, 520, { used: 20 * MB, cap: 128 * MB, rate: 8 * MB }); b.link(c.drv, u); const n = b.add('nic', 330, 700); b.link(c.drv, n); return b.out(); } },
  { id: 'rig', title: 'Gaming Rig: CPU Cache and GPU', tag: 'Hardware', hook: 'A game and an ML training run share two CPU cores with on-chip caches and one GPU. The working sets outgrow the caches and the GPU queue forms.',
    watch: ['The GPU node shows frames served and its queue. The game stalls when the GPU or a core cannot keep up.', 'The CPU inspector shows the cache speed factor: big working sets run below the clock speed.', 'The ML task keeps 512 MB hot and evicts everything else.'],
    try: ['Shrink L3 on the CPUs and watch the game frame rate drop in Metrics.', 'Raise the GPU frame rate from 120 to 240 fps.', 'Remove the GPU and read the requirement hint on the game.'],
    build() { const b = new B(); const c = core(b, { cores: 2, ram: { size: 1 * GB }, disk: { type: 'ssd' } });
      const g = b.add('gpu', 700, 700, { fps: 120 }); b.link(c.drv, g);
      col(b, c.s, [['game'], ['ml', { delay: 300 }], ['browser', { delay: 150 }]]); const n = b.add('nic', 330, 700); b.link(c.drv, n); return b.out(); } },
  { id: 'blank', title: 'Blank Canvas', tag: 'Free build', hook: 'Build your own system from scratch. Drop components from the palette and drag from a port to connect them.',
    watch: ['The Guide tab lists the next step.'], try: ['Start with a Scheduler, a CPU, an MMU and RAM.'], build() { return { nodes: [], edges: [] }; } },
];

export const scenarioById = (id: string) => SCENARIOS.find(s => s.id === id)!;
