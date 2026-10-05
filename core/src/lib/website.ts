// Fetch a public home page and reduce it to a structural snapshot. No metrics are measured; only structure is observed.
import type { SiteSnapshotT } from '../agents/research.ts';
const PLATFORMS: [RegExp, string][] = [[/cdn\.shopify\.com|Shopify\.theme/i, 'Shopify'], [/wix\.com|wixstatic/i, 'Wix'], [/wp-content|wp-includes/i, 'WordPress'], [/woocommerce/i, 'WooCommerce'], [/framerusercontent|framer\.com/i, 'Framer'], [/webflow\.(io|com)/i, 'Webflow'], [/_next\/static/i, 'Next.js'], [/magento|Mage\./i, 'Magento'], [/gtag\(|googletagmanager/i, 'Google Tag'], [/fbq\(|facebook\.net\/.*fbevents/i, 'Meta Pixel'], [/razorpay/i, 'Razorpay'], [/shiprocket/i, 'Shiprocket']];
const TRUST = [/warranty/i, /return(s)? policy|easy returns/i, /free shipping|free delivery/i, /cash on delivery|\bcod\b/i, /secure (checkout|payment)/i, /\d[\d,]*\+? (happy )?customers/i, /reviews?/i, /trusted by/i, /money.back|guarantee/i, /gstin|gst no/i];
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const all = (h: string, re: RegExp) => [...h.matchAll(re)].map((m) => strip(m[1] ?? '').slice(0, 120)).filter(Boolean);

export function snapshotFromHtml(url: string, html: string): SiteSnapshotT {
  const text = strip(html);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1];
  const cta = all(html, /<(?:a|button)[^>]*(?:class=["'][^"']*(?:btn|button|cta)[^"']*["'])[^>]*>([\s\S]*?)<\/(?:a|button)>/gi).concat(all(html, /<button[^>]*>([\s\S]*?)<\/button>/gi)).filter((t) => t.length < 40);
  return {
    fetched: true, url, title, description: description || undefined, h1: all(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).slice(0, 5),
    nav_links: all(html, /<nav[\s\S]*?<\/nav>/i.test(html) ? /<nav[\s\S]*?<\/nav>/gi : /(?!)/g).join(' ').split(/\s{2,}/).slice(0, 0).concat(all(html.match(/<nav[\s\S]*?<\/nav>/i)?.[0] ?? '', /<a[^>]*>([\s\S]*?)<\/a>/gi)).slice(0, 15),
    cta_texts: [...new Set(cta)].slice(0, 8), forms: (html.match(/<form\b/gi) ?? []).length, has_viewport_meta: /<meta[^>]+name=["']viewport["']/i.test(html),
    platform_signals: PLATFORMS.filter(([re]) => re.test(html)).map(([, n]) => n), script_count: (html.match(/<script\b/gi) ?? []).length, image_count: (html.match(/<img\b/gi) ?? []).length,
    word_count: text.split(/\s+/).length, has_https: url.startsWith('https://'), trust_signals: TRUST.filter((re) => re.test(text)).map((re) => re.source.slice(0, 30)), text_excerpt: text.slice(0, 1200),
  };
}
export async function fetchSnapshot(website: string, timeoutMs = 10000): Promise<SiteSnapshotT> {
  const url = /^https?:\/\//.test(website) ? website : `https://${website}`;
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'Mozilla/5.0 (compatible; awtm-research/1.0; +https://awtmforge.com)' } });
    if (!res.ok) return { fetched: false, url, error: `http ${res.status}` } as SiteSnapshotT;
    const html = (await res.text()).slice(0, 600_000);
    return snapshotFromHtml(res.url || url, html);
  } catch (e: any) { return { fetched: false, url, error: e.message } as SiteSnapshotT; }
}
