// zod for request bodies, with the first problem said plainly instead of a dump of issues.
import { z } from 'zod';
import { HttpError } from '../pipeline.ts';
export { z };
export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input ?? {});
  if (r.success) return r.data;
  const i = r.error.issues[0]!; const field = i.path.join('.');
  throw new HttpError(400, field ? `${field}: ${i.message}` : i.message);
}
export const uuid = z.string().uuid();
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export function needUuid(s: string, what = 'record') { if (!isUuid(s)) throw new HttpError(404, `${what} not found`); return s; }
// dates arrive as YYYY-MM-DD from <input type=date>; empty means none
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').nullable().optional().or(z.literal('').transform(() => null));
export const text = (max: number) => z.string().trim().max(max);
export const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
