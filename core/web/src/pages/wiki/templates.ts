// The wiki's built-in starting points. Each one becomes an ordinary page that anyone can change; nothing is locked.
// Placeholders say what goes where; they never state a fact, a price or a date for the reader.
const t = (text: string) => ({ type: 'text', text });
const b = (text: string) => ({ type: 'text', text, marks: [{ type: 'bold' }] });
const p = (...parts: (string | object)[]) => ({ type: 'paragraph', content: parts.filter((x) => x !== '').map((x) => (typeof x === 'string' ? t(x) : x)) });
const h = (level: 1 | 2 | 3, text: string) => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const ul = (...items: string[]) => ({ type: 'bulletList', content: items.map((x) => ({ type: 'listItem', content: [p(x)] })) });
const ol = (...items: string[]) => ({ type: 'orderedList', content: items.map((x) => ({ type: 'listItem', content: [p(x)] })) });
const todo = (...items: string[]) => ({ type: 'taskList', content: items.map((x) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(x)] })) });
const callout = (tone: string, text: string) => ({ type: 'callout', attrs: { tone }, content: [p(text)] });
const toggle = (summary: string, body: string) => ({ type: 'details', content: [{ type: 'detailsSummary', content: [t(summary)] }, { type: 'detailsContent', content: [p(body)] }] });
const table = (head: string[], rows = 2) => ({ type: 'table', content: [
  { type: 'tableRow', content: head.map((x) => ({ type: 'tableHeader', content: [p(x)] })) },
  ...Array.from({ length: rows }, () => ({ type: 'tableRow', content: head.map(() => ({ type: 'tableCell', content: [p()] })) })),
] });
const hr = { type: 'horizontalRule' };
const toc = { type: 'toc' };
const doc = (...content: any[]) => ({ type: 'doc', content });
const today = () => new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' });

export type Template = { id: string; title: string; icon: string; hint: string; category: string; content: () => any };
export const WIKI_TEMPLATES: Template[] = [
  { id: 'brief', title: 'Project brief', icon: '🎯', hint: 'Goal, scope, people, dates, risks', category: 'Client Delivery', content: () => doc(
    callout('info', 'One paragraph: what this project changes for the client, and why now.'), h(2, 'Goal'), p(), h(2, 'Scope'), h(3, 'In scope'), ul(''), h(3, 'Out of scope'), ul(''),
    h(2, 'People'), table(['Role', 'Name', 'Contact']), h(2, 'Key dates'), table(['Milestone', 'Date', 'Owner']), h(2, 'Risks'), ul(''), h(2, 'Open questions'), todo('')) },
  { id: 'meeting', title: 'Meeting notes', icon: '🗓️', hint: 'Agenda, notes, decisions, actions', category: 'Internal Docs', content: () => doc(
    p(b('Date: '), today()), p(b('Attendees: ')), h(2, 'Agenda'), ol(''), h(2, 'Notes'), p(), h(2, 'Decisions'), callout('ok', ''), h(2, 'Action items'), todo('')) },
  { id: 'playbook', title: 'Outbound email playbook', icon: '📬', hint: 'Who, why, sequence, rules', category: 'Sales & Outreach', content: () => doc(
    toc, h(2, 'Who we write to'), table(['Segment', 'Role', 'Company size', 'Signal that qualifies them']), h(2, 'Why they would reply'), ul(''),
    h(2, 'The sequence'), table(['Step', 'Day', 'Angle', 'Ask'], 3), h(2, 'Rules'), ul('One ask per email.', 'Every claim has a source we can show.', 'No price, date or promise that has not been agreed.'),
    h(2, 'Replies and what we do'), table(['Reply', 'What it means', 'Next step'], 3), callout('warn', 'Never send on someone’s behalf without their review.')) },
  { id: 'onboarding', title: 'Client onboarding checklist', icon: '🤝', hint: 'Access, kickoff, first week', category: 'Client Delivery', content: () => doc(
    p(b('Client: ')), p(b('Start date: ')), h(2, 'Before kickoff'), todo('Contract signed', 'Main contact and backup named', 'Shared channel created', 'Access list collected'),
    h(2, 'Kickoff call'), todo('Goals agreed in writing', 'Success measures agreed', 'Cadence of updates agreed'), h(2, 'First week'), todo('Access confirmed', 'First update sent'), h(2, 'Notes'), p()) },
  { id: 'sop', title: 'Standard operating procedure', icon: '📋', hint: 'Purpose, when, steps, checks', category: 'Processes', content: () => doc(
    table(['Owner', 'Last reviewed', 'Applies to'], 1), h(2, 'Purpose'), p(), h(2, 'When to use it'), p(), h(2, 'Steps'), ol(''), h(2, 'Checks before you finish'), todo(''), callout('warn', 'Common mistakes: ')) },
  { id: 'campaign', title: 'Campaign strategy', icon: '📈', hint: 'Audience, message, plan, measures', category: 'Sales & Outreach', content: () => doc(
    callout('info', 'The one sentence this campaign is about.'), h(2, 'Audience'), p(), h(2, 'Problem we solve for them'), p(), h(2, 'Message and proof'), table(['Claim', 'Proof we can show']),
    h(2, 'Plan'), table(['Week', 'What goes out', 'Owner']), h(2, 'How we will know it worked'), ul(''), h(2, 'What we will not do'), ul('')) },
  { id: 'tech', title: 'Technical documentation', icon: '🛠️', hint: 'Overview, setup, how it works', category: 'Tools & Integrations', content: () => doc(
    toc, h(2, 'Overview'), p(), h(2, 'Setup'), ol(''), { type: 'codeBlock', attrs: { language: null }, content: [] }, h(2, 'How it works'), p(), h(2, 'Configuration'), table(['Setting', 'What it does', 'Default']),
    h(2, 'Troubleshooting'), toggle('Symptom', 'Cause and fix.'), h(2, 'Owners'), p()) },
  { id: 'weekly', title: 'Weekly update', icon: '🗞️', hint: 'Done, next, blocked, asks', category: 'Team', content: () => doc(
    p(b('Week of: '), today()), callout('info', 'Overall: on track / needs attention / at risk. One line on why.'), h(2, 'Done this week'), ul(''), h(2, 'Next week'), ul(''), h(2, 'Blocked or at risk'), ul(''), h(2, 'Asks'), ul('')) },
  { id: 'retro', title: 'Retrospective', icon: '🔁', hint: 'Went well, did not, try next', category: 'Team', content: () => doc(
    p(b('Period: ')), h(2, 'What went well'), ul(''), h(2, 'What did not'), ul(''), h(2, 'What we will try next'), todo(''), hr, h(3, 'Follow-up'), p()) },
  { id: 'faq', title: 'Frequently asked questions', icon: '❓', hint: 'Questions as toggles', category: 'Getting Started', content: () => doc(
    p('Click a question to see its answer. Add new ones at the bottom.'), toggle('Question', 'Answer.'), toggle('Question', 'Answer.'), toggle('Question', 'Answer.')) },
];
export const BLANK: Template = { id: 'blank', title: 'Blank page', icon: '📄', hint: 'Start from nothing', category: '', content: () => doc(p()) };
