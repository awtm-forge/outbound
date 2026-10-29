// The client portal (dashboard.awtmforge.com) read from ops. Read-only; the portal keeps every client-facing action.
// Answers are cached for a minute so a busy Clients screen does not hammer the portal's database.
import { env } from './lib/env.ts';
import { HttpError } from './pipeline.ts';

const cache = new Map<string, { at: number; data: any }>();
const TTL = 60_000;
export const portalConfigured = () => !!(env.portalApiUrl && env.portalApiKey);
async function get<T>(path: string): Promise<T> {
  if (!portalConfigured()) throw new HttpError(503, 'The portal is not connected. Set PORTAL_API_URL and PORTAL_API_KEY.');
  const hit = cache.get(path); if (hit && Date.now() - hit.at < TTL) return hit.data as T;
  const res = await fetch(env.portalApiUrl.replace(/\/$/, '') + path, { headers: { 'x-ops-key': env.portalApiKey }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) throw new HttpError(502, 'The portal answered 404. Either OPS_API_KEY is not set on the portal, the keys differ, or the portal has not deployed the ops routes yet.');
  if (!res.ok) throw new HttpError(502, `The portal answered ${res.status}.`);
  const data = await res.json(); cache.set(path, { at: Date.now(), data }); return data as T;
}
export const clients = () => get<{ clients: any[]; totals: any; generatedAt: string }>('/api/ops/clients');
export const client = (id: string) => get<any>(`/api/ops/clients/${encodeURIComponent(id)}`);
export const forget = () => cache.clear();
