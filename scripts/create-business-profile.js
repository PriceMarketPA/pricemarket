#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DEFAULT_BUSINESSES_FILE = path.resolve(__dirname, '..', 'businesses.js');
const MAX_SLUG_LENGTH = 64;

function text(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function slugify(value) {
  return text(value, 300)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

function requiredText(data, key, label, maxLength, errors) {
  const value = text(data[key], maxLength);
  if (!value) errors.push(`${label} is required.`);
  return value;
}

function safeAssetSource(value) {
  const source = text(value, 1000);
  if (!source) return '';
  if (/^https:\/\//i.test(source)) return source;
  if (/^(assets|images)\/[a-z0-9_./-]+$/i.test(source) && !source.split('/').includes('..')) return source;
  return '';
}

function optionalWebsite(value) {
  const raw = typeof value === 'string' ? value : value && value.href;
  const href = text(raw, 500);
  if (!href) return null;

  try {
    const parsed = new URL(href);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const label = text(value && value.label, 120) || parsed.hostname;
    return { label, href: parsed.href };
  } catch {
    return null;
  }
}

function optionalRows(value, { titleKey, detailKeys, maxRows = 50 }) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxRows).flatMap(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
    const title = text(row[titleKey], 120);
    if (!title) return [];
    let detail = '';
    for (const key of detailKeys) {
      detail = text(row[key], 500);
      if (detail) break;
    }
    return [{ title, [detailKeys[0]]: detail }];
  });
}

function initials(name) {
  return name.normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).map(word => word[0]).join('').slice(0, 2).toUpperCase();
}

function normalizeProfile(profileData) {
  if (!profileData || typeof profileData !== 'object' || Array.isArray(profileData)) {
    throw new Error('profileDataJson must contain a JSON object.');
  }

  const errors = [];
  const name = requiredText(profileData, 'name', 'Business name', 90, errors);
  const category = requiredText(profileData, 'category', 'Category', 90, errors);
  const city = requiredText(profileData, 'city', 'City', 90, errors);
  const address = requiredText(profileData, 'address', 'Street address', 180, errors);
  const description = requiredText(profileData, 'description', 'Description', 240, errors);
  const email = requiredText(profileData, 'email', 'Email', 254, errors);

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email must be a valid email address.');
  if (errors.length) throw new Error(`Profile validation failed:\n- ${errors.join('\n- ')}`);

  const hero = profileData.heroImage && typeof profileData.heroImage === 'object' ? profileData.heroImage : {};
  const gallery = Array.isArray(profileData.gallery) ? profileData.gallery : [];
  const hours = Array.isArray(profileData.hours) ? profileData.hours : [];

  return {
    demo: false,
    name,
    avatarText: text(profileData.avatarText, 3).toUpperCase() || initials(name),
    logoImage: safeAssetSource(profileData.logoImage),
    heroImage: {
      src: safeAssetSource(hero.src),
      alt: text(hero.alt, 180) || `${name} storefront or business interior`
    },
    category,
    city,
    state: text(profileData.state, 2).toUpperCase() || 'PA',
    address,
    description,
    phone: text(profileData.phone, 40),
    email,
    website: optionalWebsite(profileData.website),
    hours: hours.slice(0, 14).flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const days = text(item.days, 60);
      const time = text(item.time, 80);
      return days && time ? [{ days, time }] : [];
    }),
    deals: optionalRows(profileData.deals, { titleKey: 'title', detailKeys: ['description'], maxRows: 50 }),
    jobs: optionalRows(profileData.jobs, { titleKey: 'title', detailKeys: ['detail', 'description'], maxRows: 50 }),
    gallery: gallery.slice(0, 24).flatMap(photo => {
      if (!photo || typeof photo !== 'object') return [];
      const src = safeAssetSource(photo.src);
      if (!src) return [];
      return [{
        src,
        alt: text(photo.alt, 180) || `${name} business photo`,
        caption: text(photo.caption, 120)
      }];
    })
  };
}

function loadExistingBusinesses(filePath = DEFAULT_BUSINESSES_FILE) {
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: filePath, timeout: 1000 });
  const businesses = sandbox.window.priceMarketBusinesses;
  if (!businesses || typeof businesses !== 'object' || Array.isArray(businesses)) {
    throw new Error('businesses.js did not define window.priceMarketBusinesses.');
  }
  return businesses;
}

function createProfileEntry(profileData, existingBusinesses = {}, { approved = false } = {}) {
  if (!approved) throw new Error('Publishing is approval-gated. Confirm the sheet status is Approved and pass --approved.');

  const profile = normalizeProfile(profileData);
  const slug = slugify(profile.name);
  if (!slug) throw new Error('Business name did not produce a usable slug.');

  const duplicateKey = Object.keys(existingBusinesses).find(key => slugify(key) === slug);
  if (duplicateKey) throw new Error(`Business ID/slug "${slug}" already exists as "${duplicateKey}".`);

  const duplicateName = Object.entries(existingBusinesses).find(([, business]) =>
    business && typeof business.name === 'string' && slugify(business.name) === slug
  );
  if (duplicateName) throw new Error(`A business with this name already exists under ID "${duplicateName[0]}".`);

  return { slug, profile };
}

function parseArgs(args) {
  const options = { approved: false, input: '', businessesFile: DEFAULT_BUSINESSES_FILE };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--approved') options.approved = true;
    else if (arg === '--input') {
      options.input = args[++index] || '';
      if (!options.input) throw new Error('Provide a file path or "-" after --input.');
    }
    else if (arg === '--businesses') options.businessesFile = path.resolve(args[++index] || '');
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

function formatBusinessEntry(slug, profile) {
  const lines = JSON.stringify(profile, null, 2).split('\n');
  return `  ${JSON.stringify(slug)}: ${lines[0]}\n${lines.slice(1).map(line => `  ${line}`).join('\n')},`;
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write('Usage: node scripts/create-business-profile.js --approved [--input approved-profile.json | --input -] [--businesses businesses.js]\n');
    process.stdout.write('Without --input, profileDataJson is read from stdin.\n');
    return;
  }
  if (!options.approved) throw new Error('Approval confirmation required. Verify the Google Sheet Review Status is Approved, then pass --approved.');

  const inputText = !options.input || options.input === '-'
    ? await readStdin()
    : fs.readFileSync(path.resolve(options.input), 'utf8');
  if (!inputText.trim()) throw new Error('No profileDataJson was provided. Pass --input <file> or pipe/paste JSON through stdin.');

  const rawProfile = JSON.parse(inputText);
  const existing = loadExistingBusinesses(options.businessesFile);
  const { slug, profile } = createProfileEntry(rawProfile, existing, { approved: true });
  process.stdout.write(`Generated business slug: ${slug}\n`);
  process.stdout.write(`Final profile URL path: /business-profile.html?business=${encodeURIComponent(slug)}\n\n`);
  process.stdout.write('Ready-to-paste businesses.js object entry:\n');
  process.stdout.write(`${formatBusinessEntry(slug, profile)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createProfileEntry, loadExistingBusinesses, normalizeProfile, slugify };

