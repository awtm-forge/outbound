// AI_MODEL / AI_MODEL_CHEAP override the per-provider default, but a model named for the other provider is ignored
// (with a warning), so switching AI_PROVIDER alone never sends a Claude model name to Google or the reverse.
// Only three values mean anything. Anything else (a typo, a note pasted into the value) runs as mock, loudly, rather than
// sending every agent call to a provider with no key.
function aiProvider(raw: string | undefined): 'anthropic' | 'gemini' | 'mock' {
  const v = (raw ?? 'mock').trim().toLowerCase();
  if (v === 'anthropic' || v === 'gemini' || v === 'mock') return v;
  console.warn(JSON.stringify({ level: 'warn', msg: 'AI_PROVIDER is not anthropic, gemini or mock; running as mock', configured: raw }));
  return 'mock';
}
function pickModel(configured: string | undefined, gemini: string, claude: string): string {
  const provider = aiProvider(process.env.AI_PROVIDER);
  const fallback = provider === 'gemini' ? gemini : claude;
  if (!configured) return fallback;
  const mismatch = (provider === 'gemini' && /^claude/i.test(configured)) || (provider === 'anthropic' && /^gemini/i.test(configured));
  if (mismatch) { console.warn(JSON.stringify({ level: 'warn', msg: 'AI model does not match AI_PROVIDER; using the provider default', configured, used: fallback })); return fallback; }
  return configured;
}
export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://awtm:awtm@127.0.0.1:55460/awtm_outbound',
  port: Number(process.env.PORT ?? 8080),
  apiKey: process.env.CORE_API_KEY ?? '',
  dashboardUser: process.env.DASHBOARD_USER ?? '',
  dashboardPassword: process.env.DASHBOARD_PASSWORD ?? '',
  publicUrl: process.env.CORE_PUBLIC_URL ?? 'http://localhost:8080',
  aiProvider: aiProvider(process.env.AI_PROVIDER),
  geminiKey: process.env.GEMINI_API_KEY ?? '',
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  // Claude defaults to Opus 5.5 for both tiers; the cheap tier runs it at low effort instead of on a smaller model
  aiModel: pickModel(process.env.AI_MODEL, 'gemini-3.5-flash', 'claude-opus-5-5'),
  aiModelCheap: pickModel(process.env.AI_MODEL_CHEAP, 'gemini-3.5-flash-lite', 'claude-opus-5-5'),
  aiSpendCapUsd: Number(process.env.AI_SPEND_CAP_USD || 0),
  aiSpendSince: process.env.AI_SPEND_SINCE || '',
  // room for thinking models: Gemini 3.x spends a share of this reasoning before it writes the answer
  aiMaxTokens: Number(process.env.AI_MAX_TOKENS || 8192),
  aiTemperature: Number(process.env.AI_TEMPERATURE ?? 0.2),
  aiMaxRetries: Number(process.env.AI_MAX_RETRIES ?? 3),
  aiRetryBaseMs: Number(process.env.AI_RETRY_BASE_MS ?? 5000),
  // optional cap on what one project's files may take, in MB; 0 means no cap (none is set unless configured)
  projectStorageLimitMb: Math.max(0, Number(process.env.PROJECT_STORAGE_LIMIT_MB || 0)),
  aiCacheTtlHours: Number(process.env.AI_CACHE_TTL_HOURS ?? 720),
  saleshandyMode: (process.env.SALESHANDY_MODE ?? 'mock') as 'real' | 'mock',
  saleshandyKey: process.env.SALESHANDY_API_KEY ?? '',
  saleshandyBaseUrl: process.env.SALESHANDY_BASE_URL ?? 'https://open-api.saleshandy.com',
  saleshandyWebhookSecret: process.env.SALESHANDY_WEBHOOK_SECRET ?? '',
  configDir: process.env.CONFIG_DIR ?? new URL('../../config/', import.meta.url).pathname, // core/config, from src/lib or dist/lib
  discoverySource: (process.env.DISCOVERY_SOURCE ?? 'mock') as 'mock' | 'serper' | 'google_cse',
  serperKey: process.env.SERPER_API_KEY ?? '',
  googleCseKey: process.env.GOOGLE_CSE_KEY ?? '',
  googleCseCx: process.env.GOOGLE_CSE_CX ?? '',
  discoveryConcurrency: Number(process.env.DISCOVERY_CONCURRENCY || 5),
  discoveryFetchTimeoutMs: Number(process.env.DISCOVERY_FETCH_TIMEOUT_MS || 10000),
  discoveryMaxPages: Number(process.env.DISCOVERY_MAX_PAGES ?? 3),
  discoveryDailyQuota: Number(process.env.DISCOVERY_DAILY_QUOTA ?? 100),
  sessionSecret: process.env.SESSION_SECRET ?? '',
  cookieSecure: (process.env.CORE_PUBLIC_URL ?? '').startsWith('https://'),
  webDist: process.env.WEB_DIST ?? new URL('../../web/dist', import.meta.url).pathname,
  scheduler: (process.env.SCHEDULER ?? 'on') !== 'off',
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 5),
  portalApiUrl: process.env.PORTAL_API_URL ?? '',
  portalApiKey: process.env.PORTAL_API_KEY ?? '',
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
