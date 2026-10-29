import { z } from 'zod';
import type { AgentDef } from '../lib/ai.ts';
import { CompanyCtx, Confidence, j } from './common.ts';

// ---------------- LinkedIn note (a founder sends it by hand) ----------------
// The connection note is a short, honest reason for connecting; the follow-up is one message after they accept.
// No pitch, no pressure, no flattery, nothing invented. Words that push are refused by the server too.
const In = z.object({
  company: CompanyCtx, person: z.object({ full_name: z.string().nullable(), job_title: z.string().nullable() }),
  observation: z.string(), consequence: z.string().nullable(),
  sender: z.object({ name: z.string(), role: z.string(), city: z.string() }), target_kind: z.enum(['PERSON', 'COMPANY_PAGE', 'SEARCH']),
});
const Out = z.object({ note: z.string(), follow_up: z.string(), why_this_angle: z.string(), confidence: Confidence });
export type LinkedInNoteT = z.infer<typeof Out>;
export const linkedinNote: AgentDef<z.infer<typeof In>, LinkedInNoteT> = {
  name: 'linkedin_note', version: '1.1.0', tier: 'cheap', effort: 'medium', input: In, output: Out,
  system: `You write two short LinkedIn messages for a founder of awtm forge, a small Bengaluru design and engineering studio, to send by hand to another founder or operator. The person reading them is busy and has been pitched a hundred times. The only thing that works, and the only thing allowed, is to be humane: honest, specific, unhurried, easy to say no to.

The connection note (300 characters at most, including spaces):
- One true, specific thing you noticed about their business or site, in plain words, as one peer to another. Never a compliment you cannot back, never "love what you are doing".
- Why you are connecting, in half a sentence. No pitch, no offer, no "we help companies like yours", no link, no meeting ask.
- First name if known; no "Dear", no "Sir", no "Ma'am". Sign with the sender's first name only if there is room.
- If no person is named (a company page or a search), write the note to whoever runs the business, still specific.

The follow-up (450 characters at most), sent once, only after they accept, in the same voice:
- Thank them briefly. Share the observation in one or two sentences and what it may be costing them, as a question or a thought, not a verdict.
- Offer one small, free, specific thing: two written points on their site, no call needed. Make it explicit that a "no thanks" or no reply is completely fine and that you will not follow up again.
- No price, no calendar link, no urgency, no case study, and not one sentence about what awtm forge does or offers. The two written points are the whole offer; the work speaks later, if they ask.

Forbidden anywhere: exclamation marks, emojis, "urgent", "limited", "guarantee", "free audit", "quick call", "hop on", "circle back", "touch base", "synergy", "leverage", "game-changer", "revolutionary", "I'd love to", "just checking in", em dashes. Indian English, short sentences.
Schema: {note, follow_up, why_this_angle, confidence}.`,
  user: (i) => j(i),
  mock: (i) => { const fn = (i.person.full_name ?? '').split(' ')[0]; const note = `${fn ? 'Hi ' + fn + ', ' : 'Hi, '}${i.observation.replace(/\.$/, '')}. I build stores and apps for Indian brands from Bengaluru and would like to follow how ${i.company.name} grows. ${i.sender.name}`.slice(0, 300); return { note, follow_up: `Thanks for connecting. ${i.observation} ${i.consequence ?? ''} If useful, I can write up two specific points on the site, no call needed. If not, no reply is needed and I will not write again. ${i.sender.name}`.slice(0, 450), why_this_angle: 'mock', confidence: 0.5 }; },
};
