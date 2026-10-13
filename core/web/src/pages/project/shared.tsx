import { initials } from '../../ui/kit.tsx';
import type { Tone } from '../../ui/kit.tsx';
import { Icon } from '../../ui/icons.tsx';

// Workflow colours are the same in every project, whatever its accent: the accent marks the project, these mark the work.
export const TASK_STATUS: Record<string, string> = { TODO: 'To do', DOING: 'In progress', REVIEW: 'In review', DONE: 'Done' };
export const STATUS_ORDER = ['TODO', 'DOING', 'REVIEW', 'DONE'] as const;
export const STATUS_COLOR: Record<string, string> = { TODO: '#3B82F6', DOING: '#FF922E', REVIEW: '#A855F7', DONE: '#22C55E' };
export const PRIORITY: Record<string, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
export const PRIORITY_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
export const PROJECT_STATUS: Record<string, string> = { ACTIVE: 'Active', ON_HOLD: 'On hold', DONE: 'Done', ARCHIVED: 'Archived' };
export const PROJECT_TONE: Record<string, Tone> = { ACTIVE: 'success', ON_HOLD: 'warning', DONE: 'info', ARCHIVED: 'neutral' };

export type Task = {
  id: string; project_id: string | null; title: string; description: string; status: string; priority: string; assignee_id: string | null; assignee_name: string | null;
  due_date: string | null; start_date: string | null; completed_at: string | null; created_at: string; updated_at: string; column_id: string | null; position: number;
  parent_id: string | null; milestone_id: string | null; labels: string[]; estimate_hours: string | null; actual_hours: string | null; archived_at: string | null;
  comments: number; files: number; subtasks: number; subtasks_done: number; blocked: boolean; collaborator_ids: string[];
};
export type Column = { id: string; name: string; status: string; position: number; wip_limit: number | null };

export const StatusDot = ({ s }: { s: string }) => <span className="sdot" style={{ background: STATUS_COLOR[s] }} aria-hidden="true" />;
export const StatusPill = ({ s }: { s: string }) => <span className="spill" style={{ '--sc': STATUS_COLOR[s] } as React.CSSProperties}><StatusDot s={s} />{TASK_STATUS[s] ?? s}</span>;
export const PriorityPill = ({ p }: { p: string }) => <span className={`prio ${p}`}><Icon.bolt size={11} />{PRIORITY[p] ?? p}</span>;
export const Avatar = ({ name, size = 'sm', title }: { name?: string | null; size?: 'xs' | 'sm' | 'md'; title?: string }) =>
  <span className={`av ${size === 'md' ? '' : size}`} title={title ?? name ?? undefined} aria-hidden={title ? undefined : true}>{initials(name ?? '?')}</span>;
