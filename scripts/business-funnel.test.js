'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
  for (const phrase of ['$0 during our Central PA launch.', 'No contract. No credit card required.', 'Business Profiles', 'Deals', 'Happy Hours', 'Job Listings', 'Local discovery and search']) assert.ok(html.includes(phrase), phrase);
  assert.match(html, /Founding Business\s*[—–-]\s*Free/);
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



test('Onboarding scripts parse and load from root-relative URLs in dropdown-first order', () => {
  const html = read('business-onboarding.html');
  const script = read('business-onboarding.js');
  const dropdown = read('price-market-dropdown.js');
  assert.doesNotThrow(() => new vm.Script(script), 'onboarding script must parse before its handlers can run');
  assert.match(html, /<script src="\/price-market-dropdown\.js"><\/script>\s*<script src="\/business-onboarding\.js"><\/script>/);
  assert.match(html, /id="onboardingCategoryDropdown" data-pm-dropdown[^>]*data-select-id="businessCategory"/);
  assert.match(html, /id="onboardingCityDropdown" data-pm-dropdown[^>]*data-select-id="businessCity"/);
  assert.match(html, /id="onboardingCategoryTrigger"[^>]*aria-controls="onboardingCategoryListbox"/);
  assert.match(html, /id="onboardingCityTrigger"[^>]*aria-controls="onboardingCityListbox"/);
  assert.match(dropdown, /trigger\.addEventListener\('click'/);
  assert.match(dropdown, /window\.initPmDropdowns = initPmDropdowns/);
  assert.match(script, /window\.initPmDropdowns\(document\)/);
});

test('Business onboarding provides image and PDF uploads with URL fallback and profile preview support', () => {
  const html = read('business-onboarding.html');
  const script = read('business-onboarding.js');
  for (const item of [
    'id="logoImageFile" type="file"', 'id="coverPhotoFile" type="file"',
    'id="galleryPhotosFile" type="file" multiple', 'id="businessDocumentFile" type="file"',
    'image/heic', 'image/heif', 'application/pdf', 'Use image URLs instead (optional fallback)',
    'data-upload-status="logo"', 'data-upload-status="gallery"', 'id="previewGallery"', 'id="previewDocument"'
  ]) assert.ok(html.includes(item), item);
  assert.match(script, /media:\s*\{[\s\S]*?logoUrl,[\s\S]*?coverUrl:[\s\S]*?galleryUrls:[\s\S]*?documentUrl:/);
  assert.match(script, /profileDataJson: JSON\.stringify\(profileData\)/);
  assert.match(script, /reviewStatus: 'Pending review'/);
  assert.match(script, /uploadBytes\(signed\.uploadUrl/);
  assert.match(script, /Uploading \$\{file\.name\} � \$\{percent\}%/);
  assert.match(script, /action: 'challenge'/);
  assert.match(script, /solveUploadChallenge\(challenge\)/);
  assert.match(script, /replacePath: previousAsset\?\.path/);
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

test('Onboarding navigation uses a refreshed stylesheet and stacks every step on narrow screens', () => {
  const css = read('styles.css');
  const html = read('business-onboarding.html');
  assert.match(html, /href="\/styles\.css\?v=onboarding-business-uploads-6"/);
  assert.match(css, /@media\(max-width:480px\)\{\.onboarding-site \.onboarding-step-panel \.onboarding-step-controls,\.onboarding-site \.onboarding-submit-panel \.onboarding-step-controls\{display:flex!important;flex-direction:column!important/);
  assert.match(css, /\.onboarding-site \.onboarding-step-panel \.onboarding-step-controls>\.btn,\.onboarding-site \.onboarding-submit-panel \.onboarding-step-controls>\.btn\{[^}]*width:100%!important;[^}]*flex:0 0 auto!important/);
  assert.match(css, /font-size:1rem;line-height:1\.25;white-space:normal!important/);
  assert.match(html, /onboarding-final-controls/);
});
test('Happy Hour mobile fields use one full-width days row and an equal two-column time row', () => {
  const css = read('styles.css');
  const html = read('business-onboarding.html');
  const fields = html.match(/<div class="onboarding-fields happy-hour-fields"[\s\S]*?<\/div>/)?.[0];
  assert.ok(fields, 'Happy Hour fields exist');
  assert.match(fields, /<label class="happy-hour-days-field">Days offered<input name="happyHourDays" id="happyHourDays"/);
  assert.equal((fields.match(/class="happy-hour-time-field"/g) || []).length, 2);
  assert.match(fields, /class="happy-hour-time-field">Start time<select class="pm-select happy-hour-time-select" name="happyHourStartTime" id="happyHourStartTime"><option value="">Select time<\/option><\/select>/);
  assert.match(fields, /class="happy-hour-time-field">End time<select class="pm-select happy-hour-time-select" name="happyHourEndTime" id="happyHourEndTime"><option value="">Select time<\/option><\/select>/);
  assert.match(fields, /class="field-wide">Restrictions or notes[\s\S]*?name="happyHourRestrictions"/);
  assert.match(css, /@media\(max-width:480px\)\{\.onboarding-fields\.happy-hour-fields\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\.onboarding-fields\.happy-hour-fields>\.happy-hour-days-field\{grid-column:1\/-1\}/);
  assert.match(css, /\.onboarding-fields\.happy-hour-fields>\.happy-hour-time-field select\{width:100%;min-width:0;max-width:100%;box-sizing:border-box;text-align:center;text-align-last:center/);
  assert.doesNotMatch(css, /happy-hour-time-field input\[type=time\]|happy-hour-time-field input\[type=time\]::-/);
  const onboardingScript = read('business-onboarding.js');
  assert.match(onboardingScript, /minutes \+= 15/);
  assert.match(onboardingScript, /option\.value = value/);
  assert.match(onboardingScript, /option\.textContent = formatTime\(value\)/);
});
test('Onboarding wizard centers its desktop form and restores the two-column Step 5 preview layout', () => {
  const css = read('styles.css');
  assert.match(css, /\.onboarding-layout\{grid-template-columns:minmax\(0,1fr\);max-width:900px;margin-inline:auto\}/);
  assert.match(css, /\.onboarding-layout:has\(\.onboarding-preview-wrap:not\(\[hidden\]\)\)\{grid-template-columns:minmax\(0,1\.2fr\) minmax\(300px,\.8fr\);max-width:1240px\}/);
  assert.match(css, /@media\(max-width:980px\)\{\.onboarding-layout,\.onboarding-layout:has\(\.onboarding-preview-wrap:not\(\[hidden\]\)\)\{grid-template-columns:minmax\(0,1fr\);max-width:900px\}\}/);
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

