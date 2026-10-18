import type { NodeDef, Topology, Step } from './types';
import { TPLS, parseBursts, parseRefString } from './data';
import { analyze, requirements, type Analysis } from './graph';
import { fmtBytes, fmtTicks, fmtNum, TICKS_PER_SEC, KB } from '../units';

export const SIM_MAX_FRAMES = 4096;
export interface Frame { owner: string | null; page: number; pinned: boolean; dirty: boolean; ref: boolean; loadedAt: number; lastUse: number; uses: number; loading: boolean }
export interface PTE { present: boolean; frame: number; dirty: boolean; onSwap: boolean }
export type OpKind = 'rd' | 'wr' | 'net' | 'prn' | 'usb' | 'gpu' | 'swapin' | 'swapout' | 'zero';
export interface Op { kind: OpKind; size: number; rem: number; lat: number; track: number; key?: string; dev?: string; submitted: boolean; fault: boolean; task: string; enq: number; cacheHit?: boolean }
export type TState = 'idle' | 'new' | 'ready' | 'running' | 'blocked' | 'done' | 'killed';
export interface TaskRT {
  id: string; tpl: string; state: TState; why: string; steps: Step[]; idx: number; stepLeft: number; burst: number;
  prio: number; level: number; qUsed: number; opq: Op[]; faultPage: number | null; faultFrame: number; prefetch: { page: number; frame: number }[];
  pt: PTE[]; pages: number; wsPages: number; pagesReal: number; wsPagesReal: number; refSeq: number[]; refIdx: number; cursor: number; phaseAt: number; base: number; waste: number; sizeB: number; cfgErr: string;
  arrival: number; firstRun: number; finish: number; waitT: number; ioT: number; cpuDone: number; total: number;
  major: number; minor: number; hits: number; chunk: number; idxNum: number; restartAt: number; runs: number; fcur: number;
  playPhase: 'wait' | 'decode'; written: Record<string, number>; due: number; stalled: boolean; underruns: number; stallTicks: number; framesShown: number; throttled: boolean; seq: number; startedAt: number; lastDev: string;
  ioBytes: number; faultMajor: boolean; faultTicks: number; swapIns: number; swapOuts: number; killedBy: string; turnSum: number; completed: number;
}
export interface DevRT { id: string; queue: Op[]; cur: Op[]; head: number; dir: 1 | -1; travel: number; irqAt: number; served: number; busy: number; used: number; cfgUsed: number; hits: number; misses: number; cache: { key: string; size: number }[]; cacheUsed: number; share: number; bytes: number; latSum: number; ops: number; qSum: number; qN: number; maxQ: number }
export interface BufRT { id: string; level: number; dropped: number; frames: number[]; need: number; starved: boolean; active: boolean; cap: number; peak: number; played: boolean }
export interface ContRT { id: string; tokens: number; throttled: number; oom: number; restarts: number }
export interface CoreRT { id: string; task: string | null; trace: (string | null)[]; debt: number; busy: number; ticks: number; ctx: number }
export interface LogEntry { t: number; text: string; tone: 'info' | 'good' | 'warn' | 'bad'; task?: string; cat: 'sched' | 'mem' | 'io' | 'net' | 'docker' | 'sys' }
export interface Sample { t: number; util: number; faults: number; ram: number; swap: number; ready: number; io: number; buf: number; tlb: number; net: number; disk: number }
export interface Problem { level: 'error' | 'warn' | 'info'; text: string; node?: string }
export interface TransStep { title: string; detail: string; tone: 'ok' | 'miss' | 'bad' | 'info' }
export interface TransResult { steps: TransStep[]; virtual?: number; page?: number; offset?: number; framePage?: number; frame?: number; physical?: number; tlb?: 'hit' | 'miss' | 'off' }

const mulberry = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const MAX_TASK_PAGES = 8192;
const emptyStat = () => ({ major: 0, minor: 0, hits: 0, ctx: 0, done: 0, oom: 0, cacheHit: 0, win: [] as number[], busy: 0, tot: 0, uwin: [] as number[], tlbHit: 0, tlbMiss: 0, swapIn: 0, swapOut: 0, faultTicks: 0, faultN: 0, majorTicks: 0, majorN: 0, ctxTicks: 0, turn: 0, wait: 0, resp: 0, evict: 0, writeback: 0, prefetched: 0, killed: 0 });
const NEWFRAME = (): Frame => ({ owner: null, page: 0, pinned: false, dirty: false, ref: false, loadedAt: 0, lastUse: 0, uses: 0, loading: false });
export const isSys = (o: string | null) => !!o && (o === 'kernel' || o.startsWith('buf:'));

export class Sim {
  t = 0; topo!: Topology; an!: Analysis; rnd = mulberry(7);
  tasks = new Map<string, TaskRT>(); frames: Frame[] = []; devs = new Map<string, DevRT>(); bufs = new Map<string, BufRT>();
  conts = new Map<string, ContRT>(); cores = new Map<string, CoreRT>(); readyQ: string[] = []; log: LogEntry[] = []; samples: Sample[] = [];
  seqN = 0; memSig = ''; version = 0; compactions = 0; hand = 0; fb = 0; pageReal = 0; pagesPerFrame = 1; kernelFrames = 0; swapUsed = 0; cfgErr = '';
  tlb: string[] = []; stat = emptyStat(); lastBoost = 0; lastSample = { f: 0, busy: 0, tot: 0 };
  cacheF = new Map<string, number>(); // core id -> current cache speed factor

  constructor(topo: Topology) { this.reset(topo); }

  reset(topo: Topology) {
    this.topo = topo; this.t = 0; this.rnd = mulberry(7); this.tasks.clear(); this.devs.clear(); this.bufs.clear(); this.conts.clear(); this.cores.clear();
    this.readyQ = []; this.log = []; this.samples = []; this.frames = []; this.memSig = ''; this.seqN = 0; this.compactions = 0; this.swapUsed = 0; this.tlb = [];
    this.stat = emptyStat(); this.lastSample = { f: 0, busy: 0, tot: 0 }; this.lastBoost = 0;
    this.sync(topo, true);
    this.say('Simulation started.', 'info', undefined, 'sys');
  }

  say(text: string, tone: LogEntry['tone'] = 'info', task?: string, cat: LogEntry['cat'] = 'sys') {
    this.log.push({ t: this.t, text, tone, task, cat }); if (this.log.length > 600) this.log.splice(0, 200);
  }

  // ---------- topology sync ----------
  memCfg() {
    const ram = this.an.mem.ram; if (!ram) return null;
    const size = Math.floor(+ram.props.size || 0), page = Math.floor(+ram.props.page || 0), res = Math.max(8, Math.min(4096, Math.floor(+ram.props.res || 128)));
    // `res` is display-only (memory map aggregation). Simulation granularity depends only on size, page and the fixed SIM_MAX_FRAMES budget.
    if (size < 1 || page < 1 || size < page * 2) return { err: size < page * 2 ? `RAM (${fmtBytes(size)}) must hold at least 2 pages of ${fmtBytes(page)}.` : 'Invalid RAM size', size, page, res, k: 1, fb: 0, F: 0 };
    const real = Math.floor(size / page); let k = 1; while (Math.ceil(real / k) > SIM_MAX_FRAMES) k *= 2;
    const fb = page * k; return { err: '', size, page, res, k, fb, F: Math.floor(size / fb) };
  }

