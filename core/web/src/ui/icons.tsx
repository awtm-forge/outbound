// Stroke icons, 18px, currentColor. Drawn here so there is no icon dependency.
const I = ({ d, size = 18 }: { d: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
export const Icon = {
  today: (p: { size?: number }) => <I {...p} d="M4 12h4l3 7 4-14 3 7h2" />,
  find: (p: { size?: number }) => <I {...p} d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 2-4.35-4.35" />,
  review: (p: { size?: number }) => <I {...p} d="M4 6h16M4 12h10M4 18h7m6-3 2 2 4-4" />,
  inbox: (p: { size?: number }) => <I {...p} d="M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6l2-8Z" />,
  pipeline: (p: { size?: number }) => <I {...p} d="M4 5h16M7 12h10M10 19h4" />,
  deals: (p: { size?: number }) => <I {...p} d="M4 7h16v12H4zM9 7V5h6v2M4 12h16" />,
  campaigns: (p: { size?: number }) => <I {...p} d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
  arrow: (p: { size?: number }) => <I {...p} d="M5 12h14m-6-6 6 6-6 6" />,
  back: (p: { size?: number }) => <I {...p} d="M19 12H5m6 6-6-6 6-6" />,
  left: (p: { size?: number }) => <I {...p} d="m15 18-6-6 6-6" />,
  right: (p: { size?: number }) => <I {...p} d="m9 18 6-6-6-6" />,
  check: (p: { size?: number }) => <I {...p} d="m5 12 5 5 9-10" />,
  x: (p: { size?: number }) => <I {...p} d="M6 6l12 12M18 6 6 18" />,
  redo: (p: { size?: number }) => <I {...p} d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  copy: (p: { size?: number }) => <I {...p} d="M8 8h11v11H8zM5 16V5h11" />,
  out: (p: { size?: number }) => <I {...p} d="M14 4h6v6m0-6-9 9M18 14v6H4V6h6" />,
  user: (p: { size?: number }) => <I {...p} d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" />,
  spark: (p: { size?: number }) => <I {...p} d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6" />,
  send: (p: { size?: number }) => <I {...p} d="m4 12 16-8-6 16-2-7-8-1Z" />,
  shield: (p: { size?: number }) => <I {...p} d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" />,
};
