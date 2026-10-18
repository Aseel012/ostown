import { useEffect } from 'react';
import { useStore, getUI, setUI, sim, bump } from './store';
import { Canvas, view } from './ui/Canvas';
import { Topbar, Palette, Inspector, Dock, Coach, Toast, Welcome } from './ui/panels';
import { Academy } from './ui/academy';
import { ErrorBoundary } from './ui/ErrorBoundary';

export default function App() {
  const ui = useStore(() => getUI());
  useEffect(() => { (window as any).__view = view; document.documentElement.dataset.theme = ui.theme; }, [ui.theme]);
  useEffect(() => { (window as any).__view = view; let raf = 0, last = performance.now(), acc = 0, lastUI = 0;
    const f = (now: number) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; const u = getUI();
      if (u.playing && !u.academy && !u.welcome) { acc += dt * 40 * u.speed; let n = Math.min(60, Math.floor(acc)); acc -= n; while (n-- > 0) sim.tick(); }
      if (now - lastUI > 55) { lastUI = now; bump(); } raf = requestAnimationFrame(f); };
    raf = requestAnimationFrame(f); return () => cancelAnimationFrame(raf); }, []);
  const modal = ui.academy || ui.welcome; const inertProps: any = modal ? { inert: '', 'aria-hidden': true } : {};
  return <ErrorBoundary><div className={`app ${ui.left ? '' : 'noleft'} ${ui.right ? '' : 'noright'} ${ui.dockOpen ? '' : 'nodock'}`} {...inertProps}>
    <Canvas /><div className="scrim" onClick={() => setUI({ left: false, right: false })} /><Topbar /><Palette /><Inspector /><Dock /><Coach /><Toast />
  </div><Welcome />{ui.academy && <Academy />}</ErrorBoundary>;
}
