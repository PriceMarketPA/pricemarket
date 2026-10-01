'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const data = require('../data/local-seo.json');
const businessSandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'businesses.js'), 'utf8'), businessSandbox);
const profiles = businessSandbox.window.priceMarketBusinesses;
const {
  MIN_APPROVED_PROFILES_FOR_CATEGORY_INDEX,
  categoryIsIndexable,
  generateLocalSeoPages,
  getPublishedProfiles,
  renderSitemap
} = require('./generate-local-seo-pages');
const { buildLocalBusinessSchema } = require('../local-seo');

test('generates five distinct city hubs and twenty city/listing guides', () => {
  const tempRoot = fs.mkdtempSync(path.join(__dirname, '.local-seo-test-'));
  try {
    const generated = generateLocalSeoPages({ rootDir: tempRoot, data, profiles: {} });
    assert.equal(generated.length, 25);
    const titles = new Set();
    for (const city of data.cities) {
      const html = fs.readFileSync(path.join(tempRoot, city.slug, 'index.html'), 'utf8');
      assert.match(html, /<h1\b/);
      assert.match(html, new RegExp(`<title>[^<]*${city.name}`));
      assert.match(html, new RegExp(`<link rel="canonical" href="https:\/\/pricemarketpa\.com\/${city.slug}\/">`));
      titles.add(html.match(/<title>(.*?)<\/title>/)[1]);
      for (const category of data.categories) {
        const routePage = path.join(tempRoot, city.slug, category.slug, 'index.html');
        assert.ok(fs.existsSync(routePage), `${city.slug}/${category.slug} route exists`);
        const categoryHtml = fs.readFileSync(routePage, 'utf8');
        assert.match(categoryHtml, /<h1\b/);
        assert.match(categoryHtml, /Browse current/);
        assert.match(categoryHtml, /\?city=/);
        assert.match(categoryHtml, /name="robots" content="noindex,follow"/);
        const scripts = [...categoryHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
        assert.equal(scripts.length, 1);
        assert.doesNotThrow(() => JSON.parse(scripts[0][1]));
      }
      const graphText = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
      const graph = JSON.parse(graphText);
      assert.ok(graph['@graph'].some(item => item['@type'] === 'BreadcrumbList'));
      assert.ok(!graph['@graph'].some(item => item['@type'] === 'LocalBusiness'));
    }
    assert.equal(titles.size, 5, 'city title tags are unique');
    const sitemap = fs.readFileSync(path.join(tempRoot, 'sitemap.xml'), 'utf8');
    assert.equal((sitemap.match(/<loc>/g) || []).length, 6);
    assert.doesNotMatch(sitemap, /business-profile|onboarding|\/deals\//);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('category indexing requires three approved, matching businesses and useful city context', () => {
  const city = data.cities[0];
  const category = data.categories.find(item => item.filterType === 'deal');
  const make = (slug, cityName = city.name, demo = false) => [slug, { demo, city: cityName, deals: [{ title: 'Offer' }] }];
  const threeApproved = Object.fromEntries([make('a'), make('b'), make('c')]);
  const twoApproved = Object.fromEntries([make('a'), make('b')]);
  const withDemo = Object.fromEntries([make('a'), make('b'), make('sample', city.name, true)]);
  const otherCity = Object.fromEntries([make('a'), make('b'), make('c', 'Other City')]);
  assert.equal(MIN_APPROVED_PROFILES_FOR_CATEGORY_INDEX, 3);
  assert.equal(categoryIsIndexable(threeApproved, city, category), true);
  assert.equal(categoryIsIndexable(twoApproved, city, category), false);
  assert.equal(categoryIsIndexable(withDemo, city, category), false);
  assert.equal(categoryIsIndexable(otherCity, city, category), false);
  assert.equal(categoryIsIndexable(threeApproved, { ...city, discoveryNotes: { deals: 'Short text.' } }, category), false);
});

test('only explicitly approved real profiles enter indexable route lists', () => {
  const sampleSet = { approved: { demo: false }, pending: { demo: 'pending' }, sample: { demo: true }, ambiguous: {} };
  assert.deepEqual(getPublishedProfiles(sampleSet).map(([slug]) => slug), ['approved']);
  const sitemap = renderSitemap(data, profiles);
  assert.doesNotMatch(sitemap, /\/business\//);
  assert.doesNotMatch(sitemap, /keystone-pizza/);
});

test('LocalBusiness schema requires approved profile and a complete matching address', () => {
  const valid = {
    demo: false,
    name: 'Approved Sample Business',
    description: 'Owner supplied business description.',
    city: 'Mechanicsburg',
    state: 'PA',
    address: '10 Main Street, Mechanicsburg, PA 17055',
    heroImage: { src: '/assets/example.jpg' }
  };
  assert.equal(buildLocalBusinessSchema({ ...valid, demo: true }, 'demo'), null);
  assert.equal(buildLocalBusinessSchema({ ...valid, address: 'Mechanicsburg, PA' }, 'incomplete'), null);
  assert.equal(buildLocalBusinessSchema({ ...valid, address: '10 Main Street, Hershey, PA 17033' }, 'mismatch'), null);
  assert.equal(buildLocalBusinessSchema({ ...valid, address: { streetAddress: '10 Main Street', addressLocality: 'Hershey', addressRegion: 'PA', postalCode: '17033' } }, 'object-mismatch'), null);
  const schema = buildLocalBusinessSchema(valid, 'approved-sample');
  assert.equal(schema['@type'], 'LocalBusiness');
  assert.equal(schema.address.postalCode, '17055');
  assert.equal(schema.url, 'https://pricemarketpa.com/business/approved-sample/');
  assert.ok(!('aggregateRating' in schema));
  assert.ok(!('review' in schema));
  assert.ok(!('priceRange' in schema));
  assert.ok(!('openingHours' in schema));
});

test('profile page implements clean approved URL and demo-safe metadata handling', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'business-profile.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'business-profile.js'), 'utf8');
  assert.match(html, /name="robots" id="profileRobots" content="noindex,follow"/);
  assert.match(js, /window\.location\.pathname\.match/);
  assert.ok(js.includes("match(/^\\/business\\/([^/]+)\\/?$/)"));
  assert.match(js, /business\.demo === false/);
  assert.match(js, /buildLocalBusinessSchema/);
  assert.match(html, /id="profileCanonical"/);
  assert.match(html, /src="\/businesses\.js"/);
  assert.match(html, /src="\/business-profile\.js"/);
});

test('homepage, crawl controls, and clean profile rewrite use the production origin', () => {
  const root = path.join(__dirname, '..');
  const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  const onboarding = fs.readFileSync(path.join(root, 'business-onboarding.html'), 'utf8');
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.match(home, /<link rel="canonical" href="https:\/\/pricemarketpa\.com\/">/);
  const homeGraph = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.ok(homeGraph['@graph'].some(item => item['@type'] === 'Organization'));
  assert.ok(homeGraph['@graph'].some(item => item['@type'] === 'WebSite'));
  assert.doesNotMatch(JSON.stringify(homeGraph), /LocalBusiness|aggregateRating|review/);
  assert.match(robots, /Sitemap: https:\/\/pricemarketpa\.com\/sitemap\.xml/);
  assert.doesNotMatch(sitemap, /www\.pricemarketpa\.com|onboarding|keystone-pizza|business-profile/);
  assert.match(onboarding, /name="robots" content="noindex,follow"/);
  assert.equal(vercel.trailingSlash, true);
  assert.ok(vercel.rewrites.some(rule => rule.source === '/business/:slug/' && rule.destination === '/business-profile?business=:slug'));
  assert.ok(vercel.rewrites.some(rule => rule.source === '/business/:slug' && rule.destination === '/business-profile?business=:slug'));
});

