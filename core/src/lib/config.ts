import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './env.ts';
const read = (f: string) => JSON.parse(readFileSync(join(env.configDir, f), 'utf8'));
export type Criterion = { key: string; label: string; max: number };
export type ScoringConfig = { criteria: Criterion[]; thresholds: { campaign_ready: number; research_further: number } };
export type Capabilities = Record<string, { name: string; items: string[]; problems: string[] }>;
// ponytail: read on each call; files are tiny and this makes config edits live without restart
export const scoringConfig = (): ScoringConfig => read('scoring.json');
export const capabilities = (): Capabilities => read('capabilities.json');
export const campaignsConfig = (): any[] => read('campaigns.json');
export const proofAssetsConfig = (): any[] => read('proof_assets.json');
export const PROBLEMS = ['WEBSITE','CONVERSION','UX','SEO','ANALYTICS','PRODUCT','MVP','ENGINEERING','AUTOMATION','AI','BRAND','OTHER'] as const;
export function capabilityForProblem(problem: string): string {
  for (const [k, v] of Object.entries(capabilities())) if (v.problems.includes(problem)) return k;
  return 'UNKNOWN';
}
