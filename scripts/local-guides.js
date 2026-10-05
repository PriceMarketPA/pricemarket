'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ORIGIN: SITE_ORIGIN, absoluteAsset } = require('../local-seo');
const MIN_GUIDE_ITEMS = 4;
const MIN_GUIDE_SECTIONS = 2;
const MIN_GUIDE_INTRO_WORDS = 40;
const MIN_GUIDE_SECTION_WORDS = 18;
const MAX_PROMOTION_VERIFICATION_AGE_DAYS = 30;
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GUIDE_LISTING_TYPES = new Set(['business','deal','happy-hour','job']);
function safe(value) { return escapeHtml(value); }
function formatTime(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return String(value || '');
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`;
}
function renderHomeGuideLinks(guides) {
  const selected = (guides || []).filter(guide => guide.publishable).slice(0, 3);
  return selected.length ? `<section class="pm-guides-section pm-home-guides" aria-labelledby="pm-guides-title"><div class="section-heading"><p class="small-title">Local discovery guides</p><h2 id="pm-guides-title">Useful ways to explore Central PA</h2></div><div class="pm-guide-grid">${selected.map(renderGuideCard).join('')}</div></section>` : '';
}

function wordsCount(value) { return String(value || '').trim().split(/\s+/).filter(Boolean).length; }

function normalizeText(value) { return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' '); }

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isCurrentGuideItem(item, kind, asOf = new Date()) {
  const today = new Date(asOf).toISOString().slice(0, 10);
  const start = item.startDate || '';
  const end = item.endDate || '';
  const verified = item.lastVerified || '';
  if (start && (!validIsoDate(start) || start > today)) return false;
  if (end && (!validIsoDate(end) || end < today)) return false;
  if (verified && !validIsoDate(verified)) return false;
  if (verified) {
    const ageDays = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${verified}T00:00:00Z`)) / 86400000);
    if (ageDays < 0 || ageDays > MAX_PROMOTION_VERIFICATION_AGE_DAYS) return false;
  }
  const promotion = kind === 'deal' || kind === 'happy-hour';
  if (promotion && !verified && !end) return false;
  return true;
}

function resolveGuideReference(reference, profiles, city, asOf = new Date()) {
  if (!reference || typeof reference !== 'object') return null;
  const businessSlug = String(reference.businessSlug || '').trim();
  if (!SAFE_SLUG.test(businessSlug)) return null;
  const profile = profiles?.[businessSlug];
  if (!profile || profile.demo !== false || !profile.name || normalizeText(profile.city) !== normalizeText(city.name)) return null;
  if (profile.state && String(profile.state).trim().toUpperCase() !== 'PA') return null;
  const kind = String(reference.listingType || '').trim();
  if (!GUIDE_LISTING_TYPES.has(kind)) return null;
  if (kind === 'business') return { businessSlug, profile, kind, listing: profile, reference, dates: { ...(reference || {}), ...(profile || {}) } };
  const collection = kind === 'deal' ? 'deals' : kind === 'happy-hour' ? 'happyHours' : 'jobs';
  const listings = Array.isArray(profile[collection]) ? profile[collection] : [];
  const id = reference.listingId == null ? '' : String(reference.listingId);
  const title = normalizeText(reference.listingTitle);
  if (!id && !title) return null;
  const listing = listings.find(entry => {
    if (!entry || typeof entry !== 'object') return false;
    const entryId = entry.id == null ? (entry.listingId == null ? '' : String(entry.listingId)) : String(entry.id);
    if (id && entryId !== id) return false;
    if (title && normalizeText(entry.title) !== title) return false;
    return true;
  });
  const dates = { ...reference, ...listing };
  for (const field of ['startDate', 'endDate', 'lastVerified']) if (listing[field] == null && reference[field] != null) dates[field] = reference[field];
  if (!listing || !isCurrentGuideItem(dates, kind, asOf)) return null;
  return { businessSlug, profile, kind, listing, reference, dates };
}

