'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createProfileEntry, slugify } = require('./create-business-profile');
const CLI_PATH = path.resolve(__dirname, 'create-business-profile.js');

const approved = { approved: true };

function validProfile(overrides = {}) {
  return {
    demo: false,
    name: 'Caf� & Co. - Harrisburg',
    category: 'Restaurant / Food',
    city: 'Harrisburg',
    state: 'PA',
    address: '18 Market Street, Harrisburg, PA 17101',
    description: 'A neighborhood cafe serving fresh coffee and pastries.',
    phone: '717-555-0150',
    email: 'hello@example.test',
    website: { label: 'example.test', href: 'https://example.test' },
    logoImage: 'https://images.example.test/logo.png',
    heroImage: { src: 'https://images.example.test/cover.jpg', alt: 'Cafe interior' },
    hours: [{ days: 'Monday - Friday', time: '8 AM - 5 PM' }],
    deals: [{ title: 'Coffee and croissant', description: 'Available before 10 AM.' }],
    jobs: [{ title: 'Barista', detail: 'Part-time mornings.' }],
    gallery: [{ src: 'assets/cafe.jpg', alt: 'Cafe counter', caption: 'Welcome in' }],
    ...overrides
  };
}

test('creates a businesses.js entry from valid approved profile data', () => {
  const result = createProfileEntry(validProfile(), {}, approved);
  assert.equal(result.slug, 'cafe-and-co-harrisburg');
  assert.equal(result.profile.demo, false);
  assert.equal(result.profile.name, 'Caf� & Co. - Harrisburg');
  assert.equal(result.profile.category, 'Restaurant / Food');
  assert.equal(result.profile.website.href, 'https://example.test/');
  assert.deepEqual(result.profile.deals, [{ title: 'Coffee and croissant', description: 'Available before 10 AM.' }]);
  assert.deepEqual(result.profile.jobs, [{ title: 'Barista', detail: 'Part-time mornings.' }]);
});

test('rejects profile data missing required fields', () => {
  assert.throws(
    () => createProfileEntry(validProfile({ address: '', email: '' }), {}, approved),
    /Street address is required[\s\S]*Email is required/
  );
});

test('rejects duplicate business slugs and IDs instead of overwriting', () => {
  assert.throws(
    () => createProfileEntry(validProfile({ name: 'Keystone Pizza' }), { 'keystone-pizza': { name: 'Keystone Pizza Co.' } }, approved),
    /already exists/
  );
  assert.throws(
    () => createProfileEntry(validProfile({ name: 'Keystone Pizza Co.' }), { legacyPizzaId: { name: 'Keystone Pizza Co.' } }, approved),
    /already exists/
  );
});

test('falls back cleanly for optional images, website, deals, jobs, hours, and state', () => {
  const result = createProfileEntry(validProfile({
    state: '',
    website: { href: 'javascript:alert(1)' },
    logoImage: 'javascript:alert(1)',
    heroImage: null,
    hours: null,
    deals: null,
    jobs: null,
    gallery: [{ src: '//untrusted.example/image.jpg' }]
  }), {}, approved);

  assert.equal(result.profile.state, 'PA');
  assert.equal(result.profile.avatarText, 'CC');
  assert.equal(result.profile.logoImage, '');
  assert.deepEqual(result.profile.heroImage, { src: '', alt: 'Caf� & Co. - Harrisburg storefront or business interior' });
  assert.equal(result.profile.website, null);
  assert.deepEqual(result.profile.hours, []);
  assert.deepEqual(result.profile.deals, []);
  assert.deepEqual(result.profile.jobs, []);
  assert.deepEqual(result.profile.gallery, []);
});

test('requires an explicit human approval confirmation', () => {
  assert.throws(() => createProfileEntry(validProfile()), /approval-gated/);
});

test('reads pasted profile JSON from stdin and prints the slug, profile path, and object entry', () => {
  const profile = validProfile({ name: 'Stdin Preview Bakery' });
  const result = spawnSync(process.execPath, [CLI_PATH, '--approved'], {
    input: JSON.stringify(profile),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Generated business slug: stdin-preview-bakery/);
  assert.match(result.stdout, /Final profile URL path: \/business-profile\.html\?business=stdin-preview-bakery/);
  assert.match(result.stdout, /Ready-to-paste businesses\.js object entry:/);
  assert.match(result.stdout, /"stdin-preview-bakery": \{/);
  assert.match(result.stdout, /"demo": false/);
});

test('continues to read profile JSON from --input files', () => {
  const tempDirectory = fs.mkdtempSync(path.join(__dirname, '.tmp-profile-'));
  const inputPath = path.join(tempDirectory, 'approved-profile.json');
  fs.writeFileSync(inputPath, JSON.stringify(validProfile({ name: 'File Input Bakery' })));

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, '--approved', '--input', inputPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Generated business slug: file-input-bakery/);
    assert.match(result.stdout, /"file-input-bakery": \{/);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('stdin mode does not bypass the explicit approval gate', () => {
  const result = spawnSync(process.execPath, [CLI_PATH], {
    input: JSON.stringify(validProfile({ name: 'Unapproved Bakery' })),
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Approval confirmation required/);
});

test('generates stable, safe slugs', () => {
  assert.equal(slugify('  Caf� & Co. / West Shore  '), 'cafe-and-co-west-shore');
  assert.equal(slugify('***'), '');
});

