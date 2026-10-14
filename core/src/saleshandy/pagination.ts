// One adapter per paging style Saleshandy uses (see docs/saleshandy/DIAGNOSIS.md). No response carries a total, so a
// page shorter than the page size is the last one. A hard page ceiling stops a misbehaving endpoint from looping.
import { read } from './client.ts';

const MAX_PAGES = 500;
// the list inside a page: a bare array, or the named key, or the usual suspects
export function itemsOf(data: any, key?: string): any[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const k of [key, 'items', 'data', 'results', 'list'].filter(Boolean) as string[]) if (Array.isArray(data[k])) return data[k];
  return [];
}
type Fetch = (page: number) => Promise<any>;
async function* pages(fetchPage: Fetch, size: number, key: string | undefined, first = 1): AsyncGenerator<any[]> {
  for (let page = first, n = 0; n < MAX_PAGES; page++, n++) {
    const items = itemsOf(await fetchPage(page), key);
    if (items.length) yield items;
    if (items.length < size) return;
  }
}
// 1. page and pageSize in the query string: prospects (100), sequences (1000), clients, Do Not Contact, webhooks, outcomes, tasks
export const pageQuery = (path: string, query: Record<string, unknown>, size: number, key?: string) =>
  pages((page) => read.get(path, { ...query, page, pageSize: size }), size, key);
// 2. page and limit in a POST body: unified inbox emails, team analytics
export const pageBodyLimit = (path: string, body: Record<string, unknown>, size: number, key?: string) =>
  pages((page) => read.post(path, { ...body, page, limit: size }), size, key);
// 3. page and pageSize in a POST body: email accounts
export const pageBodySize = (path: string, body: Record<string, unknown>, size: number, key?: string) =>
  pages((page) => read.post(path, { ...body, page, pageSize: size }), size, key);
// 4. pageNum and pageLimit in a POST body: consolidated analytics (10 to 500)
export const pageBodyNum = (path: string, body: Record<string, unknown>, size: number, key?: string) =>
  pages((page) => read.post(path, { ...body, pageNum: page, pageLimit: size }), size, key);
// 5. skip and take in the query string: notes for a prospect
export async function* skipTake(path: string, query: Record<string, unknown>, size: number, key?: string): AsyncGenerator<any[]> {
  for (let skip = 0, n = 0; n < MAX_PAGES; skip += size, n++) {
    const items = itemsOf(await read.get(path, { ...query, skip, take: size }), key);
    if (items.length) yield items;
    if (items.length < size) return;
  }
}
export async function collect(gen: AsyncGenerator<any[]>) { const out: any[] = []; for await (const p of gen) out.push(...p); return out; }
