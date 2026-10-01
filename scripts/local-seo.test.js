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
      assert.match(html, new RegExp(`<link rel="canonical" href="https:\/\/pricemarketpa\.com\/${city.slug}">`));
      assert.doesNotMatch(html, /Keystone Pizza|example\.com|717-555|\b\d+ reviews?\b|\b[1-5](?:\.\d)? stars?\b/i);
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

test('approved profiles get static clean-URL HTML with metadata and eligible schema in the initial response', () => {
  const tempRoot = fs.mkdtempSync(path.join(__dirname, '.local-seo-profile-test-'));
  const approved = {
    'river-street-cafe': {
      demo: false,
      name: 'River Street Cafe',
      category: 'Cafe',
      city: 'Mechanicsburg',
      state: 'PA',
      address: '10 Main Street, Mechanicsburg, PA 17055',
      description: 'A reviewed business profile with owner-provided information.',
      phone: '717-555-0100',
      heroImage: { src: '/assets/approved-business.jpg', alt: 'Cafe counter' },
      deals: [], jobs: [], hours: [], happyHours: [], gallery: []
    },
    pending: { demo: true, name: 'Pending Example' }
  };
  try {
    const generated = generateLocalSeoPages({ rootDir: tempRoot, data, profiles: approved });
    assert.ok(generated.includes('business/river-street-cafe/index.html'));
    assert.ok(!generated.some(file => file.includes('/pending/')));
    const page = fs.readFileSync(path.join(tempRoot, 'business', 'river-street-cafe', 'index.html'), 'utf8');
    assert.match(page, /<title>River Street Cafe \| Business Profile \| Price Market<\/title>/);
    assert.match(page, /name="robots" id="profileRobots" content="index,follow,max-image-preview:large"/);
    assert.match(page, /rel="canonical" id="profileCanonical" href="https:\/\/pricemarketpa\.com\/business\/river-street-cafe"/);
    const jsonLd = JSON.parse(page.match(/<script type="application\/ld\+json" id="profileStructuredData">([\s\S]*?)<\/script>/)[1]);
    assert.equal(jsonLd['@type'], 'LocalBusiness');
    assert.equal(jsonLd.address.addressLocality, 'Mechanicsburg');
    const sitemap = fs.readFileSync(path.join(tempRoot, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /https:\/\/pricemarketpa\.com\/business\/river-street-cafe<\/loc>/);
    assert.doesNotMatch(sitemap, /\/business\/pending\//);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
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
  assert.equal(schema.url, 'https://pricemarketpa.com/business/approved-sample');
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
  assert.match(html, /href="https:\/\/pricemarketpa\.com\/business-profile\?business=keystone-pizza"/);
  assert.match(js, /https:\/\/pricemarketpa\.com\/business-profile\?business=/);
  assert.match(html, /src="\/businesses\.js"/);
  assert.match(html, /src="\/business-profile\.js"/);
});

test('homepage and crawl controls use the production origin and Vercel clean URLs', () => {
  const root = path.join(__dirname, '..');
  const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  const onboarding = fs.readFileSync(path.join(root, 'business-onboarding.html'), 'utf8');
  const legacyProfile = fs.readFileSync(path.join(root, 'keystone-pizza.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'site.webmanifest'), 'utf8'));
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.match(home, /<link rel="canonical" href="https:\/\/pricemarketpa\.com\/">/);
  const homeGraph = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.ok(homeGraph['@graph'].some(item => item['@type'] === 'Organization'));
  assert.ok(homeGraph['@graph'].some(item => item['@type'] === 'WebSite'));
  assert.doesNotMatch(JSON.stringify(homeGraph), /LocalBusiness|aggregateRating|review/);
  assert.match(robots, /Sitemap: https:\/\/pricemarketpa\.com\/sitemap\.xml/);
  assert.deepEqual(manifest.icons.map(icon => icon.src), ['/apple-touch-icon.png']);
  assert.doesNotMatch(sitemap, /www\.pricemarketpa\.com|onboarding|keystone-pizza|business-profile/);
  assert.match(onboarding, /name="robots" content="noindex,follow"/);
  assert.match(legacyProfile, /rel="canonical" href="https:\/\/pricemarketpa\.com\/business-profile\?business=keystone-pizza"/);
  assert.equal(vercel.cleanUrls, true);
  assert.equal(vercel.trailingSlash, false);
  assert.match(onboarding, /href="styles\.css"/);
  assert.equal(new URL('styles.css', 'https://pricemarketpa.com/business-onboarding').href, 'https://pricemarketpa.com/styles.css');
  assert.equal(new URL('styles.css', 'https://pricemarketpa.com/business-onboarding/').href, 'https://pricemarketpa.com/business-onboarding/styles.css');
});

test('clean routes and legacy .html links share one no-slash destination', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const canonicalPath = value => {
    const url = new URL(value, 'https://pricemarketpa.com');
    let pathname = url.pathname.replace(/\.html$/, '');
    if (config.trailingSlash === false && pathname.length > 1) pathname = pathname.replace(/\/$/, '');
    url.pathname = pathname || '/';
    return `${url.pathname}${url.search}${url.hash}`;
  };

  assert.equal(canonicalPath('/'), '/');
  assert.equal(canonicalPath('/index.html'), '/index');
  assert.equal(canonicalPath('/business-onboarding.html'), '/business-onboarding');
  assert.equal(canonicalPath('/business-profile.html?business=keystone-pizza'), '/business-profile?business=keystone-pizza');
  assert.equal(canonicalPath('/keystone-pizza.html'), '/keystone-pizza');
  assert.equal(canonicalPath('/?city=Harrisburg&type=happy-hour#marketplace'), '/?city=Harrisburg&type=happy-hour#marketplace');
  assert.equal(canonicalPath('/mechanicsburg/'), '/mechanicsburg');
  assert.equal(canonicalPath('/mechanicsburg/deals/'), '/mechanicsburg/deals');
  assert.equal(canonicalPath('/business/keystone-pizza/'), '/business/keystone-pizza');
  assert.equal(canonicalPath('/styles.css'), '/styles.css');
});

