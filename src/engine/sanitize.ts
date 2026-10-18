import type { Kind, NodeDef, Topology, TplId, Props } from './types';
import { CATALOG, TPLS, taskDefaults, canLink } from './data';

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
export const MAX_NODES = 300, MAX_EDGES = 1000;

export interface Sanitized { topo: Topology; warnings: string[] }

const KINDS: Kind[] = ['scheduler', 'cpu', 'mmu', 'ram', 'storage', 'usb', 'printer', 'nic', 'driver', 'cache', 'buffer', 'container', 'task', 'gpu'];
const MAX_SIZE = 2 ** 48; // 256 TB ceiling for any byte field
const SIZE_KEYS = new Set(['size', 'ws', 'io', 'cap', 'used', 'swap', 'rate', 'bw', 'mem', 'page', 'reserved', 'l1', 'l2', 'l3', 'bitrate']);
const BOOL_KEYS = new Set(['cacheOn', 'asid', 'plugged', 'online', 'loop', 'swapOK']);
const STR_KEYS: Record<string, number> = { name: 40, bursts: 600, refstr: 4000 };
const ENUM_KEYS: Record<string, string[]> = {
  policy: ['rr', 'fcfs', 'sjf', 'srtf', 'prio', 'priop', 'mlfq', 'lru', 'fifo'], // scheduler policy + cache policy share the key
  repl: ['fifo', 'lru', 'clock', 'lfu', 'random'],
  fit: ['first', 'best', 'worst'],
  oom: ['largest', 'newest', 'lowprio'],
  sched: ['fcfs', 'sstf', 'scan', 'cscan'],
  type: ['hdd', 'ssd'],
  dest: ['auto', 'usb'],
  restart: ['always', 'no'],
};
// Numeric props with tighter ranges than the generic size clamp. [min, max]
const NUM_RANGES: Record<string, [number, number]> = {
  repeat: [1, 5000], burst: [10, 1000], delay: [0, 600000], arrival: [0, 3600000],
  quantum: [10, 5000], boost: [100, 60000], ctxCost: [0, 100], ghz: [0.5, 6],
  tlb: [0, 1024], tlbMiss: [0, 10000], prefetch: [0, 64], res: [8, 4096],
  prio: [1, 9], writePct: [0, 100], cpuPct: [5, 100], start: [0, 100],
  fps: [1, 1000], latency: [0, 5000], seek: [0, 500],
};
const KNOWN_EXTRA = new Set([...SIZE_KEYS, ...BOOL_KEYS, ...Object.keys(STR_KEYS), ...Object.keys(ENUM_KEYS), ...Object.keys(NUM_RANGES)]);

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function cleanProps(kind: Kind, tpl: TplId | undefined, raw: any, warn: (m: string) => void): Props {
  const base: Props = kind === 'task' ? taskDefaults(tpl!) : { ...(CATALOG as any)[kind].defaults };
  const out: Props = { ...base };
  if (!raw || typeof raw !== 'object') return out;
  let dropped = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (!own(base, k) && !KNOWN_EXTRA.has(k)) { dropped++; continue; }
    if (SIZE_KEYS.has(k)) {
      const n = Math.floor(Number(v));
      if (!isFinite(n) || n < 0) { warn(`Invalid size "${k}" reset to default`); continue; }
      out[k] = clampNum(n, 0, MAX_SIZE);
    } else if (BOOL_KEYS.has(k)) out[k] = !!v;
    else if (own(STR_KEYS, k)) out[k] = String(v ?? '').slice(0, STR_KEYS[k]);
    else if (own(ENUM_KEYS, k)) {
      const allowed = ENUM_KEYS[k];
      if (typeof v === 'string' && allowed.includes(v)) {
        // 'policy' is shared: scheduler policies vs cache policies - check against the node's own default
        const def = base[k];
        if (def !== undefined && k === 'policy') {
          const schedP = ['rr', 'fcfs', 'sjf', 'srtf', 'prio', 'priop', 'mlfq'];
          const cacheP = ['lru', 'fifo'];
          const good = kind === 'cache' ? cacheP.includes(v) : schedP.includes(v);
          if (!good) { warn(`Invalid value "${v}" for "${k}" reset to default`); continue; }
        }
        out[k] = v;
      } else warn(`Invalid value "${String(v)}" for "${k}" reset to default`);
    } else if (typeof base[k] === 'number' || own(NUM_RANGES, k)) {
      const n = Number(v);
      if (!isFinite(n)) { warn(`Invalid number "${k}" reset to default`); continue; }
      const [lo, hi] = (own(NUM_RANGES, k) ? NUM_RANGES[k] : undefined) ?? [-1e9, 1e9];
      out[k] = clampNum(n, lo, hi);
    } else out[k] = own(base, k) ? (typeof base[k] === typeof v ? v : base[k]) : v;
  }
  if (dropped) warn(`${dropped} unknown propert${dropped === 1 ? 'y' : 'ies'} dropped on a ${kind} node`);
  return out;
}

