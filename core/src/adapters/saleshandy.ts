// Saleshandy adapter for the approved draft pipeline in mock mode. Nothing in here reaches Saleshandy.
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

// The live Saleshandy client is src/saleshandy/client.ts, and every live write goes through src/saleshandy/gateway.ts.
// This mock stays for the approved draft pipeline in mock mode (tests and local runs); it never reaches Saleshandy.
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
export function saleshandy(): Saleshandy { return (instance ??= new MockSaleshandy()); }
