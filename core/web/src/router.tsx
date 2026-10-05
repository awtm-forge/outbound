import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';
// Path routing with the History API. Seven screens do not need a router library.
const Ctx = createContext<{ path: string; search: URLSearchParams; go: (to: string, replace?: boolean) => void }>({ path: '/', search: new URLSearchParams(), go: () => {} });
export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [loc, setLoc] = useState(() => ({ path: location.pathname, search: location.search }));
  useEffect(() => { const f = () => setLoc({ path: location.pathname, search: location.search }); addEventListener('popstate', f); return () => removeEventListener('popstate', f); }, []);
  const go = (to: string, replace = false) => { if (to === location.pathname + location.search) return; history[replace ? 'replaceState' : 'pushState'](null, '', to); setLoc({ path: location.pathname, search: location.search }); if (!replace) scrollTo({ top: 0 }); };
  return <Ctx.Provider value={{ path: loc.path, search: new URLSearchParams(loc.search), go }}>{children}</Ctx.Provider>;
}
export const useRouter = () => useContext(Ctx);
export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const { go } = useRouter();
  return <a href={to} {...rest} onClick={(e: MouseEvent<HTMLAnchorElement>) => { onClick?.(e); if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); go(to); }} />;
}
export function match(pattern: string, path: string): Record<string, string> | null {
  const k: string[] = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => { k.push(n); return '([^/]+)'; }) + '/?$');
  const m = path.match(re); return m ? Object.fromEntries(k.map((n, i) => [n, decodeURIComponent(m[i + 1])])) : null;
}
