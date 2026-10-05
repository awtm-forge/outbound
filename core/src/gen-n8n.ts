// Generates the 18 n8n workflow JSON files from one table. Every workflow: trigger -> guard (webhook ones) -> core HTTP calls with retries
// -> respond; every HTTP node's error output -> "Log error" (POST /api/workflow-runs/log-error). Idempotency-Key = n8n execution id + step.
import { writeFileSync, mkdirSync } from 'node:fs';
type Step = { name: string; method?: 'GET' | 'POST'; path: string; body?: string; split?: string; onlyIf?: { left: string; right: string } };
type WF = { name: string; trigger: { webhook: string } | { cron: string }; steps: Step[] };
const H = (name: string) => ({ name, value: `={{ $env.CORE_API_KEY }}` });
const WFS: WF[] = [
  { name: '01_ingest_prospects', trigger: { webhook: 'awtm/ingest' }, steps: [
    { name: 'Bulk ingest', path: '/api/prospects/bulk', body: '={{ { prospects: $json.body.prospects } }}', split: 'results' },
    { name: 'Run chain', path: '=/api/prospects/{{ $json.prospect_id }}/run-chain', body: '={{ { workflow_run_id: null } }}', onlyIf: { left: '={{ $json.ok && $json.created }}', right: 'true' } } ] },
  { name: '02_qualify_accounts', trigger: { webhook: 'awtm/qualify' }, steps: [{ name: 'Qualify', path: '=/api/prospects/{{ $json.body.prospect_id }}/qualify' }] },
  { name: '03_research_account', trigger: { webhook: 'awtm/research' }, steps: [{ name: 'Research', path: '=/api/prospects/{{ $json.body.prospect_id }}/research', body: '={{ { force: $json.body.force || false } }}' }, { name: 'Analyze website', path: '=/api/prospects/{{ $("Webhook").item.json.body.prospect_id }}/analyze-website' }] },
  { name: '04_analyze_website', trigger: { webhook: 'awtm/analyze-website' }, steps: [{ name: 'Analyze website', path: '=/api/prospects/{{ $json.body.prospect_id }}/analyze-website' }] },
  { name: '05_identify_problem', trigger: { webhook: 'awtm/identify-problem' }, steps: [{ name: 'Identify problem', path: '=/api/prospects/{{ $json.body.prospect_id }}/identify-problem' }] },
  { name: '06_generate_email', trigger: { webhook: 'awtm/generate-email' }, steps: [{ name: 'Generate email', path: '=/api/prospects/{{ $json.body.prospect_id }}/generate-email' }] },
  { name: '07_human_approval', trigger: { webhook: 'awtm/approve' }, steps: [{ name: 'Record decision', path: '=/api/drafts/{{ $json.body.draft_id }}/decision', body: '={{ { action: $json.body.action, subject: $json.body.subject, body: $json.body.body, reason: $json.body.reason } }}' }] },
  { name: '08_sync_to_saleshandy', trigger: { cron: '*/15 * * * *' }, steps: [{ name: 'Sync approved drafts', path: '/api/sync/approved' }] },
  { name: '09_receive_saleshandy_webhook', trigger: { webhook: 'awtm/saleshandy' }, steps: [
    { name: 'Forward to core', path: '/webhooks/saleshandy', body: '={{ $json.body }}', split: 'processed' },
    { name: 'Classify reply', path: '=/api/replies/{{ $json.reply_id }}/classify', onlyIf: { left: '={{ !!$json.reply_id }}', right: 'true' } } ] },
  { name: '10_classify_reply', trigger: { webhook: 'awtm/classify-reply' }, steps: [
    { name: 'Classify', path: '=/api/replies/{{ $json.body.reply_id }}/classify' },
    { name: 'Teardown if value request', path: '=/api/replies/{{ $json.reply_id }}/teardown', onlyIf: { left: '={{ $json.classification }}', right: 'VALUE_REQUEST' } } ] },
  { name: '11_generate_teardown', trigger: { webhook: 'awtm/teardown' }, steps: [{ name: 'Teardown', path: '=/api/replies/{{ $json.body.reply_id }}/teardown' }] },
  { name: '12_meeting_brief', trigger: { webhook: 'awtm/meeting-brief' }, steps: [{ name: 'Meeting brief', path: '=/api/meetings/{{ $json.body.meeting_id }}/brief' }] },
  { name: '13_post_meeting', trigger: { webhook: 'awtm/post-meeting' }, steps: [{ name: 'Post-meeting analysis', path: '=/api/meetings/{{ $json.body.meeting_id }}/post-meeting', body: '={{ { notes: $json.body.notes } }}' }] },
  { name: '14_proposal_draft', trigger: { webhook: 'awtm/proposal' }, steps: [{ name: 'Proposal draft', path: '=/api/meetings/{{ $json.body.meeting_id }}/proposal', body: '={{ { business_inputs: $json.body.business_inputs || {} } }}' }] },
  { name: '15_daily_metrics', trigger: { cron: '30 2 * * *' }, steps: [{ name: 'Daily snapshot', path: '/api/metrics/daily-snapshot' }] },   // 08:00 IST
  { name: '16_weekly_campaign_analysis', trigger: { cron: '30 3 * * 1' }, steps: [{ name: 'Weekly analysis', path: '/api/analytics/weekly' }] },
  { name: '17_suppression_handler', trigger: { webhook: 'awtm/suppress' }, steps: [{ name: 'Suppress', path: '/api/suppression', body: '={{ { email: $json.body.email, domain: $json.body.domain, reason: $json.body.reason || "manual", source: "n8n" } }}' }] },
  { name: '18_health_monitor', trigger: { cron: '*/5 * * * *' }, steps: [{ name: 'Health', method: 'GET', path: '/health' }, { name: 'Alert if degraded', path: '/api/workflow-runs/log-error', body: '={{ { workflow: "18_health_monitor", error: "health " + $json.status + " db=" + $json.db } }}', onlyIf: { left: '={{ $json.status }}', right: 'degraded' } }] },
];

