'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const guides = require('./local-guides');
const seo = require('./generate-local-seo-pages');
const city = { slug: 'harrisburg', name: 'Harrisburg' };
const asOf = new Date('2026-10-05T12:00:00Z');

function fixture(count = 4, overrides = {}) {
  const profiles = {};
  const items = [];
  for (let i = 1; i <= count; i += 1) {
    const businessSlug = `approved-shop-${i}`;
    profiles[businessSlug] = {
      demo: false, name: `Approved Shop ${i}`, city: 'Harrisburg', state: 'PA',
      category: 'Local business', description: `A useful description for approved shop ${i}.`,
      deals: [{ id: `offer-${i}`, title: `Offer ${i}`, description: `Offer details ${i}`, endDate: '2026-11-01' }]
    };
    items.push({ businessSlug, listingType: 'deal', listingId: `offer-${i}`, startDate: '2026-10-01', endDate: '2026-11-01', lastVerified: '2026-10-01' });
  }
  const guide = {
    slug: 'harrisburg-local-deals', citySlug: 'harrisburg', kind: 'deal',
    title: 'Harrisburg local deals', metaTitle: 'Local Deals in Harrisburg, PA | Price Market',
    description: 'A practical guide to current offers from approved Harrisburg businesses, with details and direct profile links.',
    h1: 'Local deals to explore in Harrisburg, PA',
    intro: 'Use this guide to compare current offers from approved businesses in Harrisburg. Each item links to its business profile so you can review the details, find contact information, and confirm any restrictions before making plans in the city. Check the linked profiles for context before you decide what fits.',
    lastUpdated: '2026-10-05',
    sections: [
      { title: 'Offers to compare', intro: 'Start with the offer description and any stated limits. Open its linked business profile for contact details and more context before deciding whether it fits your plans.', items: items.slice(0, Math.ceil(count / 2)) },
      { title: 'Check the details', intro: 'Offer terms and availability can change. Use the linked profile to check the business information, then confirm current terms directly with the business when needed.', items: items.slice(Math.ceil(count / 2)) }
    ],
    ...overrides
  };
  return { profiles, items, guide };
}
test('four current approved listings and useful unique sections make a guide indexable', () => {
  const { profiles, guide } = fixture();
  const [result] = guides.analyzeLocalGuides([guide], profiles, [city], asOf);
  assert.equal(result.indexable, true);
  assert.equal(result.route, '/guides/harrisburg-local-deals');
});
test('three listings, duplicate intro, or insufficient sections remain noindex', () => {
  const three = fixture(3);
  assert.equal(guides.analyzeLocalGuides([three.guide], three.profiles, [city], asOf)[0].indexable, false);
  const duplicate = fixture();
  assert.equal(guides.analyzeLocalGuides([duplicate.guide, { ...duplicate.guide, slug: 'another-guide' }], duplicate.profiles, [city], asOf)[0].indexable, false);
  const oneSection = fixture();
  oneSection.guide.sections = [oneSection.guide.sections[0]];
  assert.equal(guides.analyzeLocalGuides([oneSection.guide], oneSection.profiles, [city], asOf)[0].indexable, false);
});
test('expired, future, stale and demo listings are excluded', () => {
  const { profiles, guide } = fixture();
  profiles['approved-shop-2'].deals[0].endDate = '2026-10-04';
  profiles['approved-shop-3'].deals[0].startDate = '2026-10-10';
  profiles['approved-shop-4'].demo = true;
  const [result] = guides.analyzeLocalGuides([guide], profiles, [city], asOf);
  assert.equal(result.entries.length, 1);
  assert.equal(result.indexable, false);
  assert.equal(guides.isCurrentGuideItem({ endDate: '2026-10-04' }, 'deal', asOf), false);
  assert.equal(guides.isCurrentGuideItem({ lastVerified: '2026-08-01' }, 'happy-hour', asOf), false);
});
test('business and non-promotion items resolve only to approved non-demo profiles', () => {
  const { profiles } = fixture();
  profiles['demo-shop'] = { ...profiles['approved-shop-1'], demo: true };
  const resolved = guides.resolveGuideReference({ businessSlug: 'approved-shop-1', listingType: 'business' }, profiles, city, asOf);
  assert.ok(resolved);
  assert.equal(guides.resolveGuideReference({ businessSlug: 'demo-shop', listingType: 'business' }, profiles, city, asOf), null);
});
test('canonical, noindex and sitemap membership follow eligibility', () => {
  const { profiles, guide } = fixture();
  const eligible = guides.analyzeLocalGuides([guide], profiles, [city], asOf);
  const html = guides.renderGuidePage(eligible[0], eligible);
  assert.match(html, /<link rel="canonical" href="https:\/\/pricemarketpa\.com\/guides\/harrisburg-local-deals">/);
  assert.match(html, /name="robots" content="index,follow/);
  assert.match(seo.renderSitemap({ cities: [], categories: [] }, profiles, eligible), /\/guides\/harrisburg-local-deals/);
  const thin = guides.analyzeLocalGuides([fixture(3).guide], fixture(3).profiles, [city], asOf);
  const thinHtml = guides.renderGuidePage(thin[0], thin);
  assert.match(thinHtml, /name="robots" content="noindex,follow"/);
  assert.doesNotMatch(seo.renderSitemap({ cities: [], categories: [] }, fixture(3).profiles, thin), /\/guides\//);
});
test('guide output has valid breadcrumbs, one H1, ItemList and no fabricated rating/review data', () => {
  const { profiles, guide } = fixture();
  const [result] = guides.analyzeLocalGuides([guide], profiles, [city], asOf);
  const html = guides.renderGuidePage(result, [result]);
  const h1s = html.match(/<h1\b/g) || [];
  assert.equal(h1s.length, 1);
  const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(script);
  const json = JSON.parse(script[1]);
  assert.ok(json['@graph'].some(node => node['@type'] === 'BreadcrumbList'));
  assert.ok(json['@graph'].some(node => node['@type'] === 'ItemList' && node.numberOfItems === 4));
  assert.doesNotMatch(html, /aggregateRating|reviewCount|"review"/i);
});
test('all-expired content removes only a previously generated guide page', () => {
  const { profiles, guide } = fixture();
  profiles['approved-shop-1'].deals[0].endDate = '2026-10-04';
  profiles['approved-shop-2'].deals[0].endDate = '2026-10-04';
  profiles['approved-shop-3'].deals[0].endDate = '2026-10-04';
  profiles['approved-shop-4'].deals[0].endDate = '2026-10-04';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-guides-'));
  const generatedDir = path.join(root, 'guides', guide.slug);
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(path.join(generatedDir, 'index.html'), '<!-- generated-price-market-guide:harrisburg-local-deals --> old');
  guides.generateLocalGuidePages({ rootDir: root, guides: [guide], profiles, cities: [city], asOf });
  assert.equal(fs.existsSync(path.join(generatedDir, 'index.html')), false);
  fs.rmSync(root, { recursive: true, force: true });
});
test('homepage, city and profile guide links only render for existing guides', () => {
  const { profiles, guide } = fixture();
  const [result] = guides.analyzeLocalGuides([guide], profiles, [city], asOf);
  assert.match(guides.renderHomeGuideLinks([result]), /harrisburg-local-deals/);
  assert.match(guides.renderGuideLinks([result], 'harrisburg'), /harrisburg-local-deals/);
  assert.match(guides.renderBusinessGuideLinks([result], 'approved-shop-1'), /harrisburg-local-deals/);
  assert.equal(guides.renderHomeGuideLinks([]), '');
});

test('generator links the same eligible guide from homepage, city hub, business profile and sitemap', () => {
  const { profiles, guide } = fixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-guide-integrated-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<main><!-- PRICE_MARKET_GUIDE_LINKS:START --><!-- PRICE_MARKET_GUIDE_LINKS:END --></main>');
  const cityData = {
    ...city, title: 'Harrisburg local discovery', description: 'A local discovery page.',
    h1: 'Find local listings in Harrisburg', intro: ['Helpful local browsing context.'],
    guideHeading: 'Explore', guide: ['Browse the listings.'], sectionHeading: 'Choose a category'
  };
  const data = { cities: [cityData], categories: [] };
  const template = fs.readFileSync(path.join(__dirname, '..', 'business-profile.html'), 'utf8');
  try {
    seo.generateLocalSeoPages({ rootDir: root, data, profiles, profileTemplate: template, guides: [guide] });
    const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const cityHtml = fs.readFileSync(path.join(root, 'harrisburg', 'index.html'), 'utf8');
    const profileHtml = fs.readFileSync(path.join(root, 'business', 'approved-shop-1', 'index.html'), 'utf8');
    const guideHtml = fs.readFileSync(path.join(root, 'guides', guide.slug, 'index.html'), 'utf8');
    const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
    assert.match(home, /\/guides\/harrisburg-local-deals/);
    assert.match(cityHtml, /\/guides\/harrisburg-local-deals/);
    assert.match(profileHtml, /\/guides\/harrisburg-local-deals/);
    assert.match(guideHtml, /name="robots" content="index,follow/);
    assert.match(sitemap, /\/guides\/harrisburg-local-deals/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
