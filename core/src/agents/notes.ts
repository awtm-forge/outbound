import { z } from 'zod';
import type { AgentDef } from '../lib/ai.ts';
import { j } from './common.ts';

// ---------------- Notes assistant ----------------
// Works only from the page and project text it is given. The result is shown to a person as a preview; nothing it
// returns is written into a page or turned into a task until that person chooses to.
export const NOTES_ACTIONS = ['summarize', 'improve', 'action_items', 'extract_tasks', 'brief', 'checklist'] as const;
const NaIn = z.object({
  action: z.enum(NOTES_ACTIONS), title: z.string().max(200), text: z.string().max(30_000),
  project: z.object({ name: z.string(), description: z.string(), tasks: z.array(z.string()).max(80), milestones: z.array(z.string()).max(30), members: z.array(z.string()).max(30) }),
});
const Section = z.object({ heading: z.string(), text: z.string().default(''), items: z.array(z.string()).default([]) });
const NaOut = z.object({ sections: z.array(Section).min(1).max(8), missing: z.array(z.string()).default([]) });
export type NotesAssistOut = z.infer<typeof NaOut>;
const ASK: Record<(typeof NOTES_ACTIONS)[number], string> = {
  summarize: 'Summarise the page in one short paragraph (heading "Summary") and list its key points (heading "Key points").',
  improve: 'Rewrite the page text to be clearer and shorter without changing its meaning, facts, names, numbers or dates. One section, heading "Improved text", the rewrite in text.',
  action_items: 'List the action items the page states or clearly implies, each as a short imperative line with the owner and date only if the page names them. Heading "Action items".',
  extract_tasks: 'List the distinct pieces of work the page describes, each as a short task title starting with a verb. Heading "Tasks". No duplicates of the project tasks already listed.',
  brief: 'Write a project brief from the project information: sections Objective, Scope, Milestones, Team and Open questions. Use only what is given; where something is not given, say so in "missing".',
  checklist: 'Turn the specification on the page into a checklist of verifiable items. Heading "Checklist".',
};
export const notesAssist: AgentDef<z.infer<typeof NaIn>, NotesAssistOut> = {
  name: 'notes_assist', version: '1.0.0', input: NaIn, output: NaOut,
  system: `You help a small agency team with project notes. ${Object.entries(ASK).map(([k, v]) => `${k}: ${v}`).join(' ')} Return {"sections":[{"heading","text","items"}],"missing":[]}. Never add a price, a date, a name or a promise that is not in the input. List anything the brief needs but the input lacks under "missing".`,
  user: (i) => `Action: ${i.action}\n${j({ title: i.title, page: i.text, project: i.project })}`,
  mock: (i) => {
    const lines = i.text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const sentences = i.text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 3);
    const verbs = /^(add|build|check|create|fix|improve|make|move|review|send|set|test|update|write|ship|call|draft|design|plan|prepare|confirm|book)\b/i;
    const doable = [...new Set([...lines, ...sentences])].filter((l) => verbs.test(l) || /\b(todo|to do|action)\b/i.test(l)).map((l) => l.replace(/^[-*\d.)\s]+/, '')).slice(0, 12);
    switch (i.action) {
      case 'summarize': return { sections: [{ heading: 'Summary', text: sentences.slice(0, 2).join(' ') || 'The page is empty.', items: [] }, { heading: 'Key points', text: '', items: lines.slice(0, 5) }], missing: [] };
      case 'improve': return { sections: [{ heading: 'Improved text', text: lines.join('\n'), items: [] }], missing: [] };
      case 'action_items': return { sections: [{ heading: 'Action items', text: '', items: doable }], missing: doable.length ? [] : ['No action items are stated on the page.'] };
      case 'extract_tasks': return { sections: [{ heading: 'Tasks', text: '', items: doable.filter((d) => !i.project.tasks.includes(d)) }], missing: [] };
      case 'checklist': return { sections: [{ heading: 'Checklist', text: '', items: lines.slice(0, 10) }], missing: [] };
      default: return { sections: [{ heading: 'Objective', text: i.project.description || 'Not stated yet.', items: [] }, { heading: 'Scope', text: '', items: i.project.tasks.slice(0, 8) },
        { heading: 'Milestones', text: '', items: i.project.milestones }, { heading: 'Team', text: '', items: i.project.members }], missing: i.project.description ? [] : ['The project has no description, so the objective is not stated.'] };
    }
  },
};