function build(w: WF) {
  const nodes: any[] = []; const conn: Record<string, any> = {}; let x = 0;
  const add = (n: any) => { nodes.push({ position: [x += 220, 300], ...n }); return n.name; };
  const link = (from: string, to: string, out = 0) => { (conn[from] ??= { main: [] }).main[out] ??= []; conn[from].main[out].push({ node: to, type: 'main', index: 0 }); };
  const isWebhook = 'webhook' in w.trigger;
  const trig = isWebhook
    ? add({ name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, parameters: { httpMethod: 'POST', path: (w.trigger as any).webhook, responseMode: 'responseNode', options: {} }, webhookId: w.name })
    : add({ name: 'Schedule', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, parameters: { rule: { interval: [{ field: 'cronExpression', expression: (w.trigger as any).cron }] } } });
  const logErr = { name: 'Log error', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [400, 600], parameters: { method: 'POST', url: '={{ $env.CORE_URL }}/api/workflow-runs/log-error', sendHeaders: true, headerParameters: { parameters: [H('X-Api-Key'), { name: 'Idempotency-Key', value: `={{ $execution.id }}-log-error-{{ $itemIndex }}` }] }, sendBody: true, specifyBody: 'json', jsonBody: `={{ { workflow: "${w.name}", execution_id: $execution.id, error: JSON.stringify($json.error || $json), detail: { node: $prevNode.name } } }}`, options: { timeout: 20000 } } };
  nodes.push(logErr);
  let prev = trig;
  if (isWebhook) {
    const guard = add({ name: 'Guard', type: 'n8n-nodes-base.if', typeVersion: 2, parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ id: 'g1', leftValue: '={{ $json.headers["x-api-key"] }}', rightValue: '={{ $env.CORE_API_KEY }}', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, options: {} } });
    const deny = { name: 'Respond 401', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [x, 500], parameters: { respondWith: 'json', responseBody: '={{ { error: "unauthorized" } }}', options: { responseCode: 401 } } }; nodes.push(deny);
    link(prev, guard); link(guard, deny.name, 1); prev = guard;
  }
  for (const s of w.steps) {
    let from = prev;
    if (s.onlyIf) {
      const ifn = add({ name: `If ${s.name}`, type: 'n8n-nodes-base.if', typeVersion: 2, parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ id: 'c1', leftValue: s.onlyIf.left, rightValue: s.onlyIf.right, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, options: {} } });
      link(from, ifn); from = ifn;
    }
    const http = add({ name: s.name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, onError: 'continueErrorOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
      parameters: { method: s.method ?? 'POST', url: s.path.startsWith('=') ? `={{ $env.CORE_URL }}${s.path.slice(1)}` : `={{ $env.CORE_URL }}${s.path}`, sendHeaders: true,
        headerParameters: { parameters: [H('X-Api-Key'), { name: 'Idempotency-Key', value: `={{ $execution.id }}-${s.name.replace(/\W+/g, '-').toLowerCase()}-{{ $itemIndex }}` }, { name: 'X-Actor', value: 'n8n' }] },
        ...(s.method === 'GET' ? {} : { sendBody: true, specifyBody: 'json', jsonBody: s.body ?? '={{ {} }}' }), options: { timeout: 180000 } } });
    link(from, http); link(http, 'Log error', 1);
    prev = http;
    if (s.split) { const sp = add({ name: `Split ${s.split}`, type: 'n8n-nodes-base.splitOut', typeVersion: 1, parameters: { fieldToSplitOut: s.split, options: {} } }); link(prev, sp); prev = sp; }
  }
  if (isWebhook) { const ok = add({ name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, parameters: { respondWith: 'allIncomingItems', options: {} } }); link(prev, ok); }
  return { name: w.name, nodes, connections: conn, settings: { executionOrder: 'v1', saveExecutionProgress: true, saveManualExecutions: true, timezone: 'Asia/Kolkata' }, active: false, tags: [] };
}
const out = new URL('../../n8n/workflows/', import.meta.url).pathname; mkdirSync(out, { recursive: true });
for (const w of WFS) writeFileSync(out + w.name + '.json', JSON.stringify(build(w), null, 1));
console.log('wrote', WFS.length, 'workflows to', out);
