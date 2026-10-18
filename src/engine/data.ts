import type { Kind, Tpl, TplId, Props, Step } from './types';
import { KB, MB, GB } from '../units';

export const TPLS: Record<TplId, Tpl> = {
  browser: { id: 'browser', name: 'Browser', blurb: 'Fetches pages over the network, then renders them. Small footprint, but tabs add up fast.', size: 120 * MB, ws: 80 * MB, io: 1 * MB, prio: 3, writePct: 30, repeat: 5, color: '#8aa4b8',
    pattern: [{ k: 'net', n: 2 }, { k: 'cpu', n: 14 }, { k: 'rd', n: 1 }, { k: 'cpu', n: 8 }] },
  video: { id: 'video', name: 'Video Playback', blurb: 'Pulls one frame at a time from the media buffer. An empty buffer means a stall (rebuffering).', size: 96 * MB, ws: 48 * MB, io: 1 * MB, prio: 2, writePct: 10, repeat: 1, color: '#c08c9e', fps: 25, bitrate: 1 * MB,
    pattern: [{ k: 'play', n: 300 }] },
  copy: { id: 'copy', name: 'File Copy', blurb: 'Read a chunk, then write it, over and over. Disk heavy, light on CPU.', size: 64 * MB, ws: 32 * MB, io: 4 * MB, prio: 4, writePct: 20, repeat: 12, color: '#bfa87a',
    pattern: [{ k: 'rd', n: 1 }, { k: 'cpu', n: 3 }, { k: 'wr', n: 1 }] },
  zip: { id: 'zip', name: 'Compression', blurb: 'Burns CPU and memory and also streams the disk. The heaviest everyday workload.', size: 160 * MB, ws: 112 * MB, io: 4 * MB, prio: 5, writePct: 50, repeat: 8, color: '#9d8cbd',
    pattern: [{ k: 'rd', n: 1 }, { k: 'cpu', n: 16 }, { k: 'wr', n: 1 }] },
  photo: { id: 'photo', name: 'Photo Editor', blurb: 'Needs a large image resident in RAM. The classic thrashing victim on a small machine.', size: 288 * MB, ws: 208 * MB, io: 8 * MB, prio: 3, writePct: 40, repeat: 6, color: '#7fb59d',
    pattern: [{ k: 'cpu', n: 18 }, { k: 'rd', n: 1 }, { k: 'cpu', n: 12 }] },
  database: { id: 'database', name: 'Database', blurb: 'Random reads and frequent writes against a large working set. Sensitive to cache size and disk scheduling.', size: 224 * MB, ws: 160 * MB, io: 256 * KB, prio: 2, writePct: 60, repeat: 20, color: '#b7a06e',
    pattern: [{ k: 'rd', n: 3 }, { k: 'cpu', n: 5 }, { k: 'wr', n: 1 }] },
  print: { id: 'print', name: 'Print Job', blurb: 'The printer is slow, so the task blocks. A blocked task uses no CPU.', size: 48 * MB, ws: 24 * MB, io: 256 * KB, prio: 1, writePct: 10, repeat: 4, color: '#bf927a',
    pattern: [{ k: 'cpu', n: 4 }, { k: 'prn', n: 3 }, { k: 'cpu', n: 2 }] },
  usbcopy: { id: 'usbcopy', name: 'USB Backup', blurb: 'Reads from disk and writes to USB. If the drive is unplugged the task stalls.', size: 72 * MB, ws: 32 * MB, io: 4 * MB, prio: 4, writePct: 20, repeat: 12, color: '#92b58d',
    pattern: [{ k: 'rd', n: 1 }, { k: 'cpu', n: 2 }, { k: 'usb', n: 1 }] },
  download: { id: 'download', name: 'Download', blurb: 'Shares network bandwidth with everyone else. Running next to a video slows both.', size: 56 * MB, ws: 24 * MB, io: 2 * MB, prio: 4, writePct: 20, repeat: 16, color: '#7aacbf',
    pattern: [{ k: 'net', n: 1 }, { k: 'cpu', n: 1 }, { k: 'wr', n: 1 }] },
  memhog: { id: 'memhog', name: 'Memory Hog', blurb: 'Asks for so much memory that the OOM killer has to step in.', size: 400 * MB, ws: 340 * MB, io: 4 * MB, prio: 5, writePct: 70, repeat: 4, color: '#c27d7d',
    pattern: [{ k: 'cpu', n: 40 }] },
  game: { id: 'game', name: '3D Game', blurb: 'Prepares a frame on the CPU, then hands it to the GPU, over and over. A slow GPU or a busy CPU shows up as a low frame rate.', size: 320 * MB, ws: 224 * MB, io: 4 * MB, prio: 2, writePct: 20, repeat: 400, color: '#a8bf7a',
    pattern: [{ k: 'cpu', n: 3 }, { k: 'gpu', n: 1 }] },
  ml: { id: 'ml', name: 'ML Training', blurb: 'Loads batches from disk, preprocesses on the CPU, then pushes long matrix work to the GPU. Large resident working set.', size: 640 * MB, ws: 512 * MB, io: 16 * MB, prio: 4, writePct: 40, repeat: 8, color: '#8d9dbf',
    pattern: [{ k: 'rd', n: 1 }, { k: 'cpu', n: 8 }, { k: 'gpu', n: 6 }, { k: 'wr', n: 1 }] },
  custom: { id: 'custom', name: 'Custom Workload', blurb: 'Your own program: type a burst list (for example "cpu 40, rd 2, cpu 25, wr 1"), an arrival time and an optional page reference string.', size: 96 * MB, ws: 48 * MB, io: 1 * MB, prio: 3, writePct: 30, repeat: 4, color: '#c9c9c9',
    pattern: [{ k: 'cpu', n: 12 }, { k: 'rd', n: 1 }, { k: 'cpu', n: 6 }] },
};

