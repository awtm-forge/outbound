import { api } from '../api.ts';
import { useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { Badge, Empty, Failure, Loading, ago, inr, type Tone } from '../ui/kit.tsx';

// Clients and their projects, read from the client portal (dashboard.awtmforge.com). Read-only here, on purpose:
// agreements, invoices and sign-offs stay in the portal, where the evidence rules live. Links open the portal's admin page.
const PHASE: Record<string, [string, Tone]> = { INTAKE: ['Intake', 'neutral'], AGREEMENT: ['Agreement', 'info'], BUILD: ['Building', 'info'], DELIVERY: ['Delivery', 'warning'], LIVE: ['Live', 'success'], DAY30: ['Day 30', 'success'], DONE: ['Done', 'success'], CANCELLED: ['Cancelled', 'danger'] };
const phase = (p: string) => { const [label, tone] = PHASE[p] ?? [p, 'neutral' as Tone]; return <Badge tone={tone}>{label}</Badge>; };

export function Clients() {
  const { data, error, loading, reload } = useLoad(() => api.get('/api/clients'), []);
  const clients: any[] = data?.clients ?? [];
  const live = clients.flatMap((c) => c.projects).filter((p) => !p.cancelledAt && !p.deliveredAt);
  const due = clients.flatMap((c) => c.projects).reduce((a, p) => a + BigInt(p.duePaise ?? '0'), 0n).toString();
  return (
    <div className="dash-main">
      <div className="hero-row">
        <div className="hero-text"><p className="hero-eyebrow">From the client portal</p><h1>Clients</h1>
          <p className="lede">Every client, where each project stands, and what is invoiced and paid. Read here, acted on in the portal.</p></div>
        <div className="quota-card"><span className="qc-ic" aria-hidden="true"><Icon.folder size={20} /></span>
          <div className="qc-body"><span>{clients.length} clients, {live.length} projects in flight</span><span>{inr(due)} invoiced and unpaid</span></div></div>
      </div>
      {loading && !data ? <Loading /> : error ? <Failure error={error.includes('not connected') ? 'The portal is not connected yet. Set PORTAL_API_URL and PORTAL_API_KEY on ops and OPS_API_KEY on the portal.' : error} retry={() => reload(true)} />
        : !clients.length ? <Empty title="No clients in the portal yet">The first one appears here the moment it is created at dashboard.awtmforge.com.</Empty>
        : clients.map((c) => (
          <section className="panel" key={c.id} style={{ marginBottom: 16 }}>
            <div className="toolbar" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div><h2 style={{ margin: 0 }}>{c.businessName}</h2>
                <p className="muted" style={{ margin: '4px 0 0' }}>{[c.contactName, c.contactEmail, c.contactPhone, c.location].filter(Boolean).join(' · ')}{c.intake?.submittedAt ? '' : ' · intake not submitted'}</p></div>
              <a className="btn ghost" href={c.adminUrl} target="_blank" rel="noreferrer">Open in portal <Icon.out size={14} /></a>
            </div>
            {!c.projects.length ? <p className="muted">No project yet.</p> : (
              <table className="table"><thead><tr><th>Project</th><th>Phase</th><th>Agreement</th><th>Paid</th><th>Due</th><th>Last moved</th><th /></tr></thead>
                <tbody>{c.projects.map((p: any) => (
                  <tr key={p.id}><td><strong>{p.name}</strong><br /><span className="muted">{p.typeOfWork}{p.weekCount ? `, ${p.weekCount} weeks` : ''}</span></td>
                    <td>{phase(p.phase)}</td><td>{p.agreement ? inr(p.agreement.totalPaise) + (p.agreementSignedAt ? '' : ' (unsigned)') : 'None yet'}</td>
                    <td>{inr(p.paidPaise)}</td><td>{p.duePaise !== '0' ? <strong>{inr(p.duePaise)}</strong> : '0'}</td><td>{ago(p.lastMovedAt)}</td>
                    <td><a href={p.adminUrl} target="_blank" rel="noreferrer" aria-label={`Open ${p.name} in the portal`}><Icon.out size={14} /></a></td></tr>))}</tbody></table>)}
          </section>))}
      {data?.generatedAt ? <p className="muted">Portal read {ago(data.generatedAt)}. Refreshes every minute.</p> : null}
    </div>
  );
}
