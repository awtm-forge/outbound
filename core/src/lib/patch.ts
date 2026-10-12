import { one, type Row } from './db.ts';
// UPDATE with only the fields that were sent. Column names come from a zod schema's keys, never from the request.
export async function patchRow(table: string, id: string, fields: Record<string, unknown>, returning = '*'): Promise<Row | undefined> {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return one(`select ${returning} from ${table} where id=$1`, [id]);
  const set = keys.map((k, i) => `${k}=$${i + 2}`).join(', ');
  return one(`update ${table} set ${set} where id=$1 returning ${returning}`, [id, ...keys.map((k) => fields[k])]);
}
