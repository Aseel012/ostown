import { useEffect, useId, useRef, useState } from 'react';
import { UNIT_LIST, UNIT_BYTES, parseSize, bestUnit, fmtBytes, type Unit } from '../units';

const numIn = (bytes: number, u: Unit) => String(parseFloat((bytes / UNIT_BYTES[u]).toFixed(6)));

export function SizeField({ label, value, onChange, min = 1, max, defUnit, presets, rate, hint }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; defUnit?: Unit; presets?: number[]; rate?: boolean; hint?: string }) {
  const focus = useRef(false); const cancel = useRef(false); const uid = useId(); const [unit, setUnit] = useState<Unit>(value ? bestUnit(value) : defUnit ?? 'MB'); const [txt, setTxt] = useState(numIn(value, value ? bestUnit(value) : defUnit ?? 'MB')); const [err, setErr] = useState('');
  useEffect(() => { if (!focus.current) { const u = value ? bestUnit(value) : defUnit ?? 'MB'; setUnit(u); setTxt(numIn(value, u)); setErr(''); } }, [value]);
  const commit = (text: string, u: Unit) => {
    const r = parseSize(text, u); if (!r.ok) { setErr(r.err); return; }
    if (r.bytes < min) { setErr(`Minimum is ${fmtBytes(min)}${rate ? '/s' : ''}`); return; }
    if (max !== undefined && r.bytes > max) { setErr(`Maximum is ${fmtBytes(max)}${rate ? '/s' : ''}`); return; }
    setErr(''); const nu = bestUnit(r.bytes); setUnit(nu); setTxt(numIn(r.bytes, nu)); if (r.bytes !== value) onChange(r.bytes);
  };
  const set = (b: number) => { const u = bestUnit(b); setUnit(u); setTxt(numIn(b, u)); setErr(''); onChange(b); };
  return <div className={`field ${err ? 'bad' : ''}`}>
    <div className="flabel"><span>{label}</span>{rate && <em>per second</em>}</div>
    <div className="fin">
      <input value={txt} inputMode="decimal" spellCheck={false} onFocus={e => { focus.current = true; e.target.select(); }} onChange={e => setTxt(e.target.value)} onBlur={() => { focus.current = false; if (cancel.current) { cancel.current = false; return; } commit(txt, unit); }} onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') { cancel.current = true; const u = value ? bestUnit(value) : defUnit ?? 'MB'; setUnit(u); setTxt(numIn(value, u)); setErr(''); (e.target as HTMLInputElement).blur(); } }} id={uid} aria-label={label} aria-describedby={err || hint ? uid + 'd' : undefined} aria-invalid={!!err} />
      <select aria-label={`${label} unit`} value={unit} onChange={e => { const u = e.target.value as Unit; setUnit(u); commit(txt, u); }}>{UNIT_LIST.map(u => <option key={u} value={u}>{rate ? u + '/s' : u}</option>)}</select>
    </div>
    {presets && <div className="presets">{presets.map(p => <button key={p} className={p === value ? 'on' : ''} onClick={() => set(p)}>{fmtBytes(p)}</button>)}</div>}
    {err ? <div className="ferr" id={uid + 'd'} role="alert">{err}</div> : hint ? <div className="fhint" id={uid + 'd'}>{hint}</div> : null}
  </div>;
}

export function NumField({ label, value, onChange, min, max, step = 1, unit, int, hint, presets }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string; int?: boolean; hint?: string; presets?: number[] }) {
  const focus = useRef(false); const cancel = useRef(false); const uid = useId(); const [txt, setTxt] = useState(String(value)); const [err, setErr] = useState('');
  useEffect(() => { if (!focus.current) { setTxt(String(value)); setErr(''); } }, [value]);
  const commit = (text: string) => {
    const v = Number(text.replace(/,/g, '')); if (text.trim() === '' || !isFinite(v)) { setErr('Enter a number'); return; }
    if (int && !Number.isInteger(v)) { setErr('Must be a whole number'); return; }
    if (v < min || v > max) { setErr(`Must be between ${min} and ${max}`); return; }
    setErr(''); setTxt(String(v)); if (v !== value) onChange(v);
  };
  const bump = (d: number) => { const v = Math.min(max, Math.max(min, Math.round((value + d * step) * 1e6) / 1e6)); setTxt(String(v)); setErr(''); onChange(v); };
  return <div className={`field ${err ? 'bad' : ''}`}>
    <div className="flabel"><span>{label}</span></div>
    <div className="fin num">
      <input value={txt} inputMode="decimal" spellCheck={false} onFocus={e => { focus.current = true; e.target.select(); }} onChange={e => setTxt(e.target.value)} onBlur={() => { focus.current = false; if (cancel.current) { cancel.current = false; return; } commit(txt); }} id={uid} aria-label={label} aria-describedby={err || hint ? uid + 'd' : undefined} aria-invalid={!!err} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { cancel.current = true; setTxt(String(value)); setErr(''); (e.target as HTMLInputElement).blur(); } if (e.key === 'ArrowUp') { e.preventDefault(); bump(1); } if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1); } }} />
      {unit && <span className="funit">{unit}</span>}
      <button className="stepb" aria-label={`Decrease ${label}`} onClick={() => bump(-1)} tabIndex={-1}>-</button><button className="stepb" aria-label={`Increase ${label}`} onClick={() => bump(1)} tabIndex={-1}>+</button>
    </div>
    {presets && <div className="presets">{presets.map(p => <button key={p} className={p === value ? 'on' : ''} onClick={() => { onChange(p); }}>{p}{unit ? ' ' + unit : ''}</button>)}</div>}
    {err ? <div className="ferr" id={uid + 'd'} role="alert">{err}</div> : hint ? <div className="fhint" id={uid + 'd'}>{hint}</div> : null}
  </div>;
}

export function SelectField({ label, value, onChange, options, hint }: { label: string; value: string; onChange: (v: string) => void; options: Record<string, string>; hint?: string }) {
  return <div className="field"><div className="flabel"><span>{label}</span></div><div className="fin"><select className="wide" aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{Object.entries(options).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>{hint && <div className="fhint">{hint}</div>}</div>;
}
export function SwitchField({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return <div className="field"><div className="flabel row sp"><span>{label}</span><button className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)} role="switch" aria-checked={value} aria-label={label}><i /></button></div>{hint && <div className="fhint">{hint}</div>}</div>;
}
export function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div className="field"><div className="flabel"><span>{label}</span></div><div className="fin"><input className="wide" aria-label={label} value={value} onChange={e => onChange(e.target.value)} /></div></div>;
}
export const Section = ({ title, children }: { title: string; children: any }) => <div className="fsec"><h5>{title}</h5>{children}</div>;
