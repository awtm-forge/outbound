import { route } from '../lib/http.ts';
import { q, one } from '../lib/db.ts';
import { env } from '../lib/env.ts';
import * as D from '../discovery.ts';
route('POST', '/api/discovery/searches', 'api', async (c) => D.runSearch(c.body, c.actor, { force: !!c.body.force }));
route('GET', '/api/discovery/searches', 'api', async () => D.listSearches());
route('GET', '/api/discovery/searches/:id', 'api', async (c) => D.getSearch(c.params.id));
route('POST', '/api/discovery/candidates/add', 'api', async (c) => D.addCandidates(c.body.candidate_ids ?? [], c.body.campaign_code, c.actor, { run_chain: c.body.run_chain !== false, background: !!c.user || /respond-async/i.test(String(c.req.headers.prefer ?? '')) }));
route('POST', '/api/discovery/candidates/:id/ignore', 'api', async (c) => q(`update discovery_candidates set status='IGNORED' where id=$1 returning id,status`, [c.params.id]));
// Totals for the cards on Find companies, each with how many arrived in the last 7 days. Read-only.
route('GET', '/api/discovery/stats', 'api', async () => {
  const week = `created_at > now() - interval '7 days'`;
  return one(`select
    (select count(*)::int from discovery_candidates) companies_found,
    (select count(*)::int from discovery_candidates where ${week}) companies_found_7d,
    (select count(*)::int from discovery_candidates where enriched_at is not null) sites_analysed,
    (select count(*)::int from discovery_candidates where enriched_at is not null and ${week}) sites_analysed_7d,
    (select count(*)::int from discovery_candidates where platform is not null) platforms_detected,
    (select count(*)::int from discovery_candidates where platform is not null and ${week}) platforms_detected_7d,
    (select coalesce(sum(cardinality(emails)), 0)::int from discovery_candidates) emails_found,
    (select coalesce(sum(cardinality(emails)), 0)::int from discovery_candidates where ${week}) emails_found_7d`);
});
route('GET', '/api/discovery/quota', 'api', async () => ({ source: env.discoverySource, used_today: await D.quotaUsed(env.discoverySource), daily_quota: env.discoveryDailyQuota }));