  sync(topo: Topology, first = false) {
    this.topo = topo; this.an = analyze(topo); const an = this.an;
    const ram = an.mem.ram; const cfg = this.memCfg();
    const sig = ram && cfg ? `${an.mem.mode}:${ram.id}:${cfg.size}:${cfg.page}:${ram.props.reserved}` : 'none';
    if (sig !== this.memSig) {
      if (!first && this.memSig && this.memSig !== 'none') this.say('Memory layout changed. All tasks restart with the new configuration.', 'warn', undefined, 'mem');
      this.memSig = sig; this.cfgErr = cfg?.err ?? '';
      this.fb = cfg?.fb ?? 0; this.pageReal = cfg?.page ?? 0; this.pagesPerFrame = cfg?.k ?? 1;
      const F = cfg && !cfg.err ? cfg.F : 0;
      this.frames = Array.from({ length: F }, NEWFRAME);
      this.kernelFrames = F ? Math.min(F - 1, Math.max(0, Math.ceil((+ram!.props.reserved || 0) / this.fb))) : 0;
      for (let i = 0; i < this.kernelFrames; i++) { const f = this.frames[i]; f.owner = 'kernel'; f.pinned = true; }
      this.bufs.forEach(b => { b.frames = []; }); this.tlb = []; this.swapUsed = 0;
      this.tasks.forEach(t => this.resetTask(t, false)); this.readyQ = [];
    }
    const ids = new Set(topo.nodes.map(n => n.id));
    for (const [id, t] of [...this.tasks]) if (!ids.has(id)) { this.freeTask(t); this.removeFromCore(id); this.devs.forEach(d => { d.queue = d.queue.filter(o => o.task !== id); d.cur = d.cur.filter(o => o.task !== id); }); this.tasks.delete(id); this.readyQ = this.readyQ.filter(x => x !== id); }
    for (const n of topo.nodes) {
      if (n.kind === 'task' && !this.tasks.has(n.id)) this.tasks.set(n.id, this.mkTask(n));
      if ((n.kind === 'storage' || n.kind === 'usb' || n.kind === 'printer' || n.kind === 'nic' || n.kind === 'gpu') && !this.devs.has(n.id)) this.devs.set(n.id, { id: n.id, queue: [], cur: [], head: 50, dir: 1, travel: 0, irqAt: -99, served: 0, busy: 0, used: n.props.used ?? 0, cfgUsed: n.props.used ?? 0, hits: 0, misses: 0, cache: [], cacheUsed: 0, share: 0, bytes: 0, latSum: 0, ops: 0, qSum: 0, qN: 0, maxQ: 0 });
      if (n.kind === 'buffer' && !this.bufs.has(n.id)) this.bufs.set(n.id, { id: n.id, level: 0, dropped: 0, frames: [], need: 0, starved: false, active: false, cap: 0, peak: 0, played: false });
      if (n.kind === 'container' && !this.conts.has(n.id)) this.conts.set(n.id, { id: n.id, tokens: 1, throttled: 0, oom: 0, restarts: 0 });
    }
    for (const [id, d] of [...this.devs]) { const n = an.byId.get(id); if (n && (n.kind === 'storage' || n.kind === 'usb') && n.props.used !== d.cfgUsed) { d.cfgUsed = n.props.used; d.used = Math.max(0, Math.min(+n.props.cap || 0, +n.props.used || 0)); } }
    for (const [id] of [...this.devs]) if (!ids.has(id)) this.devs.delete(id);
    for (const [id, b] of [...this.bufs]) if (!ids.has(id)) { this.releaseBuf(b); this.bufs.delete(id); }
    for (const [id] of [...this.conts]) if (!ids.has(id)) this.conts.delete(id);
    const coreIds = new Set(an.cores.map(c => c.id));
    for (const [id, c] of [...this.cores]) if (!coreIds.has(id)) { if (c.task) { const t = this.tasks.get(c.task); if (t && t.state === 'running') { t.state = 'ready'; this.enqueue(t); } } this.cores.delete(id); }
    for (const c of an.cores) if (!this.cores.has(c.id)) this.cores.set(c.id, { id: c.id, task: null, trace: [], debt: 0, busy: 0, ticks: 0, ctx: 0 });
    this.version++;
  }

  mkTask(n: NodeDef): TaskRT {
    const tpl = TPLS[n.tpl!]; const idxNum = this.tasks.size + 1;
    return { id: n.id, tpl: tpl.id, state: 'idle', why: 'Not started yet', steps: [], idx: 0, stepLeft: 0, burst: 0, prio: n.props.prio ?? tpl.prio, level: 0, qUsed: 0, opq: [], faultPage: null, faultFrame: -1, prefetch: [],
      pt: [], pages: 0, wsPages: 0, pagesReal: 0, wsPagesReal: 0, refSeq: [], refIdx: 0, cursor: 0, phaseAt: 0, base: -1, waste: 0, sizeB: 0, cfgErr: '', arrival: 0, firstRun: -1, finish: 0, waitT: 0, ioT: 0, cpuDone: 0, total: 0,
      major: 0, minor: 0, hits: 0, chunk: 0, idxNum, restartAt: -1, runs: 0, fcur: 0, playPhase: 'wait', written: {}, due: 0, stalled: false, underruns: 0, stallTicks: 0, framesShown: 0, throttled: false, seq: 0, startedAt: 0, lastDev: '',
      ioBytes: 0, faultMajor: false, faultTicks: 0, swapIns: 0, swapOuts: 0, killedBy: '', turnSum: 0, completed: 0 };
  }

  nodeOf(id: string) { return this.an.byId.get(id)!; }
  tplOf(t: TaskRT) { return TPLS[t.tpl as keyof typeof TPLS]; }
  tname(t: TaskRT) { return this.tplOf(t).name; }
  contOf(t: TaskRT) { const a = this.an.attach.get(t.id); return a?.container ? this.nodeOf(a.container) : undefined; }
  swapSlots() { const s = this.an.swap; return s && this.fb ? Math.floor((+s.props.swap || 0) / this.fb) : 0; }
  hasSwap() { return this.swapSlots() > 0; }
  prop(n: NodeDef, k: string) { const t = TPLS[n.tpl!]; return n.props[k] ?? (t as any)[k]; }

  // ---------- task lifecycle ----------
  resetTask(t: TaskRT, keepRuns = true) {
    this.freeTask(t); this.removeFromCore(t.id);
    this.devs.forEach(d => { d.queue = d.queue.filter(o => o.task !== t.id); d.cur = d.cur.filter(o => o.task !== t.id); });
    t.state = 'idle'; t.opq = []; t.faultPage = null; t.prefetch = []; t.pt = []; t.idx = 0; t.why = 'Not started yet'; this.readyQ = this.readyQ.filter(x => x !== t.id); if (!keepRuns) t.runs = 0;
  }
  restartTask(id: string) { const t = this.tasks.get(id); if (!t) return; this.resetTask(t); t.restartAt = this.t; t.major = t.minor = t.hits = 0; t.waitT = 0; t.ioT = 0; }
  enqueue(t: TaskRT) { if (!this.readyQ.includes(t.id)) { this.readyQ.push(t.id); t.seq = ++this.seqN; } }
  removeFromCore(id: string) { this.cores.forEach(c => { if (c.task === id) c.task = null; }); }

  freeTask(t: TaskRT) {
    for (let i = 0; i < this.frames.length; i++) { const f = this.frames[i]; if (f.owner === t.id) { f.owner = null; f.dirty = false; f.loading = false; f.ref = false; } }
    t.pt.forEach(p => { if (p.onSwap) this.swapUsed = Math.max(0, this.swapUsed - 1); p.present = false; p.onSwap = false; });
    if (this.tlb.length) this.tlb = this.tlb.filter(k => !k.startsWith(t.id + '|'));
  }

  startTask(t: TaskRT) {
    const n = this.nodeOf(t.id); const tpl = this.tplOf(t); const P = n.props;
    let pattern = tpl.pattern; let patErr = '';
    if (tpl.id === 'custom' && String(P.bursts ?? '').trim()) {
      const pb = parseBursts(String(P.bursts));
      if (pb.steps) pattern = pb.steps; else patErr = pb.err;
    }
    const steps: Step[] = []; const rep = Math.max(1, Math.min(5000, Math.round(+P.repeat || tpl.repeat), Math.floor(50000 / Math.max(1, pattern.length)))); const bs = Math.max(0.1, (+P.burst || 100) / 100);
    for (let r = 0; r < rep; r++) pattern.forEach(s => steps.push(s.k === 'cpu' ? { k: 'cpu', n: Math.max(1, Math.round(s.n * bs)) } : { ...s }));
    t.steps = steps; t.idx = -1; t.state = 'new'; t.arrival = this.t; t.firstRun = -1; t.waitT = 0; t.ioT = 0; t.cpuDone = 0; t.chunk = 0; t.faultTicks = 0;
    t.total = steps.reduce((a, s) => a + (s.k === 'cpu' ? s.n : s.k === 'play' ? s.n * 2 : 0), 0);
    t.prio = P.prio ?? tpl.prio; t.level = 0; t.qUsed = 0; t.opq = []; t.faultPage = null; t.prefetch = []; t.stalled = false; t.runs++; t.startedAt = this.t;
    t.sizeB = Math.max(1, Math.floor(+P.size || tpl.size)); const wsB = Math.max(1, Math.min(t.sizeB, Math.floor(+P.ws || tpl.ws)));
    t.cfgErr = patErr; const fb = this.fb || 1;
    t.pages = Math.max(1, Math.ceil(t.sizeB / fb)); t.wsPages = Math.max(1, Math.min(t.pages, Math.ceil(wsB / fb)));
    if (t.pages > MAX_TASK_PAGES) t.cfgErr = `${fmtBytes(t.sizeB)} needs ${t.pages.toLocaleString('en-US')} simulation frames at this resolution (limit ${MAX_TASK_PAGES.toLocaleString('en-US')}). Use "Fit workloads to RAM" or reduce the task size.`;
    const pr = this.pageReal || 1; t.waste = Math.ceil(t.sizeB / pr) * pr - t.sizeB;
    t.pagesReal = Math.max(1, Math.ceil(t.sizeB / pr)); t.wsPagesReal = Math.max(1, Math.min(t.pagesReal, Math.ceil(wsB / pr)));
    t.refSeq = []; t.refIdx = 0;
    if (String(P.refstr ?? '').trim()) {
      const rs = parseRefString(String(P.refstr));
      if (rs.pages) t.refSeq = rs.pages; else t.cfgErr = t.cfgErr || rs.err;
    }
    t.cursor = 0; t.phaseAt = this.t; t.base = -1; t.pt = []; t.fcur = 0;
    t.why = 'Allocating memory'; this.say(`${this.tname(t)} started and requests ${fmtBytes(t.sizeB)} of memory.`, 'info', t.id, 'sched');
  }

