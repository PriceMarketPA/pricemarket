'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const data = require('../data/local-seo.json');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'businesses.js'), 'utf8'), sandbox);
const realProfiles = sandbox.window.priceMarketBusinesses;
const {
  MIN_APPROVED_PROFILES_FOR_CATEGORY_INDEX,
  categoryIsIndexable,
  generateLocalSeoPages,
  getPublishedProfiles,
  renderSitemap
} = require('./generate-local-seo-pages');
const { buildLocalBusinessSchema, buildBusinessProfileJsonLd, localBusinessType } = require('../local-seo');

const temp = prefix => fs.mkdtempSync(path.join(__dirname, prefix));
const profile = (slug, changes = {}) => ({
  demo: false, name: slug.split('-').map(x => x[0].toUpperCase()+x.slice(1)).join(' '),
  category: 'Restaurant', city: 'Mechanicsburg', state: 'PA', description: 'Owner provided information for this approved local business profile in Mechanicsburg.',
  address: '12 Main Street, Mechanicsburg, PA 17055', deals: [], happyHours: [], jobs: [], hours: [], gallery: [],
  ...changes
});
const city = data.cities.find(item => item.slug === 'mechanicsburg');
const deals = data.categories.find(item => item.filterType === 'deal');

test('city hubs render unique local copy, approved listing sections, honest empty states, and breadcrumbs', () => {
  const root = temp('.seo-hubs-');
  try {
    const profiles = {
      sample: profile('sample', { deals: [{ title: 'Lunch special', description: 'Owner-provided weekday lunch offer.' }] }),
      demo: { ...profile('demo'), demo: true, name: 'Demo Restaurant', deals: [{ title: 'Demo deal' }] },
      pending: { ...profile('pending'), demo: 'pending', name: 'Pending Restaurant', deals: [{ title: 'Pending deal' }] }
    };
    generateLocalSeoPages({ rootDir: root, data, profiles });
    const titles = new Set();
    for (const item of data.cities) {
      const html = fs.readFileSync(path.join(root, item.slug, 'index.html'), 'utf8');
      assert.equal((html.match(/<h1\b/g) || []).length, 1);
      assert.match(html, /name="robots" content="index,follow,max-image-preview:large"/);
      assert.match(html, new RegExp('<link rel="canonical" href="https://pricemarketpa\\.com/' + item.slug + '">'));
      assert.match(html, new RegExp(item.name));
      assert.match(html, /There are no approved .* listings/);
      assert.match(html, /Browse deals/);
      assert.match(html, /Explore other Central PA launch cities/);
      assert.doesNotMatch(html, /Demo Restaurant|Pending Restaurant/);
      titles.add(html.match(/<title>(.*?)<\/title>/)[1]);
      const graphText = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
      const graph = JSON.parse(graphText);
      assert.ok(graph['@graph'].some(node => node['@type'] === 'BreadcrumbList'));
      assert.equal(graph['@graph'].some(node => /LocalBusiness/.test(node['@type'])), false);
    }
    assert.equal(titles.size, 5);
    const mechanicsburg = fs.readFileSync(path.join(root, 'mechanicsburg', 'index.html'), 'utf8');
    assert.match(mechanicsburg, /Lunch special/);
    assert.match(mechanicsburg, /href="\/business\/sample"/);
    assert.doesNotMatch(mechanicsburg, /href="\/business\/demo"/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('city/type routes require three approved matching listings and unique local content before indexing', () => {
  const make = (slug, cityName = city.name, demo = false) => [slug, profile(slug, { city: cityName, deals: [{ title: 'Offer' }] , demo })];
  const three = Object.fromEntries([make('one'), make('two'), make('three')]);
  const two = Object.fromEntries([make('one'), make('two')]);
  const mixed = Object.fromEntries([make('one'), make('two'), make('example', city.name, true)]);
  assert.equal(MIN_APPROVED_PROFILES_FOR_CATEGORY_INDEX, 3);
  assert.equal(categoryIsIndexable(three, city, deals), true);
  assert.equal(categoryIsIndexable(two, city, deals), false);
  assert.equal(categoryIsIndexable(mixed, city, deals), false);
  assert.equal(categoryIsIndexable(three, { ...city, discoveryNotes: { deals: 'Short local note.' } }, deals), false);
  const oneBusinessThreeOffers = { one: profile('one', { deals: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }) };
  assert.equal(categoryIsIndexable(oneBusinessThreeOffers, city, deals), true);
});

test('city/type pages stay noindex and out of sitemap until eligible; eligible pages become indexable and self-canonical', () => {
  const two = Object.fromEntries([['one', profile('one', { deals: [{ title: 'A' }] })], ['two', profile('two', { deals: [{ title: 'B' }] })]]);
  const sitemapThin = renderSitemap(data, two);
  assert.doesNotMatch(sitemapThin, /mechanicsburg\/deals/);
  const root = temp('.seo-type-');
  try {
    generateLocalSeoPages({ rootDir: root, data, profiles: two });
    const thin = fs.readFileSync(path.join(root, 'mechanicsburg', 'deals', 'index.html'), 'utf8');
    assert.match(thin, /name="robots" content="noindex,follow"/);
    assert.ok(thin.includes('href="/business/one"') && thin.includes('>A</a>'));
    const eligible = Object.fromEntries([...Object.entries(two), ['three', profile('three', { deals: [{ title: 'C' }] })]]);
    generateLocalSeoPages({ rootDir: root, data, profiles: eligible });
    const page = fs.readFileSync(path.join(root, 'mechanicsburg', 'deals', 'index.html'), 'utf8');
    assert.match(page, /name="robots" content="index,follow,max-image-preview:large"/);
    assert.match(page, /rel="canonical" href="https:\/\/pricemarketpa\.com\/mechanicsburg\/deals"/);
    const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /https:\/\/pricemarketpa\.com\/mechanicsburg\/deals/);
    assert.match(page, /href="\/business\/one"/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('sitemap contains only canonical public hubs and approved real business profiles', () => {
  const sitemap = renderSitemap(data, { approved: profile('approved'), demo: { ...profile('demo'), demo: true }, pending: { ...profile('pending'), demo: 'pending' } });
  assert.equal((sitemap.match(/<loc>/g) || []).length, 9);
  assert.match(sitemap, /https:\/\/pricemarketpa\.com\/about/);
  assert.match(sitemap, /https:\/\/pricemarketpa\.com\/for-businesses/);
  assert.match(sitemap, /https:\/\/pricemarketpa\.com\/business\/approved/);
  assert.doesNotMatch(sitemap, /demo|pending|onboarding|\.html|\/deals/);
  assert.equal(renderSitemap(data, realProfiles).includes('/business/keystone-pizza'), false);
});

test('approved business profile is crawlable in initial HTML with unique metadata, breadcrumb, and factual LocalBusiness JSON-LD', () => {
  const root = temp('.seo-profile-');
  const approved = {
    'river-street-cafe': profile('River Street Cafe', {
      category: 'Cafe', website: { href: 'https://riverstreet.example' }, phone: '717-555-0144',
      logoImage: '/assets/cafe-logo.png', heroImage: { src: '/assets/cafe.jpg', alt: 'Cafe counter', width: 1200, height: 800 },
      hours: [{ days: 'Monday – Friday', time: '9 AM – 5 PM' }],
      deals: [{ title: 'Lunch special', description: 'Lunch details from the business.' }]
    })
  };
  try {
    generateLocalSeoPages({ rootDir: root, data, profiles: approved });
    const page = fs.readFileSync(path.join(root, 'business', 'river-street-cafe', 'index.html'), 'utf8');
    assert.match(page, /<title>River Street Cafe · Cafe in Mechanicsburg, PA \| Price Market<\/title>/);
    assert.match(page, /name="robots" id="profileRobots" content="index,follow,max-image-preview:large"/);
    assert.match(page, /rel="canonical" id="profileCanonical" href="https:\/\/pricemarketpa\.com\/business\/river-street-cafe"/);
    assert.match(page, /property="og:title" id="profileOgTitle" content="River Street Cafe/);
    assert.match(page, /<h1 id="businessName">River Street Cafe<\/h1>/);
    assert.match(page, /Owner provided information/);
    assert.match(page, /Monday/);
    assert.match(page, /profile-breadcrumbs/);
    assert.match(page, /href="\/mechanicsburg\/businesses">Cafe/);
    const jsonLd = JSON.parse(page.match(/<script type="application\/ld\+json" id="profileStructuredData">([\s\S]*?)<\/script>/)[1]);
    const businessNode = jsonLd['@graph'].find(node => node['@type'] === 'CafeOrCoffeeShop');
    assert.equal(businessNode.name, 'River Street Cafe');
    assert.equal(businessNode.telephone, '717-555-0144');
    assert.equal(businessNode.address.addressLocality, 'Mechanicsburg');
    assert.equal(businessNode.openingHoursSpecification[0].opens, '09:00');
    assert.equal(jsonLd['@graph'].some(node => node['@type'] === 'BreadcrumbList'), true);
    assert.equal(businessNode.aggregateRating, undefined);
    const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /https:\/\/pricemarketpa\.com\/business\/river-street-cafe/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('demo and pending profiles never receive indexable LocalBusiness markup or sitemap URLs', () => {
  const root = temp('.seo-demo-');
  try {
    const profiles = { sample: { ...profile('sample'), demo: true }, pending: { ...profile('pending'), demo: 'pending' } };
    generateLocalSeoPages({ rootDir: root, data, profiles });
    assert.equal(getPublishedProfiles(profiles).length, 0);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8'), /business\//);
    const template = fs.readFileSync(path.join(__dirname, '..', 'business-profile.html'), 'utf8');
    assert.equal(template.includes('LocalBusiness'), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  assert.equal(buildBusinessProfileJsonLd({ ...profile('demo'), demo: true }, 'demo'), null);
});

test('business schema uses the best supported subtype and includes only factual fields', () => {
  assert.equal(localBusinessType('Cafe'), 'CafeOrCoffeeShop');
  assert.equal(localBusinessType('Restaurant / Pizza'), 'Restaurant');
  const schema = buildLocalBusinessSchema(profile('Good Salon', {
    category: 'Beauty Salon', address: '', hours: [{ days: 'Monday', time: '9 AM – 5 PM' }]
  }), 'good-salon');
  assert.equal(schema['@type'], 'BeautySalon');
  assert.equal(schema.address.addressLocality, 'Mechanicsburg');
  assert.equal(schema.openingHoursSpecification[0].closes, '17:00');
  assert.equal(schema.aggregateRating, undefined);
  assert.equal(schema.review, undefined);
  assert.equal(schema.priceRange, undefined);
  assert.equal(schema.telephone, undefined);
});

test('homepage, About and For Businesses have distinct titles/canonicals and city links', () => {
  const root = path.join(__dirname, '..');
  const files = ['index.html', 'about.html', 'for-businesses.html'].map(name => fs.readFileSync(path.join(root, name), 'utf8'));
  const titles = files.map(html => html.match(/<title>(.*?)<\/title>/)[1]);
  assert.equal(new Set(titles).size, 3);
  assert.match(files[1], /<link rel="canonical" href="https:\/\/pricemarketpa\.com\/about">/);
  assert.match(files[2], /<link rel="canonical" href="https:\/\/pricemarketpa\.com\/for-businesses">/);
  for (const slug of data.cities.map(item => item.slug)) assert.match(files[0], new RegExp('href="/' + slug + '"'));
  const onboarding = fs.readFileSync(path.join(root, 'business-onboarding.html'), 'utf8');
  assert.match(onboarding, /name="robots" content="noindex,follow"/);
});
