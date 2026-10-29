import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Badge, Empty, Failure, Loading, Spinner, ago, copy, initials, problemLabel } from '../ui/kit.tsx';

// The LinkedIn queue. The system wrote the words and keeps the book; the founder opens the profile, pastes, clicks.
// Nothing on this screen talks to LinkedIn, by design: it is the founders' own profiles and LinkedIn's rules.
const SENDERS = [['ayush', 'Ayush'], ['rahul', 'Rahul']] as const;
const KIND: Record<string, string> = { PERSON: 'Open profile', PERSON_SEARCH: 'Find them', COMPANY_PAGE: 'Company page', SEARCH: 'Find the founder' };
const HOW: Record<string, string> = { PERSON: 'Connect, then Add a note, then paste.', PERSON_SEARCH: 'Their result should be first. Connect is in the row; Add a note; paste.', COMPANY_PAGE: 'Open People on the company page, find the founder or head, Connect, Add a note, paste.', SEARCH: 'Pick the founder from the results, Connect, Add a note, paste.' };
const date = () => new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' });

export function LinkedIn() {
  const { search, go } = useRouter(); const toast = useToast();
  const sender = (search.get('sender') === 'rahul' ? 'rahul' : 'ayush');
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/linkedin/today?sender=${sender}`), [sender]);
  const [building, setBuilding] = useState(false);
  const build = async () => {
    setBuilding(true);
    try { const r = await api.run('/api/linkedin/build', { sender }); toast(r.queued ? `${r.queued} written for today. Read each one before you send it.` : r.already_today >= r.cap ? `Today's ${r.cap} are already in the queue.` : 'Nothing new to add: every company with research is queued or written to.'); reload(true); }
    catch (e: any) { toast(e.message, { err: true }); } finally { setBuilding(false); }
  };
  const items: any[] = data?.items ?? []; const c = data?.counts ?? {};
  const queued = items.filter((i) => i.status === 'QUEUED'); const sent = items.filter((i) => i.status === 'SENT'); const followUps = items.filter((i) => i.status === 'ACCEPTED');
  return (
    <div className="dash-main">
      <div className="hero-row">
        <div className="hero-text"><p className="hero-eyebrow">{date()}</p><h1>LinkedIn</h1>
          <p className="lede">A short list each day, a note written for each person from what we found on their site, and the follow-up ready for when they accept.</p>
          <p className="lede">You open the profile, paste, and click. Nothing here is sent for you, on purpose: these are your own profiles and LinkedIn's rules.</p></div>
        <div className="quote-card"><span className="qm" aria-hidden="true">“</span><p>Say one true thing. Make no the easy answer. Never write twice without a reply.</p></div>
        <div className="quota-card"><span className="qc-ic" aria-hidden="true"><Icon.handshake size={20} /></span>
          <div className="qc-body"><span>{c.sent_today ?? 0} of {data?.cap ?? 25} sent today</span>
            <span className="qc-bar" role="progressbar" aria-label="Sent today" aria-valuemin={0} aria-valuemax={data?.cap ?? 25} aria-valuenow={c.sent_today ?? 0}><i style={{ width: `${Math.min(100, ((c.sent_today ?? 0) / (data?.cap ?? 25)) * 100)}%` }} /></span></div>
          <span className="qc-pct">{c.replied ?? 0} replied</span></div>
      </div>
      <div className="panel toolbar camp-bar" style={{ gap: 12 }}>
        <div className="tabs" role="tablist" aria-label="Whose profile">{SENDERS.map(([k, l]) => <button key={k} role="tab" aria-selected={sender === k} className={sender === k ? 'on' : ''} onClick={() => go(`/linkedin?sender=${k}`, true)}>{l}</button>)}</div>
        <span className="faint" style={{ fontSize: 'var(--fs-0)' }}>{c.sent_all ?? 0} written to so far · {c.follow_ups_due ?? 0} follow-ups due</span>
        <button className="btn primary right" onClick={build} disabled={building}>{building ? <Spinner /> : <Icon.spark size={16} />}{building ? 'Writing notes' : "Write today's notes"}</button>
      </div>
      {loading && !data ? <Loading rows={4} /> : error ? <Failure error={error} retry={reload} /> : <>
        {followUps.length > 0 && <Section title={`They accepted: ${followUps.length} follow-up${followUps.length === 1 ? '' : 's'} to send`} hint="One message, then you stop unless they reply.">{followUps.map((i) => <Card key={i.id} i={i} sender={sender} reload={() => reload(true)} />)}</Section>}
        <Section title={`To send today: ${queued.length}`} hint={queued.length ? 'Open the profile, read the note once, paste it into the connection request.' : undefined}>
          {queued.length ? queued.map((i) => <Card key={i.id} i={i} sender={sender} reload={() => reload(true)} />) : <div className="panel" style={{ padding: 20 }}><Empty title={items.length ? 'All of today’s notes are sent' : 'No notes written for today yet'} action={!items.length ? <button className="btn primary" onClick={build} disabled={building}>Write today’s notes</button> : undefined}>{items.length ? 'Come back tomorrow, or check the follow-ups above.' : 'The best researched companies go first: a named person with a profile before a company page.'}</Empty></div>}
        </Section>
        {sent.length > 0 && <Section title={`Sent today, waiting: ${sent.length}`} hint="Mark accepted, declined or replied as LinkedIn tells you.">{sent.map((i) => <Card key={i.id} i={i} sender={sender} reload={() => reload(true)} />)}</Section>}
      </>}
    </div>
  );
}
const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => <section className="section" style={{ gap: 12 }}><div><h2 style={{ fontSize: 'var(--fs-3)' }}>{title}</h2>{hint && <p className="muted" style={{ marginTop: 4 }}>{hint}</p>}</div>{children}</section>;

