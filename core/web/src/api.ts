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
};
export type Me = { user: string; ai_provider: string; saleshandy: string; discovery_source: string };
