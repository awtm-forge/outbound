// Mock transport: when the integration is not live (no key, or SALESHANDY_MODE is not real) every request is answered
// from the constructed fake account in test/fixtures/saleshandy/account.json, in Saleshandy's envelope. Writes change
// an in-memory copy, so screens behave plausibly. Nothing here ever reaches Saleshandy.
import { readFileSync } from 'node:fs';
import type { Transport } from './client.ts';

const FIXTURE = new URL('../../test/fixtures/saleshandy/account.json', import.meta.url);
let state: any = null;
const load = () => (state ??= JSON.parse(readFileSync(FIXTURE, 'utf8')));
export function resetMock() { state = null; }
let n = 0; const nid = (p: string) => `${p}Mock${Date.now().toString(36)}${++n}`;

const ok = (payload: unknown) => ({ status: 200, headers: {}, text: JSON.stringify({ payload }) });
const notFound = () => ({ status: 404, headers: {}, text: JSON.stringify({ code: 404, type: 'general', message: 'Not found in the fixture set.' }) });
const page = <T>(arr: T[], p: number, size: number) => arr.slice((Math.max(1, p) - 1) * size, Math.max(1, p) * size);
const statsOf = (s: any) => ({ total: s.stats.sent, sent: s.stats.sent, open: s.stats.open, replied: s.stats.replied, clicked: s.stats.clicked, bounced: s.stats.bounced, unsubscribed: s.stats.unsubscribed });