function Card({ i, sender, reload }: { i: any; sender: string; reload: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState(i.note); const [fu, setFu] = useState(i.follow_up); const [busy, setBusy] = useState<string | null>(null); const [editing, setEditing] = useState(false);
  useEffect(() => { setNote(i.note); setFu(i.follow_up); }, [i.note, i.follow_up]);
  const edited = note !== i.note || fu !== i.follow_up;
  const act = async (status: string, extra: any = {}) => { setBusy(status); try { if (edited) await api.post(`/api/linkedin/${i.id}/text`, { note, follow_up: fu }); await api.post(`/api/linkedin/${i.id}/status`, { status, ...extra }); reload(); } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(null); } };
  const copyNote = async () => { if (edited) { try { await api.post(`/api/linkedin/${i.id}/text`, { note, follow_up: fu }); } catch (e: any) { toast(e.message, { err: true }); return; } } toast((await copy(i.status === 'ACCEPTED' ? fu : note)) ? 'Copied. Paste it on LinkedIn.' : 'Could not copy.'); };
  const over = note.length > 300;
  return (
    <div className="panel" style={{ padding: 18, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)', gap: 18 }}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row"><span className="avatar">{initials(i.person ?? i.company)}</span><div className="grow"><div style={{ fontWeight: 650 }}>{i.person ?? i.company}</div><div className="muted" style={{ fontSize: 'var(--fs-0)' }}>{i.person ? `${i.person_title ?? 'Role unknown'} · ${i.company}` : 'No named person yet'}</div></div><Badge tone={i.status === 'ACCEPTED' ? 'success' : i.status === 'SENT' ? 'info' : 'neutral'}>{i.status === 'ACCEPTED' ? 'Accepted' : i.status === 'SENT' ? 'Sent' : 'To send'}</Badge></div>
        <div className="row wrap" style={{ gap: 6 }}><a className="btn sm primary" href={i.target_url} target="_blank" rel="noreferrer" onClick={() => { copy(i.status === 'ACCEPTED' ? fu : note).then((ok) => ok && toast('Note copied. On LinkedIn: Connect, Add a note, paste.')); }}><Icon.out size={14} />{KIND[i.target_kind]} and copy</a><Link className="btn sm ghost" to={`/prospects/${i.prospect_id}`}>Profile in app</Link>{i.account_score != null && <Badge tone="neutral">score {i.account_score}</Badge>}{i.primary_problem && <Badge tone="neutral">{problemLabel(i.primary_problem)}</Badge>}</div>
        <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>{HOW[i.target_kind]}</p>
        <div className="notice" style={{ padding: 12 }}><p className="kick ember" style={{ marginBottom: 6 }}>What we noticed</p><p style={{ fontSize: 'var(--fs-0)' }}>{i.specific_observation}</p></div>
        {(i.person_email || i.person_phone) && <p className="faint mono" style={{ fontSize: 12 }}>{[i.person_email, i.person_phone].filter(Boolean).join(' · ')}</p>}
        {i.sent_at && <p className="faint" style={{ fontSize: 'var(--fs-0)' }}>Sent {ago(i.sent_at)}{i.accepted_at ? ` · accepted ${ago(i.accepted_at)}` : ''}</p>}
      </div>
      <div className="col" style={{ gap: 10 }}>
        <div className="row between"><p className="kick">{i.status === 'ACCEPTED' ? 'Follow-up, send once' : 'Connection note'}</p><span className={`mono ${over ? '' : 'faint'}`} style={{ fontSize: 11, color: over ? 'var(--danger)' : undefined }}>{i.status === 'ACCEPTED' ? `${fu.length} characters` : `${note.length} of 300`}</span></div>
        {i.status === 'ACCEPTED'
          ? (editing ? <textarea className="textarea" rows={6} value={fu} onChange={(e) => setFu(e.target.value)} /> : <div className="quote" style={{ borderLeftColor: 'var(--accent-line)' }}>{fu}</div>)
          : (editing ? <textarea className="textarea" rows={4} value={note} onChange={(e) => setNote(e.target.value)} /> : <div className="quote" style={{ borderLeftColor: 'var(--accent-line)' }}>{note}</div>)}
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn" onClick={copyNote} disabled={over}><Icon.copy size={14} />Copy</button>
          <button className="btn ghost" onClick={() => setEditing((v) => !v)}><Icon.edit size={14} />{editing ? 'Done editing' : 'Edit'}</button>
          {i.status === 'QUEUED' && <><button className="btn primary" onClick={() => act('SENT')} disabled={!!busy || over}>{busy === 'SENT' ? <Spinner /> : <Icon.check size={14} />}I sent it</button><button className="btn ghost right" onClick={() => act('SKIPPED', { reason: 'skipped by hand' })} disabled={!!busy}>Skip</button></>}
          {i.status === 'SENT' && <><button className="btn primary" onClick={() => act('ACCEPTED')} disabled={!!busy}>Accepted</button><button className="btn" onClick={() => act('REPLIED')} disabled={!!busy}>Replied</button><button className="btn ghost right" onClick={() => act('DECLINED')} disabled={!!busy}>Declined or ignored</button></>}
          {i.status === 'ACCEPTED' && <><button className="btn primary" onClick={() => act('ACCEPTED', { follow_up_sent: true })} disabled={!!busy}>{busy ? <Spinner /> : <Icon.send size={14} />}I sent the follow-up</button><button className="btn" onClick={() => act('REPLIED')} disabled={!!busy}>They replied</button></>}
        </div>
        <p className="faint" style={{ fontSize: 11 }}>{sender === 'rahul' ? 'Rahul' : 'Ayush'} sends this. If they do not reply after the follow-up, that is the end of it.</p>
      </div>
    </div>
  );
}