/** Burst-list kinds accepted by the Custom Workload editor. */
export const BURST_ALIASES: Record<string, Step['k']> = {
  cpu: 'cpu', compute: 'cpu', rd: 'rd', read: 'rd', wr: 'wr', write: 'wr',
  net: 'net', network: 'net', prn: 'prn', print: 'prn', usb: 'usb', gpu: 'gpu', play: 'play',
};
/**
 * Parse a free-typed burst list such as "cpu 40, rd 2, cpu 25, wr 1".
 * Accepts "kind amount" or "kind:amount", separated by commas, semicolons or spaces.
 * CPU amounts are bursts of 10 ms; other kinds are operation counts.
 */
export function parseBursts(text: string): { steps: Step[]; err?: never } | { steps?: never; err: string } {
  const s = (text ?? '').trim();
  if (!s) return { err: 'Enter at least one burst, e.g. cpu 40, rd 2, cpu 25' };
  const parts = s.split(/[,;]+/).map(x => x.trim()).filter(Boolean);
  const steps: Step[] = [];
  for (const part of parts) {
    const m = /^([a-z]+)\s*[:=]?\s*(\d+(?:\.\d+)?)$/i.exec(part) ?? /^([a-z]+)$/i.exec(part);
    if (!m) return { err: `Cannot read "${part}". Use "cpu 40" or "rd 2", separated by commas.` };
    const kind = BURST_ALIASES[m[1].toLowerCase()];
    if (!kind) return { err: `Unknown burst kind "${m[1]}". Use cpu, rd, wr, net, prn, usb, gpu or play.` };
    const n = m[2] === undefined ? 1 : Number(m[2]);
    if (!isFinite(n) || n <= 0) return { err: `The amount in "${part}" must be a positive number.` };
    if (n > 100000) return { err: `The amount in "${part}" is too large (max 100000).` };
    steps.push({ k: kind, n: Math.round(n) });
    if (steps.length > 500) return { err: 'Too many bursts (max 500).' };
  }
  if (!steps.some(x => x.k === 'cpu')) return { err: 'Add at least one CPU burst, e.g. cpu 40.' };
  return { steps };
}

/** Parse a page reference string such as "0 1 2 3 0 4 1" into page numbers. */
export function parseRefString(text: string): { pages: number[]; err?: never } | { pages?: never; err: string } {
  const s = (text ?? '').trim();
  if (!s) return { pages: [] };
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  const pages: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return { err: `"${p}" is not a page number. Use whole numbers separated by spaces or commas.` };
    pages.push(Number(p));
    if (pages.length > 2000) return { err: 'Reference string is too long (max 2000 references).' };
  }
  return { pages };
}