  tryAdmit(t: TaskRT) {
    const an = this.an; const m = an.mem;
    if (m.mode === 'none') { t.why = 'No path to RAM (connect CPU, MMU and RAM)'; return; }
    if (this.cfgErr) { t.why = this.cfgErr; return; }
    if (an.cores.length === 0) { t.why = 'No CPU core connected'; return; }
    if (t.cfgErr) { t.why = t.cfgErr; return; }
    if (m.mode === 'paging') {
      t.pt = Array.from({ length: t.pages }, () => ({ present: false, frame: -1, dirty: false, onSwap: false }));
    } else {
      const base = this.findHole(t.pages);
      if (base < 0) {
        const { free, largest } = this.holeInfo();
        t.why = free >= t.pages ? `External fragmentation: needs ${t.pages} contiguous frames, ${free} are free but the largest hole is ${largest}.` : `Not enough RAM: needs ${t.pages} frames, only ${free} free.`;
        return;
      }
      for (let i = 0; i < t.pages; i++) { const f = this.frames[base + i]; f.owner = t.id; f.page = i; f.loadedAt = this.t; f.lastUse = this.t; f.pinned = false; f.loading = false; f.dirty = false; }
      t.base = base; this.say(`${this.tname(t)} received one contiguous block (frames ${base} to ${base + t.pages - 1}).`, 'good', t.id, 'mem');
    }
    this.advance(t);
  }

  advance(t: TaskRT) {
    t.idx++;
    if (t.idx >= t.steps.length) return this.finishTask(t);
    const s = t.steps[t.idx];
    if (s.k === 'cpu') { t.burst = s.n; t.state = 'ready'; t.why = 'Waiting for a CPU'; this.enqueue(t); return; }
    t.stepLeft = s.n; t.state = 'blocked';
    if (s.k === 'play') { t.playPhase = 'wait'; t.due = this.t; t.why = 'Waiting for a frame from the buffer'; return; }
    this.issueFileOp(t, s);
  }

  issueFileOp(t: TaskRT, s: Step) {
    const kind = s.k as 'rd' | 'wr' | 'net' | 'prn' | 'usb' | 'gpu'; const n = this.nodeOf(t.id);
    const size = Math.max(1, Math.floor(+n.props.io || this.tplOf(t).io)); let track = 0; let key: string | undefined;
    if (kind === 'rd') {
      const K = Math.max(4, Math.ceil((+n.props.ws || this.tplOf(t).ws) / size));
      t.fcur = this.rnd() < 0.65 ? (t.fcur + 1) % K : Math.floor(this.rnd() * K); key = `${t.id}:${t.fcur}`; track = (t.fcur * 37 + t.idxNum * 13) % 85;
    } else track = (t.idxNum * 23 + t.chunk * 9) % 85;
    t.chunk++;
    t.opq.push({ kind, size, rem: 0, lat: 0, track, key, submitted: false, fault: false, task: t.id, enq: this.t }); t.why = 'Waiting for a device';
  }

  finishTask(t: TaskRT) {
    t.state = 'done'; t.finish = this.t; this.stat.done++; this.freeTask(t); this.removeFromCore(t.id);
    const tat = this.t - t.arrival; this.stat.turn += tat; this.stat.wait += t.waitT; this.stat.resp += Math.max(0, t.firstRun - t.arrival); t.turnSum += tat; t.completed++;
    this.say(`${this.tname(t)} finished in ${fmtTicks(tat)} (waited ${fmtTicks(t.waitT)} in the ready queue).`, 'good', t.id, 'sched');
    t.why = 'Finished'; if (this.nodeOf(t.id).props.loop) { t.restartAt = this.t + 25; for (const [id, b] of Object.entries(t.written)) { const d = this.devs.get(id); if (d) d.used = Math.max(0, d.used - b); } t.written = {}; }
  }

  killTask(t: TaskRT, why: string) {
    this.freeTask(t); this.removeFromCore(t.id); this.readyQ = this.readyQ.filter(x => x !== t.id);
    this.devs.forEach(d => { d.queue = d.queue.filter(o => o.task !== t.id); d.cur = d.cur.filter(o => o.task !== t.id); });
    t.opq = []; t.faultPage = null; t.prefetch = []; t.state = 'killed'; t.why = why; t.finish = this.t; this.stat.killed++;
    const c = this.contOf(t); const restart = c ? c.props.restart !== 'no' : true;
    if (this.nodeOf(t.id).props.loop && restart) { t.restartAt = this.t + 140; if (c) this.conts.get(c.id)!.restarts++; }
  }

  // ---------- memory ----------
  holeList() { const out: { s: number; n: number }[] = []; let s = -1; for (let i = 0; i <= this.frames.length; i++) { const free = i < this.frames.length && !this.frames[i].owner && !this.frames[i].pinned; if (free && s < 0) s = i; if (!free && s >= 0) { out.push({ s, n: i - s }); s = -1; } } return out; }
  holeInfo() { const h = this.holeList(); const free = h.reduce((a, b) => a + b.n, 0), largest = h.reduce((a, b) => Math.max(a, b.n), 0); return { free, largest, holes: h.length, ext: free ? 1 - largest / free : 0 }; }
  findHole(n: number) {
    const fit = this.an.mem.ram?.props.fit ?? 'first'; const h = this.holeList().filter(x => x.n >= n); if (!h.length) return -1;
    if (fit === 'best') return h.sort((a, b) => a.n - b.n)[0].s; if (fit === 'worst') return h.sort((a, b) => b.n - a.n)[0].s; return h[0].s;
  }
  compact() {
    const F = this.frames; let i = 0; let moved = 0;
    while (i < F.length) {
      if (F[i].pinned) { i++; continue; }
      let j = i; while (j < F.length && !F[j].pinned) j++;
      const seg = F.slice(i, j); const owners = new Map<string, Frame[]>();
      seg.forEach(f => { if (f.owner) { if (!owners.has(f.owner)) owners.set(f.owner, []); owners.get(f.owner)!.push(f); } });
      let k = i; const order = [...owners.entries()].sort((a, b) => (this.tasks.get(a[0])?.base ?? 0) - (this.tasks.get(b[0])?.base ?? 0));
      const copies = order.map(([o, fs]) => [o, fs.map(f => ({ ...f }))] as [string, Frame[]]);
      for (let x = i; x < j; x++) F[x] = NEWFRAME();
      for (const [o, fs] of copies) { const t = this.tasks.get(o); if (t && t.base !== k) moved++; if (t) t.base = k; fs.forEach(f => { F[k++] = f; }); }
      i = j;
    }
    this.compactions++; this.say(moved ? `Compaction moved ${moved} task block(s). Pinned frames stayed in place.` : 'Compaction was not needed.', moved ? 'good' : 'info', undefined, 'mem');
  }

  pickPage(t: TaskRT) {
    if (t.refSeq.length) { const p = t.refSeq[t.refIdx % t.refSeq.length]; t.refIdx++; return p % t.pagesReal; }
    if (this.t - t.phaseAt > 300 && this.rnd() < 0.02) { t.phaseAt = this.t; t.cursor = Math.floor(this.rnd() * t.wsPagesReal); }
    const r = this.rnd();
    if (r < 0.62) return t.cursor = (t.cursor + (this.rnd() < 0.5 ? 0 : 1)) % t.wsPagesReal;
    if (r < 0.92) return Math.floor(this.rnd() * t.wsPagesReal);
    return Math.floor(this.rnd() * t.pagesReal);
  }

  eligible(owner: string | null, scope: Set<string> | null) { return !!owner && !isSys(owner) && (!scope || scope.has(owner)); }

