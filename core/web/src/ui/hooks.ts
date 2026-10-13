import { useCallback, useEffect, useRef, useState } from 'react';
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const live = useRef(true);
  const reload = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try { const d = await fn(); if (live.current) { setData(d); setError(null); } } catch (e: any) { if (live.current) setError(e.message); } finally { if (live.current) setLoading(false); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { live.current = true; reload(); return () => { live.current = false; }; }, [reload]);
  return { data, error, loading, reload, setData };
}
// Single-key shortcuts that stay quiet while the person is typing.
export function useKeys(map: Record<string, () => void>, enabled = true) {
  const ref = useRef(map); ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement; if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t.closest('input, textarea, select, [contenteditable=true]')) { if (e.key === 'Escape') (t as HTMLElement).blur(); return; }
      const f = ref.current[e.key]; if (f) { e.preventDefault(); f(); }
    };
    addEventListener('keydown', h); return () => removeEventListener('keydown', h);
  }, [enabled]);
}
// true while the media query matches; follows changes
export function useMedia(q: string) {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q); const h = () => setM(mq.matches); mq.addEventListener('change', h); h(); return () => mq.removeEventListener('change', h); }, [q]);
  return m;
}
