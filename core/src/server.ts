import { createServer } from 'node:http';
import { env } from './lib/env.ts';
import { log } from './lib/log.ts';
import { handle } from './lib/http.ts';
import './routes/api.ts';
import './routes/dashboard.ts';
import './routes/discovery.ts';
if (!env.apiKey || !env.dashboardPassword) log.warn('CORE_API_KEY or DASHBOARD_PASSWORD is empty: all /api and dashboard requests will be rejected');
export const server = createServer(handle);
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  server.listen(env.port, () => log.info('core listening', { port: env.port, ai: env.aiProvider, saleshandy: env.saleshandyMode }));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
