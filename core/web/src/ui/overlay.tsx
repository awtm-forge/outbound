import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Icon } from './icons.tsx';

// Keeps keyboard focus inside an open overlay, closes it on Escape, and hands focus back to whatever had it before.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export function useFocusTrap(ref: RefObject<HTMLElement | null>, onEscape: () => void, initial?: RefObject<HTMLElement | null>) {
  const esc = useRef(onEscape); esc.current = onEscape;
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null; const el = ref.current; if (!el) return;
    const first = initial?.current ?? el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el;
    first.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); esc.current(); return; }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) { e.preventDefault(); return; }
      const [a, z] = [items[0]!, items[items.length - 1]!];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    el.addEventListener('keydown', key);
    return () => { el.removeEventListener('keydown', key); if (back && document.contains(back)) back.focus(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------- confirm: replaces the browser's confirm() and prompt() ----------
export type ConfirmOptions = {
  title: string; body?: ReactNode; confirm: string; tone?: 'danger' | 'primary'; cancel?: string;
  // a text answer, e.g. why a deal was lost; when required, the confirm button waits for it
  input?: { label: string; placeholder?: string; required?: boolean };
};
type Pending = ConfirmOptions & { resolve: (v: string | boolean) => void };
const Ctx = createContext<(o: ConfirmOptions) => Promise<string | boolean>>(async () => false);
export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<Pending | null>(null);
  const ask = useCallback((o: ConfirmOptions) => new Promise<string | boolean>((resolve) => setP({ ...o, resolve })), []);
  const close = (v: string | boolean) => { p?.resolve(v); setP(null); };
  return <Ctx.Provider value={ask}>{children}{p && <ConfirmDialog p={p} close={close} />}</Ctx.Provider>;
}
function ConfirmDialog({ p, close }: { p: Pending; close: (v: string | boolean) => void }) {
  const box = useRef<HTMLDivElement>(null); const field = useRef<HTMLInputElement>(null); const cancel = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState('');
  // a destructive question starts on Cancel, so Enter alone never destroys anything
  useFocusTrap(box, () => close(false), p.input ? field : p.tone === 'danger' ? cancel : undefined);
  const ok = !p.input?.required || text.trim().length > 0;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
      <div ref={box} className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby={p.body ? 'dlg-body' : undefined}>
        <h2 id="dlg-title">{p.title}</h2>
        {p.body && <div id="dlg-body" className="dialog-body">{p.body}</div>}
        <form onSubmit={(e) => { e.preventDefault(); if (ok) close(p.input ? text.trim() : true); }}>
          {p.input && <label className="field"><span>{p.input.label}{p.input.required ? '' : ' (optional)'}</span>
            <input ref={field} value={text} onChange={(e) => setText(e.target.value)} placeholder={p.input.placeholder} required={p.input.required} maxLength={500} /></label>}
          <div className="dialog-actions">
            <button ref={cancel} type="button" className="btn" onClick={() => close(false)}>{p.cancel ?? 'Cancel'}</button>
            <button type="submit" data-confirm className={`btn ${p.tone === 'danger' ? 'danger solid' : 'primary'}`} disabled={!ok}>{p.confirm}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- drawer: a side panel that behaves as a modal dialog ----------
export function Drawer({ label, onClose, actions, children }: { label: string; onClose: () => void; actions?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  // Escape in a field leaves the field first (the drawer saves on blur), a second Escape closes
  useFocusTrap(ref, () => { const a = document.activeElement as HTMLElement | null; if (a?.matches('input, textarea, select') && ref.current?.contains(a)) ref.current.focus(); else onClose(); });
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <header><h2 className="drawer-title">{label}</h2>{actions}<button className="btn sm ghost icon-only" onClick={onClose} aria-label="Close"><Icon.x size={16} /></button></header>
        {children}
      </aside>
    </>
  );
}
