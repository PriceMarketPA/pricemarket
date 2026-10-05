#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { absoluteAsset, buildBusinessProfileJsonLd, businessProfileUrl, cityRoute } = require('../local-seo');
const { generateLocalGuidePages, renderBusinessGuideLinks, renderGuideLinks, renderHomeGuideLinks } = require('./local-guides');

const SITE_ORIGIN = 'https://pricemarketpa.com';
const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'local-seo.json');
const GUIDE_DATA_FILE = path.join(ROOT, 'data', 'local-guides.json');
const MIN_APPROVED_PROFILES_FOR_CATEGORY_INDEX = 3;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function routeForCity(city) { return `/${city.slug}`; }
function routeForCategory(city, category) { return `/${city.slug}/${category.slug}`; }
function homeFilterUrl(city, category) {
  const params = new URLSearchParams({ city: city.name, type: category?.filterType || "all" });
  return `/?${params.toString()}#marketplace`;
}

function fillCity(value, cityName) { return String(value || "").replaceAll("{city}", cityName); }

function getPublishedProfiles(profiles) {
  return Object.entries(profiles || {}).filter(([, profile]) => profile && profile.demo === false);
}

function profileListings(profile, type) {
  if (!profile) return [];
  if (type === 'business') return profile.name ? [profile] : [];
  const collection = type === 'deal' ? 'deals' : type === 'happy-hour' ? 'happyHours' : 'jobs';
  if (!Array.isArray(profile[collection])) return [];
  return profile[collection].filter(item => {
    if (!item || typeof item !== 'object' || !String(item.title || '').trim()) return false;
    if (type === 'happy-hour') return !!String(item.days || '').trim();
    return true;
  });
}

function profileHasType(profile, type) {
  return profileListings(profile, type).length > 0;
}

function approvedListingEntriesFor(profiles, city, category) {
  const entries = [];
  for (const [slug, profile] of getPublishedProfiles(profiles)) {
    if (String(profile.city || '').trim().toLocaleLowerCase() !== city.name.toLocaleLowerCase()) continue;
    if (profile.state && String(profile.state).trim().toUpperCase() !== 'PA') continue;
    for (const listing of profileListings(profile, category.filterType)) {
      entries.push({ slug, profile, listing });
    }
  }
  return entries;
}

function approvedProfilesFor(profiles, city, category) {
  const seen = new Set();
  return approvedListingEntriesFor(profiles, city, category)
    .filter(entry => !seen.has(entry.slug) && seen.add(entry.slug))
    .map(entry => [entry.slug, entry.profile]);
}

function hasMeaningfulUniquePageContent(city, category) {
  const uniqueCityCopy = String(city.discoveryNotes?.[category.slug] || '').trim();
  const categoryCopy = [category.intro, category.guideCopy, ...(category.checklist || [])].join(' ');
  const cityCopy = [...(city.intro || []), ...(city.guide || [])].join(' ');
  const words = value => value.trim().split(/\s+/).filter(Boolean).length;
  return words(uniqueCityCopy) >= 25 && words(categoryCopy) >= 45 && words(cityCopy) >= 100;
}

function categoryIsIndexable(profiles, city, category) {
  return approvedListingEntriesFor(profiles, city, category).length >= MIN_APPROVED_PROFILES_FOR_CATEGORY_INDEX
    && hasMeaningfulUniquePageContent(city, category);
}

function absoluteUrl(route) { return `${SITE_ORIGIN}${route}`; }

function safeBusinessSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function replaceElementInner(html, id, inner) {
  const idAt = html.indexOf(`id="${id}"`);
  if (idAt < 0) return html;
  const openStart = html.lastIndexOf('<', idAt);
  const openEnd = html.indexOf('>', idAt);
  const tag = html.slice(openStart + 1).match(/^([a-z][a-z0-9]*)/i)?.[1];
  if (!tag || openEnd < 0) return html;
  const closeStart = html.indexOf(`</${tag}>`, openEnd + 1);
  if (closeStart < 0) return html;
  return html.slice(0, openEnd + 1) + inner + html.slice(closeStart);
}

function editTagById(html, id, edit) {
  const idAt = html.indexOf(`id="${id}"`);
  if (idAt < 0) return html;
  const start = html.lastIndexOf('<', idAt);
  const end = html.indexOf('>', idAt);
  if (start < 0 || end < 0) return html;
  return html.slice(0, start) + edit(html.slice(start, end + 1)) + html.slice(end + 1);
}

