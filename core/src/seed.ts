// Upserts campaigns and proof assets from config/. Safe to run on every boot.
import { pool, q } from './lib/db.ts';
import { campaignsConfig, proofAssetsConfig } from './lib/config.ts';
import { ensureFirstAdmin } from './lib/auth.ts';
export async function seed() {
  for (const c of campaignsConfig()) await q(`insert into campaigns(code,name,country,region,service_domain,vertical,problem,offer,buyer_titles,sender,compliance,config) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    on conflict (code) do update set name=excluded.name,country=excluded.country,region=excluded.region,service_domain=excluded.service_domain,vertical=excluded.vertical,problem=excluded.problem,offer=excluded.offer,buyer_titles=excluded.buyer_titles,sender=excluded.sender,compliance=excluded.compliance,config=excluded.config`,
    [c.code, c.name, c.country, c.region ?? null, c.service_domain, c.vertical, c.problem, c.offer, c.buyer_titles ?? [], c.sender ?? null, c.compliance ?? {}, c.config ?? {}]);
  for (const p of proofAssetsConfig()) await q(`insert into proof_assets(id,title,kind,label,public_ok,domains,verticals,problems,text,source,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    on conflict (id) do update set title=excluded.title,kind=excluded.kind,label=excluded.label,public_ok=excluded.public_ok,domains=excluded.domains,verticals=excluded.verticals,problems=excluded.problems,text=excluded.text,source=excluded.source,notes=excluded.notes`,
    [p.id, p.title, p.kind, p.label, !!p.public_ok, p.domains ?? [], p.verticals ?? [], p.problems ?? [], p.text, p.source ?? null, p.notes ?? null]);
  await ensureFirstAdmin();
  console.log('seeded', campaignsConfig().length, 'campaigns,', proofAssetsConfig().length, 'proof assets');
}
if (/seed\.[jt]s$/.test(process.argv[1] ?? '')) seed().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
