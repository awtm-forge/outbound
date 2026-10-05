import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useKeys, useLoad } from '../ui/hooks.ts';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Empty, Failure, Loading, Spinner, ago, classLabel, copy, ProofTag } from '../ui/kit.tsx';
import { countsBus } from '../App.tsx';

export function Inbox() {
  const { search, go } = useRouter();
  const tab = search.get('tab') === 'teardowns' ? 'teardowns' : 'replies';
  const { data, error, loading, reload } = useLoad(() => api.get('/api/inbox'));
  const changed = () => { countsBus.dispatchEvent(new Event('changed')); reload(true); };
  const replies: any[] = data?.replies ?? []; const teardowns: any[] = data?.teardowns ?? [];
  return (
    <div className="page">
      <div className="head"><div><h1>Inbox</h1><p>Replies from Saleshandy, already read and sorted. Nothing here is sent for you: copy the suggested answer, change it, send it yourself.</p></div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'replies'} className={tab === 'replies' ? 'on' : ''} onClick={() => go('/inbox', true)}>Replies {replies.length > 0 && <span className="tag solid" style={{ height: 18 }}>{replies.length}</span>}</button>
          <button role="tab" aria-selected={tab === 'teardowns'} className={tab === 'teardowns' ? 'on' : ''} onClick={() => go('/inbox?tab=teardowns', true)}>Teardowns {teardowns.length > 0 && <span className="tag solid" style={{ height: 18 }}>{teardowns.length}</span>}</button>
        </div></div>
      {loading && !data ? <Loading rows={5} /> : error ? <Failure error={error} retry={reload} /> : tab === 'replies'
        ? <Replies items={replies} changed={changed} openTeardowns={() => go('/inbox?tab=teardowns')} />
        : <Teardowns items={teardowns} changed={changed} />}
    </div>
  );
}

function Replies({ items, changed, openTeardowns }: { items: any[]; changed: () => void; openTeardowns: () => void }) {
  const toast = useToast(); const { go } = useRouter();
  const [id, setId] = useState<string | null>(items[0]?.id ?? null); const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (!items.find((r) => r.id === id)) setId(items[0]?.id ?? null); }, [items, id]);
  const i = items.findIndex((r) => r.id === id); const r = items[i];
  useKeys({ j: () => items[i + 1] && setId(items[i + 1].id), k: () => items[i - 1] && setId(items[i - 1].id), ArrowDown: () => items[i + 1] && setId(items[i + 1].id), ArrowUp: () => items[i - 1] && setId(items[i - 1].id) });
  if (!items.length) return <div className="card"><Empty title="No replies waiting">When someone answers an email, it lands here already read, with a suggested next step.</Empty></div>;
  const act = async (what: 'teardown' | 'handled' | 'meeting' | 'classify') => {
    setBusy(what);
    try {
      if (what === 'teardown') { await api.run(`/api/replies/${r.id}/teardown`); toast('Teardown drafted. Read it before it goes.', { action: { label: 'Open', run: openTeardowns } }); }
      if (what === 'handled') { await api.post(`/api/replies/${r.id}/handled`); toast('Marked as handled.'); }
      if (what === 'classify') { await api.run(`/api/replies/${r.id}/classify`); toast('Reply read again.'); }
      if (what === 'meeting') { const m = await api.post(`/api/prospects/${r.prospect_id}/meeting`, {}); await api.run(`/api/meetings/${m.meeting_id}/brief`); await api.post(`/api/replies/${r.id}/handled`); toast('Meeting created and the brief is ready.', { action: { label: 'Open', run: () => go('/deals') } }); }
      changed();
    } catch (e: any) { toast(e.message, { err: true }); } finally { setBusy(null); }
  };
  return (
    <div className="split">
      <div className="list" role="listbox" aria-label="Replies">{items.map((x) => (
        <button key={x.id} role="option" aria-selected={x.id === id} className={x.id === id ? 'on' : ''} onClick={() => setId(x.id)}>
          <div className="row"><span className={`dot ${x.priority === 'HIGH' ? 'hot' : x.priority === 'MEDIUM' ? 'mid' : ''}`} /><b className="grow ellipsis" style={{ fontWeight: 600 }}>{x.company ?? x.from_email}</b><span className="faint mono" style={{ fontSize: 11 }}>{ago(x.received_at)}</span></div>
          <span className="tag" style={{ alignSelf: 'flex-start' }}>{classLabel(x.classification)}</span>
          <span className="muted ellipsis" style={{ fontSize: 'var(--fs-0)' }}>{x.body}</span>
        </button>))}</div>
      {r && <div className="col" style={{ gap: 'var(--s-4)' }}>
        <div className="card col">
          <div className="row between wrap"><div><div className="co-name" style={{ fontSize: 'var(--fs-4)' }}>{r.company ?? 'Unknown sender'}</div><p className="muted" style={{ marginTop: 4 }}>{r.contact_name ? `${r.contact_name} · ` : ''}{r.from_email} · {ago(r.received_at)}</p></div>
            {r.prospect_id && <Link className="btn sm ghost" to={`/prospects/${r.prospect_id}`}>Profile <Icon.arrow size={14} /></Link>}</div>
          {r.subject && <p className="faint">{r.subject}</p>}
          <div className="quote">{r.body}</div>
        </div>
        <div className="card col">
          <div className="row wrap"><span className="tag solid">{classLabel(r.classification)}</span>{r.confidence != null && <span className="faint mono" style={{ fontSize: 11 }}>{Math.round(Number(r.confidence) * 100)}% sure</span>}<span className="tag right">{r.priority ?? 'MEDIUM'} priority</span>{r.owner && <span className="tag">For {r.owner}</span>}</div>
          <div><p className="kick" style={{ marginBottom: 6 }}>Next step</p><p style={{ fontSize: 'var(--fs-2)', fontWeight: 600 }}>{r.recommended_next_action ?? 'Read it and decide.'}</p></div>
          {r.suggested_reply && <div><div className="row between" style={{ marginBottom: 6 }}><p className="kick">Suggested answer, not sent</p><button className="btn sm" onClick={async () => toast((await copy(r.suggested_reply)) ? 'Copied.' : 'Could not copy.')}><Icon.copy size={14} />Copy</button></div><div className="quote" style={{ borderLeftColor: 'var(--hairline)' }}>{r.suggested_reply}</div></div>}
          <hr className="divider" />
          <div className="row wrap">
            {r.classification === 'VALUE_REQUEST' && (r.teardown_id ? <button className="btn primary" onClick={openTeardowns}><Icon.arrow size={16} />Teardown is drafted</button>
              : <button className="btn primary" onClick={() => act('teardown')} disabled={!!busy}>{busy === 'teardown' ? <Spinner /> : <Icon.spark size={16} />}Draft the two-point teardown</button>)}
            {r.prospect_id && ['POSITIVE', 'PRICE', 'REFERRAL', 'VALUE_REQUEST'].includes(r.classification) && <button className={`btn ${r.classification === 'VALUE_REQUEST' ? '' : 'primary'}`} onClick={() => act('meeting')} disabled={!!busy}>{busy === 'meeting' ? <Spinner /> : <Icon.deals size={16} />}They booked a call</button>}
            {!r.classification && <button className="btn" onClick={() => act('classify')} disabled={!!busy}>Read it again</button>}
            <button className="btn ghost right" onClick={() => act('handled')} disabled={!!busy}>{busy === 'handled' ? <Spinner /> : <Icon.check size={16} />}Handled</button>
          </div>
        </div>
      </div>}
    </div>
  );
}

