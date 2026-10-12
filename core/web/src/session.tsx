import { createContext, useContext, useEffect, useState } from 'react';
import { api, type Me, type TeamMember } from './api.ts';
// The signed-in person, for pages that show or hide things by role. The server enforces roles regardless.
export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext)!;
export const isAdmin = (me: Me | null) => me?.role === 'admin';

// Everyone on the team, loaded once per page load and shared (assignees, conversations, owners).
let team: Promise<TeamMember[]> | null = null;
export const refreshTeam = () => { team = null; };
export function useTeam() {
  const [list, setList] = useState<TeamMember[]>([]);
  useEffect(() => { let live = true; (team ??= api.get<TeamMember[]>('/api/team').catch(() => { team = null; return []; })).then((t) => { if (live) setList(t); }); return () => { live = false; }; }, []);
  return list;
}
export const nameOf = (list: TeamMember[], id?: string | null) => (id ? list.find((u) => u.id === id)?.name ?? 'Former teammate' : 'Nobody');
