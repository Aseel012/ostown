export const KB = 1024, MB = 1024 ** 2, GB = 1024 ** 3, TB = 1024 ** 4;
export const UNIT_LIST = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
export type Unit = typeof UNIT_LIST[number];
export const UNIT_BYTES: Record<Unit, number> = { B: 1, KB, MB, GB, TB };
export const TICK_MS = 10; // one simulation tick = 10 ms of simulated time
export const TICKS_PER_SEC = 1000 / TICK_MS;

const ALIAS: Record<string, Unit> = {
  b: 'B', byte: 'B', bytes: 'B', k: 'KB', kb: 'KB', kib: 'KB', kilobyte: 'KB', kilobytes: 'KB',
  m: 'MB', mb: 'MB', mib: 'MB', megabyte: 'MB', megabytes: 'MB', g: 'GB', gb: 'GB', gib: 'GB', gigabyte: 'GB', gigabytes: 'GB',
  t: 'TB', tb: 'TB', tib: 'TB', terabyte: 'TB', terabytes: 'TB',
};

export type Parsed = { ok: true; bytes: number } | { ok: false; err: string };
/** Parse "8", "8 gb", "12 bytes", "1.5MB", "512kib". A bare number uses defUnit. */
export function parseSize(input: string, defUnit: Unit = 'MB'): Parsed {
  const s = input.trim().replace(/\/s(ec)?$/i, '').replace(/,/g, '');
  if (!s) return { ok: false, err: 'Enter a value' };
  const m = /^([0-9]*\.?[0-9]+(?:e[+-]?\d+)?)\s*([a-z]*)$/i.exec(s);
  if (!m) return { ok: false, err: 'Use a number with an optional unit, e.g. 8 GB, 512 KB or 12 bytes' };
  const unit = m[2] ? ALIAS[m[2].toLowerCase()] : defUnit;
  if (!unit) return { ok: false, err: `Unknown unit "${m[2]}". Use B, KB, MB, GB or TB` };
  const v = parseFloat(m[1]) * UNIT_BYTES[unit];
  if (!isFinite(v)) return { ok: false, err: 'Number is too large' };
  if (Math.abs(v - Math.round(v)) > 1e-6) return { ok: false, err: 'Must be a whole number of bytes' };
  return { ok: true, bytes: Math.round(v) };
}
export function bestUnit(bytes: number): Unit {
  for (let i = UNIT_LIST.length - 1; i >= 0; i--) { const u = UNIT_LIST[i]; if (bytes >= UNIT_BYTES[u] && Math.abs(bytes / UNIT_BYTES[u] - Math.round((bytes / UNIT_BYTES[u]) * 100) / 100) < 1e-9) return u; }
  return 'B';
}
const trim = (n: number) => String(parseFloat(n.toFixed(2)));
export function fmtBytes(bytes: number): string {
  if (!isFinite(bytes)) return '-';
  const a = Math.abs(bytes); if (a < 1024) return `${Math.round(bytes)} B`;
  for (let i = UNIT_LIST.length - 1; i >= 1; i--) { const u = UNIT_LIST[i]; if (a >= UNIT_BYTES[u]) return `${trim(bytes / UNIT_BYTES[u])} ${u}`; }
  return `${Math.round(bytes)} B`;
}
export const fmtRate = (bps: number) => `${fmtBytes(bps)}/s`;
export function fmtTicks(t: number): string { const ms = t * TICK_MS; if (ms < 1000) return `${Math.round(ms)} ms`; if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`; return `${Math.floor(ms / 60000)} m ${Math.round((ms % 60000) / 1000)} s`; }
export const fmtNum = (n: number) => n.toLocaleString('en-US');
export const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