const dd = (d: string) => new Date(d + 'T00:00:00Z');
export const shortDay = (d?: string | null) => (d ? dd(d).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }) : '');
export const daysFrom = (a: string, b: string) => Math.round((dd(b).getTime() - dd(a).getTime()) / 86_400_000);
export const addDays = (d: string, n: number) => { const x = dd(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const fileSize = (n: number) => (n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1_048_576).toFixed(1)} MB`);

const FIELD: Record<string, string> = { start_date: 'start date', due_date: 'due date', milestone_id: 'milestone', parent_id: 'parent task', estimate_hours: 'estimate', actual_hours: 'actual time', owner_id: 'owner', company_id: 'client' };
const fields = (l?: string[]) => (l ?? []).map((f) => FIELD[f] ?? f.replace(/_/g, ' ')).join(', ');
// What an activity row says, in plain words. Every row is a recorded event; nothing here is made up.
export function describe(a: { action: string; detail: any }): { verb: string; what?: string; note?: string; icon: keyof typeof Icon; tone: string } {
  const d = a.detail ?? {}; const t = d.title;
  switch (a.action) {
    case 'project_created': return { verb: 'created this project', icon: 'plus', tone: 'g' };
    case 'project_updated': return { verb: 'updated the project', note: fields(d.fields), icon: 'edit', tone: 'c' };
    case 'project_status': return { verb: `set the project to ${({ ACTIVE: 'Active', ON_HOLD: 'On hold', DONE: 'Done', ARCHIVED: 'Archived' } as any)[d.to] ?? d.to}`, icon: 'flag', tone: 'y' };
    case 'project_color': return { verb: d.color ? `changed the project colour to ${d.color}` : 'reset the project colour', icon: 'palette', tone: 'p' };
    case 'member_added': return { verb: 'added', what: d.member, note: 'to the team', icon: 'people', tone: 'g' };
    case 'member_removed': return { verb: 'removed', what: d.member, note: 'from the team', icon: 'people', tone: 'y' };
    case 'link_added': return { verb: 'added the link', what: t, icon: 'out', tone: 'c' };
    case 'link_removed': return { verb: 'removed the link', what: t, icon: 'out', tone: 'y' };
    case 'column_added': return { verb: 'added the column', what: d.column, icon: 'layers', tone: 'c' };
    case 'column_renamed': return { verb: 'renamed a column', what: `${d.from} to ${d.to}`, icon: 'layers', tone: 'c' };
    case 'column_removed': return { verb: 'removed the column', what: d.column, icon: 'layers', tone: 'y' };
    case 'milestone_added': return { verb: 'added the milestone', what: d.milestone, icon: 'target', tone: 'p' };
    case 'milestone_updated': return { verb: 'updated the milestone', what: d.milestone, icon: 'target', tone: 'p' };
    case 'milestone_done': return { verb: 'reached the milestone', what: d.milestone, icon: 'trophy', tone: 'g' };
    case 'milestone_removed': return { verb: 'removed the milestone', what: d.milestone, icon: 'target', tone: 'y' };
    case 'task_created': return { verb: 'created', what: t, icon: 'plus', tone: 'g' };
    case 'subtask_created': return { verb: 'added the subtask', what: t, icon: 'plus', tone: 'g' };
    case 'task_moved': return { verb: 'moved', what: t, note: `from ${d.from} to ${d.to}`, icon: 'arrow', tone: 'o' };
    case 'task_completed': return { verb: 'completed', what: t, icon: 'checkCircle', tone: 'g' };
    case 'task_assigned': return { verb: d.to ? 'assigned' : 'unassigned', what: t, note: d.to ? `to ${d.to}` : undefined, icon: 'user', tone: 'c' };
    case 'task_due': return { verb: d.to ? 'set the due date of' : 'cleared the due date of', what: t, note: d.to ? `to ${shortDay(d.to)}` : undefined, icon: 'calendar', tone: 'y' };
    case 'task_updated': return { verb: 'updated', what: t, note: fields(d.fields), icon: 'edit', tone: 'c' };
    case 'task_deleted': return { verb: 'deleted', what: t, icon: 'trash', tone: 'r' };
    case 'tasks_deleted': return { verb: `deleted ${d.count} tasks`, icon: 'trash', tone: 'r' };
    case 'task_archived': return { verb: 'archived', what: t, icon: 'file', tone: 'y' };
    case 'task_restored': return { verb: 'restored', what: t, icon: 'redo', tone: 'g' };
    case 'dependency_added': return { verb: 'made', what: t, note: `wait on “${d.other}”`, icon: 'lock', tone: 'r' };
    case 'relation_added': return { verb: 'linked', what: t, note: `to “${d.other}”`, icon: 'layers', tone: 'c' };
    case 'dependency_removed': return { verb: 'removed a dependency from', what: t, icon: 'lock', tone: 'y' };
    case 'comment_added': return { verb: 'commented on', what: t, note: d.excerpt ? `“${d.excerpt}”` : undefined, icon: 'message', tone: 'c' };
    case 'page_comment': return { verb: 'commented on the page', what: t, note: d.excerpt ? `“${d.excerpt}”` : undefined, icon: 'message', tone: 'c' };
    case 'file_uploaded': return { verb: 'uploaded', what: d.name, icon: 'file', tone: 'p' };
    case 'file_renamed': return { verb: 'renamed a file', what: `${d.from} to ${d.to}`, icon: 'file', tone: 'p' };
    case 'file_removed': return { verb: 'deleted the file', what: d.name, icon: 'trash', tone: 'r' };
    case 'page_created': return { verb: 'created the page', what: t, icon: 'wiki', tone: 'g' };
    case 'page_edited': return { verb: 'edited the page', what: t, icon: 'wiki', tone: 'c' };
    case 'page_moved': return { verb: 'moved the page', what: t, icon: 'wiki', tone: 'c' };
    case 'page_archived': return { verb: 'archived the page', what: t, icon: 'wiki', tone: 'y' };
    case 'page_restored': return { verb: 'restored the page', what: t, icon: 'wiki', tone: 'g' };
    case 'page_deleted': return { verb: 'deleted the page', what: t, icon: 'trash', tone: 'r' };
    default: return { verb: a.action.replace(/_/g, ' '), what: t, icon: 'clock', tone: 'c' };
  }
}
