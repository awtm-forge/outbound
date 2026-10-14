// Reads the text out of a PDF in the browser (the file itself is never uploaded). Each line comes back as its cells,
// with where each cell starts on the page, so the server can put a cell under the right column even when a PDF table
// leaves empty cells out. Loaded only when someone imports a file.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type Cell = { x: number; t: string };
type Item = { str: string; x: number; y: number; w: number; h: number };
export async function pdfLines(data: ArrayBuffer, onPage?: (n: number, of: number) => void): Promise<{ lines: Cell[][]; pages: number; chars: number }> {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  const lines: Cell[][] = []; let chars = 0; const pages = doc.numPages;
  for (let n = 1; n <= pages; n++) {
    onPage?.(n, pages);
    const page = await doc.getPage(n); const tc = await page.getTextContent();
    const items: Item[] = [];
    for (const it of tc.items as any[]) { if (typeof it.str !== 'string' || !it.str.trim()) continue; const [, , , d, e, f] = it.transform; items.push({ str: it.str, x: e, y: f, w: it.width, h: Math.abs(d) || it.height || 10 }); chars += it.str.length; }
    // rows: items whose baselines sit within a third of the text height of each other, top of the page first
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: Item[][] = [];
    for (const it of items) { const r = rows.find((row) => Math.abs(row[0]!.y - it.y) <= Math.max(2, it.h * 0.35)); if (r) r.push(it); else rows.push([it]); }
    rows.sort((a, b) => b[0]!.y - a[0]!.y);
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      // a gap wider than about half a character height starts a new cell (spaces between words are narrower)
      const cells: Cell[] = []; let end = -Infinity;
      for (const it of row) {
        const gap = it.x - end; const last = cells[cells.length - 1];
        if (last && gap < Math.max(2.5, it.h * 0.55)) last.t += (gap > it.h * 0.15 && !last.t.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
        else cells.push({ x: Math.round(it.x), t: it.str });
        end = it.x + it.w;
      }
      const clean = cells.map((c) => ({ x: c.x, t: c.t.replace(/\s+/g, ' ').trim() })).filter((c) => c.t);
      if (clean.length) lines.push(clean);
    }
    page.cleanup();
  }
  await doc.destroy();
  return { lines, pages, chars };
}