  choose(scope: Set<string> | null): number {
    const repl = this.an.mem.mmu?.props.repl ?? 'lru'; const F = this.frames;
    const ok = (i: number) => this.eligible(F[i].owner, scope) && !F[i].pinned && !F[i].loading;
    if (repl === 'clock') {
      let guard = 0; this.hand = this.hand % F.length;
      while (guard++ < F.length * 2 + 2) { const i = this.hand; this.hand = (this.hand + 1) % F.length; if (!ok(i)) continue; if (F[i].ref) { F[i].ref = false; continue; } return i; }
      return -1;
    }
    if (repl === 'random') { const c: number[] = []; for (let i = 0; i < F.length; i++) if (ok(i)) c.push(i); return c.length ? c[Math.floor(this.rnd() * c.length)] : -1; }
    let best = -1; const key = (i: number) => repl === 'fifo' ? F[i].loadedAt : repl === 'lfu' ? F[i].uses * 1e6 + F[i].lastUse : F[i].lastUse;
    for (let i = 0; i < F.length; i++) { if (!ok(i)) continue; if (best < 0 || key(i) < key(best)) best = i; }
    return best;
  }

  residentOf(scope: Set<string>) { let n = 0; for (const f of this.frames) if (f.owner && scope.has(f.owner)) n++; return n; }

  oomKill(scope: Set<string> | null, cont?: NodeDef): boolean {
    const policy = this.an.mem.ram?.props.oom ?? 'largest'; let victim: TaskRT | undefined; let best = -Infinity; let res = 0;
    for (const t of this.tasks.values()) {
      if (scope && !scope.has(t.id)) continue; let r = 0; for (const f of this.frames) if (f.owner === t.id) r++; if (r <= 0) continue;
      const score = policy === 'newest' ? t.arrival : policy === 'lowprio' ? t.prio * 1e6 + r : r;
      if (score > best) { best = score; victim = t; res = r; }
    }
    if (!victim) return false;
    this.killTask(victim, 'Killed by the OOM killer'); this.stat.oom++; victim.killedBy = 'oom'; if (cont) this.conts.get(cont.id)!.oom++;
    this.say(cont ? `Container "${cont.props.name ?? 'container'}" exceeded its ${fmtBytes(cont.props.mem)} memory limit. The OOM killer stopped ${this.tname(victim)} inside the container (${res} frames). The host is unaffected.` : `Out of memory with no swap space left. The OOM killer stopped ${this.tname(victim)} (${res} frames resident).`, 'bad', victim.id, 'docker');
    return true;
  }

  allocFrame(t: TaskRT, extra: Op[]): number {
    for (let attempt = 0; attempt < 4; attempt++) {
      const cont = this.contOf(t); let scope: Set<string> | null = null; let local = false;
      if (cont) { scope = new Set([...this.tasks.values()].filter(x => this.an.attach.get(x.id)?.container === cont.id).map(x => x.id)); const limit = Math.max(1, Math.floor(cont.props.mem / Math.max(1, this.fb))); local = this.residentOf(scope) >= limit; }
      if (!local) { const fi = this.frames.findIndex(f => !f.owner && !f.pinned); if (fi >= 0) return fi; }
      const swapOK = local ? !!(cont!.props.swapOK && this.hasSwap()) : this.hasSwap();
      const vi = swapOK ? this.choose(local ? scope : null) : -1;
      if (vi < 0) { if (!this.oomKill(local ? scope : null, local ? cont : undefined)) return -1; if (t.state === 'killed') return -1; continue; }
      const f = this.frames[vi]; const vt = this.tasks.get(f.owner!)!; const pte = vt.pt[f.page];
      if (pte && f.dirty && !pte.onSwap && this.swapUsed >= this.swapSlots()) { if (!this.oomKill(local ? scope : null, local ? cont : undefined)) return -1; if (t.state === 'killed') return -1; continue; }
      if (pte) {
        pte.present = false; this.stat.evict++;
        { const lo = f.page * this.pagesPerFrame, hi = lo + this.pagesPerFrame; this.tlb = this.tlb.filter(key => { if (!key.startsWith(vt.id + '|')) return true; const rp = +key.slice(vt.id.length + 1); return rp < lo || rp >= hi; }); }
        if (f.dirty) { if (!pte.onSwap) { pte.onSwap = true; this.swapUsed++; } vt.swapOuts++; this.stat.swapOut++; this.stat.writeback++; extra.push({ kind: 'swapout', size: this.fb, rem: 0, lat: 0, track: 85 + ((f.page * 7 + vt.idxNum * 3) % 15), submitted: false, fault: true, task: t.id, enq: this.t }); }
      }
      f.owner = null; f.dirty = false; return vi;
    }
    return -1;
  }

  /** Returns progress factor in (0,1] when the access succeeded, or -1 when the task blocked or died. */
  touch(t: TaskRT): number {
    if (this.an.mem.mode !== 'paging') return 1;
    const mmu = this.an.mem.mmu!; const rp = this.pickPage(t); const p = Math.min(t.pages - 1, Math.floor(rp / this.pagesPerFrame)); const pte = t.pt[p]; let factor = 1;
    const tlbN = Math.max(0, Math.floor(+mmu.props.tlb || 0));
    if (tlbN > 0) {
      const key = `${t.id}|${rp}`; const i = this.tlb.indexOf(key);
      if (i >= 0 && pte.present) { this.tlb.splice(i, 1); this.tlb.push(key); this.stat.tlbHit++; }
      else { this.stat.tlbMiss++; const walk = Math.max(0, +mmu.props.tlbMiss || 0); factor = 100 / (100 + walk); if (i >= 0) this.tlb.splice(i, 1); if (pte.present) { this.tlb.push(key); while (this.tlb.length > tlbN) this.tlb.shift(); } }
    }
    const wp = Math.max(0, Math.min(100, +this.nodeOf(t.id).props.writePct || 0)) / 100;
    if (pte.present) { const f = this.frames[pte.frame]; f.ref = true; f.lastUse = this.t; f.uses++; if (this.rnd() < wp) { f.dirty = true; pte.dirty = true; } t.hits++; this.stat.hits++; return factor; }
    const extra: Op[] = []; const fi = this.allocFrame(t, extra);
    if (fi < 0 || t.state === 'killed') return -1;
    const f = this.frames[fi]; f.owner = t.id; f.page = p; f.loading = true; f.loadedAt = this.t; f.lastUse = this.t; f.uses = 1; f.ref = true; f.dirty = false; f.pinned = false;
    pte.frame = fi; const major = pte.onSwap && this.hasSwap();
    const ops = [...extra]; t.prefetch = [];
    if (major) {
      const pf = Math.max(0, Math.floor(+mmu.props.prefetch || 0));
      for (let q = p + 1; q <= p + pf && q < t.pages; q++) { const pq = t.pt[q]; if (!pq.onSwap || pq.present) continue; const fj = this.frames.findIndex(x => !x.owner && !x.pinned); if (fj < 0) break; const g = this.frames[fj]; g.owner = t.id; g.page = q; g.loading = true; g.loadedAt = this.t; g.lastUse = this.t; g.uses = 0; g.ref = false; g.dirty = false; pq.frame = fj; t.prefetch.push({ page: q, frame: fj }); }
      ops.push({ kind: 'swapin', size: this.fb * (1 + t.prefetch.length), rem: 0, lat: 0, track: 85 + ((p * 7 + t.idxNum * 3) % 15), submitted: false, fault: true, task: t.id, enq: this.t }); t.major++; t.swapIns++; this.stat.major++; this.stat.swapIn++; this.stat.win.push(this.t);
    } else { ops.push({ kind: 'zero', size: 0, rem: 2, lat: 0, track: 0, submitted: true, fault: true, task: t.id, enq: this.t }); t.minor++; this.stat.minor++; }
    t.opq.unshift(...ops); t.faultMajor = major; t.faultPage = p; t.faultFrame = fi; t.state = 'blocked'; t.why = major ? `Major page fault: reading page ${rp} back from swap` : `Minor page fault: zero-filling a frame for page ${rp}`;
    this.removeFromCore(t.id); return -1;
  }