function staticProfileBreadcrumbs(profile, data) {
  const city = data.cities.find(item => item.name.toLocaleLowerCase() === String(profile.city || '').toLocaleLowerCase());
  const crumbs = [{ name: 'Price Market', route: '/' }];
  if (city) {
    crumbs.push({ name: `${city.name}, PA`, route: routeForCity(city) });
    crumbs.push({ name: String(profile.category || 'Businesses').trim(), route: `${routeForCity(city)}/businesses` });
  }
  crumbs.push({ name: profile.name, route: '' });
  return `<nav class="seo-breadcrumbs profile-breadcrumbs" id="profileBreadcrumbs" aria-label="Breadcrumb">${crumbs.map((item, index) =>
    `${index ? '<span aria-hidden="true">/</span>' : ''}${item.route ? `<a href="${escapeHtml(item.route)}">${escapeHtml(item.name)}</a>` : `<span aria-current="page">${escapeHtml(item.name)}</span>`}`
  ).join('')}</nav>`;
}

function safeWebsite(value) {
  const url = absoluteAsset(value);
  return url && /^https?:/i.test(url) ? url : '';
}

function profileImageTag(id, src, alt, options = {}) {
  const url = absoluteAsset(src);
  if (!url) return `<img id="${id}" src="" alt="" hidden>`;
  const width = Number.isSafeInteger(Number(options.width)) && Number(options.width) > 0 ? ` width="${Number(options.width)}"` : '';
  const height = Number.isSafeInteger(Number(options.height)) && Number(options.height) > 0 ? ` height="${Number(options.height)}"` : '';
  const loading = options.hero ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"';
  return `<img id="${id}" src="${escapeHtml(url)}" alt="${escapeHtml(alt || '')}"${width}${height}${loading} decoding="async">`;
}

function profileActions(profile) {
  const actions = [];
  const phone = String(profile.phone || '').replace(/[^+\d]/g, '');
  if (phone) actions.push(`<a class="btn blue" href="tel:${escapeHtml(phone)}">Call</a>`);
  const website = safeWebsite(profile.website?.href);
  if (website) actions.push(`<a class="btn white" href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">Visit website</a>`);
  if (Array.isArray(profile.deals) && profile.deals.length) actions.push('<a class="btn dark" href="#deals">View Deals</a>');
  actions.push('<a class="btn ghost" href="/for-businesses">Claim this business</a>');
  return actions.join('');
}

function renderProfileDeals(profile) {
  const deals = Array.isArray(profile.deals) ? profile.deals : [];
  if (!deals.length) return '<p class="profile-empty-state">No current deals are listed on this profile.</p>';
  return deals.map(deal => `<article class="profile-deal-card"><span class="profile-deal-label">Featured deal</span><h3>${escapeHtml(deal.title || '')}</h3><p>${escapeHtml(deal.description || '')}</p></article>`).join('');
}

function formatProfileTime(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return String(value || '');
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`;
}

function renderProfileHappyHours(profile) {
  const entries = (Array.isArray(profile.happyHours) ? profile.happyHours : []).filter(entry => entry && entry.title && entry.days);
  if (!entries.length) return '';
  return entries.map(entry => {
    const timeRange = [formatProfileTime(entry.startTime), formatProfileTime(entry.endTime)].filter(Boolean).join(' – ');
    const schedule = [entry.days, timeRange].filter(Boolean).join(' · ');
    const notes = entry.restrictions || entry.notes;
    return `<article class="profile-happy-hour-card"><h3>${escapeHtml(entry.title)}</h3><p>${escapeHtml(entry.description || '')}</p><p class="profile-happy-hour-schedule">${escapeHtml(schedule)}</p>${notes ? `<p class="profile-happy-hour-notes">${escapeHtml(notes)}</p>` : ''}</article>`;
  }).join('');
}

function renderProfileJobs(profile) {
  const jobs = Array.isArray(profile.jobs) ? profile.jobs : [];
  if (!jobs.length) return '';
  return jobs.map(job => `<article class="profile-job-card"><span class="profile-job-mark">JOB</span><div><h3>${escapeHtml(job.title || '')}</h3><p>${escapeHtml(job.detail || job.description || job.details || '')}</p></div></article>`).join('');
}

function renderProfileGallery(profile) {
  const gallery = Array.isArray(profile.gallery) ? profile.gallery : [];
  if (!gallery.length) return '';
  return gallery.map(photo => {
    const src = absoluteAsset(photo.src);
    if (!src) return '';
    const width = Number.isSafeInteger(Number(photo.width)) && Number(photo.width) > 0 ? ` width="${Number(photo.width)}"` : '';
    const height = Number.isSafeInteger(Number(photo.height)) && Number(photo.height) > 0 ? ` height="${Number(photo.height)}"` : '';
    return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(photo.alt || '')}"${width}${height} loading="lazy" decoding="async"><figcaption>${escapeHtml(photo.caption || '')}</figcaption></figure>`;
  }).join('');
}

