import { z } from 'zod';
import type { AgentDef } from '../lib/ai.ts';
import { parseTaskLines } from '../lib/taskimport.ts';

// ---------------- Reading a task list the rules could not ----------------
// For a document that is not a table and does not put a status word on each line (a status report written as prose,
// a scanned export with odd spacing). It reads one slice of the document at a time and returns only what the text
// says: a status only when the text states one, an owner or a date only when written. The result is a preview.
const In = z.object({ project: z.string().max(200), lines: z.array(z.string().max(2000)).min(1).max(300) });
const Task = z.object({
  title: z.string().min(1).max(300), status: z.enum(['TODO', 'DOING', 'REVIEW', 'DONE']).nullable(), status_text: z.string().max(60).nullable().default(null),
  assignee: z.string().max(80).nullable().default(null), start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  section: z.string().max(80).nullable().default(null),
});
const Out = z.object({ tasks: z.array(Task).max(400) });
export type ImportAiOut = z.infer<typeof Out>;
export const taskImportAi: AgentDef<z.infer<typeof In>, ImportAiOut> = {
  name: 'task_import', version: '1.0.0', input: In, output: Out,
  system: `You turn a slice of a project's task list into tasks. Return {"tasks":[{"title","status","status_text","assignee","start_date","due_date","section"}]}.
One entry per task the text lists, in the order given, with the task's own wording as the title (no serial numbers). Status: DONE for completed/done/closed/delivered,
DOING for in progress/in process/ongoing/WIP, REVIEW for under review/in review/testing/awaiting approval, TODO for pending/not started/to do/on hold/blocked; null when the text
gives no status for that task. status_text is the exact status words used. assignee only when a person is named for the task. Dates as YYYY-MM-DD only when written in the text.
section is the heading the task sits under, if any. Never invent tasks, statuses, people or dates. Skip page numbers, headers and prose that is not a task.`,
  user: (i) => `Project: ${i.project}\nLines:\n${i.lines.join('\n')}`,
  mock: (i) => ({ tasks: parseTaskLines(i.lines).rows.slice(0, 400).map((r) => ({ title: r.title, status: r.status, status_text: r.status_text, assignee: r.assignee, start_date: r.start_date, due_date: r.due_date, section: r.section })) }),
};