function Teardowns({ items, changed }: { items: any[]; changed: () => void }) {
  if (!items.length) return <div className="card"><Empty title="No teardowns waiting">When a prospect asks to see the two things, the teardown is drafted from what we found on their site and waits here for you.</Empty></div>;
  return <div className="col" style={{ gap: 'var(--s-5)' }}>{items.map((t) => <Teardown key={t.id} t={t} changed={changed} />)}</div>;
}
function Teardown({ t, changed }: { t: any; changed: () => void }) {
  const toast = useToast(); const [body, setBody] = useState(t.body_original); const [busy, setBusy] = useState<string | null>(null);
  const proofs = useLoad(() => api.get<any[]>('/api/proof-assets'));
  const decide = async (action: 'APPROVE' | 'EDIT' | 'REJECT') => { setBusy(action); try { await api.post(`/api/teardowns/${t.id}/decision`, { action: action === 'APPROVE' && body !== t.body_original ? 'EDIT' : action, body }); toast(action === 'REJECT' ? 'Teardown rejected.' : 'Approved. Copy it into your reply.'); if (action !== 'REJECT') await copy(body); changed(); } catch (e: any) { toast(e.message, { err: true }); setBusy(null); } };
  return (
    <div className="review">
      <div className="ctx">
        <div><div className="co-name" style={{ fontSize: 'var(--fs-4)' }}>{t.company}</div><p className="muted" style={{ marginTop: 4 }}>{t.contact_name ?? ''} · {t.domain} · drafted {ago(t.created_at)}</p></div>
        {t.reply_body && <div><p className="kick" style={{ marginBottom: 6 }}>They wrote</p><div className="quote">{t.reply_body}</div></div>}
        {(t.findings as any[]).map((f, i) => <div key={i} className="notice"><p className="kick ember" style={{ marginBottom: 8 }}>Finding {i + 1}</p><p className="obs" style={{ fontSize: 'var(--fs-2)' }}>{f.observation}</p>
          <p className="why"><b style={{ fontWeight: 600, color: 'var(--ink)' }}>Why it matters.</b> {f.why_it_matters}</p><p className="why"><b style={{ fontWeight: 600, color: 'var(--ink)' }}>What we would test.</b> {f.what_we_would_test}</p><p className="faint mono" style={{ fontSize: 11, marginTop: 8 }}>Evidence: {f.evidence}</p></div>)}
        {t.proof_ids?.length > 0 && <div className="card col"><h2>Proof used</h2>{t.proof_ids.map((id: string) => { const p = proofs.data?.find((x) => x.id === id); return p ? <div key={id} className="proof"><div className="row between"><b style={{ fontWeight: 600 }}>{p.title}</b><ProofTag label={p.label} /></div></div> : null; })}</div>}
      </div>
      <div className="composer">
        <div className="to"><span className="k">Reply</span><span className="grow muted">Paste this into your reply in Saleshandy or Gmail.</span></div>
        <textarea className="body" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Teardown text" />
        <div className="foot">
          <button className="btn primary" onClick={() => decide('APPROVE')} disabled={!!busy}>{busy === 'APPROVE' ? <Spinner /> : <Icon.check size={16} />}{body !== t.body_original ? 'Approve with my edits and copy' : 'Approve and copy'}</button>
          <button className="btn danger" onClick={() => decide('REJECT')} disabled={!!busy}><Icon.x size={16} />Reject</button>
          <span className="right faint mono" style={{ fontSize: 11 }}>{body.trim().split(/\s+/).length} words</span>
        </div>
      </div>
    </div>
  );
}