function renderProfileContact(profile) {
  const rows = [];
  const add = (label, text, href, external = false) => {
    if (!text) return;
    const value = href
      ? `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(text)}</a>`
      : `<strong>${escapeHtml(text)}</strong>`;
    rows.push(`<div class="profile-contact-row"><span>${escapeHtml(label)}</span>${value}</div>`);
  };
  if (profile.address) add('Address', profile.address, `https://maps.google.com/?q=${encodeURIComponent(profile.address)}`, true);
  const phone = String(profile.phone || '').replace(/[^+\d]/g, '');
  if (profile.phone) add('Phone', profile.phone, phone ? `tel:${phone}` : '');
  if (profile.email) add('Email', profile.email, `mailto:${profile.email}`);
  if (profile.website?.label) add('Website', profile.website.label, safeWebsite(profile.website.href), true);
  return rows.join('');
}

function renderProfileHours(profile) {
  return (Array.isArray(profile.hours) ? profile.hours : []).filter(item => item && item.days && item.time)
    .map(item => `<li><span>${escapeHtml(item.days)}</span><strong>${escapeHtml(item.time)}</strong></li>`).join('');
}

function renderRelatedBusinesses(profile, slug, profiles, data) {
  const city = String(profile.city || '').toLocaleLowerCase();
  const related = getPublishedProfiles(profiles).filter(([otherSlug, other]) =>
    otherSlug !== slug && String(other.city || '').toLocaleLowerCase() === city && other.name
  ).slice(0, 3);
  if (!related.length) return '';
  return `<section class="profile-panel seo-related-profiles" aria-labelledby="relatedBusinessTitle"><div class="profile-panel-heading"><div><p class="small-title">Explore nearby</p><h2 id="relatedBusinessTitle">More businesses in ${escapeHtml(profile.city)}</h2></div></div><ul>${related.map(([otherSlug, other]) => `<li><a href="${businessProfilePath(otherSlug)}">${escapeHtml(other.name)}</a><span>${escapeHtml([other.category, other.city].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul></section>`;
}

function businessProfilePath(slug) {
  return `/business/${encodeURIComponent(slug)}`;
}

function replaceProfileMeta(html, profile, slug, profiles = {}, data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')), guidePages = []) {
  if (!profile || profile.demo !== false) return html;
  const canonical = businessProfilePath(slug);
  const canonicalUrl = absoluteUrl(canonical);
  const city = String(profile.city || '').trim();
  const state = String(profile.state || 'PA').trim();
  const title = `${profile.name} · ${profile.category || 'Business'} in ${city}${city ? ', ' : ''}${state} | Price Market`;
  const summary = String(profile.description || '').trim();
  const listingWords = [
    Array.isArray(profile.deals) && profile.deals.length ? 'deals' : '',
    Array.isArray(profile.happyHours) && profile.happyHours.length ? 'Happy Hours' : '',
    Array.isArray(profile.jobs) && profile.jobs.length ? 'job openings' : ''
  ].filter(Boolean);
  const details = listingWords.length ? ` Current listings include ${listingWords.join(', ')}.` : '';
  const description = (summary ? `${summary}` : `${profile.name} business profile`)
    + ` Explore business details for ${city}${city ? ', ' : ''}${state} on Price Market.${details}`;
  const hero = absoluteAsset(profile.heroImage?.src);
  const logo = absoluteAsset(profile.logoImage);
  const image = hero || logo || `${SITE_ORIGIN}/pm-logo.png`;
  const setContent = (id, value) => {
    const escaped = escapeHtml(value);
    const pattern = new RegExp(`(<[^>]+id="${id}"[^>]*content=")[^"]*(")`);
    html = html.replace(pattern, (_match, prefix, suffix) => `${prefix}${escaped}${suffix}`);
  };
  const setLink = (id, value) => {
    const escaped = escapeHtml(value);
    const pattern = new RegExp(`(<link[^>]+id="${id}"[^>]*href=")[^"]*(")`);
    html = html.replace(pattern, (_match, prefix, suffix) => `${prefix}${escaped}${suffix}`);
  };
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${escapeHtml(description.slice(0, 300))}">`);
  setContent('profileRobots', 'index,follow,max-image-preview:large');
  setContent('profileOgTitle', title);
  setContent('profileOgDescription', description);
  setContent('profileTwitterTitle', title);
  setContent('profileTwitterDescription', description);
  setContent('profileOgImage', image);
  setContent('profileTwitterImage', image);
  setContent('profileOgUrl', canonicalUrl);
  setLink('profileCanonical', canonicalUrl);
  html = html.replace(/(<meta property="og:type" content=")[^"]*(")/, (_m, a, b) => `${a}profile${b}`);
  const jsonLd = JSON.stringify(buildBusinessProfileJsonLd(profile, slug)).replace(/</g, '\\u003c');
  html = html.replace(/(<script type="application\/ld\+json" id="profileStructuredData">)[\s\S]*?(<\/script>)/, (_match, prefix, suffix) => `${prefix}${jsonLd}${suffix}`);

  html = html.replace('<main class="profile-page" id="profileRoot" hidden>', '<main class="profile-page" id="profileRoot" data-prerendered="true">');
  html = html.replace('<section class="profile-hero" aria-labelledby="businessName">', `${staticProfileBreadcrumbs(profile, data)}\n      <section class="profile-hero" aria-labelledby="businessName">`);

  const heroImage = profileImageTag('businessHero', profile.heroImage?.src, profile.heroImage?.alt, { hero: true, width: profile.heroImage?.width, height: profile.heroImage?.height });
  html = html.replace(/<img id="businessHero"[^>]*>/, heroImage);
  html = html.replace('<span class="profile-cover-caption" id="businessCoverCaption"></span>', `<span class="profile-cover-caption" id="businessCoverCaption">${escapeHtml([city, state].filter(Boolean).join(', '))}</span>`);
  html = html.replace(/<span class="profile-demo-label" id="businessDemoLabel">[^<]*<\/span>/, '<span class="profile-demo-label" id="businessDemoLabel" hidden></span>');

  html = replaceElementInner(html, 'businessName', escapeHtml(profile.name));
  html = replaceElementInner(html, 'businessCategoryCity', escapeHtml([profile.category, city, state].filter(Boolean).join(' · ')));
  html = replaceElementInner(html, 'businessDescription', escapeHtml(summary));
  const avatar = profile.logoImage
    ? `<img src="${escapeHtml(absoluteAsset(profile.logoImage))}" alt="${escapeHtml(profile.name)} logo" loading="eager" decoding="async">`
    : escapeHtml(profile.avatarText || String(profile.name || '').split(/\s+/).map(part => part[0]).join('').slice(0, 2));
  html = replaceElementInner(html, 'businessAvatar', avatar);
  html = replaceElementInner(html, 'businessTags', [city, profile.category].filter(Boolean).map(item => `<span>${escapeHtml(item)}</span>`).join(''));
  html = replaceElementInner(html, 'businessActions', profileActions(profile));
  html = replaceElementInner(html, 'businessDeals', renderProfileDeals(profile));
  html = replaceElementInner(html, 'businessHappyHours', renderProfileHappyHours(profile));
  html = replaceElementInner(html, 'businessJobs', renderProfileJobs(profile));
  html = replaceElementInner(html, 'businessGallery', renderProfileGallery(profile));
  html = replaceElementInner(html, 'businessContact', renderProfileContact(profile));
  html = replaceElementInner(html, 'businessHours', renderProfileHours(profile));
  html = replaceElementInner(html, 'profileFooterNote', 'Central Pennsylvania');

  const happyHours = (Array.isArray(profile.happyHours) ? profile.happyHours : []).filter(entry => entry && entry.title && entry.days);
  if (happyHours.length) {
    html = editTagById(html, 'happyHours', tag => tag.replace(' hidden', ''));
    html = replaceElementInner(html, 'happyHourExampleTag', 'Current Happy Hour');
  }
  if (Array.isArray(profile.jobs) && profile.jobs.length) html = editTagById(html, 'jobs', tag => tag.replace(' hidden', ''));
  if (Array.isArray(profile.gallery) && profile.gallery.length) html = editTagById(html, 'profileGallery', tag => tag.replace(' hidden', ''));
  if (Array.isArray(profile.hours) && profile.hours.length) html = editTagById(html, 'profileHours', tag => tag.replace(' hidden', ''));
  html = editTagById(html, 'profileDemoNote', tag => tag.replace('>', ' hidden>'));

  const related = renderRelatedBusinesses(profile, slug, profiles, data);
  if (related) html = html.replace('<section class="profile-bottom-cta">', `${related}\n      <section class="profile-bottom-cta">`);
  const guideLinks = renderBusinessGuideLinks(guidePages, slug);
  if (guideLinks) html = html.replace('<section class="profile-bottom-cta">', `${guideLinks}
      <section class="profile-bottom-cta">`);
  return html;
}

function jsonLdGraph({ route, title, description, breadcrumbs }) {
  const pageUrl = absoluteUrl(route);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_ORIGIN}/#organization`,
        name: 'Price Market LLC',
        url: `${SITE_ORIGIN}/`,
        description: 'A Central Pennsylvania marketplace for local deals, Happy Hours, businesses, and jobs.',
        logo: { '@type': 'ImageObject', url: `${SITE_ORIGIN}/pm-logo.png` }
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_ORIGIN}/#website`,
        url: `${SITE_ORIGIN}/`,
        name: 'Price Market',
        publisher: { '@id': `${SITE_ORIGIN}/#organization` },
        potentialAction: {
          '@type': 'SearchAction',
          target: `${SITE_ORIGIN}/?q={search_term_string}`,
          'query-input': 'required name=search_term_string'
        }
      },
      {
        '@type': 'WebPage',
        '@id': `${pageUrl}#webpage`,
        url: pageUrl,
        name: title,
        description,
        isPartOf: { '@id': `${SITE_ORIGIN}/#website` }
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: breadcrumbs.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          item: absoluteUrl(item.route)
        }))
      }
    ]
  };
}

