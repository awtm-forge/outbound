import { route, redirect } from '../lib/http.ts';
import { q } from '../lib/db.ts';
import { env } from '../lib/env.ts';
import * as D from '../discovery.ts';
import { page, esc } from './dashboard.ts';

// ---- API ----
route('POST', '/api/discovery/searches', 'api', async (c) => D.runSearch(c.body, c.actor, { force: !!c.body.force }));
route('GET', '/api/discovery/searches', 'api', async () => D.listSearches());
route('GET', '/api/discovery/searches/:id', 'api', async (c) => D.getSearch(c.params.id));
route('POST', '/api/discovery/candidates/add', 'api', async (c) => D.addCandidates(c.body.candidate_ids ?? [], c.body.campaign_code, c.actor, { run_chain: c.body.run_chain !== false }));
route('POST', '/api/discovery/candidates/:id/ignore', 'api', async (c) => q(`update discovery_candidates set status='IGNORED' where id=$1 returning id,status`, [c.params.id]));
route('GET', '/api/discovery/quota', 'api', async () => ({ source: env.discoverySource, used_today: await D.quotaUsed(env.discoverySource), daily_quota: env.discoveryDailyQuota }));

// ---- UI ----
const form = (v: Record<string, string> = {}) => `<form method="post" action="/ui/discovery" class="card"><div class="row">
  <label>Industry / what they sell<input type="text" name="industry" value="${esc(v.industry)}" placeholder="consumer electronics brand"></label>
  <label>Location<input type="text" name="location" value="${esc(v.location ?? 'India')}" placeholder="India, Bengaluru"></label>
  <label>Technology<input type="text" name="technology" value="${esc(v.technology)}" placeholder="shopify, wix, woocommerce, framer (optional)"></label>
  <label>Extra keywords<input type="text" name="keywords" value="${esc(v.keywords)}" placeholder='"buy online" headphones (optional)'></label>
  <label>Pages (10 sites each)<input type="text" name="pages" value="${esc(v.pages ?? String(env.discoveryMaxPages))}"></label></div>
  <button class="ok">Search</button> <span class="meta">source: ${esc(env.discoverySource)}</span></form>`;
route('GET', '/ui/discovery', 'dashboard', async () => {
  const list = await D.listSearches(); const used = await D.quotaUsed(env.discoverySource);
  return page('discovery', `<h1><a href="/">ops</a> / discovery</h1><p class="meta">Search source ${esc(env.discoverySource)}: ${used} of ${env.discoveryDailyQuota} queries used today. Each page is one query.</p>${form()}
  <h2>Previous searches</h2><div class="card"><table><tr><th>when</th><th>query</th><th>source</th><th>status</th><th>results</th></tr>${list.map((s) => `<tr><td class="meta">${new Date(s.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td><td><a href="/ui/discovery/${s.id}">${esc([s.query.industry, s.query.keywords, s.query.location, s.query.technology].filter(Boolean).join(' · '))}</a></td><td>${esc(s.source)}</td><td>${esc(s.status)}</td><td>${s.result_count}</td></tr>`).join('') || '<tr><td class="meta">none yet</td></tr>'}</table></div>`);
});
route('POST', '/ui/discovery', 'dashboard', async (c) => { const s = await D.runSearch({ industry: c.body.industry, location: c.body.location, technology: c.body.technology, keywords: c.body.keywords, pages: Number(c.body.pages) || undefined }, c.actor); redirect(c, `/ui/discovery/${s.id}`); });
route('GET', '/ui/discovery/:id', 'dashboard', async (c) => {
  const s = await D.getSearch(c.params.id); const campaigns = await q(`select code,name from campaigns where status='ACTIVE' order by code`);
  const row = (x: any) => `<tr><td><input type="checkbox" name="candidate_ids" value="${x.id}" ${x.status === 'NEW' && x.country_guess !== 'UNKNOWN' ? 'checked' : ''}></td>
    <td><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.domain)}</a><br><span class="meta">${esc(x.title ?? '')}</span></td>
    <td>${x.platform ? `<span class="tag">${esc(x.platform)}</span>` : '<span class="meta">not detected</span>'}<br><span class="meta">${esc(x.platform_signals.filter((p: string) => p !== x.platform).join(', '))}</span></td>
    <td>${x.emails.map((e: string) => `<div>${esc(e)}</div>`).join('') || '<span class="meta">none public</span>'}${x.phones.length ? `<div class="meta">${esc(x.phones.join(', '))}</div>` : ''}</td>
    <td>${x.country_guess}<br><span class="meta">${esc(x.size_estimate)}</span>${x.gstin ? `<br><span class="meta">GST ${esc(x.gstin)}</span>` : ''}</td>
    <td>${[['LinkedIn', x.linkedin_url], ['Instagram', x.instagram_url], ['Facebook', x.facebook_url]].filter(([, u]) => u).map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${n}</a>`).join(' ')}
      <a href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent((x.company_name ?? x.title ?? x.domain).split(/[|\-–:]/)[0] + ' founder')}" target="_blank" rel="noopener">find founder</a></td>
    <td>${x.signals?.trust_signals?.length ? '' : '<span class="tag s">no trust signals</span>'}${x.signals?.has_viewport_meta === false ? '<span class="tag s">no viewport</span>' : ''}${x.signals?.cta_texts?.length === 0 ? '<span class="tag s">no CTA</span>' : ''}${x.signals?.description === false ? '<span class="tag s">no meta description</span>' : ''}</td>
    <td>${x.status === 'ADDED' ? `<span class="tag v">in pipeline</span><br><span class="meta">${esc(x.prospect_status ?? '')} ${x.account_score ?? ''}</span>` : esc(x.status)}</td></tr>`;
  return page('discovery results', `<h1><a href="/">ops</a> / <a href="/ui/discovery">discovery</a> / results</h1>
  <p class="meta">${esc(JSON.stringify(s.query))} · ${esc(s.source)} · ${esc(s.status)}${s.cached ? ' · served from a search run in the last 7 days' : ''}${s.error ? ' · ' + esc(s.error) : ''}</p>
  <form method="post" action="/ui/discovery/${s.id}/add"><div class="card"><table><tr><th></th><th>site</th><th>platform</th><th>public contact</th><th>country / size</th><th>links</th><th>visible problems</th><th>status</th></tr>${s.candidates.map(row).join('') || '<tr><td class="meta" colspan="8">no candidates</td></tr>'}</table></div>
  <div class="card">Add selected to campaign <select name="campaign_code">${campaigns.map((c) => `<option value="${esc(c.code)}">${esc(c.code)}: ${esc(c.name)}</option>`).join('')}</select>
  <label><input type="checkbox" name="run_chain" value="1" checked> research, score and draft immediately</label> <button class="ok">Add to pipeline</button>
  <p class="meta">Each added company runs research, scoring and, at 70 points or more, an email draft that lands in the approval queue. Sites with only a generic inbox (info@, hello@) still need a named decision maker before a draft is allowed.</p></div></form>`);
});
route('POST', '/ui/discovery/:id/add', 'dashboard', async (c) => {
  const ids = ([] as string[]).concat(c.body.candidate_ids ?? []);
  await D.addCandidates(ids, c.body.campaign_code, c.actor, { run_chain: !!c.body.run_chain }); redirect(c, `/ui/discovery/${c.params.id}`);
});