function analyzeLocalGuides(guides, profiles, cities, asOf = new Date()) {
  const items = Array.isArray(guides) ? guides : (guides?.guides || []);
  const cityBySlug = new Map((cities || []).map(city => [city.slug, city]));
  const countOf = selector => {
    const counts = new Map();
    for (const guide of items) {
      const value = normalizeText(selector(guide));
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    }
    return counts;
  };
  const introCounts = countOf(guide => guide?.intro);
  const titleCounts = countOf(guide => guide?.metaTitle || guide?.h1);
  const descriptionCounts = countOf(guide => guide?.description);
  return items.filter(guide => guide && typeof guide === 'object').map(guide => {
    const slug = String(guide.slug || '').trim();
    const city = cityBySlug.get(String(guide.citySlug || '').trim());
    const safeSlug = SAFE_SLUG.test(slug) && !!city;
    const sections = (Array.isArray(guide.sections) ? guide.sections : []).map(section => ({
      ...section,
      entries: (Array.isArray(section.items) ? section.items : []).map(item => resolveGuideReference(item, profiles, city || { name: '' }, asOf)).filter(Boolean)
    }));
    const allEntries = [], seen = new Set();
    for (const section of sections) for (const entry of section.entries) {
      const title = normalizeText(entry.kind === 'business' ? entry.profile.name : entry.listing.title);
      const key = `${entry.businessSlug}|${entry.kind}|${entry.reference.listingId || title}`;
      if (!seen.has(key)) { seen.add(key); allEntries.push(entry); }
    }
    const meaningfulSections = sections.filter(section => String(section.title || '').trim()
      && wordsCount(section.intro) >= MIN_GUIDE_SECTION_WORDS && section.entries.length > 0);
    const intro = normalizeText(guide.intro);
    const uniqueIntro = !!intro && introCounts.get(intro) === 1 && wordsCount(guide.intro) >= MIN_GUIDE_INTRO_WORDS;
    const uniqueTitle = titleCounts.get(normalizeText(guide.metaTitle || guide.h1)) === 1;
    const uniqueDescription = descriptionCounts.get(normalizeText(guide.description)) === 1;
    const hasUpdateDate = validIsoDate(guide.lastUpdated);
    const renderable = safeSlug && !!String(guide.title || '').trim() && !!String(guide.description || '').trim()
      && !!String(guide.h1 || '').trim() && wordsCount(guide.intro) >= 8 && meaningfulSections.length >= 1
      && allEntries.length > 0 && hasUpdateDate;
    const indexable = renderable && allEntries.length >= MIN_GUIDE_ITEMS && uniqueIntro
      && uniqueTitle && uniqueDescription && meaningfulSections.length >= MIN_GUIDE_SECTIONS;
    return { ...guide, slug, city, sections, meaningfulSections, entries: allEntries, route: `/guides/${slug}`, publishable: renderable, indexable, uniqueIntro, uniqueTitle, uniqueDescription };
  });
}

function guideUrl(slug) { return `/guides/${encodeURIComponent(slug)}`; }