  // ---------- buffers ----------
  syncBuffers() {
    for (const b of this.an.buffers) {
      const rt = this.bufs.get(b.node.id)!; const cap = Math.max(1, +b.node.props.size || 1); const need = this.fb ? Math.max(1, Math.ceil(cap / this.fb)) : 0; rt.need = need;
      if (!b.ok || !this.fb) { if (rt.frames.length) this.releaseBuf(rt); rt.active = false; rt.cap = 0; continue; }
      if (rt.frames.length < need) {
        const mine = this.frames.map((f, i) => (f.owner === 'buf:' + rt.id ? i : -1)).filter(i => i >= 0);
        rt.frames = mine;
        if (this.an.mem.mode === 'contig' && mine.length === 0) { const s = this.findHole(need); if (s >= 0) for (let i = 0; i < need; i++) this.pin(rt, s + i); }
        else if (this.an.mem.mode === 'paging') for (let i = 0; i < this.frames.length && rt.frames.length < need; i++) if (!this.frames[i].owner && !this.frames[i].pinned) this.pin(rt, i);
      }
      if (rt.frames.length > need) { const keep = rt.frames.slice(0, need); for (const i of rt.frames.slice(need)) { const f = this.frames[i]; if (f && f.owner === 'buf:' + rt.id) { f.owner = null; f.pinned = false; f.dirty = false; f.ref = false; } } rt.frames = keep; }
      rt.starved = rt.frames.length < need; rt.cap = cap * Math.min(1, rt.frames.length / Math.max(1, need));
      if (rt.level > rt.cap) rt.level = rt.cap;
      if (rt.frames.length === 0) rt.active = false;
    }
  }
  pin(rt: BufRT, i: number) { const f = this.frames[i]; f.owner = 'buf:' + rt.id; f.pinned = true; f.page = rt.frames.length; f.loading = false; rt.frames.push(i); }
  releaseBuf(rt: BufRT) { for (const i of rt.frames) { const f = this.frames[i]; if (f && f.owner === 'buf:' + rt.id) { f.owner = null; f.pinned = false; } } rt.frames = []; rt.level = 0; }

  // ---------- devices ----------
  resolve(t: TaskRT, op: Op): NodeDef | undefined {
    const n = this.topo.nodes; const on = (k: string) => n.filter(x => x.kind === k && this.an.online.has(x.id));
    if (op.kind === 'swapin' || op.kind === 'swapout') return this.hasSwap() ? this.an.swap : undefined;
    if (op.kind === 'rd') return on('storage')[0];
    if (op.kind === 'wr') { const p = this.nodeOf(t.id).props.dest; return p === 'usb' ? on('usb')[0] ?? on('storage')[0] : on('storage')[0]; }
    if (op.kind === 'usb') return on('usb')[0]; if (op.kind === 'prn') return on('printer')[0]; if (op.kind === 'net') return on('nic')[0]; if (op.kind === 'gpu') return on('gpu')[0];
  }

  svcTicks(n: NodeDef, op: Op, d: DevRT): number {
    const rate = Math.max(1, +n.props.rate || 1) / TICKS_PER_SEC; // bytes per tick
    if (n.kind === 'storage') {
      const ssd = n.props.type === 'ssd'; const dist = Math.abs(op.track - d.head);
      const seek = ssd ? 0 : (dist / 100) * ((+n.props.seek || 0) / 10) + 0.3;
      return Math.max(0.5, seek + (ssd ? 0.02 : 0) + op.size / rate);
    }
    if (n.kind === 'printer') return Math.max(1, op.size / rate + 1);
    if (n.kind === 'gpu') return Math.max(0.5, TICKS_PER_SEC / Math.max(1, +n.props.fps || 120)); // ticks per frame
    return Math.max(0.5, op.size / rate + 0.3);
  }

  dispatchOps() {
    for (const t of this.tasks.values()) {
      if (t.state !== 'blocked' || !t.opq.length) continue; const op = t.opq[0]; if (op.submitted) continue;
      const dev = this.resolve(t, op);
      if (!dev) { t.why = op.kind === 'swapin' || op.kind === 'swapout' ? (this.an.swap ? 'Swap space is 0 bytes. Set a swap size on the disk.' : 'No swap disk found (connect the MMU to a disk behind a driver)') : op.kind === 'prn' ? 'Printer is not behind a driver' : op.kind === 'net' ? 'Network card is not behind a driver' : op.kind === 'usb' ? 'USB drive is not behind a driver' : op.kind === 'gpu' ? 'GPU is not behind a driver' : 'Disk is not behind a driver'; continue; }
      const d = this.devs.get(dev.id)!;
      if ((op.kind === 'wr' || op.kind === 'usb') && d.used + op.size > dev.props.cap) { t.why = `${dev.kind === 'usb' ? 'USB drive' : 'Disk'} is full (${fmtBytes(d.used)} of ${fmtBytes(dev.props.cap)}). Free up space.`; continue; }
      if (op.kind === 'rd') { const c = this.an.cacheOf.get(dev.id); if (c) { const hit = d.cache.findIndex(e => e.key === op.key); if (hit >= 0) { d.hits++; this.stat.cacheHit++; if (c.props.policy !== 'fifo') { const [e] = d.cache.splice(hit, 1); d.cache.unshift(e); } op.kind = 'zero'; op.rem = 1; op.cacheHit = true; op.submitted = true; t.why = 'Page cache hit: no disk access needed'; continue; } d.misses++; } }
      op.dev = dev.id; op.submitted = true; op.enq = this.t; op.rem = dev.kind === 'nic' ? op.size : this.svcTicks(dev, op, d); op.lat = dev.kind === 'nic' ? Math.round((+dev.props.latency || 0) / 10) : 0;
      d.queue.push(op); d.maxQ = Math.max(d.maxQ, d.queue.length); t.why = `${dev.kind === 'storage' ? 'Disk' : dev.kind === 'usb' ? 'USB' : dev.kind === 'printer' ? 'Printer' : dev.kind === 'gpu' ? 'GPU' : 'Network'} queue, position ${d.queue.length}`; t.lastDev = dev.id;
    }
  }

  pickDisk(d: DevRT, n: NodeDef): number {
    const sched = n.props.sched; let pick = 0; if (n.props.type === 'ssd') return 0;
    if (sched === 'sstf') { let bd = 1e9; d.queue.forEach((o, i) => { const x = Math.abs(o.track - d.head); if (x < bd) { bd = x; pick = i; } }); }
    else if (sched === 'scan') {
      const ahead = d.queue.map((o, i) => ({ i, dd: (o.track - d.head) * d.dir })).filter(x => x.dd >= 0).sort((a, b) => a.dd - b.dd)[0];
      if (ahead) pick = ahead.i; else { d.dir = (d.dir * -1) as 1 | -1; const back = d.queue.map((o, i) => ({ i, dd: (o.track - d.head) * d.dir })).filter(x => x.dd >= 0).sort((a, b) => a.dd - b.dd)[0]; pick = back ? back.i : 0; }
    } else if (sched === 'cscan') {
      d.dir = 1; const ahead = d.queue.map((o, i) => ({ i, dd: o.track - d.head })).filter(x => x.dd >= 0).sort((a, b) => a.dd - b.dd)[0];
      if (ahead) pick = ahead.i; else { let lo = 1e9; d.queue.forEach((o, i) => { if (o.track < lo) { lo = o.track; pick = i; } }); }
    }
    return pick;
  }

  stepDevices() {
    const nics = new Map<string, number>();
    for (const d of this.devs.values()) { const n = this.nodeOf(d.id); if (n.kind === 'nic') { while (d.cur.length < 8 && d.queue.length) d.cur.push(d.queue.shift()!); nics.set(d.id, d.cur.length); } }
    for (const b of this.an.buffers) { const rt = this.bufs.get(b.node.id)!; const act = b.ok && rt.frames.length > 0 && b.tasks.some(id => { const s = this.tasks.get(id)?.state; return s && s !== 'idle' && s !== 'done' && s !== 'killed'; }); rt.active = act; if (act && b.nic && rt.level < rt.cap - 1e-6) nics.set(b.nic.id, (nics.get(b.nic.id) ?? 0) + 1); }
    for (const [id, cnt] of nics) { const n = this.nodeOf(id); const d = this.devs.get(id)!; d.share = (Math.max(0, +n.props.bw || 0) / TICKS_PER_SEC) / Math.max(1, cnt); }
    for (const b of this.an.buffers) { const rt = this.bufs.get(b.node.id)!; if (!rt.active || !b.nic) continue; const nd = this.devs.get(b.nic.id)!; rt.level = Math.min(rt.cap, rt.level + nd.share); rt.peak = Math.max(rt.peak, rt.level); nd.bytes += nd.share; }
    for (const d of this.devs.values()) {
      const n = this.nodeOf(d.id); d.qSum += d.queue.length; d.qN++;
      if (n.kind === 'nic') { if (d.cur.length || [...this.bufs.values()].some(b => b.active)) d.busy++; for (const op of [...d.cur]) { if (op.lat > 0) { op.lat--; continue; } op.rem -= d.share; d.bytes += d.share; if (op.rem <= 0) { d.cur.splice(d.cur.indexOf(op), 1); this.complete(d, op); } } continue; }
      const dead = (n.kind === 'usb' && !n.props.plugged) || (n.kind === 'printer' && !n.props.online);
      if (dead) { const msg = n.kind === 'usb' ? 'USB drive is unplugged. Plug it back in.' : 'Printer is offline'; [...d.queue, ...d.cur].forEach(o => { const t = this.tasks.get(o.task); if (t) t.why = msg; }); continue; }
      if (!d.cur.length && d.queue.length) {
        const pick = n.kind === 'storage' ? this.pickDisk(d, n) : 0; const op = d.queue.splice(pick, 1)[0];
        if (n.kind === 'storage') { const dist = Math.abs(op.track - d.head); d.travel += dist; d.dir = op.track >= d.head ? 1 : -1; op.rem = this.svcTicks(n, op, d); d.head = op.track; }
        d.cur.push(op);
      }
      if (d.cur.length) { d.busy++; const op = d.cur[0]; op.rem--; if (op.rem <= 0) { d.cur.shift(); this.complete(d, op); } }
    }
    for (const t of this.tasks.values()) if (t.state === 'blocked') { t.ioT++; if (t.faultPage !== null) { t.faultTicks++; this.stat.faultTicks++; if (t.faultMajor) this.stat.majorTicks++; } }
  }

