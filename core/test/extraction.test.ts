// Regressions from the first live Serper run (5 Oct 2026): ids in scripts read as phones, "image." read as Magento,
// escaped JSON and placeholder emails, articles / agencies / platforms treated as companies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const D = await import('../src/discovery.ts');
const { snapshotFromHtml } = await import('../src/lib/website.ts');
const page = `<html><head><title>Tempt | Buy Power Banks</title><link rel="preload" href="//temptindia.com/cdn/shop/files/image.png?v=1"></head><body>
<script>var meta={"product":{"id":8316031227,"variants":[{"id":6620843259}]},"x":"\\u003eplus@shopify.com","y":"xxx@xxx.xxx"};</script>
<script src="//cdn.shopify.com/s/files/theme.js"></script><img src="https://cdn.shopify.com/s/files/1/image.jpg">
<footer>Write to <a href="mailto:customercare@temptindia.com">customercare@temptindia.com</a>. Call <a href="tel:+91-98450 12345">98450 12345</a> or 1800-208-4455. Fax 6666666667.
Founder: aarav.tempt@gmail.com. Price 98450.12345 units. Mobile 70225 81934. Partner brand support@anker.com</footer></body></html>`;
const fetchStub = (async () => new Response(page)) as unknown as typeof fetch;

test('platform: Shopify image URLs are not Magento', () => {
  const snap = snapshotFromHtml('https://temptindia.com', page);
  assert.ok(snap.platform_signals.includes('Shopify')); assert.ok(!snap.platform_signals.includes('Magento'), snap.platform_signals.join(','));
});
test('phones: only visible text and tel: links, normalised, junk runs rejected', async () => {
  const e = await D.enrichSite('https://temptindia.com/', fetchStub);
  assert.deepEqual(e.phones.sort(), ['+917022581934', '+919845012345', '18002084455']); // sentence-final number kept, decimal ignored
  for (const [raw, want] of [['+91 98450 12345', '+919845012345'], ['09845012345', '+919845012345'], ['919845012345', '+919845012345'], ['6666666667', null], ['8500000000', null], ['1234567890', null], ['5845012345', null]] as const) assert.equal(D.normPhone(raw), want, raw);
});
test('emails: escaped json and placeholders dropped, own domain first, then free mail, then others', async () => {
  const e = await D.enrichSite('https://temptindia.com/', fetchStub);
  assert.deepEqual(e.emails, ['customercare@temptindia.com', 'aarav.tempt@gmail.com', 'support@anker.com']);
  assert.equal(D.isRealEmail('u003eplus@shopify.com'), true); // shape is fine; the escape is stripped before matching
  assert.equal(D.isRealEmail('xxx@xxx.xxx'), false); assert.equal(D.isRealEmail('logo@2x.png'), false); assert.equal(D.isRealEmail('your@email.com'), false);
  assert.deepEqual(D.rankEmails(['a@other.com', 'b@gmail.com', 'care@jainaindia.com', 'c@sansuiworld.com'], 'sansuiworld.com'), ['c@sansuiworld.com', 'b@gmail.com', 'a@other.com', 'care@jainaindia.com']);
});
test('result kind: articles, agencies and platforms are not companies', () => {
  assert.equal(D.classifyHit('https://www.shopify.com/in/blog/consumer-electronics-sites', '12 Best Consumer Electronics Sites that Convert in 2025'), 'PLATFORM');
  assert.equal(D.classifyHit('https://seventhtriangle.com/', 'Seventh Triangle: E-commerce Agency & Shopify Plus Partners'), 'AGENCY');
  assert.equal(D.classifyHit('https://ignitionindia.com/blogs/news/offline-vs-online', 'Offline Sales vs Online Sales: Which Is Better for Electrical ...'), 'ARTICLE');
  assert.equal(D.classifyHit('https://temptindia.com/', 'Temptindia: Buy Power Banks, Wireless Earbuds, Adapters ...'), 'COMPANY');
  assert.equal(D.classifyHit('https://home.hafeleindia.com/', 'Hafele India'), 'COMPANY');
});

