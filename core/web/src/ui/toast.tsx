import { createContext, useCallback, useContext, useState } from 'react';
type T = { id: number; text: string; err?: boolean; action?: { label: string; run: () => void } };
const Ctx = createContext<(text: string, opts?: { err?: boolean; action?: T['action'] }) => void>(() => {});
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((text: string, opts: { err?: boolean; action?: T['action'] } = {}) => {
    const id = Date.now() + Math.random(); setItems((xs) => [...xs.slice(-2), { id, text, ...opts }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), opts.err ? 7000 : 4200);
  }, []);
  return <Ctx.Provider value={push}>{children}<div className="toasts" role="status" aria-live="polite">{items.map((t) => (
    <div key={t.id} className={`toast${t.err ? ' err' : ''}`}><span>{t.text}</span>{t.action && <button className="btn sm ghost" onClick={() => { t.action!.run(); setItems((xs) => xs.filter((x) => x.id !== t.id)); }}>{t.action.label}</button>}</div>))}</div></Ctx.Provider>;
}
export const useToast = () => useContext(Ctx);
