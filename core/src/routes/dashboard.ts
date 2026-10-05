// Internal approval dashboard. Server-rendered HTML, forms post to /ui/*. Functional, not beautiful.
import { route } from '../lib/http.ts';
import { q, one } from '../lib/db.ts';
import * as P from '../pipeline.ts';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:0;padding:16px;max-width:1100px;background:#fafafa;color:#222}h1{font-size:20px}h2{font-size:16px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:4px}
.card{background:#fff;border:1px solid #e3e3e3;border-radius:6px;padding:12px;margin:10px 0}.meta{color:#666;font-size:12px}.row{display:flex;gap:16px;flex-wrap:wrap}.row>*{flex:1;min-width:260px}
textarea,input[type=text]{width:100%;box-sizing:border-box;font:13px/1.4 ui-monospace,monospace;padding:6px}textarea{min-height:200px}button{padding:6px 12px;margin:4px 4px 0 0;cursor:pointer;border-radius:4px;border:1px solid #999;background:#fff}
button.ok{background:#1b7f3b;color:#fff;border-color:#1b7f3b}button.no{background:#b3261e;color:#fff;border-color:#b3261e}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:4px 8px;border-bottom:1px solid #eee;font-size:13px}
.tag{display:inline-block;padding:1px 6px;border-radius:3px;background:#eee;font-size:11px;margin-right:4px}.tag.v{background:#d8f3dc}.tag.s{background:#ffe8cc}pre{white-space:pre-wrap;background:#f4f4f4;padding:8px;border-radius:4px;font-size:12px}</style></head><body>${body}</body></html>`;

route('GET', '/', 'dashboard', async () => {
  const [drafts, replies, teardowns, briefs, proposals, metrics, failures] = await Promise.all([
    q(`select d.*, p.account_score, p.primary_problem, p.specific_observation, p.relevant_proof_ids, p.relevant_capability, co.name company, co.domain, ca.code campaign, ct.email, ct.full_name
       from email_drafts d join prospects p on p.id=d.prospect_id join companies co on co.id=p.company_id left join campaigns ca on ca.id=d.campaign_id left join contacts ct on ct.id=p.contact_id where d.status in ('PENDING_APPROVAL','APPROVED') order by d.status desc, d.created_at`),
    q(`select r.*, co.name company from replies r left join prospects p on p.id=r.prospect_id left join companies co on co.id=p.company_id where r.status in ('NEW','CLASSIFIED') order by case r.priority when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end, r.received_at`),
    q(`select t.*, co.name company from teardowns t join prospects p on p.id=t.prospect_id join companies co on co.id=p.company_id where t.status='PENDING_APPROVAL' order by t.created_at`),
    q(`select m.*, co.name company from meetings m join opportunities o on o.id=m.opportunity_id join companies co on co.id=o.company_id where m.brief is not null and not m.held order by m.scheduled_at nulls last`),
    q(`select pr.*, co.name company from proposals pr join opportunities o on o.id=pr.opportunity_id join companies co on co.id=o.company_id where pr.status in ('DRAFT','PENDING_APPROVAL') order by pr.created_at`),
    P.campaignMetrics(),
    q(`select workflow, error, started_at from workflow_runs where status='FAILED' and started_at > now() - interval '7 days' order by started_at desc limit 10`),
  ]);
  const proofs = Object.fromEntries((await q('select id,title,label from proof_assets')).map((p) => [p.id, p]));
  const pipeline = await q(`select status, count(*) n from prospects group by status order by status`);
  const draftCard = (d: any) => `<div class="card"><div class="row"><div>
    <b>${esc(d.company)}</b> <span class="meta">${esc(d.domain)} · ${esc(d.campaign ?? 'no campaign')} · to ${esc(d.full_name ?? '')} &lt;${esc(d.email ?? 'no email')}&gt;</span><br>
    <span class="tag">score ${d.account_score ?? '?'}</span><span class="tag">${esc(d.primary_problem ?? '?')}</span><span class="tag">${esc(d.relevant_capability ?? '')}</span>
    ${(d.relevant_proof_ids ?? []).map((id: string) => `<span class="tag ${proofs[id]?.label === 'VERIFIED' ? 'v' : 's'}">${esc(proofs[id]?.title ?? id)} [${esc(proofs[id]?.label)}]</span>`).join('')}
    <p class="meta">Observation: ${esc(d.specific_observation)}</p>
    ${d.status === 'APPROVED' ? `<p><b>APPROVED</b> by ${esc(d.approver)} · <form method="post" action="/ui/drafts/${d.id}/sync" style="display:inline"><button class="ok">Sync to Saleshandy now</button></form></p>` : ''}
    </div><div>
    <form method="post" action="/ui/drafts/${d.id}/decision"><input type="text" name="subject" value="${esc(d.subject_final ?? d.subject_original)}"><textarea name="body">${esc(d.body_final ?? d.body_original)}</textarea>
    <input type="text" name="reason" placeholder="reason (for reject / research more)">
    ${d.status === 'PENDING_APPROVAL' ? `<button class="ok" name="action" value="APPROVE">Approve</button><button name="action" value="EDIT">Save edit &amp; approve</button><button class="no" name="action" value="REJECT">Reject</button><button name="action" value="RESEARCH_MORE">Research again</button>` : ''}
    </form></div></div></div>`;
  const body = `<h1>awtm forge outbound ops</h1><p class="meta">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · <a href="/health">health</a> · <a href="/ui/prospects">prospects</a></p>
  <h2>Pipeline</h2><div class="card"><table><tr>${pipeline.map((r) => `<th>${esc(r.status)}</th>`).join('')}</tr><tr>${pipeline.map((r) => `<td>${r.n}</td>`).join('')}</tr></table></div>
  <h2>Emails awaiting approval (${drafts.filter((d) => d.status === 'PENDING_APPROVAL').length}) and approved, not yet synced (${drafts.filter((d) => d.status === 'APPROVED').length})</h2>${drafts.map(draftCard).join('') || '<p class="meta">Nothing waiting.</p>'}
  <h2>Replies awaiting action (${replies.length})</h2>${replies.map((r) => `<div class="card"><b>${esc(r.company ?? r.from_email)}</b> <span class="tag">${esc(r.classification ?? 'unclassified')}</span><span class="tag">${esc(r.priority ?? '')}</span><span class="tag">owner ${esc(r.owner ?? '?')}</span><span class="meta">${esc(r.from_email)} · ${new Date(r.received_at).toLocaleString('en-IN')}</span>
    <pre>${esc(r.body)}</pre>${r.recommended_next_action ? `<p><b>Next:</b> ${esc(r.recommended_next_action)}</p>` : ''}${r.suggested_reply ? `<p><b>Suggested reply (not sent):</b></p><pre>${esc(r.suggested_reply)}</pre>` : ''}
    ${r.classification === 'VALUE_REQUEST' ? `<form method="post" action="/ui/replies/${r.id}/teardown" style="display:inline"><button class="ok">Generate teardown</button></form>` : ''}<form method="post" action="/ui/replies/${r.id}/done" style="display:inline"><button>Mark handled</button></form></div>`).join('') || '<p class="meta">None.</p>'}
  <h2>Teardowns awaiting approval (${teardowns.length})</h2>${teardowns.map((t) => `<div class="card"><b>${esc(t.company)}</b> ${(t.proof_ids ?? []).map((id: string) => `<span class="tag v">${esc(proofs[id]?.title ?? id)}</span>`).join('')}
    <form method="post" action="/ui/teardowns/${t.id}/decision"><textarea name="body">${esc(t.body_original)}</textarea><button class="ok" name="action" value="APPROVE">Approve</button><button name="action" value="EDIT">Save edit &amp; approve</button><button class="no" name="action" value="REJECT">Reject</button></form></div>`).join('') || '<p class="meta">None.</p>'}
  <h2>Meeting briefs (${briefs.length})</h2>${briefs.map((m) => `<div class="card"><b>${esc(m.company)}</b> <span class="meta">${m.scheduled_at ? new Date(m.scheduled_at).toLocaleString('en-IN') : 'unscheduled'}</span><pre>${esc(JSON.stringify(m.brief, null, 2))}</pre></div>`).join('') || '<p class="meta">None.</p>'}
  <h2>Proposal drafts (${proposals.length})</h2>${proposals.map((p) => `<div class="card"><b>${esc(p.company)}</b> <span class="tag">${esc(p.status)}</span><pre>${esc(JSON.stringify(p.draft, null, 2))}</pre></div>`).join('') || '<p class="meta">None.</p>'}
  <h2>Campaign summary</h2><div class="card"><table><tr><th>campaign</th><th>accounts</th><th>qualified</th><th>sent</th><th>replies</th><th>positive</th><th>meetings</th><th>proposals</th><th>wins</th><th>revenue INR</th></tr>
  ${(metrics as any[]).map((c) => `<tr><td>${esc(c.code)}</td><td>${c.accounts_found}</td><td>${c.accounts_qualified}</td><td>${c.emails_sent}</td><td>${c.replies}</td><td>${c.positive_replies}</td><td>${c.meetings_booked}</td><td>${c.proposals}</td><td>${c.wins}</td><td>${(Number(c.revenue_paise) / 100).toLocaleString('en-IN')}</td></tr>`).join('')}</table></div>
  <h2>Workflow failures, last 7 days (${failures.length})</h2>${failures.length ? `<div class="card"><table>${failures.map((f) => `<tr><td>${esc(f.workflow)}</td><td>${esc(f.error)}</td><td class="meta">${new Date(f.started_at).toLocaleString('en-IN')}</td></tr>`).join('')}</table></div>` : '<p class="meta">None.</p>'}`;
  return page('awtm ops', body);
});
route('GET', '/ui/prospects', 'dashboard', async () => {
  const rows = await q(`select p.id,p.status,p.account_score,p.primary_problem,p.suppressed,p.updated_at,c.name,c.domain,ca.code campaign,ct.email from prospects p join companies c on c.id=p.company_id left join campaigns ca on ca.id=p.campaign_id left join contacts ct on ct.id=p.contact_id order by p.updated_at desc limit 300`);
  return page('prospects', `<h1><a href="/">ops</a> / prospects</h1><div class="card"><table><tr><th>company</th><th>campaign</th><th>status</th><th>score</th><th>problem</th><th>email</th><th>updated</th></tr>${rows.map((r) => `<tr><td><a href="/ui/prospects/${r.id}">${esc(r.name)}</a> <span class="meta">${esc(r.domain)}</span></td><td>${esc(r.campaign)}</td><td>${esc(r.status)}${r.suppressed ? ' <span class="tag">SUPPRESSED</span>' : ''}</td><td>${r.account_score ?? ''}</td><td>${esc(r.primary_problem ?? '')}</td><td>${esc(r.email ?? '')}</td><td class="meta">${new Date(r.updated_at).toLocaleString('en-IN')}</td></tr>`).join('')}</table></div>`);
});
route('GET', '/ui/prospects/:id', 'dashboard', async (c) => {
  const p = await P.loadProspect(c.params.id);
  const research = await q('select kind,data,confidence,created_at from research where prospect_id=$1 order by created_at', [p.id]);
  const acts = await q('select * from activities where entity_id=$1 or entity_id in (select id from email_drafts where prospect_id=$1) order by created_at desc limit 50', [p.id]);
  return page(p.company.name, `<h1><a href="/">ops</a> / <a href="/ui/prospects">prospects</a> / ${esc(p.company.name)}</h1>
  <div class="card"><span class="tag">${esc(p.status)}</span><span class="tag">score ${p.account_score ?? '?'}</span><span class="tag">${esc(p.campaign?.code ?? 'no campaign')}</span><pre>${esc(JSON.stringify({ company: p.company, contact: p.contact, score_breakdown: p.score_breakdown, primary_problem: p.primary_problem, specific_observation: p.specific_observation, business_consequence: p.business_consequence, relevant_capability: p.relevant_capability, relevant_proof_ids: p.relevant_proof_ids }, null, 2))}</pre></div>
  ${research.map((r) => `<h2>${esc(r.kind)} <span class="meta">conf ${r.confidence ?? '?'} · ${new Date(r.created_at).toLocaleString('en-IN')}</span></h2><div class="card"><pre>${esc(JSON.stringify(r.data, null, 2))}</pre></div>`).join('')}
  <h2>Audit trail</h2><div class="card"><table>${acts.map((a) => `<tr><td class="meta">${new Date(a.created_at).toLocaleString('en-IN')}</td><td>${esc(a.entity_type)}</td><td><b>${esc(a.action)}</b></td><td>${esc(a.actor)}</td><td class="meta">${esc(JSON.stringify(a.detail))}</td></tr>`).join('')}</table></div>`);
});
