import { scoringConfig } from './config.ts';
export type ScoreInput = Record<string, number>; // criterion key -> awarded points
export function score(input: ScoreInput) {
  const cfg = scoringConfig();
  const breakdown: Record<string, number> = {};
  let total = 0;
  for (const c of cfg.criteria) {
    const v = Math.max(0, Math.min(c.max, Math.round(input[c.key] ?? 0)));
    breakdown[c.key] = v; total += v;
  }
  const verdict = total >= cfg.thresholds.campaign_ready ? 'QUALIFIED' : total >= cfg.thresholds.research_further ? 'RESEARCH_FURTHER' : 'REJECTED';
  return { total, breakdown, verdict } as const;
}
