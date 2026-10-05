// Saleshandy adapter. Interface + real client (Open API, x-api-key) + mock. Nothing in here sends unless an APPROVED draft is passed in.
import { env } from '../lib/env.ts';
import { log } from '../lib/log.ts';
export type ShProspect = { email: string; first_name?: string; last_name?: string; company?: string; job_title?: string; website?: string; custom?: Record<string, string> };
export type ShSequence = { id: string; name: string };
export interface Saleshandy {
  readonly mode: 'real' | 'mock';
  listSequences(): Promise<ShSequence[]>;
  createSequence(name: string): Promise<ShSequence>;
  addProspectToSequence(sequenceId: string, prospect: ShProspect, firstStep: { subject: string; body: string }): Promise<{ prospect_id: string }>;
  pauseProspect(sequenceId: string, prospectId: string): Promise<void>;
  addToDnc(email: string): Promise<void>;
  listEmailAccounts(): Promise<{ id: string; email: string; warmup?: boolean }[]>;
  sequenceStats(sequenceId: string): Promise<Record<string, number>>;
}

// NOTE: endpoint paths follow Saleshandy's public Open API docs (https://open-api.saleshandy.com). Confirm against the account's
// API docs once a key exists; each call is isolated so a path change is a one-line edit.
class RealSaleshandy implements Saleshandy {
  readonly mode = 'real' as const;
  private async call(method: string, path: string, body?: unknown) {
    const res = await fetch(env.saleshandyBaseUrl + path, { method, headers: { 'content-type': 'application/json', 'x-api-key': env.saleshandyKey }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    if (!res.ok) { log.error('saleshandy error', { path, status: res.status }); throw new Error(`saleshandy ${res.status}: ${text.slice(0, 200)}`); }
    return text ? JSON.parse(text) : {};
  }
  async listSequences() { const j = await this.call('GET', '/sequences'); return (j.data ?? j.sequences ?? j).map((s: any) => ({ id: String(s.id), name: s.name ?? s.title })); }
  async createSequence(name: string) { const j = await this.call('POST', '/sequences', { name }); return { id: String(j.data?.id ?? j.id), name }; }
  async addProspectToSequence(sequenceId: string, p: ShProspect, first: { subject: string; body: string }) {
    // Saleshandy personalises via merge tags; the approved copy is passed as custom fields the sequence step references as {{subject_1}} / {{body_1}}.
    const j = await this.call('POST', `/sequences/${sequenceId}/prospects`, { prospects: [{ email: p.email, firstName: p.first_name, lastName: p.last_name, company: p.company, jobTitle: p.job_title, website: p.website, customFields: { ...p.custom, subject_1: first.subject, body_1: first.body } }] });
    return { prospect_id: String(j.data?.[0]?.id ?? j.data?.id ?? j.id ?? 'unknown') };
  }
  async pauseProspect(sequenceId: string, prospectId: string) { await this.call('POST', `/sequences/${sequenceId}/prospects/${prospectId}/pause`); }
  async addToDnc(email: string) { await this.call('POST', '/dnc', { emails: [email] }); }
  async listEmailAccounts() { const j = await this.call('GET', '/email-accounts'); return (j.data ?? j).map((a: any) => ({ id: String(a.id), email: a.email ?? a.fromEmail, warmup: a.warmupEnabled })); }
  async sequenceStats(sequenceId: string) { const j = await this.call('GET', `/sequences/${sequenceId}/stats`); return j.data ?? j; }
}

export class MockSaleshandy implements Saleshandy {
  readonly mode = 'mock' as const;
  sequences: ShSequence[] = [];
  sent: { sequenceId: string; prospect: ShProspect; subject: string; body: string; prospect_id: string }[] = [];
  paused: string[] = []; dnc: string[] = []; private n = 0;
  async listSequences() { return this.sequences; }
  async createSequence(name: string) { const s = { id: `mock-seq-${++this.n}`, name }; this.sequences.push(s); return s; }
  async addProspectToSequence(sequenceId: string, prospect: ShProspect, first: { subject: string; body: string }) {
    if (this.dnc.includes(prospect.email.toLowerCase())) throw new Error('mock saleshandy: email is on DNC');
    const prospect_id = `mock-pr-${++this.n}`; this.sent.push({ sequenceId, prospect, ...first, prospect_id }); return { prospect_id };
  }
  async pauseProspect(_s: string, prospectId: string) { this.paused.push(prospectId); }
  async addToDnc(email: string) { this.dnc.push(email.toLowerCase()); }
  async listEmailAccounts() { return [{ id: 'mock-acct-1', email: 'ayush@awtmforge.com', warmup: true }]; }
  async sequenceStats(sequenceId: string) { const s = this.sent.filter((x) => x.sequenceId === sequenceId).length; return { sent: s, delivered: s, bounced: 0, replied: 0 }; }
}
let instance: Saleshandy | undefined;
export function saleshandy(): Saleshandy {
  if (!instance) {
    if (env.saleshandyMode === 'real') { if (!env.saleshandyKey) throw new Error('SALESHANDY_API_KEY missing while SALESHANDY_MODE=real'); instance = new RealSaleshandy(); }
    else instance = new MockSaleshandy();
  }
  return instance;
}
