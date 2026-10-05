import { createServer } from 'node:http';
import { env } from './lib/env.ts';
import { log } from './lib/log.ts';
import { handle } from './lib/http.ts';
import './routes/api.ts';
import './routes/discovery.ts';
import { migrate } from './migrate.ts';
import { seed } from './seed.ts';
import { startScheduler } from './scheduler.ts';
if (!env.apiKey || !env.dashboardPassword || !env.sessionSecret) log.warn('CORE_API_KEY, DASHBOARD_PASSWORD or SESSION_SECRET is empty: API calls or sign-in will be refused');
export const server = createServer(handle);
// Started directly (node dist/server.js on Hostinger, or the container), not imported by the test runner.
if (!process.env.NODE_TEST_CONTEXT) {
  (async () => {
    // Migrations are additive and idempotent, so every boot applies what is new; campaigns and proof are re-read from config.
    await migrate(); await seed();
    server.listen(env.port, () => log.info('core listening', { port: env.port, ai: env.aiProvider, saleshandy: env.saleshandyMode, scheduler: env.scheduler }));
    if (env.scheduler) startScheduler();
  })().catch((e) => { log.error('boot failed', { err: e.message }); process.exit(1); });
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
