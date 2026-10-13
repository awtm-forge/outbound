// Looks up the fixture's ids through the API so screen URLs are stable across database resets.
export const B = 'http://localhost:8099';
export const ROLES = { admin: ['rahul', 'ui-audit-pass-1'], member: ['meera', 'meera-ui-pass-1'] };
export async function ids() {
  const k = { 'x-api-key': 'ui-audit-key' };
  const g = async (p) => (await fetch(B + p, { headers: k })).json();
  const prospects = await g('/api/prospects?view=active'); const companies = await g('/api/crm/companies');
  const login = await fetch(B + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.88.0.1' }, body: JSON.stringify({ user: 'rahul', password: 'ui-audit-pass-1' }) });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]; const s = async (p) => (await fetch(B + p, { headers: { cookie } })).json();
  const projects = await s('/api/projects'); const proj = projects.find((p) => p.name.startsWith('Kaveri'));
  const detail = await s(`/api/projects/${proj.id}`); const task = detail.task_list.find((t) => t.title.startsWith('Write the brief'));
  const chans = await s('/api/chat/channels'); const people = await s('/api/hr/employees');
  return { prospect: prospects.find((p) => p.contact_name)?.id, prospectNoContact: prospects.find((p) => p.needs_contact)?.id ?? prospects[0].id,
    company: companies.find((c) => c.name === 'Kaveri Foods').id, project: proj.id, task: task.id, general: chans.find((c) => c.name === 'general').id,
    meera: people.find((p) => p.full_name === 'Meera Shah').id };
}
export const screens = (i) => [
  // [name, path, roles]
  ['login', '/', ['signed-out']],
  ['today', '/', ['admin', 'member']],
  ['find', '/find', ['admin']],
  ['review', '/review', ['admin']],
  ['inbox', '/inbox', ['admin']],
  ['pipeline', '/pipeline', ['admin']],
  ['prospect', `/prospects/${i.prospect}`, ['admin']],
  ['deals', '/deals', ['admin']],
  ['campaigns', '/campaigns', ['admin']],
  ['projects', '/projects', ['admin']],
  ['my-tasks', '/projects?view=mine', ['admin', 'member']],
  ['project-board', `/projects/${i.project}`, ['admin']],
  ['task-drawer', `/projects/${i.project}?task=${i.task}`, ['admin']],
  ['wiki', '/wiki', ['admin']],
  ['wiki-page', '/wiki/how-we-run-a-project', ['admin']],
  ['wiki-edit', '/wiki/how-we-run-a-project?edit=1', ['admin']],
  ['wiki-history', '/wiki/how-we-run-a-project?history=1', ['admin']],
  ['wiki-missing', '/wiki/standup-notes', ['admin']],
  ['chat', `/chat/${i.general}`, ['admin']],
  ['crm-companies', '/crm', ['admin']],
  ['crm-people', '/crm?tab=contacts', ['admin']],
  ['crm-opportunities', '/crm?tab=opportunities', ['admin']],
  ['crm-company', `/crm/companies/${i.company}`, ['admin']],
  ['people', '/people', ['admin', 'member']],
  ['people-leave', '/people?tab=leave', ['admin', 'member']],
  ['person', `/people/${i.meera}`, ['admin', 'member']],
  ['team', '/team', ['admin', 'member']],
  ['account', '/account', ['admin']],
  ['not-found', '/nowhere', ['admin']],
];