test('company name: declared name first, then the title part matching the domain, never a sales tagline', () => {
  assert.equal(D.companyName('Buy Smart TVs & ACs Online | Shop Sansui Electronics', 'sansuiworld.com'), 'Sansui Electronics');
  assert.equal(D.companyName('Buy Smart TVs & ACs Online | Shop Sansui Electronics ...', 'sansuiworld.com'), 'Sansui Electronics'); // search engines truncate titles
  assert.equal(D.companyName('Buy 200 RPM Geared Motor Online in India | The Engineer Store', 'theengineerstore.in'), 'The Engineer Store');
  assert.equal(D.companyName('Temptindia: Buy Power Banks, Wireless Earbuds, Adapters', 'temptindia.com'), 'Temptindia');
  assert.equal(D.companyName('GadgetLane | Electronics, Apparel, Home &amp; Kitchen Online', 'gadgetlane.co.in'), 'GadgetLane');
  assert.equal(D.companyName('Crompton Greaves Consumer Electricals Limited: Shop Fans', 'crompton.co.in'), 'Crompton Greaves Consumer Electricals Limited');
  assert.equal(D.companyName('Best deals on everything', 'zedlights.in'), 'Zedlights');
  assert.equal(D.companyName('Anything', 'x.in', 'Hafele India'), 'Hafele India');
});

test('evidence tags never reach the email sentence', async () => {
  const P = await import('../src/pipeline.ts');
  assert.equal(P.untag('OBSERVED: Your homepage loads 211 images.'), 'Your homepage loads 211 images.');
  assert.equal(P.untag('INFERRED - This likely slows phones.'), 'This likely slows phones.');
  assert.equal(P.untag('UNKNOWN'), 'UNKNOWN');
  assert.equal(P.untag('Observed traffic dips are common.'), 'Observed traffic dips are common.');
});

test('a job title keeps the title and drops evidence notes the model appended', async () => {
  const P = await import('../src/pipeline.ts');
  assert.equal(P.cleanTitle('Co-Founder and Director (OBSERVED: the LinkedIn company page calls him Co-Founder)'), 'Co-Founder and Director');
  assert.equal(P.cleanTitle('Director (UNKNOWN: role not confirmed'), 'Director');
  assert.equal(P.cleanTitle('Head of E-commerce (Digital)'), 'Head of E-commerce (Digital)');
});

test('deep contact read: structured data phone and email, WhatsApp link, policy page, landline, with sources', async () => {
  const home = `<html><head><title>Volt Home</title><script type="application/ld+json">{"@type":"Organization","telephone":"+91 80 4147 2211","email":"care@volthome.in"}</script></head>
    <body><a href="/policies/privacy-policy">Privacy</a><a href="https://wa.me/919845120376">Chat</a><p>No contact here</p></body></html>`;
  const privacy = `<html><body><p>Grievance officer: Meera Iyer, grievance@volthome.in, +91 98451 20376</p></body></html>`;
  const stub = (async (u: any) => new Response(String(u).includes('privacy-policy') ? privacy : String(u).endsWith('volthome.in') || String(u).endsWith('volthome.in/') ? home : '', { status: String(u).match(/volthome\.in\/?$|privacy-policy/) ? 200 : 404 })) as unknown as typeof fetch;
  const e = await D.enrichSite('https://volthome.in', stub, { deep: true });
  assert.deepEqual(e.emails.sort(), ['care@volthome.in', 'grievance@volthome.in']);
  assert.deepEqual(e.phones.sort(), ['+918041472211', '+919845120376']);
  const src: any = e.sources; assert.match(src.emails['grievance@volthome.in'], /privacy-policy/); assert.equal(src.whatsapp, true); assert.equal(src.structured_data, true); assert.ok(src.pages_checked >= 3);
  assert.equal(D.normPhone('080-4147 2211'), '+918041472211'); assert.equal(D.normPhone('011 4166 2211'), '+911141662211'); assert.equal(D.normPhone('0123456789'), null);
});