  complete(d: DevRT, op: Op) {
    d.irqAt = this.t; d.served++; d.ops++; d.latSum += this.t - op.enq; if (n_isDisk(this.nodeOf(d.id))) d.bytes += op.size;
    const t = this.tasks.get(op.task); if (!t) return;
    const n = this.nodeOf(d.id);
    if (op.kind === 'wr' || op.kind === 'usb') { d.used = Math.min(n.props.cap, d.used + op.size); t.written[d.id] = (t.written[d.id] ?? 0) + op.size; }
    if (op.kind === 'gpu') t.framesShown++;
    if (op.kind === 'rd') { const c = this.an.cacheOf.get(d.id); if (c) { const cap = +c.props.size || 0; d.cache = d.cache.filter(e => e.key !== op.key); if (op.size <= cap) { d.cache.unshift({ key: op.key!, size: op.size }); d.cacheUsed = d.cache.reduce((a, e) => a + e.size, 0); while (d.cacheUsed > cap && d.cache.length) d.cacheUsed -= d.cache.pop()!.size; } } }
    t.ioBytes += op.size;
    this.opDone(t, op);
  }

  opDone(t: TaskRT, op: Op) {
    const i = t.opq.indexOf(op); if (i >= 0) t.opq.splice(i, 1);
    if (op.fault) {
      if (!t.opq.length && t.faultPage !== null) {
        const pte = t.pt[t.faultPage]; const f = this.frames[t.faultFrame];
        if (pte && f && f.owner === t.id) { pte.present = true; pte.frame = t.faultFrame; f.loading = false; }
        for (const pf of t.prefetch) { const g = this.frames[pf.frame]; const pq = t.pt[pf.page]; if (g && pq && g.owner === t.id) { pq.present = true; pq.frame = pf.frame; g.loading = false; this.stat.prefetched++; } }
        t.prefetch = []; t.faultPage = null; this.stat.faultN++; if (t.faultMajor) this.stat.majorN++; t.state = 'ready'; t.why = 'Waiting for a CPU'; this.enqueue(t);
      }
      return;
    }
    if (t.opq.length) return;
    t.stepLeft--; const s = t.steps[t.idx];
    if (t.stepLeft > 0) this.issueFileOp(t, s); else this.advance(t);
  }

  tickOpTimers() {
    for (const t of this.tasks.values()) {
      if (t.state !== 'blocked' || !t.opq.length) continue; const op = t.opq[0];
      if (op.kind === 'zero' && op.submitted) { op.rem--; if (op.rem <= 0) this.opDone(t, op); }
    }
  }

  tickPlay() {
    for (const t of this.tasks.values()) {
      if (t.state !== 'blocked' || t.opq.length) continue; const s = t.steps[t.idx]; if (!s || s.k !== 'play' || t.playPhase !== 'wait') continue;
      const n = this.nodeOf(t.id); const fps = Math.max(1, +n.props.fps || 25); const frameB = Math.max(1, (+n.props.bitrate || 1) / fps);
      const b = this.an.buffers.find(x => x.tasks.includes(t.id)); const rt = b && this.bufs.get(b.node.id);
      if (this.t < t.due) { t.why = 'Waiting for the next frame time'; continue; }
      if (t.stalled) t.stallTicks++;
      const startAt = b ? Math.min(rt!.cap, Math.max(frameB, (+b.node.props.start || 0) / 100 * (rt?.cap ?? 0))) : 0;
      const need = t.stalled || !rt?.played ? startAt : frameB;
      if (!b || !b.ok || !rt || rt.level < need || rt.level < frameB) { if (!t.stalled && (rt?.played || t.framesShown > 0)) { t.stalled = true; t.underruns++; this.stat.uwin.push(this.t); this.say('The buffer ran dry and playback stalled (rebuffering).', 'bad', t.id, 'net'); } t.why = b && b.ok ? `Buffering: ${fmtBytes(rt?.level ?? 0)} of ${fmtBytes(need)} needed` : 'No media buffer connected'; continue; }
      rt.level -= frameB; rt.played = true; t.stalled = false; t.playPhase = 'decode'; t.burst = 2; t.state = 'ready'; t.why = 'Decoding a frame: waiting for a CPU'; this.enqueue(t);
    }
  }

  /** Effective speed factor from the core's cache hierarchy: a working set that outgrows L1+L2+L3 stalls on RAM more often. */
  cacheFactor(t: TaskRT, cpu: NodeDef): number {
    if (cpu.props.cacheOn === false) return 1;
    const cache = Math.max(0, +cpu.props.l1 || 0) + Math.max(0, +cpu.props.l2 || 0) + Math.max(0, +cpu.props.l3 || 0);
    if (cache <= 0) return 0.4;
    const ws = Math.max(1, t.wsPages * (this.fb || 1));
    if (ws <= cache) return 1;
    return Math.max(0.25, 1 / (1 + 0.9 * Math.log2(ws / cache)));
  }

  // ---------- scheduler ----------
  policy() { return this.an.scheduler?.props.policy ?? 'rr'; }
  q() { return Math.max(1, Math.round((+(this.an.scheduler?.props.quantum ?? 60)) / 10)); }
  levelQ(l: number) { return this.q() * (1 << l); }
  /** Total CPU work left in the current run (current burst plus all remaining CPU steps). */
  remainingCpu(t: TaskRT): number {
    let r = t.burst;
    for (let i = t.idx + 1; i < t.steps.length; i++) { const s = t.steps[i]; if (s.k === 'cpu') r += s.n; else if (s.k === 'play') r += s.n * 2; }
    return r;
  }
  better(a: TaskRT, b: TaskRT): boolean {
    const p = this.policy();
    if (p === 'sjf' || p === 'srtf') return this.remainingCpu(a) < this.remainingCpu(b);
    if (p === 'prio' || p === 'priop') return a.prio < b.prio;
    if (p === 'mlfq') return a.level < b.level; return false;
  }
  pickReady(): TaskRT | undefined {
    const c = this.readyQ.map(id => this.tasks.get(id)!).filter(x => x && x.state === 'ready'); if (!c.length) return;
    let best = c[0]; for (const x of c) if (this.better(x, best)) best = x; return best;
  }

  schedule() {
    const p = this.policy(); const boost = Math.max(10, Math.round((+(this.an.scheduler?.props.boost ?? 2000)) / 10));
    if (p === 'mlfq' && this.t - this.lastBoost > boost) { this.lastBoost = this.t; this.tasks.forEach(t => { t.level = 0; }); }
    for (const core of this.cores.values()) {
      const cur = core.task ? this.tasks.get(core.task) : undefined;
      if (cur && cur.state === 'running') {
        const cand = this.pickReady(); let pre = false;
        if (cand) {
          if (p === 'rr' && cur.qUsed >= this.q()) pre = true;
          if (p === 'mlfq') { if (cur.qUsed >= this.levelQ(cur.level)) { cur.level = Math.min(2, cur.level + 1); pre = true; } else if (cand.level < cur.level) pre = true; }
          if ((p === 'srtf' || p === 'priop') && this.better(cand, cur)) pre = true;
        } else if (p === 'rr' && cur.qUsed >= this.q()) cur.qUsed = 0; else if (p === 'mlfq' && cur.qUsed >= this.levelQ(cur.level)) { cur.level = Math.min(2, cur.level + 1); cur.qUsed = 0; }
        if (pre) { cur.state = 'ready'; cur.why = 'Preempted, back in the ready queue'; this.enqueue(cur); core.task = null; }
      } else core.task = null;
    }
    const cost = Math.max(0, +(this.an.scheduler?.props.ctxCost ?? 0)) / 10;
    for (const core of this.cores.values()) {
      if (core.task) continue; const nx = this.pickReady(); if (!nx) continue;
      this.readyQ = this.readyQ.filter(x => x !== nx.id); nx.state = 'running'; nx.qUsed = 0; nx.why = 'Running on a CPU'; core.task = nx.id; this.stat.ctx++; core.ctx++; core.debt += cost;
      if (this.an.mem.mmu && this.an.mem.mmu.props.asid === false) this.tlb = [];
      if (nx.firstRun < 0) nx.firstRun = this.t;
    }
  }

