import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, onUnauthorized } from './api.ts';
// One live feed per browser tab, running whatever screen is open, so the Chat badge is always true. It is a long-poll:
// the server holds each request until something new is visible to you (usually well under a second) or 25 s pass.

export type ChatMessage = { id: string; seq: string; channel_id: string; author_id: string | null; author_name: string | null; body: string; created_at: string; edited_at: string | null; deleted: boolean; pending?: boolean };
export type Channel = { id: string; kind: 'CHANNEL' | 'DIRECT'; name: string | null; topic: string; archived: boolean; created_by: string | null; other: { id: string; name: string; username: string; active: boolean } | null; last_read_seq: string; unread: number; last_at: string | null };
type Ctx = { channels: Channel[]; unread: number; reloadChannels: () => Promise<void>; listen: (fn: (m: ChatMessage[]) => void) => () => void; live: boolean };
const ChatCtx = createContext<Ctx>({ channels: [], unread: 0, reloadChannels: async () => {}, listen: () => () => {}, live: false });
export const useChat = () => useContext(ChatCtx);
export const channelLabel = (c: Channel) => (c.kind === 'DIRECT' ? c.other?.name ?? 'Former teammate' : `#${c.name}`);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [channels, setChannels] = useState<Channel[]>([]); const [live, setLive] = useState(false);
  const listeners = useRef(new Set<(m: ChatMessage[]) => void>());
  const reloadChannels = useCallback(async () => { try { setChannels(await api.get<Channel[]>('/api/chat/channels')); } catch { /* the feed retries */ } }, []);
  useEffect(() => {
    let stop = false; const ctl = new AbortController();
    const off = () => { stop = true; ctl.abort(); }; onUnauthorized.addEventListener('401', off);
    (async () => {
      await reloadChannels();
      let cursor: string | null = null; let backoff = 1000;
      while (!stop) {
        try {
          const res = await fetch(`/api/chat/poll?wait=25${cursor ? `&after=${cursor}` : ''}`, { credentials: 'same-origin', signal: ctl.signal });
          if (res.status === 401) { onUnauthorized.dispatchEvent(new Event('401')); return; }
          if (!res.ok) throw new Error(String(res.status));
          const r: { cursor: string; messages: ChatMessage[] } = await res.json();
          cursor = r.cursor; backoff = 1000; setLive(true);
          if (r.messages.length) { for (const l of listeners.current) l(r.messages); reloadChannels(); }
        } catch {
          if (stop) return;
          setLive(false); await new Promise((ok) => setTimeout(ok, backoff)); backoff = Math.min(backoff * 2, 15_000);
        }
      }
    })();
    // the channel list (new channels, someone's first message to you) also refreshes every minute
    const t = setInterval(reloadChannels, 60_000);
    return () => { off(); clearInterval(t); onUnauthorized.removeEventListener('401', off); };
  }, [reloadChannels]);
  const listen = useCallback((fn: (m: ChatMessage[]) => void) => { listeners.current.add(fn); return () => { listeners.current.delete(fn); }; }, []);
  const unread = channels.reduce((n, c) => n + (c.archived ? 0 : c.unread), 0);
  return <ChatCtx.Provider value={{ channels, unread, reloadChannels, listen, live }}>{children}</ChatCtx.Provider>;
}