function dateLabel(value) {
  if (!validIsoDate(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function renderGuideCard(guide) {
  return `<article class="pm-guide-card"><p class="small-title">${safe(guide.city.name)}, PA</p><h3><a href="${guide.route}">${safe(guide.title)}</a></h3><p>${safe(guide.description)}</p><a class="pm-guide-card-link" href="${guide.route}">Read the guide <span aria-hidden="true">&rarr;</span></a></article>`;
}

function renderGuideLinks(guides, citySlug = '') {
  const selected = (guides || []).filter(guide => guide.publishable && (!citySlug || guide.city?.slug === citySlug));
  if (!selected.length) return '';
  return `<section class="pm-guides-section" aria-labelledby="pm-guides-title"><div class="section-heading"><p class="small-title">Local discovery guides</p><h2 id="pm-guides-title">${citySlug ? 'More local guides' : 'Guides to explore Central PA'}</h2></div><div class="pm-guide-grid">${selected.map(renderGuideCard).join('')}</div></section>`;
}

function listingLabel(entry) {
  const { kind, listing, profile } = entry;
  return kind === 'business' ? profile.name : String(listing.title || profile.name);
}

function renderGuideItem(entry, position) {
  const { kind, listing, profile, businessSlug, dates } = entry;
  const typeLabel = { business: profile.category || 'Business', deal: 'Deal', 'happy-hour': 'Happy Hour', job: 'Job opening' }[kind];
  const detail = kind === 'business' ? profile.description : (listing.description || listing.details || listing.detail || '');
  const schedule = kind === 'happy-hour' ? [listing.days, formatTime(listing.startTime), listing.endTime ? `– ${formatTime(listing.endTime)}` : ''].filter(Boolean).join(' · ') : '';
  const src = profile.heroImage?.src ? absoluteAsset(profile.heroImage.src) : '';
  const img = src ? `<img src="${safe(src)}" alt="${safe(profile.heroImage.alt || `${profile.name} image`)}"${profile.heroImage.width ? ` width="${Number(profile.heroImage.width)}"` : ''}${profile.heroImage.height ? ` height="${Number(profile.heroImage.height)}"` : ''} loading="${position === 1 ? 'eager' : 'lazy'}" decoding="async">` : '';
  const meta = [typeLabel, profile.category, profile.city, profile.state || 'PA'].filter(Boolean).join(' · ');
  const dateMeta = [dates?.startDate && `Starts ${dateLabel(dates.startDate)}`, dates?.endDate && `Through ${dateLabel(dates.endDate)}`].filter(Boolean).join(' · ');
  return `<article class="pm-guide-listing">${img}<div class="pm-guide-listing-copy"><p class="pm-guide-listing-meta">${safe(meta)}</p><h3><a href="/business/${encodeURIComponent(businessSlug)}">${safe(listingLabel(entry))}</a></h3><p class="pm-guide-listing-business">From <a href="/business/${encodeURIComponent(businessSlug)}">${safe(profile.name)}</a></p>${detail ? `<p>${safe(detail)}</p>` : ''}${schedule ? `<p class="pm-guide-listing-meta">${safe(schedule)}</p>` : ''}${dateMeta ? `<p class="pm-guide-listing-meta">${safe(dateMeta)}</p>` : ''}</div></article>`;
}

function renderGuideBreadcrumbs(guide) {
  const route = `/${guide.city.slug}`;
  return `<nav class="seo-breadcrumbs pm-guide-breadcrumbs" aria-label="Breadcrumb"><a href="/">Price Market</a><span aria-hidden="true">/</span><a href="${route}">${safe(guide.city.name)}, PA</a><span aria-hidden="true">/</span><span aria-current="page">${safe(guide.title)}</span></nav>`;
}

function guideStructuredData(guide) {
  const url = `${SITE_ORIGIN}${guide.route}`;
  const graph = [
    { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: guide.title, description: guide.description },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Price Market', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: `${guide.city.name}, PA`, item: `${SITE_ORIGIN}/${guide.city.slug}` },
      { '@type': 'ListItem', position: 3, name: guide.title, item: url }
    ] }
  ];
  if (guide.entries.length) graph.push({
    '@type': 'ItemList', name: guide.title, itemListOrder: 'https://schema.org/ItemListOrderAscending',
    numberOfItems: guide.entries.length, itemListElement: guide.entries.map((entry, index) => ({
      '@type': 'ListItem', position: index + 1, name: listingLabel(entry), url: `${SITE_ORIGIN}/business/${encodeURIComponent(entry.businessSlug)}`
    }))
  });
  return { '@context': 'https://schema.org', '@graph': graph };
}

function renderGuidePage(guide, allGuides = []) {
  const canonical = `${SITE_ORIGIN}${guide.route}`;
  const robots = guide.indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow';
  const graph = JSON.stringify(guideStructuredData(guide)).replace(/</g, '\\u003c');
  const itemList = guide.entries.map((entry, index) => renderGuideItem(entry, index + 1)).join('');
  const sections = guide.meaningfulSections.map(section => `<section class="pm-guide-section" aria-labelledby="section-${safe(section.slug || normalizeText(section.title).replace(/[^a-z0-9]+/g, '-'))}"><p class="small-title">${safe(guide.city.name)} local picks</p><h2 id="section-${safe(section.slug || normalizeText(section.title).replace(/[^a-z0-9]+/g, '-'))}">${safe(section.title)}</h2><p>${safe(section.intro)}</p><div class="pm-guide-grid">${section.entries.map((entry, index) => renderGuideItem(entry, index + 1)).join('')}</div></section>`).join('');
  const related = allGuides.filter(item => item.publishable && item.slug !== guide.slug && item.city?.slug === guide.city.slug);
  const relatedLinks = related.length ? `<nav class="pm-guide-related" aria-label="Related local guides"><h2>More guides for ${safe(guide.city.name)}</h2>${related.map(item => `<a href="${item.route}">${safe(item.title)}</a>`).join('')}</nav>` : '';
  const title = String(guide.metaTitle || `${guide.h1} | Price Market`).trim();
  const description = String(guide.description).trim().slice(0, 300);
  return `<!-- generated-price-market-guide:${safe(guide.slug)} -->
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>${safe(title)}</title><meta name="description" content="${safe(description)}"><meta name="robots" content="${robots}"><link rel="canonical" href="${canonical}"><meta property="og:type" content="article"><meta property="og:site_name" content="Price Market"><meta property="og:title" content="${safe(title)}"><meta property="og:description" content="${safe(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${SITE_ORIGIN}/favicon-32x32.png"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${safe(title)}"><meta name="twitter:description" content="${safe(description)}"><link rel="stylesheet" href="/styles.css"><script type="application/ld+json">${graph}</script><meta name="theme-color" content="#1454e6"><link rel="icon" href="/favicon.ico" sizes="any"></head><body><div class="site seo-site"><header class="nav seo-nav"><a class="brand" href="/" aria-label="Price Market home"><img src="/pm-logo.png" alt="Price Market PM logo"><div><span>Price Market</span><small>Central PA Marketplace</small></div></a><nav class="nav-links" aria-label="Main navigation"><a href="/#marketplace">Marketplace</a><a href="/for-businesses">For Businesses</a><a href="/about">About</a></nav><div class="nav-actions"><a class="btn blue small" href="/#marketplace">Explore local</a></div></header><main class="seo-local-page pm-guide-page" id="main">${renderGuideBreadcrumbs(guide)}<section class="seo-local-hero pm-guide-hero"><p class="small-title">Price Market guide · ${safe(guide.city.name)}, PA</p><h1>${safe(guide.h1)}</h1><p>${safe(guide.intro)}</p><p class="pm-guide-updated"><time datetime="${safe(guide.lastUpdated)}">Last updated ${safe(dateLabel(guide.lastUpdated))}</time></p></section>${sections}<div class="pm-guide-actions"><a class="btn white" href="/${guide.city.slug}">Explore ${safe(guide.city.name)}</a></div>${relatedLinks}</main><footer class="seo-footer"><a href="/">Price Market home</a><a href="/${guide.city.slug}">${safe(guide.city.name)} city guide</a><a href="/for-businesses">For Businesses</a><a href="/about">About</a></footer></div></body></html>`;
}

function generateLocalGuidePages({ rootDir, guides, profiles, cities, asOf = new Date() }) {
  const analyzed = analyzeLocalGuides(guides, profiles, cities, asOf);
  const publishable = analyzed.filter(guide => guide.publishable);
  const generated = [];
  const livePaths = new Set(publishable.map(guide => `${guide.slug}/index.html`));
  for (const guide of publishable) {
    const directory = path.join(rootDir, 'guides', guide.slug);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'index.html'), renderGuidePage(guide, publishable));
    generated.push(`guides/${guide.slug}/index.html`);
  }
  const guideRoot = path.join(rootDir, 'guides');
  if (fs.existsSync(guideRoot)) for (const folder of fs.readdirSync(guideRoot, { withFileTypes: true })) {
    if (!folder.isDirectory() || !SAFE_SLUG.test(folder.name)) continue;
    const file = path.join(guideRoot, folder.name, 'index.html');
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('<!-- generated-price-market-guide:') && !livePaths.has(`${folder.name}/index.html`)) {
      fs.unlinkSync(file);
    }
  }
  return analyzed.map(guide => ({ ...guide, generated: guide.publishable }));
}

function renderBusinessGuideLinks(guides, businessSlug) {
  const selected = (guides || []).filter(guide => guide.publishable && guide.entries.some(entry => entry.businessSlug === businessSlug));
  return selected.length ? `<section class="profile-panel pm-business-guide-links" aria-labelledby="businessGuidesTitle"><p class="small-title">Included in local guides</p><h2 id="businessGuidesTitle">Local guides featuring this business</h2><ul>${selected.map(guide => `<li><a href="${guide.route}">${safe(guide.title)}</a></li>`).join('')}</ul></section>` : '';
}
module.exports = { MIN_GUIDE_ITEMS, MIN_GUIDE_SECTIONS, MIN_GUIDE_INTRO_WORDS, MIN_GUIDE_SECTION_WORDS, MAX_PROMOTION_VERIFICATION_AGE_DAYS, analyzeLocalGuides, dateLabel, generateLocalGuidePages, guideStructuredData, guideUrl, isCurrentGuideItem, renderBusinessGuideLinks, renderGuideLinks, renderGuidePage, renderHomeGuideLinks, resolveGuideReference };