  runCores() {
    for (const core of this.cores.values()) {
      core.trace.push(null); if (core.trace.length > 160) core.trace.shift();
      this.stat.tot++; core.ticks++;
      const t = core.task ? this.tasks.get(core.task) : undefined; if (!t || t.state !== 'running') continue;
      if (core.debt >= 1) { core.debt -= 1; this.stat.ctxTicks++; continue; }
      const ca = this.an.attach.get(t.id)?.container;
      if (ca) { const cn = this.nodeOf(ca); const cr = this.conts.get(ca)!; if (cr.tokens < 1) { t.throttled = true; cr.throttled++; t.why = `Container CPU quota (${cn.props.cpuPct}%) used up, throttled`; continue; } cr.tokens -= 1; }
      t.throttled = false;
      const f = this.touch(t); if (f < 0) { if (ca) this.conts.get(ca)!.tokens += 1; continue; }
      const cpuN = this.nodeOf(core.id); const cf = this.cacheFactor(t, cpuN); this.cacheF.set(core.id, cf);
      const work = Math.max(0.05, (+cpuN.props.ghz || 3) / 3) * f * cf;
      core.trace[core.trace.length - 1] = t.id; this.stat.busy++; core.busy++; t.qUsed++; t.cpuDone += work; t.burst -= work;
      if (t.burst <= 1e-6) {
        const s = t.steps[t.idx]; core.task = null; t.state = 'ready';
        if (s.k === 'play') { const fps = Math.max(1, +this.nodeOf(t.id).props.fps || 25); t.framesShown++; t.stepLeft--; t.due = this.t + Math.max(1, Math.round(TICKS_PER_SEC / fps)); if (t.stepLeft <= 0) this.advance(t); else { t.playPhase = 'wait'; t.state = 'blocked'; t.why = 'Waiting for the next frame time'; } }
        else this.advance(t);
        if (t.state === 'ready') { this.readyQ = this.readyQ.filter(x => x !== t.id); this.enqueue(t); }
      }
    }
  }

  // ---------- tick ----------
  tick() {
    this.t++; const an = this.an;
    for (const [id, cr] of this.conts) { const n = an.byId.get(id); if (n) { const rate = (an.cores.length * n.props.cpuPct) / 100; cr.tokens = Math.min(Math.max(2, rate * 2), cr.tokens + rate); }; }
    this.syncBuffers();
    this.stepDevices(); this.tickOpTimers(); this.dispatchOps(); this.tickPlay();
    for (const t of this.tasks.values()) {
      const at = an.attach.get(t.id)!;
      if (!at.ok && t.state !== 'idle' && t.state !== 'done' && t.state !== 'killed') { this.resetTask(t); t.why = at.why ?? 'Not connected'; continue; }
      if (t.state === 'idle') { const n = this.nodeOf(t.id); if (!at.ok) { t.why = at.why ?? 'Not connected to the Scheduler'; continue; } if (t.restartAt >= 0 ? this.t >= t.restartAt : this.t >= Math.max(Math.round((+n.props.delay || 0) / 10), Math.round((+n.props.arrival || 0) / 10))) { t.restartAt = -1; this.startTask(t); } }
      else if ((t.state === 'done' || t.state === 'killed') && t.restartAt >= 0 && this.t >= t.restartAt && at.ok) { t.restartAt = -1; t.state = 'idle'; this.startTask(t); }
      if (t.state === 'new') this.tryAdmit(t);
      if (t.state === 'ready') t.waitT++;
    }
    this.schedule(); this.runCores();
    if (this.t % 8 === 0) this.sample();
    if (this.t % 40 === 0) { this.stat.win = this.stat.win.filter(x => this.t - x < 300); this.stat.uwin = this.stat.uwin.filter(x => this.t - x < 300); }
  }

  sample() {
    const used = this.frames.filter(f => f.owner).length; let io = 0; this.devs.forEach(d => { io += d.queue.length + d.cur.length; }); let buf = 0; this.bufs.forEach(b => { buf += b.level; });
    const dBusy = this.stat.busy - this.lastSample.busy, dTot = this.stat.tot - this.lastSample.tot; const df = this.stat.major - this.lastSample.f;
    this.lastSample = { f: this.stat.major, busy: this.stat.busy, tot: this.stat.tot };
    const th = this.stat.tlbHit + this.stat.tlbMiss; const nic = [...this.devs.values()].find(d => this.nodeOf(d.id).kind === 'nic'); const dk = [...this.devs.values()].find(d => this.nodeOf(d.id).kind === 'storage');
    this.samples.push({ t: this.t, util: dTot ? dBusy / dTot : 0, faults: df, ram: this.frames.length ? used / this.frames.length : 0, swap: this.swapSlots() ? this.swapUsed / this.swapSlots() : 0, ready: this.readyQ.length, io, buf, tlb: th ? this.stat.tlbHit / th : 0, net: nic && nic.busy && this.t ? nic.busy / this.t : 0, disk: dk && this.t ? dk.busy / this.t : 0 });
    if (this.samples.length > 120) this.samples.shift();
  }

  freeSpace(id: string, bytes?: number) { const d = this.devs.get(id); const n = this.an.byId.get(id); if (d && n) { const b = bytes ?? Math.max(1, Math.round(d.used * 0.25)); d.used = Math.max(0, d.used - b); this.say(`Freed ${fmtBytes(b)} on the ${n.kind === 'usb' ? 'USB drive' : 'disk'}.`, 'good', undefined, 'io'); } }
  unplugNote(plugged: boolean) { this.say(plugged ? 'USB drive plugged in. Queued requests resume.' : 'USB drive unplugged. Tasks waiting on it will stall.', plugged ? 'good' : 'warn', undefined, 'io'); }

  // ---------- derived metrics ----------
  thrashing() { return this.stat.win.filter(x => this.t - x < 120).length; }
  reqs(id: string) { return requirements(this.an, this.topo, id); }
  fragInfo() { return this.holeInfo(); }
  active(t: TaskRT) { return t.state !== 'idle' && t.state !== 'done' && t.state !== 'killed'; }
  internalWaste() { let w = 0; this.tasks.forEach(t => { if (this.active(t)) w += t.waste; }); return w; }
  accesses() { return this.stat.hits + this.stat.minor + this.stat.major; }
  tlbRate() { const n = this.stat.tlbHit + this.stat.tlbMiss; return n ? this.stat.tlbHit / n : 0; }
  /** Effective memory access time in ns using textbook constants: TLB 1 ns, RAM 100 ns, and the measured fault service time. */
  eat() {
    const acc = this.accesses(); if (!acc) return 0; const h = this.tlbRate(); const mmu = this.an.mem.mmu; const tlbOn = (+(mmu?.props.tlb) || 0) > 0;
    const walk = Math.max(0, +(mmu?.props.tlbMiss ?? 60) || 0);
    const base = tlbOn ? h * 101 + (1 - h) * (101 + walk) : 100 + walk; const svc = this.stat.majorN ? (this.stat.majorTicks / this.stat.majorN) * 10_000_000 : 8e6;
    const pMaj = this.stat.major / acc, pMin = this.stat.minor / acc; return (1 - pMaj - pMin) * base + pMin * 1000 + pMaj * svc;
  }
  avg(k: 'turn' | 'wait' | 'resp') { return this.stat.done ? this.stat[k] / this.stat.done : 0; }
  utilNow() { return this.samples.length ? this.samples[this.samples.length - 1].util : 0; }
  ramUsage() { const F = this.frames; let task = 0, pinned = 0, kernel = 0, free = 0; for (const f of F) { if (!f.owner) free++; else if (f.owner === 'kernel') kernel++; else if (f.owner.startsWith('buf:')) pinned++; else task++; } return { task, pinned, kernel, free, total: F.length }; }


