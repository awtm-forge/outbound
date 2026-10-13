import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { Icon } from '../ui/icons.tsx';
import { useToast } from '../ui/toast.tsx';
import { Empty, Failure, Loading, initials } from '../ui/kit.tsx';
import { inline } from '../ui/markdown.tsx';
import { useMe, useTeam } from '../session.tsx';
import { channelLabel, useChat, type Channel, type ChatMessage } from '../chat.tsx';
import { useActive } from '../active.ts';
import { useConfirm } from '../ui/overlay.tsx';

const IST = { timeZone: 'Asia/Kolkata' } as const;
const time = (ts: string) => new Date(ts).toLocaleTimeString('en-IN', { ...IST, hour: 'numeric', minute: '2-digit' });
const dayOf = (ts: string) => new Date(ts).toLocaleDateString('en-CA', IST);
const dayHeading = (ts: string) => { const d = dayOf(ts); const today = new Date().toLocaleDateString('en-CA', IST); const y = new Date(Date.now() - 86400_000).toLocaleDateString('en-CA', IST);
  return d === today ? 'Today' : d === y ? 'Yesterday' : new Date(ts).toLocaleDateString('en-IN', { ...IST, weekday: 'long', day: 'numeric', month: 'long' }); };

export function Chat({ id }: { id?: string }) {
  const { channels, reloadChannels, live } = useChat(); const { go } = useRouter();
  const current = channels.find((c) => c.id === id) ?? null;
  // no conversation chosen: open #general
  useEffect(() => { if (!id && channels.length) go(`/chat/${(channels.find((c) => c.name === 'general') ?? channels[0]!).id}`, true); }, [id, channels]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="page chat-page">
      <div className="chat">
        <Sidebar channels={channels} current={id ?? null} reload={reloadChannels} live={live} />
        {id ? <Conversation key={id} id={id} channel={current} /> : <div className="card"><Loading rows={3} /></div>}
      </div>
    </div>
  );
}