function renderMeta({ title, description, route, indexable, graph }) {
  const url = absoluteUrl(route);
  const robots = indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow';
  const ld = JSON.stringify(graph).replace(/</g, '\\u003c');
  return `  <title>${escapeHtml(title)}</title>\n`
    + `  <meta name="description" content="${escapeHtml(description)}">\n`
    + `  <meta name="robots" content="${robots}">\n`
    + `  <link rel="canonical" href="${url}">\n`
    + `  <meta property="og:type" content="website">\n`
    + `  <meta property="og:site_name" content="Price Market">\n`
    + `  <meta property="og:title" content="${escapeHtml(title)}">\n`
    + `  <meta property="og:description" content="${escapeHtml(description)}">\n`
    + `  <meta property="og:url" content="${url}">\n`
    + `  <meta property="og:image" content="${SITE_ORIGIN}/favicon-32x32.png">\n`
    + `  <meta property="og:image:alt" content="Price Market Central PA marketplace">\n`
    + `  <meta name="twitter:card" content="summary">\n`
    + `  <meta name="twitter:title" content="${escapeHtml(title)}">\n`
    + `  <meta name="twitter:description" content="${escapeHtml(description)}">\n`
    + `  <meta name="twitter:image" content="${SITE_ORIGIN}/favicon-32x32.png">\n`
    + `  <script type="application/ld+json">${ld}</script>\n`;
}

