import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Moves focus into a modal dialog, keeps Tab inside it, and restores focus to the previous element on close. */
export function useModal(ref: RefObject<HTMLElement>) {
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null; const root = ref.current;
    if (root) { const first = root.querySelector<HTMLElement>(FOCUSABLE); (first ?? root).focus({ preventScroll: true }); }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) { e.preventDefault(); root.focus(); return; }
      const a = document.activeElement as HTMLElement | null; const i = a ? items.indexOf(a) : -1;
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && (i === items.length - 1 || i < 0)) { e.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); try { prev?.focus({ preventScroll: true }); } catch { /* element gone */ } };
  }, [ref]);
}