function Sidebar({ channels, current, reload, live }: { channels: Channel[]; current: string | null; reload: () => Promise<void>; live: boolean }) {
  const active = useActive();
  const toast = useToast(); const team = useTeam(); const me = useMe(); const { go } = useRouter();
  const [adding, setAdding] = useState<'channel' | 'direct' | null>(null); const [name, setName] = useState(''); const [showArchived, setShowArchived] = useState(false);
  const open = channels.filter((c) => c.kind === 'CHANNEL' && !c.archived); const archived = channels.filter((c) => c.kind === 'CHANNEL' && c.archived);
  const direct = channels.filter((c) => c.kind === 'DIRECT').sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''));
  const newChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    try { const c = await api.post('/api/chat/channels', { name }); setName(''); setAdding(null); await reload(); go(`/chat/${c.id}`); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const startDirect = async (userId: string) => {
    if (!userId) return;
    try { const c = await api.post('/api/chat/direct', { user_id: userId }); setAdding(null); await reload(); go(`/chat/${c.id}`); } catch (e: any) { toast(e.message, { err: true }); }
  };
  const item = (c: Channel) => <Link key={c.id} to={`/chat/${c.id}`} className={`chan${c.id === current ? ' on' : ''}${c.unread ? ' unread' : ''}`} aria-current={c.id === current ? 'page' : undefined}>
    {c.kind === 'DIRECT' ? <span className="avatar sm" aria-hidden="true">{initials(c.other?.name)}</span> : <span className="hash" aria-hidden="true">#</span>}<span className="ellipsis">{c.kind === 'DIRECT' ? c.other?.name ?? 'Former teammate' : c.name}</span>
    {c.unread > 0 && c.id !== current && <span className="count"><span className="sr">, </span>{c.unread}<span className="sr"> unread</span></span>}</Link>;
  return (
    <aside className="chat-side" aria-label="Conversations">
      <div className="row between"><span className="kick">Channels</span><button className="btn sm ghost" onClick={() => setAdding(adding === 'channel' ? null : 'channel')} aria-label="New channel"><Icon.plus size={14} /></button></div>
      {adding === 'channel' && <form onSubmit={newChannel} className="quickadd"><input className="input" autoFocus placeholder="channel-name" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))} maxLength={40} aria-label="New channel name" /><button className="btn sm">Add</button></form>}
      <nav className="col" style={{ gap: 2 }}>{open.map(item)}</nav>
      <div className="row between" style={{ marginTop: 'var(--s-4)' }}><span className="kick">Direct</span><button className="btn sm ghost" onClick={() => setAdding(adding === 'direct' ? null : 'direct')} aria-label="Message someone"><Icon.plus size={14} /></button></div>
      {adding === 'direct' && <select className="input" autoFocus defaultValue="" onChange={(e) => startDirect(e.target.value)} aria-label="Message someone"><option value="" disabled>Message someone…</option>{team.filter((u) => u.id !== me.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
      <nav className="col" style={{ gap: 2 }}>{direct.length ? direct.map(item) : <span className="faint" style={{ fontSize: 'var(--fs-0)', padding: '4px 8px' }}>No conversations yet.</span>}</nav>
      {archived.length > 0 && <><button className="btn sm ghost" style={{ marginTop: 'var(--s-4)', justifyContent: 'flex-start' }} onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Hide' : 'Show'} archived ({archived.length})</button>{showArchived && <nav className="col" style={{ gap: 2, opacity: 0.7 }}>{archived.map(item)}</nav>}</>}
      <div className="live faint" role="status" title={live ? 'Messages arrive as they are sent' : active ? 'Reconnecting' : 'Resumes when you are back'}><span className={`dot ${live ? 'hot' : ''}`} />{live ? 'Live' : active ? 'Reconnecting…' : 'Paused while you are away'}</div>
    </aside>
  );
}

function Conversation({ id, channel }: { id: string; channel: Channel | null }) {
  const me = useMe(); const toast = useToast(); const ask = useConfirm(); const { listen, reloadChannels } = useChat();
  const [msgs, setMsgs] = useState<Map<string, ChatMessage>>(new Map()); const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(''); const [editing, setEditing] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null); const stick = useRef(true); const box = useRef<HTMLTextAreaElement>(null);
  const merge = useCallback((list: ChatMessage[]) => setMsgs((m) => { const n = new Map(m); for (const x of list) if (x.channel_id === id) { const p = [...n.values()].find((y) => y.pending && y.body === x.body && y.author_id === x.author_id); if (p) n.delete(p.id); n.set(x.id, x); } return n; }), [id]);
  const load = useCallback(async (before?: string) => {
    try {
      const r = await api.get<{ messages: ChatMessage[]; more: boolean }>(`/api/chat/channels/${id}/messages${before ? `?before=${before}` : ''}`);
      if (before) stick.current = false; merge(r.messages); setMore(r.more); setError(null);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [id, merge]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => listen(merge), [listen, merge]);
  const sorted = useMemo(() => [...msgs.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || (BigInt(a.seq || '0') < BigInt(b.seq || '0') ? -1 : 1)), [msgs]);
  const newest = sorted.reduce((mx, m) => (!m.pending && BigInt(m.seq) > mx ? BigInt(m.seq) : mx), 0n);
  // mark as read while the conversation is on screen
  useEffect(() => {
    if (!newest || !channel || BigInt(channel.last_read_seq) >= newest) return;
    const mark = () => { if (document.visibilityState === 'visible') api.post(`/api/chat/channels/${id}/read`, { seq: newest.toString() }).then(reloadChannels).catch(() => {}); };
    mark(); document.addEventListener('visibilitychange', mark); return () => document.removeEventListener('visibilitychange', mark);
  }, [newest, channel?.last_read_seq, id]); // eslint-disable-line react-hooks/exhaustive-deps
  // stay at the bottom unless the reader has scrolled up
  useLayoutEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [sorted.length, sorted.at(-1)?.body]);
  const onScroll = () => { const el = scroller.current!; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
  const send = async () => {
    const body = draft.trim(); if (!body) return;
    const temp: ChatMessage = { id: 'pending-' + crypto.randomUUID(), seq: '', channel_id: id, author_id: me.id, author_name: me.name, body, created_at: new Date().toISOString(), edited_at: null, deleted: false, pending: true };
    stick.current = true; setDraft(''); setMsgs((m) => new Map(m).set(temp.id, temp));
    try { const saved = await api.post<ChatMessage>(`/api/chat/channels/${id}/messages`, { body }); merge([saved]); }
    catch (e: any) { setMsgs((m) => { const n = new Map(m); n.delete(temp.id); return n; }); setDraft(body); toast(e.message, { err: true }); }
  };
  const saveEdit = async (m: ChatMessage, body: string) => { setEditing(null); if (body.trim() === m.body) return; try { merge([await api.patch<ChatMessage>(`/api/chat/messages/${m.id}`, { body })]); } catch (e: any) { toast(e.message, { err: true }); } };
  const remove = async (m: ChatMessage) => {
    const quote = m.body.length > 90 ? `${m.body.slice(0, 90)}…` : m.body;
    if (!(await ask({ title: 'Delete this message?', body: <><p className="quote">{quote}</p><p>It is removed for everyone in the conversation.</p></>, confirm: 'Delete message', tone: 'danger' }))) return;
    try { await api.del(`/api/chat/messages/${m.id}`); merge([{ ...m, body: '', deleted: true }]); toast('Message deleted.'); } catch (e: any) { toast(e.message, { err: true }); } };
  const title = channel ? channelLabel(channel) : '';
  if (error && !sorted.length) return <div className="conv"><Failure error={error} retry={() => load()} /></div>;
  return (
    <section className="conv" aria-label={title}>
      <header className="conv-head"><div className="grow"><h1 style={{ fontSize: 'var(--fs-3)' }}>{title}</h1>{channel?.topic && <p className="muted" style={{ fontSize: 'var(--fs-0)' }}>{channel.topic}</p>}</div>
        {channel?.archived && <span className="tag dim">Archived</span>}</header>
      <div className="msgs" ref={scroller} onScroll={onScroll} aria-live="polite">
        {more && <div style={{ textAlign: 'center' }}><button className="btn sm ghost" onClick={() => load(sorted.filter((m) => !m.pending).reduce<bigint | null>((lo, m) => (lo === null || BigInt(m.seq) < lo ? BigInt(m.seq) : lo), null)?.toString())}>Earlier messages</button></div>}
        {loading && !sorted.length ? <Loading rows={4} /> : !sorted.length ? <Empty title="Nothing here yet">{channel?.kind === 'DIRECT' ? `Say hello to ${channel.other?.name ?? 'them'}.` : 'Be the first to write.'}</Empty> :
          sorted.map((m, i) => {
            const prev = sorted[i - 1]; const newDay = !prev || dayOf(prev.created_at) !== dayOf(m.created_at);
            const grouped = !newDay && prev && prev.author_id === m.author_id && !prev.deleted && +new Date(m.created_at) - +new Date(prev.created_at) < 5 * 60_000;
            const mine = m.author_id === me.id;
            return <Fragment key={m.id}>
              {newDay && <div className="day"><span>{dayHeading(m.created_at)}</span></div>}
              <div className={`msg${grouped ? ' grouped' : ''}${m.pending ? ' pending' : ''}`}>
                {grouped ? <span className="t faint mono">{time(m.created_at)}</span> : <span className="avatar">{initials(m.author_name)}</span>}
                <div className="grow">
                  {!grouped && <div className="who-line"><b>{m.author_name ?? 'Former teammate'}</b><span className="faint mono">{time(m.created_at)}</span></div>}
                  {m.deleted ? <p className="faint" style={{ fontStyle: 'italic' }}>Message deleted</p>
                    : editing === m.id ? <EditBox m={m} onSave={(b) => saveEdit(m, b)} onCancel={() => setEditing(null)} />
                    : <p className="body">{renderBody(m.body, me.user)}{m.edited_at && <span className="faint" style={{ fontSize: 12 }}> (edited)</span>}</p>}
                </div>
                {!m.deleted && !m.pending && (mine || me.role === 'admin') && editing !== m.id && <div className="msg-tools">
                  {mine && <button className="btn sm ghost" onClick={() => setEditing(m.id)} aria-label="Edit message"><Icon.edit size={14} /></button>}
                  <button className="btn sm ghost danger" onClick={() => remove(m)} aria-label="Delete message"><Icon.trash size={14} /></button></div>}
              </div>
            </Fragment>;
          })}
      </div>
      {channel?.archived ? <p className="faint" style={{ padding: 'var(--s-4)' }}>This channel is archived. You can read it, but nobody can write in it.</p> :
        <form className="composer-chat" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea ref={box} rows={1} value={draft} maxLength={4000} placeholder={`Message ${title}`} aria-label={`Message ${title}`} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
          <button className="btn primary" disabled={!draft.trim()} aria-label="Send"><Icon.send size={16} /></button>
        </form>}
    </section>
  );
}
function EditBox({ m, onSave, onCancel }: { m: ChatMessage; onSave: (b: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(m.body);
  return <div className="col" style={{ gap: 6 }}><textarea className="textarea" autoFocus value={v} maxLength={4000} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (v.trim()) onSave(v); } if (e.key === 'Escape') onCancel(); }} />
    <div className="row"><button className="btn sm primary" disabled={!v.trim()} onClick={() => onSave(v)}>Save</button><button className="btn sm ghost" onClick={onCancel}>Cancel</button></div></div>;
}
// Links, `code`, **bold** and *italic* as in the wiki; an @mention of you stands out.
function renderBody(body: string, username: string) {
  return body.split(/(@[A-Za-z0-9._-]+)/).map((part, i) => part.startsWith('@')
    ? <span key={i} className={`mention${part.slice(1).toLowerCase() === username.toLowerCase() ? ' me' : ''}`}>{part}</span>
    : <Fragment key={i}>{part.split('\n').map((line, j) => <Fragment key={j}>{j > 0 && <br />}{inline(line)}</Fragment>)}</Fragment>);
}
