// Starting points for new pages. Each one is ordinary editable content, nothing locked or special.
const t = (text: string) => ({ type: 'text', text });
const p = (text = '') => ({ type: 'paragraph', content: text ? [t(text)] : [] });
const h = (level: 1 | 2 | 3, text: string) => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const ul = (...items: string[]) => ({ type: 'bulletList', content: items.map((x) => ({ type: 'listItem', content: [p(x)] })) });
const todo = (...items: string[]) => ({ type: 'taskList', content: items.map((x) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(x)] })) });
const callout = (tone: string, text: string) => ({ type: 'callout', attrs: { tone }, content: [p(text)] });
const table = (head: string[], rows = 2) => ({ type: 'table', content: [
  { type: 'tableRow', content: head.map((x) => ({ type: 'tableHeader', content: [p(x)] })) },
  ...Array.from({ length: rows }, () => ({ type: 'tableRow', content: head.map(() => ({ type: 'tableCell', content: [p()] })) })),
] });
const doc = (...content: any[]) => ({ type: 'doc', content });

export const TEMPLATES: { id: string; title: string; icon: string; hint: string; content: () => any }[] = [
  { id: 'blank', title: 'Blank page', icon: '📄', hint: 'Start from nothing', content: () => doc(p()) },
  { id: 'brief', title: 'Project brief', icon: '🎯', hint: 'Objective, goals, links, questions, tasks', content: () => doc(callout('goal', 'One paragraph: what this project changes for the client, and why now.'), h(2, 'Goals and deliverables'), todo('', ''), h(2, 'Scope'), h(3, 'In'), ul(''), h(3, 'Out'), ul(''), h(2, 'Key links'), table(['Link', 'Address', 'Notes'], 2), h(2, 'People'), table(['Role', 'Name', 'Contact']), callout('ask', 'Open questions'), ul(''), h(2, 'Linked tasks'), { type: 'linkedTasks', attrs: { ids: '' } }) },
  { id: 'meeting', title: 'Meeting notes', icon: '🗓️', hint: 'Agenda, notes, decisions, actions', content: () => doc(p(`Date: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' })}`), p('Attendees: '), h(2, 'Agenda'), ul(''), h(2, 'Notes'), p(), h(2, 'Decisions'), callout('ok', ''), h(2, 'Action items'), todo('')) },
  { id: 'weekly', title: 'Weekly update', icon: '📈', hint: 'Done, next, blocked', content: () => doc(callout('info', 'Overall: on track / needs attention / at risk. One line on why.'), h(2, 'Done this week'), ul(''), h(2, 'Next week'), ul(''), h(2, 'Blocked or at risk'), ul(''), h(2, 'Asks of the client'), ul('')) },
  { id: 'spec', title: 'Technical specification', icon: '🛠️', hint: 'Context, design, plan', content: () => doc(h(2, 'Context'), p(), h(2, 'Goals and non-goals'), ul(''), h(2, 'Proposed design'), p(), { type: 'codeBlock', attrs: { language: null }, content: [] }, h(2, 'Alternatives considered'), ul(''), h(2, 'Rollout'), todo(''), h(2, 'Open questions'), ul('')) },
  { id: 'bug', title: 'Bug report', icon: '🐞', hint: 'Steps, expected, actual', content: () => doc(table(['Where', 'Browser / device', 'Severity'], 1), h(2, 'Steps to reproduce'), { type: 'orderedList', content: [{ type: 'listItem', content: [p('')] }] }, h(2, 'Expected'), p(), h(2, 'Actual'), p(), h(2, 'Screenshots and logs'), p()) },
  { id: 'retro', title: 'Sprint retrospective', icon: '🔁', hint: 'Went well, did not, try next', content: () => doc(h(2, 'What went well'), ul(''), h(2, 'What did not'), ul(''), h(2, 'What we will try next'), todo('')) },
  { id: 'feedback', title: 'Client feedback', icon: '💬', hint: 'What they said, what we do', content: () => doc(p('From: '), p('Received: '), h(2, 'What they said'), { type: 'blockquote', content: [p()] }, h(2, 'What it means'), p(), h(2, 'What we will do'), todo('')) },
  { id: 'sop', title: 'Standard operating procedure', icon: '📋', hint: 'Purpose, steps, checks', content: () => doc(h(2, 'Purpose'), p(), h(2, 'When to use it'), p(), h(2, 'Steps'), { type: 'orderedList', content: [{ type: 'listItem', content: [p('')] }] }, h(2, 'Checks'), todo(''), callout('warn', 'Common mistakes: ')) },
  { id: 'requirements', title: 'Requirements', icon: '🧾', hint: 'Must, should, could', content: () => doc(h(2, 'Problem'), p(), h(2, 'Requirements'), table(['Requirement', 'Priority', 'Status', 'Notes'], 3), h(2, 'Acceptance criteria'), todo(''), h(2, 'Out of scope'), ul('')) },
  { id: 'research', title: 'Research notes', icon: '🔎', hint: 'Question, sources, findings', content: () => doc(callout('goal', 'The question this research answers.'), h(2, 'Sources'), table(['Source', 'Link', 'What it says'], 3), h(2, 'Findings'), ul(''), h(2, 'What we still do not know'), ul(''), h(2, 'Recommendation'), p()) },
  { id: 'checklist', title: 'Checklist', icon: '✅', hint: 'Steps to tick off', content: () => doc(p('What this checklist is for: '), todo('', '', ''), h(3, 'Done when'), p()) },
  { id: 'launch', title: 'Launch checklist', icon: '🚀', hint: 'Before, during, after', content: () => doc(h(2, 'Before launch'), todo('Content reviewed', 'Analytics and UTM tracking verified', 'Forms tested end to end', 'Backups taken'), h(2, 'Launch day'), todo('DNS and SSL checked', 'Smoke test on mobile and desktop', 'Client told'), h(2, 'After launch'), todo('Monitor errors for 48 hours', 'Collect first feedback')) },
];
