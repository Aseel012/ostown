import { Component, type ReactNode } from 'react';
import { clearSaved } from '../store';

interface State { error: Error | null }
/** Last-resort guard: a render error shows a recovery panel instead of a white screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: any) { console.error('OSTown crashed:', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="crash"><div className="glass crashbox">
      <h2>Something broke</h2>
      <p className="muted">The interface hit an unexpected error. Your canvas is saved in this browser; reloading restores it.</p>
      <pre className="mono">{String(this.state.error.message ?? this.state.error)}</pre>
      <div className="btnrow">
        <button className="btn primary" onClick={() => location.reload()}>Reload</button>
        <button className="btn" onClick={() => { clearSaved(); location.reload(); }}>Reload with a fresh canvas</button>
      </div></div></div>;
  }
}