  // ---------- address translation (step-through view) ----------
  /**
   * Trace one virtual address through TLB and page table for a task.
   * Purely observational: does not change simulation state.
   */
  translate(taskId: string, vaText: string): TransResult {
    const t = this.tasks.get(taskId);
    const out: TransResult = { steps: [] };
    const S = (title: string, detail: string, tone: 'ok' | 'miss' | 'bad' | 'info' = 'info') => { out.steps.push({ title, detail, tone }); };
    const pr = this.pageReal || 1;
    const raw = vaText.trim().toLowerCase();
    const va = raw.startsWith('0x') ? parseInt(raw.slice(2), 16) : /^[0-9]+$/.test(raw) ? parseInt(raw, 10) : NaN;
    if (!t) { S('No task', 'Pick a task that has started at least once.', 'bad'); return out; }
    if (!isFinite(va) || va < 0) { S('Not an address', 'Type a virtual address in decimal (e.g. 20480) or hex (e.g. 0x5000).', 'bad'); return out; }
    if (this.an.mem.mode === 'none') { S('No memory path', 'Connect CPU, MMU and RAM first.', 'bad'); return out; }
    if (this.an.mem.mode === 'contig') {
      if (t.base < 0) { S('Not admitted', `${this.tname(t)} has no contiguous block yet, so there is nothing to translate.`, 'bad'); return out; }
      if (va >= t.sizeB) { S('Limit check', `${fmtBytes(va)} is beyond the task size of ${fmtBytes(t.sizeB)}: segmentation fault.`, 'bad'); return out; }
      out.virtual = va;
      S('Contiguous mode', 'No MMU: the CPU adds the base register to the virtual address.');
      S('Base and limit', `Base = frame ${t.base} (${fmtBytes(t.base * this.fb)}), limit = ${fmtBytes(t.sizeB)}. Address ${fmtBytes(va)} is inside the limit.`, 'ok');
      out.physical = t.base * this.fb + va;
      S('Physical address', `${fmtBytes(t.base * this.fb)} + ${fmtBytes(va)} = ${fmtBytes(out.physical)} (0x${out.physical.toString(16).toUpperCase()}).`, 'ok');
      return out;
    }
    const page = Math.floor(va / pr), offset = va % pr;
    out.virtual = va; out.page = page; out.offset = offset;
    S('Split the virtual address', `With ${fmtBytes(pr)} pages: virtual address ${fmtBytes(va)} (0x${va.toString(16).toUpperCase()}) = page ${page}, offset ${fmtBytes(offset)}.`);
    if (page >= t.pagesReal) { S('Bounds check', `Page ${page} is beyond the task's ${t.pagesReal.toLocaleString('en-US')} pages (${fmtBytes(t.sizeB)}): segmentation fault.`, 'bad'); return out; }
    const tlbN = Math.max(0, Math.floor(+this.an.mem.mmu!.props.tlb || 0));
    const key = `${t.id}|${page}`; const ti = this.tlb.indexOf(key);
    if (tlbN > 0 && ti >= 0) { out.tlb = 'hit'; S('TLB lookup', `Hit: the TLB already holds page ${page}. No page-table walk needed.`, 'ok'); }
    else if (tlbN > 0) { out.tlb = 'miss'; S('TLB lookup', `Miss: page ${page} is not among the ${tlbN} cached translations. The MMU must walk the page table (+${Math.max(0, +this.an.mem.mmu!.props.tlbMiss || 0)} ns penalty).`, 'miss'); }
    else { out.tlb = 'off'; S('TLB lookup', 'The TLB is disabled: every access walks the page table.', 'miss'); }
    const k = this.pagesPerFrame;
    const pg = Math.min(t.pages - 1, Math.floor(page / k));
    const pte = t.pt[pg];
    if (!pte) { S('Page-table walk', 'This task has no page table yet. It needs to be admitted to memory first.', 'bad'); return out; }
    out.framePage = pg;
    if (pte.present) {
      S(out.tlb === 'hit' ? 'Frame from the TLB' : 'Page-table walk', `PTE for page ${page}${k > 1 ? ` (tracked in frame page ${pg}, which covers real pages ${pg * k}-${pg * k + k - 1})` : ''}: present, in frame ${pte.frame}${pte.dirty ? ', dirty' : ''}.`, 'ok');
    } else if (pte.onSwap) { S('Page-table walk', `PTE for page ${page}: not present, on swap. A major page fault reads it back from the swap disk before the access can complete.`, 'miss'); return out; }
    else { S('Page-table walk', `PTE for page ${page}: never loaded. A minor page fault zero-fills a fresh frame.`, 'miss'); return out; }
    const within = (page - pg * k) * pr + offset;
    out.frame = pte.frame; out.physical = pte.frame * this.fb + within;
    S('Physical address', `Frame ${pte.frame} starts at ${fmtBytes(pte.frame * this.fb)}. Add offset ${fmtBytes(within)}: physical address ${fmtBytes(out.physical)} (0x${out.physical.toString(16).toUpperCase()}).`, 'ok');
    return out;
  }

  problems(): Problem[] {
    const out: Problem[] = []; const an = this.an; const T = this.topo; const P = (level: Problem['level'], text: string, node?: string) => out.push({ level, text, node });
    if (!an.scheduler) P('error', 'No Scheduler on the canvas. Nothing can run without one.');
    else if (!an.cores.length) P('error', 'No CPU core is connected to the Scheduler.', an.scheduler.id);
    if (an.mem.mode === 'none') P('error', 'No path from a CPU to RAM. Connect CPU to MMU to RAM (or CPU directly to RAM).');
    const ram = an.mem.ram; const cfg = this.memCfg();
    if (ram && cfg) {
      if (cfg.err) P('error', cfg.err, ram.id);
      else {
        if (cfg.k > 1) P('info', `Resolution: ${fmtBytes(cfg.size)} of RAM with ${fmtBytes(cfg.page)} pages is ${fmtNum(Math.floor(cfg.size / cfg.page))} real frames. The simulator groups ${cfg.k} real pages into one displayed frame (${fmtBytes(cfg.fb)}). Raise "Simulation resolution" on the RAM node for finer detail.`, ram.id);
        const rsv = +ram.props.reserved || 0; if (rsv >= cfg.size) P('error', 'Kernel reserved memory is as large as RAM.', ram.id);
      }
    }
    for (const s of T.nodes.filter(n => n.kind === 'storage')) {
      if (s.props.used > s.props.cap) P('error', `Disk used space (${fmtBytes(s.props.used)}) exceeds capacity (${fmtBytes(s.props.cap)}).`, s.id);
      if (s.props.swap > s.props.cap - s.props.used) P('warn', `Swap partition (${fmtBytes(s.props.swap)}) is larger than the free space on the disk.`, s.id);
      if (an.swap?.id === s.id && !(s.props.swap > 0)) P('warn', 'This disk is the swap device but its swap size is 0, so there is effectively no swap.', s.id);
    }
    if (cfg && !cfg.err) for (const c of T.nodes.filter(n => n.kind === 'container')) if (c.props.mem > cfg.size) P('warn', `Container "${c.props.name}" has a memory limit (${fmtBytes(c.props.mem)}) above total RAM, so the limit never applies.`, c.id);
    for (const t of T.nodes.filter(n => n.kind === 'task')) {
      const sz = +t.props.size || TPLS[t.tpl!].size; const nm = TPLS[t.tpl!].name;
      if (cfg && !cfg.err) {
        if (Math.ceil(sz / cfg.fb) > MAX_TASK_PAGES) P('error', `${nm} is ${fmtBytes(sz)}, far too large for ${fmtBytes(cfg.size)} of RAM at this resolution. Use "Fit workloads to RAM".`, t.id);
        else if (an.mem.mode === 'contig' && sz > cfg.size - (+ram!.props.reserved || 0)) P('warn', `${nm} (${fmtBytes(sz)}) can never fit in RAM in contiguous mode. Add an MMU for virtual memory.`, t.id);
      }
      if ((+t.props.ws || 0) > sz) P('warn', `${nm}: working set is larger than its total size. It will be clamped.`, t.id);
    }
    for (const b of an.buffers) { if (cfg && !cfg.err && b.node.props.size > cfg.size) P('warn', 'Media buffer is larger than RAM.', b.node.id); const bt = b.tasks.map(i => this.nodeOf(i)).find(n => n.tpl === 'video'); if (bt && b.nic && (+bt.props.bitrate || 0) > (+b.nic.props.bw || 0)) P('warn', `Video bitrate (${fmtBytes(bt.props.bitrate)}/s) is higher than the network bandwidth (${fmtBytes(b.nic.props.bw)}/s). It will always stall.`, bt.id); }
    for (const n of T.nodes.filter(n => n.kind === 'nic')) if (!(+n.props.bw > 0)) P('error', 'Network bandwidth must be greater than 0.', n.id);
    return out;
  }
}
const n_isDisk = (n: NodeDef) => n.kind === 'storage' || n.kind === 'usb' || n.kind === 'printer';