export const taskDefaults = (t: TplId): Props => { const p = TPLS[t]; return { loop: true, delay: 0, dest: 'auto', prio: p.prio, size: p.size, ws: p.ws, io: p.io, writePct: p.writePct, repeat: p.repeat, burst: 100, ...(p.fps ? { fps: p.fps, bitrate: p.bitrate } : {}) }; };

export interface Catalog { kind: Kind; label: string; group: string; blurb: string; defaults: Props; w: number; h: number }
export const CATALOG: Record<Exclude<Kind, 'task'>, Catalog> = {
  scheduler: { kind: 'scheduler', label: 'Scheduler', group: 'Kernel', blurb: 'Decides which task runs on which core and for how long. Every task, driver and container connects to it.', defaults: { policy: 'rr', quantum: 60, ctxCost: 2, boost: 2000 }, w: 260, h: 150 },
  cpu: { kind: 'cpu', label: 'CPU Core', group: 'Kernel', blurb: 'One core runs one task at a time. Its L1/L2/L3 caches decide how often it must wait on RAM: a working set that falls out of cache runs noticeably slower.', defaults: { ghz: 3, cacheOn: true, l1: 32 * KB, l2: 256 * KB, l3: 8 * MB }, w: 190, h: 120 },
  mmu: { kind: 'mmu', label: 'MMU / Virtual Memory', group: 'Memory', blurb: 'Translates each task\'s virtual pages to physical frames through a page table, with a TLB cache. Remove it to get contiguous allocation.', defaults: { repl: 'lru', tlb: 16, tlbMiss: 60, asid: true, prefetch: 0 }, w: 220, h: 130 },
  ram: { kind: 'ram', label: 'RAM', group: 'Memory', blurb: 'A grid of physical frames. Colour shows which task owns each frame.', defaults: { size: 512 * MB, page: 2 * MB, fit: 'first', reserved: 32 * MB, oom: 'largest', res: 128 }, w: 380, h: 300 },
  cache: { kind: 'cache', label: 'Page Cache', group: 'Memory', blurb: 'Remembers recently read disk blocks so repeat reads skip the disk.', defaults: { size: 64 * MB, policy: 'lru' }, w: 190, h: 120 },
  buffer: { kind: 'buffer', label: 'Media Buffer', group: 'Memory', blurb: 'Streaming data lands here first and the player drains it. Uses pinned RAM frames that cannot be swapped out.', defaults: { size: 32 * MB, start: 50 }, w: 220, h: 130 },
  storage: { kind: 'storage', label: 'Disk', group: 'Devices', blurb: 'Holds files and the swap partition. Requests queue up and the scheduler decides the order the head services them.', defaults: { type: 'hdd', cap: 256 * GB, used: 60 * GB, swap: 4 * GB, rate: 120 * MB, seek: 40, sched: 'fcfs' }, w: 240, h: 160 },
  usb: { kind: 'usb', label: 'USB Drive', group: 'Devices', blurb: 'Removable storage. Plug and unplug it to see what the OS does.', defaults: { cap: 32 * GB, used: 4 * GB, rate: 40 * MB, plugged: true }, w: 190, h: 120 },
  printer: { kind: 'printer', label: 'Printer', group: 'Devices', blurb: 'A very slow device with its own queue. Completion raises an interrupt.', defaults: { rate: 1536 * KB, online: true }, w: 180, h: 110 },
  gpu: { kind: 'gpu', label: 'GPU', group: 'Devices', blurb: 'Renders frames and runs parallel number crunching. It has its own queue and its own speed, independent of the CPU cores.', defaults: { fps: 120 }, w: 190, h: 120 },
  nic: { kind: 'nic', label: 'Network Card', group: 'Devices', blurb: 'Bandwidth is shared fairly between all active downloads and streams.', defaults: { bw: 12 * MB, latency: 20 }, w: 190, h: 120 },
  driver: { kind: 'driver', label: 'Driver', group: 'Devices', blurb: 'Connects the kernel to a device and forwards its interrupts. A device without a driver is unreachable.', defaults: {}, w: 170, h: 100 },
  container: { kind: 'container', label: 'Docker Container', group: 'Containers', blurb: 'Same kernel, but with cgroup limits on memory and CPU. Exceeding the memory limit triggers OOM only inside the container.', defaults: { mem: 160 * MB, cpuPct: 50, swapOK: false, restart: 'always', name: 'app' }, w: 280, h: 210 },
};