/**
 * Validate and repair an imported or restored topology. Never throws: anything
 * unusable is dropped or defaulted and reported in `warnings`. Returns null only
 * when the input is not a topology at all (no nodes array).
 */
export function sanitizeTopology(input: any): Sanitized | null {
  if (!input || typeof input !== 'object' || !Array.isArray(input.nodes)) return null;
  const warnings: string[] = [];
  const warn = (m: string) => { if (warnings.length < 12) warnings.push(m); };
  const seen = new Set<string>();
  const nodes: NodeDef[] = [];
  let badKind = 0, dup = 0;
  if (input.nodes.length > MAX_NODES) warn(`Only the first ${MAX_NODES} of ${input.nodes.length} nodes were kept`);
  for (const raw of input.nodes.slice(0, MAX_NODES)) {
    if (!raw || typeof raw !== 'object') continue;
    const kind = raw.kind as Kind;
    if (typeof kind !== 'string' || !KINDS.includes(kind)) { badKind++; continue; }
    let tpl = raw.tpl as TplId | undefined;
    if (kind === 'task') { if (typeof tpl !== 'string' || !own(TPLS, tpl)) { badKind++; continue; } }
    else tpl = undefined;
    let id = typeof raw.id === 'string' && raw.id ? raw.id : `${kind}-${nodes.length + 1}`;
    if (seen.has(id)) { dup++; continue; }
    seen.add(id);
    const x = isFinite(+raw.x) ? clampNum(+raw.x, -100000, 100000) : 0;
    const y = isFinite(+raw.y) ? clampNum(+raw.y, -100000, 100000) : 0;
    nodes.push({ id, kind, tpl, x, y, props: cleanProps(kind, tpl, raw.props, m => warn(`${id}: ${m}`)) });
  }
  if (badKind) warn(`${badKind} node(s) with an unknown component or workload type were dropped`);
  if (dup) warn(`${dup} node(s) with duplicate ids were dropped`);
  const ids = new Set(nodes.map(n => n.id));
  const kindOf = new Map(nodes.map(n => [n.id, n.kind] as const));
  const pairs = new Set<string>();
  const edgeIds = new Set<string>();
  let dangling = 0, dupE = 0, i = 0;
  const edges = (Array.isArray(input.edges) ? input.edges.slice(0, MAX_EDGES) : []).filter((e: any) => {
    if (!e || typeof e !== 'object' || !ids.has(e.a) || !ids.has(e.b) || e.a === e.b || !canLink(kindOf.get(e.a)!, kindOf.get(e.b)!)) { dangling++; return false; }
    const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
    if (pairs.has(key)) { dupE++; return false; }
    pairs.add(key); return true;
  }).map((e: any) => {
    let id = typeof e.id === 'string' && e.id && !edgeIds.has(e.id) ? e.id : `e${i}`;
    while (edgeIds.has(id)) id = `e${++i}`;
    edgeIds.add(id); i++;
    return { id, a: e.a, b: e.b };
  });
  if (dangling) warn(`${dangling} connection(s) pointing at missing nodes were dropped`);
  if (dupE) warn(`${dupE} duplicate connection(s) were dropped`);
  return { topo: { nodes, edges }, warnings };
}
