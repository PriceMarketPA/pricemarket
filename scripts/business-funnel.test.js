'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function schemaFrom(html) {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'JSON-LD is present');
  return JSON.parse(match[1]);
}

test('For Businesses landing page has indexable metadata and the founding offer', () => {
  const html = read('for-businesses.html');
  assert.match(html, /<h1[^>]*>Get discovered by more local customers\.<\/h1>/);
  assert.match(html, /Create My Free Business Profile/);
  assert.match(html, /href="\/business-onboarding"/);
  assert.match(html, /See an Example Profile/);
  assert.match(html, /business-profile\.html\?business=keystone-pizza/);
  for (const phrase of ['Founding Business — Free', '$0 during our Central PA launch.', 'No contract. No credit card required.', 'Business Profiles', 'Deals', 'Happy Hours', 'Job Listings', 'Local discovery and search']) assert.ok(html.includes(phrase), phrase);
  assert.match(html, /rel="canonical" href="https:\/\/pricemarketpa\.com\/for-businesses"/);
  assert.match(html, /name="robots" content="index,follow/);
  assert.ok(schemaFrom(html)['@graph'].some(entry => entry['@type'] === 'WebPage'));
  assert.match(html, /data-copyright-year/);
  assert.match(html, /src="\/copyright\.js"/);
});

test('About page covers company identity, Central PA story, and four marketplace areas without fabricated proof', () => {
  const html = read('about.html');
  for (const phrase of ['Building a better way to discover local.', 'Save Local. Buy Local. Hire Local.', 'Price Market LLC', 'Pennsylvania', 'Mechanicsburg', 'Camp Hill', 'Carlisle', 'Harrisburg', 'Hershey', 'Deals', 'Happy Hours', 'Businesses', 'Jobs', 'List Your Business', 'Contact us through the business inquiry form']) assert.ok(html.includes(phrase), phrase);
  assert.match(html, /href="\/for-businesses"/);
  assert.match(html, /rel="canonical" href="https:\/\/pricemarketpa\.com\/about"/);
  const graph = schemaFrom(html);
  assert.ok(graph['@graph'].some(entry => entry['@type'] === 'Organization' && entry.name === 'Price Market LLC'));
  assert.doesNotMatch(JSON.stringify(graph), /LocalBusiness|Review|AggregateRating|address|telephone/);
  assert.doesNotMatch(html, /\b(?:customers|members|partners)\s+(?:served|joined|trust us)\b|\b\d+\s+(?:businesses|customers|reviews)\b/i);
});

test('Onboarding is a five-step client flow that preserves pending-review submission infrastructure', () => {
  const html = read('business-onboarding.html');
  const script = read('business-onboarding.js');
  for (let step = 1; step <= 5; step++) assert.match(html, new RegExp(`data-step-panel="${step}"`));
  assert.match(html, /aria-label="Business profile setup progress"/);
  assert.match(html, /Step 1 of 5/);
  assert.match(html, /Preview &amp; Submit/);
  assert.equal((html.match(/type="submit"/g) || []).length, 1);
  assert.match(html, /id="submissionConfirmation"/);
  for (const message of ['We review your submission', 'Approved profiles are published', 'We send you the profile link', 'Customers can discover it', 'Submission does not guarantee publication']) assert.ok(html.includes(message), message);
  assert.match(script, /https:\/\/script\.google\.com\/macros\/s\/AKfycbxU3krjD4BPxDjzSIbRrDVlGLS_mqZ21watyba5k2I_9y7-oHG0aYobftXK0QBVC-Bp\/exec/);
  assert.match(script, /reviewStatus: 'Pending review'/);
  assert.match(script, /profileDataJson: JSON\.stringify\(profileData\)/);
  assert.match(script, /happyHourTitle: happyHour\.title \|\| ''/);
  assert.match(script, /fetch\(LEADS_API_URL/);
  assert.match(html, /price-market-dropdown\.js/);
  assert.match(html, /happyHourTitleInput/);
  assert.match(html, /business-onboarding\.js/);
});


test('Mobile More menu groups discovery and business links without the obsolete waitlist action', () => {
  const html = read('index.html');
  const menu = html.match(/<div class="mobile-more-menu"[\s\S]*?<\/div>\s*<\/div>\s*<\/nav>/)?.[0];
  assert.ok(menu, 'mobile More menu exists');
  for (const label of ['Explore', 'All Listings', 'Businesses', 'For Businesses', 'List Your Business', 'How It Works', 'Explore Central PA', 'Central PA Cities', 'Price Market', 'About Price Market']) assert.ok(menu.includes(label), label);
  assert.match(menu, /href="\/business-onboarding">List Your Business<\/a>/);
  assert.match(menu, /href="\/for-businesses">How It Works<\/a>/);
  assert.match(menu, /href="\/about">About Price Market<\/a>/);
  assert.doesNotMatch(menu, /Join the waitlist|class="open-waitlist"|class="open-business"/i);
  assert.match(menu, /data-mobile-type="all"/);
  assert.match(menu, /data-mobile-type="business"/);
});

test('Onboarding step actions stack on narrow screens with readable, full-width controls', () => {
  const css = read('styles.css');
  assert.match(css, /@media\(max-width:430px\)\{\.onboarding-step-controls\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.onboarding-step-controls \.btn\{width:100%;min-width:0;min-height:52px;padding:13px 18px;font-size:\.9rem;white-space:normal\}/);
  assert.doesNotMatch(css, /@media\(max-width:390px\)\{[^}]*onboarding-step-controls \.btn\{font-size:\.76rem/);
});
test('New indexable routes are included in sitemap and linked through the site shell', () => {
  const sitemap = read('sitemap.xml');
  const home = read('index.html');
  const seoGenerator = read('scripts/generate-local-seo-pages.js');
  assert.match(sitemap, /https:\/\/pricemarketpa\.com\/about<\/loc>/);
  assert.match(sitemap, /https:\/\/pricemarketpa\.com\/for-businesses<\/loc>/);
  assert.match(home, /href="\/for-businesses">For Businesses<\/a>/);
  assert.match(home, /href="\/about">About<\/a>/);
  assert.match(home, /initialParams.get\('form'\) === 'business'/);
  assert.ok(seoGenerator.includes("const routes = ['/', '/about', '/for-businesses'"));
});
