// Compares two network recordings. Any difference in method, path, query, body field names, mutation order, or the set
// of reads per step is reported. usage: node diff.mjs <beforeDir> <afterDir>
import { readdirSync, readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2); let diffs = 0; const lines = [];
for (const f of readdirSync(a).filter((x) => x.endsWith('.json')).sort()) {
  const x = JSON.parse(readFileSync(`${a}/${f}`, 'utf8')); let y; try { y = JSON.parse(readFileSync(`${b}/${f}`, 'utf8')); } catch { lines.push(`${f}: missing in after`); diffs++; continue; }
  const say = (m) => { lines.push(`${x.flow}: ${m}`); diffs++; };
  if (x.steps.length !== y.steps.length) say(`step count ${x.steps.length} vs ${y.steps.length}`);
  x.steps.forEach((s, k) => { const t = y.steps[k]; if (!t) return;
    if (s.error || t.error) say(`step "${s.step}" error: ${s.error ?? '-'} / ${t.error ?? '-'}`);
    if (JSON.stringify(s.writes) !== JSON.stringify(t.writes)) say(`step "${s.step}" mutations differ:\n    before ${JSON.stringify(s.writes)}\n    after  ${JSON.stringify(t.writes)}`);
    if (JSON.stringify(s.reads) !== JSON.stringify(t.reads)) say(`step "${s.step}" reads differ:\n    before ${JSON.stringify(s.reads)}\n    after  ${JSON.stringify(t.reads)}`); });
  if (JSON.stringify(x.background) !== JSON.stringify(y.background)) say(`background reads differ:\n    before ${JSON.stringify(x.background)}\n    after  ${JSON.stringify(y.background)}`);
}
const totals = (d) => readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`${d}/${f}`, 'utf8'))).reduce((t, r) => ({ flows: t.flows + 1, steps: t.steps + r.steps.length, writes: t.writes + r.steps.reduce((n, s) => n + s.writes.length, 0) }), { flows: 0, steps: 0, writes: 0 });
console.log(lines.join('\n')); const t = totals(a); console.log(`${t.flows} flows, ${t.steps} steps, ${t.writes} mutations compared: ${diffs ? diffs + ' difference(s)' : 'no differences'}`);
process.exit(diffs ? 1 : 0);