function renderHeader() {
  return `<div class="site seo-site">\n`
    + `  <header class="nav seo-nav">\n`
    + `    <a class="brand" href="/" aria-label="Price Market home"><img src="/pm-logo.png" alt="Price Market PM logo"><div><span>Price Market</span><small>Central PA Marketplace</small></div></a>\n`
    + `    <nav class="nav-links" aria-label="Main navigation"><a href="/#marketplace">Marketplace</a><a href="/for-businesses">For Businesses</a><a href="/about">About</a></nav>\n`
    + `    <div class="nav-actions"><a class="btn blue small" href="/#marketplace">Explore local</a></div>\n`
    + `  </header>\n`;
}

function renderBreadcrumbs(items) {
  return `<nav class="seo-breadcrumbs" aria-label="Breadcrumb">${items.map((item, index) =>
    `${index ? '<span aria-hidden="true">/</span>' : ''}<a href="${item.route}">${escapeHtml(item.name)}</a>`
  ).join('')}</nav>`;
}

function renderCategoryLinks(city, categories) {
  return `<div class="seo-category-grid">${categories.map(category => `
    <a class="seo-category-card" href="${routeForCategory(city, category)}">
      <span>${escapeHtml(category.label)}</span>
      <strong>${escapeHtml(fillCity(category.cardTitle, city.name))}</strong>
      <small>${escapeHtml(category.cardCopy)}</small>
      <span class="seo-card-link">${escapeHtml(category.actionLabel)} <span aria-hidden="true">→</span></span>
    </a>`).join('')}
  </div>`;
}

