// Saleshandy switches, read from the environment each time they are checked, so turning a kill switch off takes
// effect on the next action without a restart. The API key is read only by the client (client.ts).
const on = (k: string) => /^(1|true|yes|on)$/i.test(String(process.env[k] ?? '').trim());
export type Risk = 'low' | 'medium' | 'high' | 'spend';
export const RISK_FLAG: Record<Risk, string> = { low: 'SALESHANDY_WRITES_LOW', medium: 'SALESHANDY_WRITES_MEDIUM', high: 'SALESHANDY_WRITES_HIGH', spend: 'SALESHANDY_WRITES_SPEND' };
export function shConfig() {
  return {
    // real only with a key; anything else serves the constructed fixtures and never reaches Saleshandy
    live: (process.env.SALESHANDY_MODE ?? 'mock') === 'real' && !!process.env.SALESHANDY_API_KEY,
    integration: on('SALESHANDY_INTEGRATION_ENABLED'),
    writes: on('SALESHANDY_WRITES_ENABLED'),
    risk: { low: on(RISK_FLAG.low), medium: on(RISK_FLAG.medium), high: on(RISK_FLAG.high), spend: on(RISK_FLAG.spend) } as Record<Risk, boolean>,
    production: (process.env.NODE_ENV ?? 'development') === 'production',
    allowlist: String(process.env.SALESHANDY_TEST_ALLOWLIST ?? '').split(',').map((s) => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
    testSequenceId: String(process.env.SALESHANDY_TEST_SEQUENCE_ID ?? '').trim(),
    creditCap: Math.max(0, Number(process.env.SALESHANDY_MONTHLY_CREDIT_CAP || 0) || 0),
    minIntervalMs: Math.max(0, Number(process.env.SALESHANDY_MIN_INTERVAL_MS ?? 1000)),
  };
}
// links to the Saleshandy app for everything that is done there
export const SH_APP = 'https://my.saleshandy.com';