export const GROUPS = ['Kernel', 'Memory', 'Devices', 'Containers', 'Workloads'];
export const TASK_SIZE = { w: 200, h: 126 };
export const nodeSize = (kind: Kind) => (kind === 'task' ? TASK_SIZE : { w: CATALOG[kind].w, h: CATALOG[kind].h });

export const POLICIES: Record<string, { label: string; hint: string }> = {
  fcfs: { label: 'FCFS', hint: 'First come, first served. Non-preemptive.' },
  sjf: { label: 'SJF', hint: 'Shortest next burst first. Non-preemptive.' },
  srtf: { label: 'SRTF', hint: 'Shortest remaining time first. A shorter newcomer preempts the running task.' },
  prio: { label: 'Priority', hint: 'Lower number means higher priority. Non-preemptive.' },
  priop: { label: 'Priority (preemptive)', hint: 'A higher priority task preempts the running one.' },
  rr: { label: 'Round Robin', hint: 'Each task gets a time quantum in turn.' },
  mlfq: { label: 'MLFQ', hint: 'Three queues with growing quanta. CPU hogs sink, interactive tasks stay on top. Periodic priority boost prevents starvation.' },
};
export const REPLACEMENT = { fifo: 'FIFO', lru: 'LRU', clock: 'Clock (second chance)', lfu: 'LFU', random: 'Random' } as const;
export const DISK_SCHED = { fcfs: 'FCFS', sstf: 'SSTF', scan: 'SCAN (elevator)', cscan: 'C-SCAN' } as const;
export const FIT = { first: 'First-fit', best: 'Best-fit', worst: 'Worst-fit' } as const;
export const OOM_POLICY = { largest: 'Kill largest resident task', newest: 'Kill newest task', lowprio: 'Kill lowest priority task' } as const;

const PAIRS: [string, string][] = [
  ['scheduler', 'cpu'], ['scheduler', 'task'], ['scheduler', 'container'], ['scheduler', 'driver'],
  ['cpu', 'mmu'], ['cpu', 'ram'], ['mmu', 'ram'], ['mmu', 'storage'],
  ['driver', 'storage'], ['driver', 'usb'], ['driver', 'printer'], ['driver', 'nic'], ['driver', 'gpu'],
  ['cache', 'storage'], ['buffer', 'nic'], ['buffer', 'ram'], ['buffer', 'task'], ['container', 'task'],
];
export const canLink = (a: Kind, b: Kind) => PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
export function linkWhy(a: Kind, b: Kind): string {
  const k = [a, b].sort().join('+');
  const m: Record<string, string> = {
    'ram+task': 'A task does not attach to RAM directly. It attaches to the Scheduler, runs on a CPU, and the CPU reaches RAM through the MMU.',
    'cpu+task': 'A task does not attach to a CPU directly. Connect it to the Scheduler, which decides who gets a core.',
    'cpu+storage': 'A CPU does not talk to a disk directly. Put a Driver in between and connect the Driver to the Scheduler.',
    'scheduler+storage': 'Connect the disk to a Driver, not to the Scheduler.',
    'ram+storage': 'RAM and disk are linked through the MMU (for swap). Connect the MMU to the disk.',
    'nic+task': 'A task does not use the network card directly. Connect the NIC to a Driver, and the Driver to the Scheduler.',
    'driver+task': 'Tasks do not connect to drivers. They connect to the Scheduler, which uses the driver.',
    'ram+scheduler': 'The Scheduler does not manage RAM. CPUs use RAM through the MMU.',
    'mmu+scheduler': 'The MMU sits between CPU and RAM, not the Scheduler.',
  };
  return m[k] || 'These two components cannot be connected. Check the palette hints or follow the Guide.';
}