function renderCityPage(city, data, profiles = {}, guidePages = []) {
  const route=routeForCity(city), title=city.title, description=city.description;
  const breadcrumbs=[{name:'Price Market',route:'/'},{name:`${city.name}, PA`,route}];
  const graph=jsonLdGraph({route,title,description,breadcrumbs});
  const sections=data.categories.map(category=>{
    const entries=approvedListingEntriesFor(profiles,city,category);
    const cards=entries.length?`<div class="seo-listing-grid">${entries.map(({slug,profile,listing})=>renderApprovedListingCard(slug,profile,listing,category)).join('')}</div>`:`<p class="seo-empty-state">There are no approved ${escapeHtml(category.label.toLocaleLowerCase())} listings for ${escapeHtml(city.name)} yet. Browse another listing type or check back as Price Market reviews submissions.</p>`;
    return `<section class="seo-local-section seo-city-listing-section" aria-labelledby="city-${category.slug}-title"><div class="seo-section-heading"><div><p class="small-title">${escapeHtml(city.name)}, PA</p><h2 id="city-${category.slug}-title">${escapeHtml(category.label)} in ${escapeHtml(city.name)}</h2></div><a href="${routeForCategory(city,category)}">Browse ${escapeHtml(category.label.toLocaleLowerCase())} <span aria-hidden="true">&rarr;</span></a></div>${cards}</section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${renderMeta({title,description,route,indexable:true,graph})}<meta name="theme-color" content="#1454e6"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="stylesheet" href="/styles.css"></head>
<body>${renderHeader()}<main class="seo-local-page" id="main">${renderBreadcrumbs(breadcrumbs)}
<section class="seo-local-hero" aria-labelledby="pageTitle"><p class="small-title">Central Pennsylvania · ${escapeHtml(city.name)}</p><h1 id="pageTitle">${escapeHtml(city.h1)}</h1>${city.intro.map(p=>`<p>${escapeHtml(p)}</p>`).join('')}<a class="btn blue" href="${homeFilterUrl(city,data.categories.find(x=>x.filterType==='all'))}">Browse the ${escapeHtml(city.name)} marketplace</a></section>
${sections}
${renderGuideLinks(guidePages, city.slug)}
<section class="seo-local-section" aria-labelledby="discoveryTitle"><p class="small-title">Browse by what you need</p><h2 id="discoveryTitle">${escapeHtml(city.sectionHeading)}</h2>${renderCategoryLinks(city,data.categories)}</section>
<section class="seo-local-note" aria-labelledby="localGuideTitle"><h2 id="localGuideTitle">${escapeHtml(city.guideHeading)}</h2>${city.guide.map(p=>`<p>${escapeHtml(p)}</p>`).join('')}</section>
<section class="seo-market-disclosure" aria-labelledby="reviewTitle"><h2 id="reviewTitle">Listings are reviewed before they go live</h2><p>Only approved, non-demo business information appears in these listing sections. New business submissions stay pending until a person reviews them. When a section is empty, there are no approved listings of that type in ${escapeHtml(city.name)} yet.</p><a href="/#marketplace">Open the Central PA marketplace <span aria-hidden="true">&rarr;</span></a></section>
<nav class="seo-nearby" aria-label="Other launch cities"><h2>Explore other Central PA launch cities</h2><ul>${data.cities.filter(item=>item.slug!==city.slug).map(item=>`<li><a href="${routeForCity(item)}">${escapeHtml(item.name)}, PA</a></li>`).join('')}</ul></nav></main>
<footer class="seo-footer"><a href="/">Price Market home</a><span>Central Pennsylvania marketplace</span><a href="/for-businesses">For Businesses</a><a href="/about">About</a></footer></div></body></html>`;
}

function renderApprovedListingCard(slug,profile,listing,category){
 const name=String(profile.name||'').trim(), href=businessProfilePath(slug);
 const summary=category.filterType==='deal'||category.filterType==='happy-hour'?listing.description||'':category.filterType==='job'?listing.detail||listing.description||listing.details||'':profile.description||'';
 const meta=[profile.category,profile.city,profile.state||'PA'].filter(Boolean).join(' · ');
 const schedule=category.filterType==='happy-hour'?[listing.days,formatProfileTime(listing.startTime),listing.endTime?`– ${formatProfileTime(listing.endTime)}`:''].filter(Boolean).join(' · '):'';
 return `<article class="seo-listing-card"><div class="seo-listing-card-copy"><p class="seo-listing-type">${escapeHtml(category.label)}</p><h3><a href="${escapeHtml(href)}">${escapeHtml(category.filterType==='business'?name:(listing.title||name))}</a></h3>${category.filterType!=='business'?`<p class="seo-listing-business">From <a href="${escapeHtml(href)}">${escapeHtml(name)}</a></p>`:''}<p class="seo-listing-meta">${escapeHtml(meta)}</p>${summary?`<p>${escapeHtml(summary)}</p>`:''}${schedule?`<p class="seo-listing-meta">${escapeHtml(schedule)}</p>`:''}</div><a class="seo-card-link" href="${escapeHtml(href)}">View business profile <span aria-hidden="true">&rarr;</span></a></article>`;
}

function renderCategoryPage(city,category,data,profiles){
 const route=routeForCategory(city,category), title=fillCity(category.title,city.name), description=fillCity(category.description,city.name);
 const entries=approvedListingEntriesFor(profiles,city,category), indexable=categoryIsIndexable(profiles,city,category);
 const breadcrumbs=[{name:'Price Market',route:'/'},{name:`${city.name}, PA`,route:routeForCity(city)},{name:category.label,route}];
 const graph=jsonLdGraph({route,title,description,breadcrumbs}), contextual=city.discoveryNotes[category.slug];
 const listingHtml=entries.length?`<div class="seo-listing-grid">${entries.map(({slug,profile,listing})=>renderApprovedListingCard(slug,profile,listing,category)).join('')}</div>`:`<p class="seo-empty-state">There are no approved ${escapeHtml(category.label.toLocaleLowerCase())} listings for ${escapeHtml(city.name)} yet. This page remains noindex until it has at least ${MIN_APPROVED_PROFILES_FOR_CATEGORY_INDEX} approved, non-demo matching listings and meaningful unique local content.</p>`;
 return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${renderMeta({title,description,route,indexable,graph})}<meta name="theme-color" content="#1454e6"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="stylesheet" href="/styles.css"></head>
<body>${renderHeader()}<main class="seo-local-page seo-category-page" id="main">${renderBreadcrumbs(breadcrumbs)}
<section class="seo-local-hero" aria-labelledby="pageTitle"><p class="small-title">${escapeHtml(city.name)}, Pennsylvania · ${escapeHtml(category.label)}</p><h1 id="pageTitle">${escapeHtml(fillCity(category.h1,city.name))}</h1><p>${escapeHtml(contextual)} ${escapeHtml(category.intro)}</p><a class="btn blue" href="${homeFilterUrl(city,category)}">${escapeHtml(category.browseLabel)} in ${escapeHtml(city.name)}</a></section>
<section class="seo-local-section" aria-labelledby="currentListingsTitle"><p class="small-title">Approved local listings</p><h2 id="currentListingsTitle">${escapeHtml(category.label)} in ${escapeHtml(city.name)}</h2>${listingHtml}</section>
<section class="seo-local-section" aria-labelledby="helpTitle"><p class="small-title">A useful place to start</p><h2 id="helpTitle">${escapeHtml(fillCity(category.guideHeading,city.name))}</h2><p>${escapeHtml(category.guideCopy)}</p><ul class="seo-checklist">${category.checklist.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul></section>
<nav class="seo-category-nav" aria-label="Other listing types in ${escapeHtml(city.name)}"><h2>More in ${escapeHtml(city.name)}</h2>${data.categories.filter(item=>item.slug!==category.slug).map(item=>`<a href="${routeForCategory(city,item)}">${escapeHtml(item.label)}</a>`).join('')}</nav></main>
<footer class="seo-footer"><a href="${routeForCity(city)}">${escapeHtml(city.name)} city guide</a><a href="/">Price Market home</a><a href="/for-businesses">For Businesses</a><a href="/about">About</a></footer></div></body></html>`;
}

function loadBusinesses(filePath = path.join(ROOT, 'businesses.js')) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(filePath, 'utf8'), sandbox, { filename: filePath });
  return sandbox.window.priceMarketBusinesses || {};
}

function renderSitemap(data, profiles, guidePages = []) {
  const routes = ['/', '/about', '/for-businesses', ...data.cities.map(routeForCity)];
  for (const city of data.cities) {
    for (const category of data.categories) {
      if (categoryIsIndexable(profiles, city, category)) routes.push(routeForCategory(city, category));
    }
  }
  for (const [slug] of getPublishedProfiles(profiles)) routes.push(`/business/${encodeURIComponent(slug)}`);
  for (const guide of guidePages) if (guide.indexable) routes.push(guide.route);
  const urls = [...new Set(routes)].map(route => `  <url><loc>${absoluteUrl(route)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function generateLocalSeoPages({ rootDir = ROOT, data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')), profiles = loadBusinesses(), profileTemplate = fs.readFileSync(path.join(ROOT, 'business-profile.html'), 'utf8'), guides = JSON.parse(fs.readFileSync(GUIDE_DATA_FILE, 'utf8')) } = {}) {
  const generated = [];
  const guidePages = generateLocalGuidePages({ rootDir, guides, profiles, cities: data.cities });
  for (const city of data.cities) {
    const cityDir = path.join(rootDir, city.slug);
    fs.mkdirSync(cityDir, { recursive: true });
    fs.writeFileSync(path.join(cityDir, 'index.html'), renderCityPage(city, data, profiles, guidePages));
    generated.push(`${city.slug}/index.html`);
    for (const category of data.categories) {
      const categoryDir = path.join(cityDir, category.slug);
      fs.mkdirSync(categoryDir, { recursive: true });
      fs.writeFileSync(path.join(categoryDir, 'index.html'), renderCategoryPage(city, category, data, profiles));
      generated.push(`${city.slug}/${category.slug}/index.html`);
    }
  }
  for (const [slug, profile] of getPublishedProfiles(profiles)) {
    if (!safeBusinessSlug(slug)) throw new Error(`Approved business has an unsafe slug: ${slug}`);
    const profileDir = path.join(rootDir, 'business', slug);
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'index.html'), replaceProfileMeta(profileTemplate, profile, slug, profiles, data, guidePages));
    generated.push(`business/${slug}/index.html`);
  }
  const homePath = path.join(rootDir, 'index.html');
  if (fs.existsSync(homePath)) {
    let home = fs.readFileSync(homePath, 'utf8');
    const marker = /<!-- PRICE_MARKET_GUIDE_LINKS:START -->[\s\S]*?<!-- PRICE_MARKET_GUIDE_LINKS:END -->/;
    if (marker.test(home)) home = home.replace(marker, `<!-- PRICE_MARKET_GUIDE_LINKS:START -->\n${renderHomeGuideLinks(guidePages)}\n<!-- PRICE_MARKET_GUIDE_LINKS:END -->`);
    fs.writeFileSync(homePath, home);
  }
  fs.writeFileSync(path.join(rootDir, 'sitemap.xml'), renderSitemap(data, profiles, guidePages));
  return generated.concat(guidePages.filter(guide => guide.generated).map(guide => `guides/${guide.slug}/index.html`));
}

if (require.main === module) {
  const generated = generateLocalSeoPages();
  process.stdout.write(`Generated ${generated.length} city and local discovery pages; sitemap.xml refreshed.\n`);
}

module.exports = {
  SITE_ORIGIN,
  MIN_APPROVED_PROFILES_FOR_CATEGORY_INDEX,
  categoryIsIndexable,
  generateLocalSeoPages,
  getPublishedProfiles,
  renderGuideLinks,
  renderHomeGuideLinks,
  homeFilterUrl,
  renderCategoryPage,
  renderCityPage,
  renderProfileMeta: replaceProfileMeta,
  renderSitemap,
  routeForCategory,
  routeForCity
};
