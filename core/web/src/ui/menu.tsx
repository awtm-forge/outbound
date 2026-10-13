import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

// A button that opens a small menu or popover. Arrow keys move between items, Escape or a click outside closes it,
// and focus goes back to the button. Pass role="menu" content (MenuItem) or any popover content with kind="dialog".
export function Menu({ label, button, children, className = 'icon-btn', place = '', kind = 'menu' }:
  { label: string; button: ReactNode; children: (close: () => void) => ReactNode; className?: string; place?: '' | 'up' | 'left' | 'up left'; kind?: 'menu' | 'dialog' }) {
  const [open, setOpen] = useState(false); const wrap = useRef<HTMLDivElement>(null); const btn = useRef<HTMLButtonElement>(null); const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const first = pop.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"]), a, button, input, select');
    first?.focus();
    const down = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) close(false); };
    addEventListener('mousedown', down); return () => removeEventListener('mousedown', down);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (kind !== 'menu' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]; if (!items.length) return;
    e.preventDefault(); const i = items.indexOf(document.activeElement as HTMLElement);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[n]!.focus();
  };
  return (
    <div className="menu-wrap" ref={wrap} onKeyDown={keys}>
      <button ref={btn} type="button" className={className} aria-label={label} aria-haspopup={kind === 'menu' ? 'menu' : 'dialog'} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}>{button}</button>
      {open && <div ref={pop} id={id} className={`menu-pop ${place}`} role={kind} aria-label={label}>{children(() => close())}</div>}
    </div>
  );
}
export function MenuItem({ onSelect, children, disabled, title }: { onSelect: () => void; children: ReactNode; disabled?: boolean; title?: string }) {
  return <div role="menuitem" tabIndex={-1} aria-disabled={disabled || undefined} title={title}
    onClick={() => { if (!disabled) onSelect(); }} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); onSelect(); } }}>{children}</div>;
}
