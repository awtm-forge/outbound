import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api.ts';
import { useMe, isAdmin } from '../session.tsx';
import { useToast } from './toast.tsx';
import { Modal } from './overlay.tsx';
import { Spinner } from './kit.tsx';

// Every Saleshandy write from the browser goes through here, and from here only to POST /api/sh/actions, where the write
// gateway decides. The classes below only shape what a person sees first; the server enforces all of them again.
//   low: sent at once, with Undo. Undo runs the opposite action where Saleshandy has one; otherwise the write waits
//        5 seconds in the browser, so Undo means it is never sent (closing the page in that window also never sends it).
//   medium: a confirmation naming the target and how many; over 25, the count has to be typed.
//   high: admins only, the exact phrase typed, then held 10 seconds on the server with Undo.
//   spend: admins only, with the estimate and what is left of the month's cap.
export type Risk = 'low' | 'medium' | 'high' | 'spend';
export type ShAction = {
  action: string; input: unknown; risk: Risk;
  target: string;           // in words: "Test Prospect Three", "the sequence Fake sequence: Fashion stores"
  count?: number;           // how many people, sequences or items it touches
  verb?: string;            // the confirm button, e.g. "Pause the sequence"
  phrase?: string;          // high: what has to be typed exactly
  estimate?: number;        // spend: credits it would use, at most
  inverse?: { action: string; input: unknown }; // low: what Undo sends
  done?: string;            // the toast once it is sent
  onSent?: (response: any) => void; // e.g. enrichment hands back a request id
};
type Outcome = { audit_id: string; outcome: 'refused' | 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled'; reason?: string | null; send_at?: string | null; response?: any };
const HOLD_LOW_MS = 5000;

export function useShWrite(after?: () => void) {
  const me = useMe(); const toast = useToast();
  const [ask, setAsk] = useState<(ShAction & { resolve: (ok: boolean) => void }) | null>(null);
  const [held, setHeld] = useState<{ id: string; text: string; until: number; kind: 'server' | 'browser'; stop?: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const afterRef = useRef(after); afterRef.current = after;

  const post = async (action: string, input: unknown) => api.post<Outcome>('/api/sh/actions', { action, input });
  const report = (o: Outcome, a: ShAction) => {
    if (o.outcome === 'sent') { a.onSent?.(o.response); toast(a.done ?? 'Done in Saleshandy.', a.inverse ? { action: { label: 'Undo', run: () => { void post(a.inverse!.action, a.inverse!.input).then((u) => { toast(u.outcome === 'sent' ? 'Undone.' : u.reason ?? 'Could not undo.', { err: u.outcome !== 'sent' }); afterRef.current?.(); }); } } } : undefined); afterRef.current?.(); return true; }
    if (o.outcome === 'pending') { setHeld({ id: o.audit_id, text: a.done ?? 'Sending', until: Date.now() + 10_000, kind: 'server' }); return true; }
    toast(o.reason ?? (o.outcome === 'cancelled' ? 'Cancelled.' : 'Saleshandy did not accept it.'), { err: true }); afterRef.current?.(); return false;
  };
  const send = async (a: ShAction) => { setBusy(true); try { return report(await post(a.action, a.input), a); } catch (e: any) { toast(e.message, { err: true }); return false; } finally { setBusy(false); } };

  async function run(a: ShAction): Promise<boolean> {
    if ((a.risk === 'high' || a.risk === 'spend') && !isAdmin(me)) { toast('Only an admin can do this.', { err: true }); return false; }
    if (a.risk === 'low') {
      if (a.inverse) return send(a);
      // no opposite action in Saleshandy: wait here so Undo can stop it
      return new Promise<boolean>((resolve) => {
        const id = `b${Date.now()}`;
        const t = setTimeout(() => { setHeld((h) => (h?.id === id ? null : h)); void send(a).then(resolve); }, HOLD_LOW_MS);
        setHeld({ id, text: a.done ?? 'Saving', until: Date.now() + HOLD_LOW_MS, kind: 'browser', stop: () => { clearTimeout(t); resolve(false); } });
      });
    }
    const ok = await new Promise<boolean>((resolve) => setAsk({ ...a, resolve }));
    return ok ? send(a) : false;
  }

  const undo = async () => {
    const h = held; if (!h) return; setHeld(null);
    if (h.kind === 'browser') { h.stop?.(); toast('Undone. Nothing was sent.'); return; }
    try { await api.post(`/api/sh/actions/${h.id}/cancel`); toast('Undone. Nothing was sent.'); } catch (e: any) { toast(e.message, { err: true }); }
    afterRef.current?.();
  };
  // the server sends a held write by itself; here it only stops offering Undo and reads the result
  useEffect(() => {
    if (!held || held.kind !== 'server') return;
    const t = setTimeout(() => { setHeld(null); setTimeout(() => afterRef.current?.(), 1500); }, Math.max(0, held.until - Date.now()));
    return () => clearTimeout(t);
  }, [held]);

  const ui = <>
    {ask && <RiskDialog a={ask} close={(ok) => { ask.resolve(ok); setAsk(null); }} />}
    {held && <HeldBar text={held.text} until={held.until} undo={undo} />}
  </>;
  return { run, busy, ui };
}

function HeldBar({ text, until, undo }: { text: string; until: number; undo: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return <div className="toasts" role="status" aria-live="polite" style={{ bottom: 88 }}><div className="toast"><span>{text}. Sending in {left} s.</span><button className="btn sm ghost" onClick={undo}>Undo</button></div></div>;
}

function RiskDialog({ a, close }: { a: ShAction; close: (ok: boolean) => void }) {
  const [typed, setTyped] = useState('');
  const [credits, setCredits] = useState<{ balance: number | null; spent: number; cap: number | null; production: boolean; error: string | null } | null>(null);
  useEffect(() => { if (a.risk === 'spend') api.get('/api/sh/credits').then(setCredits).catch((e) => setCredits({ balance: null, spent: 0, cap: null, production: false, error: e.message })); }, [a.risk]);
  const n = a.count ?? 1;
  const need = a.risk === 'high' ? a.phrase ?? 'confirm' : a.risk === 'medium' && n > 25 ? String(n) : null;
  const ok = !need || typed.trim() === need;
  const left = credits?.cap ? credits.cap - credits.spent : null;
  const over = a.risk === 'spend' && (left == null || (a.estimate ?? 1) > left);
  let body: ReactNode;
  if (a.risk === 'medium') body = <p>This changes {a.target} in Saleshandy{n > 1 ? `: ${n} in all` : ''}.</p>;
  else if (a.risk === 'high') body = <><p>This changes {a.target} in Saleshandy and people outside awtm forge will notice.</p><p className="faint" style={{ marginTop: 8 }}>After you confirm, it waits 10 seconds before it goes, with Undo.</p></>;
  else body = <><p>This spends Saleshandy credits on {a.target}.</p>
    {!credits ? <p className="faint" style={{ marginTop: 8 }}><Spinner /> Reading the credit balance…</p> : <dl className="kv" style={{ marginTop: 12 }}>
      <dt>Estimate</dt><dd>Up to {a.estimate ?? 1} credits</dd>
      <dt>This month</dt><dd>{credits.spent} spent of {credits.cap || 'no cap set'}</dd>
      <dt>Left under the cap</dt><dd>{left ?? 'None: no cap is set, so nothing may spend'}</dd>
      <dt>Balance</dt><dd>{credits.balance ?? (credits.error ? 'Could not be read' : 'Not known')}</dd></dl>}
    {credits && !credits.production && <p className="faint" style={{ marginTop: 8 }}>Outside production every credit-spending call is refused, so this will be refused.</p>}</>;
  return <Modal title={a.risk === 'spend' ? 'Spend credits?' : a.verb ? `${a.verb}?` : 'Change this in Saleshandy?'} onClose={() => close(false)}>
    <form className="col" onSubmit={(e) => { e.preventDefault(); if (ok && !over) close(true); }}>
      <div className="dialog-body">{body}</div>
      {need && <label className="field"><span>{a.risk === 'high' ? <>Type <b className="mono">{need}</b> to confirm</> : <>Type <b>{need}</b>, the number it touches, to confirm</>}</span>
        <input data-autofocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} /></label>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => close(false)}>Cancel</button>
        <button type="submit" className={`btn ${a.risk === 'medium' ? 'primary' : 'danger solid'}`} disabled={!ok || over}>{a.verb ?? 'Confirm'}</button>
      </div>
    </form>
  </Modal>;
}