export const mockTransport: Transport = async (r) => {
  const s = load(); const u = new URL(r.url); const p = u.pathname.replace(/^\/api\/open-api/, ''); const q = u.searchParams;
  const b = r.body ? JSON.parse(r.body) : {}; const M = r.method; let m: RegExpMatchArray | null;
  const qp = Number(q.get('page') ?? 1), qs = Number(q.get('pageSize') ?? 25);
  // ---- sequences ----
  if (M === 'GET' && p === '/v1/sequences') { const name = (q.get('sequenceName') ?? '').toLowerCase(); return ok(page(s.sequences.filter((x: any) => !name || x.title.toLowerCase().includes(name)).map(({ stats, ...x }: any) => x), qp, qs)); }
  if (M === 'POST' && p === '/v1/sequences') { const id = nid('seq'); s.sequences.push({ id, title: b.title, active: false, progress: 'draft', stats: { sent: 0, open: 0, replied: 0, clicked: 0, bounced: 0, unsubscribed: 0 } }); s.steps[id] = []; return ok({ sequenceId: id, title: b.title, emailAccountIds: b.emailAccountIds ?? [], scheduleId: b.scheduleId ?? null }); }
  if (M === 'POST' && p === '/v1/sequences/status') { for (const x of s.sequences) if ((b.sequenceIds ?? []).includes(x.id)) { x.progress = b.status; x.active = b.status === 'active'; } return ok({ success: true }); }
  if ((m = p.match(/^\/v1\/sequences\/([^/]+)\/steps$/)) && M === 'GET') return ok(s.steps[m[1]!] ?? []);
  if ((m = p.match(/^\/v1\/sequences\/([^/]+)\/steps\/([^/]+)$/)) && M === 'GET') { const st = (s.steps[m[1]!] ?? []).find((x: any) => x.id === m![2]); return st ? ok({ ...st, variants: [{ subject: st.subject, content: '<p>Fake step content for testing.</p>' }] }) : notFound(); }
  if ((m = p.match(/^\/v1\/sequences\/([^/]+)\/settings$/)) && M === 'GET') { const seq = s.sequences.find((x: any) => x.id === m![1]); return seq ? ok({ settings: [{ id: 'stFake1', code: 1, value: '' }], schedule: s.schedules.find((x: any) => x.id === (seq.scheduleId ?? 'schFake1')), priorityDistribution: { id: 3, name: 'Balanced sending' } }) : notFound(); }
  if ((m = p.match(/^\/v1\/sequences\/([^/]+)\/schedule$/)) && M === 'PATCH') { const seq = s.sequences.find((x: any) => x.id === m![1]); if (!seq) return notFound(); seq.scheduleId = b.scheduleId; return ok(s.schedules.find((x: any) => x.id === b.scheduleId) ?? {}); }
  if ((m = p.match(/^\/v1\/sequences\/([^/]+)\/email-accounts$/)) && M === 'GET') return ok({ emailAccount: s.emailAccounts.slice(0, 2) });
  if ((m = p.match(/^\/v1\/sequences\/([^/]+)\/subsequences$/)) && M === 'GET') return ok([]);
  if ((m = p.match(/^\/v1\/sequences\/([^/]+)\/contacts$/)) && M === 'POST') { for (const pr of s.prospects) if ((b.contactIds ?? []).includes(pr.id) && !pr.sequences.some((x: any) => x.sequenceId === m![1])) pr.sequences.push({ sequenceId: m![1], status: 'active', stepId: b.stepId }); return ok({ success: true }); }
  if ((m = p.match(/^\/v1\/sequences\/([^/]+)\/verify-prospects$/)) && M === 'POST') return ok({ success: true });
  if (M === 'POST' && (p === '/v1/sequences/prospects/import-with-field-name' || p === '/v1/prospects/import-with-field-name')) {
    for (const x of b.prospects ?? []) { const email = String(x.email ?? x.Email ?? '').toLowerCase(); if (!email) continue; let pr = s.prospects.find((y: any) => y.email === email);
      if (!pr) { pr = { id: nid('pr'), email, firstName: x.firstName ?? x['First Name'] ?? '', lastName: x.lastName ?? x['Last Name'] ?? '', company: x.company ?? '', verificationStatus: 'unverified', createdAt: new Date().toISOString(), tags: [], sequences: [] }; s.prospects.push(pr); }
      if (b.sequenceId && !pr.sequences.some((y: any) => y.sequenceId === b.sequenceId)) pr.sequences.push({ sequenceId: b.sequenceId, status: 'active', stepId: b.stepId ?? null }); }
    return ok({ requestId: nid('imp') });
  }
  if ((m = p.match(/^\/v1\/prospects\/import-status\/([^/]+)$/))) return ok({ status: 'completed' });
  // ---- prospects ----
  if (M === 'GET' && p === '/v1/contacts') { const t = (q.get('search') ?? '').toLowerCase(); return ok(page(s.prospects.filter((x: any) => !t || `${x.firstName} ${x.lastName} ${x.email}`.toLowerCase().includes(t)), qp, qs)); }
  if (M === 'PATCH' && p === '/v1/contacts/status') { const pr = s.prospects.find((x: any) => x.id === b.prospectId); const mem = pr?.sequences.find((x: any) => x.sequenceId === b.sequenceId); if (!mem) return notFound(); mem.status = b.status; return ok({ success: true }); }
  if (M === 'GET' && p === '/v1/contacts/tags') return ok(s.tags);
  if (M === 'POST' && (p === '/v1/contacts/tags/assign' || p === '/v1/contacts/tags/un-assign')) {
    const add = p.endsWith('/assign') && !p.endsWith('un-assign');
    for (const x of (Array.isArray(b) ? b : b.prospects ?? [])) { const pr = s.prospects.find((y: any) => y.id === x.prospectId); const tag = s.tags.find((t: any) => t.id === x.tagId)?.name; if (pr && tag) pr.tags = add ? [...new Set([...pr.tags, tag])] : pr.tags.filter((t: string) => t !== tag); }
    return ok({ success: true });
  }
  if ((m = p.match(/^\/v1\/prospects\/([^/]+)\/attribute$/)) && M === 'POST') { const list = b.attributes ?? [{ fieldId: b.fieldId }]; return ok({ results: list.map((x: any) => ({ fieldId: x.fieldId, success: true })) }); }
  if (M === 'GET' && p === '/v1/prospects/attribute') return ok({ value: '' });
  if (M === 'POST' && p === '/v1/prospects/verification-status') return ok((b.emails ?? []).map((e: string) => ({ email: e, status: s.prospects.find((x: any) => x.email === e)?.verificationStatus ?? 'unverified' })));
  // ---- notes ----
  if ((m = p.match(/^\/v1\/prospects\/([^/]+)\/notes$/)) && M === 'GET') { const all = s.notes[m[1]!] ?? []; const skip = Number(q.get('skip') ?? 0), take = Number(q.get('take') ?? 25); return ok({ notes: all.slice(skip, skip + take) }); }
  if (M === 'POST' && p === '/v1/notes') { const results = (b.prospectIds ?? []).map((pid: string) => { const id = nid('nt'); (s.notes[pid] ??= []).unshift({ id, content: b.content, visibility: String(b.visibility ?? '1'), status: String(b.status ?? '1'), createdAt: new Date().toISOString() }); return { prospectId: pid, noteId: id, success: true }; }); return ok({ results }); }
  if ((m = p.match(/^\/v1\/notes\/([^/]+)$/)) && M === 'PATCH') { for (const list of Object.values<any>(s.notes)) for (const x of list) if (x.id === m[1]) { Object.assign(x, b); return ok(x); } return notFound(); }
  // ---- tasks ----
  if (M === 'GET' && p === '/v1/tasks') { const st = q.get('status'); return ok({ task: page(s.tasks.filter((x: any) => !st || x.status === st), qp, qs) }); }
  if (M === 'GET' && p === '/v1/tasks/counts') { const c: Record<string, number> = {}; for (const x of s.tasks) c[x.status] = (c[x.status] ?? 0) + 1; return ok(Object.entries(c).map(([status, count]) => ({ status, count }))); }
  if (M === 'GET' && p === '/v1/tasks/assignee/list') return ok(s.team.map((t: any) => ({ id: t.id, firstName: t.userName, lastName: '', email: t.email })));
  if (M === 'POST' && p === '/v1/tasks/create') { const results = (b.prospectIds ?? []).map((pid: string) => { const pr = s.prospects.find((x: any) => x.id === pid); const id = nid('tk'); s.tasks.push({ id, type: 'custom', status: 'upcoming', priority: Number(b.priority ?? 3), prospectId: pid, prospectName: pr ? `${pr.firstName} ${pr.lastName}` : '', sequenceId: null, sequenceName: null, dueDate: b.dueDate ?? null, note: b.taskNote ?? '', assignee: s.team[0]?.userName }); return { prospectId: pid, taskId: id, success: true }; }); return ok({ results }); }
  if ((m = p.match(/^\/v1\/tasks\/([^/]+)\/(complete|skip|snooze)$/)) && M === 'POST') { const t = s.tasks.find((x: any) => x.id === m![1]); if (!t) return notFound(); t.status = m[2] === 'complete' ? 'completed' : m[2] === 'skip' ? 'skipped' : 'upcoming'; if (m[2] === 'snooze') t.dueDate = String(b.snoozeUntil ?? '').slice(0, 10); return ok({ success: true }); }
  if ((m = p.match(/^\/v1\/tasks\/([^/]+)\/note$/)) && M === 'PATCH') { const t = s.tasks.find((x: any) => x.id === m![1]); if (!t) return notFound(); t.note = b.note; return ok({ success: true }); }
  if (M === 'POST' && (p === '/v1/tasks/bulk-skip' || p === '/v1/tasks/bulk-snooze')) { for (const t of s.tasks) if ((b.taskIds ?? []).includes(t.id)) { if (p.endsWith('skip')) t.status = 'skipped'; else t.dueDate = String(b.snoozeUntil ?? '').slice(0, 10); } return ok({ bulkActionId: nid('bulk') }); }
  if ((m = p.match(/^\/v1\/tasks\/bulk-status\/([^/]+)$/))) return ok({ status: 'completed' });
  if ((m = p.match(/^\/v1\/tasks\/([^/]+)$/)) && M === 'GET') { const t = s.tasks.find((x: any) => x.id === m![1]); return t ? ok(t) : notFound(); }
  // ---- unified inbox ----
  if (M === 'POST' && p === '/v1/unified-inbox/emails') {
    const since = b.startDate ? Date.parse(b.startDate) : 0;
    const items = s.threads.filter((t: any) => Date.parse(t.receivedAt) >= since && (b.isRead === undefined || t.isRead === b.isRead)).map(({ emails, ...t }: any) => t);
    return ok({ items: page(items, Number(b.page ?? 1), Number(b.limit ?? 25)) });
  }
  if ((m = p.match(/^\/v1\/unified-inbox\/emails\/([^/]+)$/)) && M === 'GET') { const t = s.threads.find((x: any) => x.emailThreadId === m![1]); if (!t) return notFound(); t.isRead = 1; return ok(t); }
  if ((m = p.match(/^\/v1\/unified-inbox\/emails\/([^/]+)\/([^/]+)$/)) && M === 'GET') { const t = s.threads.find((x: any) => x.emailThreadId === m![1]); const e = t?.emails.find((x: any) => x.emailId === m![2]); return e ? ok(e) : notFound(); }
  if (M === 'POST' && p === '/v1/unified-inbox/emails/reply') { const t = s.threads.find((x: any) => x.emailThreadId === b.emailThreadId); if (!t) return notFound(); t.emails.push({ emailId: nid('em'), from: 'sender.one@awtmforge.example', to: b.to, sentAt: new Date().toISOString(), subject: `Re: ${t.subject.replace(/^Re: /, '')}`, content: b.content, direction: 'out' }); return ok({ success: true }); }
  if (M === 'GET' && p === '/v1/unified-inbox/outcome') return ok({ items: s.outcomes });
  if (M === 'GET' && p === '/v1/unibox/categories') return ok(s.categories);
  if (M === 'GET' && p === '/v1/unified-inbox/unread-email-threads-count') return ok({ count: s.threads.filter((t: any) => !t.isRead).length });
  // ---- analytics ----
  if (M === 'POST' && p === '/v1/analytics/stats') { const seq = s.sequences.find((x: any) => x.id === b.sequenceId); return seq ? ok(statsOf(seq)) : notFound(); }
  if (M === 'POST' && p === '/v1/analytics/consolidated-stats') return ok(page(s.sequences.filter((x: any) => (b.sequenceIds ?? []).includes(x.id)).map((x: any) => ({ sequenceId: x.id, ...statsOf(x) })), Number(b.pageNum ?? 1), Number(b.pageLimit ?? 25)));
  if (M === 'POST' && p === '/v1/analytics/emailaccount/stats') return ok({ sent: 120, bounced: 1, replied: 6 });
  if (M === 'POST' && p === '/v1/analytics/team/stats') return ok([]);
  // ---- Do Not Contact ----
  if (M === 'GET' && p === '/v1/dnc') return ok(page(s.dncLists, qp, qs));
  if (M === 'GET' && p === '/v1/dnc/item/search') { const t = (q.get('search') ?? '').toLowerCase(); return ok({ dncList: Object.values<any>(s.dncItems).flat().filter((x: any) => !t || x.value.includes(t)) }); }
  if ((m = p.match(/^\/v1\/dnc\/([^/]+)$/)) && M === 'GET') return ok({ dncList: page(s.dncItems[m[1]!] ?? [], qp, qs) });
  if (M === 'POST' && p === '/v1/dnc') { const list = (s.dncItems[b.dncListId] ??= []); for (const v of b.items ?? []) if (!list.some((x: any) => x.value === v)) list.push({ id: nid('dn'), value: String(v).toLowerCase(), type: String(v).includes('@') ? 'email' : 'domain' }); const l = s.dncLists.find((x: any) => x.id === b.dncListId); if (l) l.itemCount = list.length; return ok({ success: true }); }
  // ---- mailboxes, lookups, credits ----
  if (M === 'POST' && p === '/v1/email-accounts') return ok({ emails: page(s.emailAccounts, Number(b.page ?? 1), Number(b.pageSize ?? 25)) });
  if ((m = p.match(/^\/v1\/warmup\/report\/([^/]+)\/([^/]+)$/))) return ok({ sent: 20, landedInInbox: 19, landedInSpam: 1, date: m[2] });
  if (M === 'GET' && p === '/v1/schedules') return ok(s.schedules);
  if (M === 'GET' && p === '/v1/fields') return ok(s.fields);
  if (M === 'GET' && p === '/v1/user/team-member-list') return ok(s.team);
  if (M === 'GET' && p === '/v1/clients') return ok([]);
  if (M === 'GET' && p === '/v1/webhook') return ok({ webhooks: [] });
  if (M === 'GET' && p === '/v1/credits') return ok(s.credits);
  if (M === 'GET' && p === '/v1/enrich/rate-limits') return ok(s.rateLimits);
  if (M === 'POST' && (p === '/v1/enrich/contact' || p === '/v1/enrich/company')) { const asked = (b.linkedin_url ?? b.company_domain ?? b.company_website ?? []).length || 1; s.credits.enrichmentCredits = Math.max(0, s.credits.enrichmentCredits - asked); return ok({ requestId: nid('enr') }); }
  if ((m = p.match(/^\/v1\/enrich\/status\/result\/([^/]+)$/))) return ok({ status: 'completed', results: [{ fake: true, note: 'Fake enrichment result for testing.' }] });
  if ((m = p.match(/^\/v1\/enrich\/status\/([^/]+)$/))) return ok({ status: 'completed' });
  return notFound();
};
