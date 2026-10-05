// Structured JSON logs to stdout. Never pass secrets or full email bodies in here.
const REDACT = /(api[_-]?key|password|secret|token|authorization)/i;
function scrub(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(scrub);
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, REDACT.test(k) ? '[redacted]' : scrub(v)]));
  return o;
}
export const log = {
  info: (msg: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), level: 'info', msg, ...(scrub(data) as object) })),
  warn: (msg: string, data: Record<string, unknown> = {}) => console.warn(JSON.stringify({ t: new Date().toISOString(), level: 'warn', msg, ...(scrub(data) as object) })),
  error: (msg: string, data: Record<string, unknown> = {}) => console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', msg, ...(scrub(data) as object) })),
};
