// One fetch wrapper. Same-origin session cookie; every mutation carries an Idempotency-Key, which is also what
// the server relies on to refuse cross-site requests.
export class ApiError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
export const onUnauthorized = new EventTarget();
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized.dispatchEvent(new Event('401'));
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`);
  return data as T;
}
export const api = {
  get: <T = any>(p: string) => call<T>('GET', p),
  post: <T = any>(p: string, b: unknown = {}) => call<T>('POST', p, b),
  patch: <T = any>(p: string, b: unknown = {}) => call<T>('PATCH', p, b),
  put: <T = any>(p: string, b: unknown = {}) => call<T>('PUT', p, b),
  del: <T = any>(p: string, b?: unknown) => call<T>('DELETE', p, b),
  // a file as the request body, with its type; progress from 0 to 1 while it goes up
  upload: <T = any>(p: string, file: Blob, onProgress?: (f: number) => void, signal?: AbortSignal) => new Promise<T>((ok, fail) => {
    const x = new XMLHttpRequest(); x.open('POST', p); x.withCredentials = true;
    if (signal) { if (signal.aborted) return fail(new ApiError(0, 'Cancelled.')); signal.addEventListener('abort', () => x.abort()); x.onabort = () => fail(new ApiError(0, 'Cancelled.')); }
    x.setRequestHeader('content-type', file.type || 'application/octet-stream'); x.setRequestHeader('idempotency-key', crypto.randomUUID());
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onload = () => { let d: any = null; try { d = JSON.parse(x.responseText); } catch { /* not json */ }
      if (x.status === 401) onUnauthorized.dispatchEvent(new Event('401'));
      x.status < 300 ? ok(d) : fail(new ApiError(x.status, d?.error ?? `Upload failed (${x.status})`)); };
    x.onerror = () => fail(new ApiError(0, 'The upload did not reach the server. Check the connection and try again.'));
    x.send(file);
  }),
  // AI actions come back as a job id (the host cuts requests at 60 s); wait here until the work is done.
  run: async <T = any>(p: string, b: unknown = {}, onWait?: (ms: number) => void): Promise<T> => {
    const r: any = await call('POST', p, b);
    if (!r || !r.job_id) return r as T;
    const t0 = Date.now();
    for (;;) {
      await new Promise((ok) => setTimeout(ok, Date.now() - t0 < 10_000 ? 1200 : 2500));
      const j: any = await call('GET', `/api/jobs/${r.job_id}`);
      if (j.status === 'done') return j.result as T;
      if (j.status === 'failed') throw new ApiError(500, j.error ?? 'The AI step failed.');
      onWait?.(Date.now() - t0);
    }
  },
};
export type Role = 'admin' | 'member';
export type Me = { user: string; id: string; name: string; role: Role; email: string | null; must_change_password: boolean; ai_provider: string; saleshandy: string; discovery_source: string; saleshandy_integration?: boolean; portal?: boolean; queue?: { waiting: number; running: string | null } };
export type TeamMember = { id: string; username: string; name: string; role: Role };
