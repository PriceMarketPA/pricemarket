#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { absoluteAsset, buildLocalBusinessSchema, profileUrl } = require('../local-seo');

const SITE_ORIGIN = 'https://pricemarketpa.com';
const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'local-seo.json');
const MIN_APPROVED_PROFILES_FOR_CATEGORY_INDEX = 3;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function routeForCity(city) { return `/${city.slug}/`; }
function routeForCategory(city, category) { return `/${city.slug}/${category.slug}/`; }
function homeFilterUrl(city, category) {
  const params = new URLSearchParams({ city: city.name, type: category?.filterType || "all" });
  return `/?${params.toString()}#marketplace`;
}

function fillCity(value, cityName) { return String(value || "").replaceAll("{city}", cityName); }

function getPublishedProfiles(profiles) {
  return Object.entries(profiles || {}).filter(([, profile]) => profile && profile.demo === false);
}

function profileHasType(profile, type) {
  if (type === 'business') return true;
  const collection = type === 'deal' ? 'deals' : type === 'happy-hour' ? 'happyHours' : 'jobs';
  return Array.isArray(profile[collection]) && profile[collection].length > 0;
}

function approvedProfilesFor(profiles, city, category) {
  return getPublishedProfiles(profiles).filter(([, profile]) =>
    String(profile.city || '').trim().toLocaleLowerCase() === city.name.toLocaleLowerCase()
    && profileHasType(profile, category.filterType)
  );
}

function categoryIsIndexable(profiles, city, category) {
  return approvedProfilesFor(profiles, city, category).length >= MIN_APPROVED_PROFILES_FOR_CATEGORY_INDEX
    && (city.discoveryNotes?.[category.slug] || '').trim().split(/\s+/).filter(Boolean).length >= 35;
}

function absoluteUrl(route) { return `${SITE_ORIGIN}${route}`; }

function safeBusinessSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function replaceProfileMeta(html, profile, slug) {
  const canonical = profileUrl(slug);
  const title = `${profile.name} | Business Profile | Price Market`;
  const description = String(profile.description || `Explore ${profile.name} in ${profile.city}, ${profile.state} on Price Market.`).trim().slice(0, 300);
  const image = absoluteAsset(profile.heroImage && profile.heroImage.src) || `${SITE_ORIGIN}/favicon-32x32.png`;
  const setContent = (id, value) => {
    const escaped = escapeHtml(value);
    const pattern = new RegExp(`(<[^>]+id="${id}"[^>]*content=")[^"]*(")`);
    html = html.replace(pattern, (_match, prefix, suffix) => `${prefix}${escaped}${suffix}`);
  };
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${escapeHtml(description)}">`);
  setContent('profileRobots', 'index,follow,max-image-preview:large');
  setContent('profileOgTitle', title);
  setContent('profileOgDescription', description);
  setContent('profileTwitterTitle', title);
  setContent('profileTwitterDescription', description);
  setContent('profileOgImage', image);
  setContent('profileTwitterImage', image);
  html = html.replace(/(<link rel="canonical" id="profileCanonical" href=")[^"]*(")/, (_match, prefix, suffix) => `${prefix}${canonical}${suffix}`);
  html = html.replace(/(<meta property="og:url" id="profileOgUrl" content=")[^"]*(")/, (_match, prefix, suffix) => `${prefix}${canonical}${suffix}`);
  const schema = buildLocalBusinessSchema(profile, slug);
  const jsonLd = schema ? JSON.stringify(schema).replace(/</g, '\\u003c') : '';
  html = html.replace(/(<script type="application\/ld\+json" id="profileStructuredData">)[\s\S]*?(<\/script>)/, (_match, prefix, suffix) => `${prefix}${jsonLd}${suffix}`);
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
        name: 'Price Market',
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
    + `    <nav class="nav-links" aria-label="Main navigation"><a href="/#marketplace">Marketplace</a><a href="/business-onboarding.html">List your business</a></nav>\n`
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

function renderCityPage(city, data) {
  const route = routeForCity(city);
  const title = city.title;
  const description = city.description;
  const breadcrumbs = [{ name: 'Home', route: '/' }, { name: city.name, route }];
  const graph = jsonLdGraph({ route, title, description, breadcrumbs });
  return `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${renderMeta({ title, description, route, indexable: true, graph })}  <meta name="theme-color" content="#1454e6">\n  <link rel="icon" href="/favicon.ico" sizes="any">\n  <link rel="stylesheet" href="/styles.css">\n</head>\n<body>\n${renderHeader()}  <main class="seo-local-page" id="main">\n    ${renderBreadcrumbs(breadcrumbs)}\n    <section class="seo-local-hero" aria-labelledby="pageTitle">\n      <p class="small-title">Central Pennsylvania · ${escapeHtml(city.name)}</p>\n      <h1 id="pageTitle">${escapeHtml(city.h1)}</h1>\n      ${city.intro.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('\n      ')}\n      <a class="btn blue" href="${homeFilterUrl(city, data.categories.find(x => x.filterType === 'all'))}">Browse the ${escapeHtml(city.name)} marketplace</a>\n    </section>\n    <section class="seo-local-section" aria-labelledby="discoveryTitle">\n      <p class="small-title">Browse by what you need</p>\n      <h2 id="discoveryTitle">${escapeHtml(city.sectionHeading)}</h2>\n      ${renderCategoryLinks(city, data.categories)}\n    </section>\n    <section class="seo-local-note" aria-labelledby="localGuideTitle">\n      <h2 id="localGuideTitle">${escapeHtml(city.guideHeading)}</h2>\n      ${city.guide.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('\n      ')}\n    </section>\n    <section class="seo-market-disclosure" aria-labelledby="reviewTitle">\n      <h2 id="reviewTitle">Real listings are reviewed before they go live</h2>\n      <p>Price Market’s sample offers and demo profiles are labeled as examples. Business submissions remain pending until a person reviews them. Browse the marketplace to see clearly labeled examples and the current approved listings, if available.</p>\n      <a href="/#marketplace">Open the Central PA marketplace <span aria-hidden="true">→</span></a>\n    </section>\n    <nav class="seo-nearby" aria-label="Other launch cities"><h2>Explore other Central PA launch cities</h2><ul>${data.cities.filter(item => item.slug !== city.slug).map(item => `<li><a href="${routeForCity(item)}">${escapeHtml(item.name)}, PA</a></li>`).join('')}</ul></nav>\n  </main>\n  <footer class="seo-footer"><a href="/">Price Market home</a><span>Central Pennsylvania marketplace</span><a href="/business-onboarding.html">List your business</a></footer>\n</div>\n</body>\n</html>\n`;
}

function renderCategoryPage(city, category, data, profiles) {
  const route = routeForCategory(city, category);
  const title = fillCity(category.title, city.name);
  const description = fillCity(category.description, city.name);
  const indexable = categoryIsIndexable(profiles, city, category);
  const breadcrumbs = [
    { name: 'Home', route: '/' },
    { name: `${city.name}, PA`, route: routeForCity(city) },
    { name: category.label, route }
  ];
  const graph = jsonLdGraph({ route, title, description, breadcrumbs });
  const contextual = city.discoveryNotes[category.slug];
  return `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${renderMeta({ title, description, route, indexable, graph })}  <meta name="theme-color" content="#1454e6">\n  <link rel="icon" href="/favicon.ico" sizes="any">\n  <link rel="stylesheet" href="/styles.css">\n</head>\n<body>\n${renderHeader()}  <main class="seo-local-page seo-category-page" id="main">\n    ${renderBreadcrumbs(breadcrumbs)}\n    <section class="seo-local-hero" aria-labelledby="pageTitle">\n      <p class="small-title">${escapeHtml(city.name)}, Pennsylvania · ${escapeHtml(category.label)}</p>\n      <h1 id="pageTitle">${escapeHtml(fillCity(category.h1, city.name))}</h1>\n      <p>${escapeHtml(contextual)}</p>\n      <p>${escapeHtml(category.intro)}</p>\n      <a class="btn blue" href="${homeFilterUrl(city, category)}">${escapeHtml(category.browseLabel)} in ${escapeHtml(city.name)}</a>\n    </section>\n    <section class="seo-local-section" aria-labelledby="helpTitle">\n      <p class="small-title">A useful place to start</p>\n      <h2 id="helpTitle">${escapeHtml(fillCity(category.guideHeading, city.name))}</h2>\n      <p>${escapeHtml(category.guideCopy)}</p>\n      <ul class="seo-checklist">${category.checklist.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>\n    </section>\n    <section class="seo-market-disclosure" aria-labelledby="reviewTitle">\n      <h2 id="reviewTitle">Browse current ${escapeHtml(category.label.toLocaleLowerCase())}</h2>\n      <p>Example listings on Price Market are labeled. Only profiles approved through human review are published as real business listings. If this filter has no matches yet, clear or change the filters to explore other Central PA listings.</p>\n      <a href="${homeFilterUrl(city, category)}">Open the filtered marketplace <span aria-hidden="true">→</span></a>\n    </section>\n    <nav class="seo-category-nav" aria-label="Other listing types in ${escapeHtml(city.name)}"><h2>More in ${escapeHtml(city.name)}</h2>${data.categories.filter(item => item.slug !== category.slug).map(item => `<a href="${routeForCategory(city, item)}">${escapeHtml(item.label)}</a>`).join('')}</nav>\n  </main>\n  <footer class="seo-footer"><a href="${routeForCity(city)}">${escapeHtml(city.name)} city guide</a><a href="/">Price Market home</a><a href="/business-onboarding.html">List your business</a></footer>\n</div>\n</body>\n</html>\n`;
}

function loadBusinesses(filePath = path.join(ROOT, 'businesses.js')) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(filePath, 'utf8'), sandbox, { filename: filePath });
  return sandbox.window.priceMarketBusinesses || {};
}

function renderSitemap(data, profiles) {
  const routes = ['/', ...data.cities.map(routeForCity)];
  for (const city of data.cities) {
    for (const category of data.categories) {
      if (categoryIsIndexable(profiles, city, category)) routes.push(routeForCategory(city, category));
    }
  }
  for (const [slug] of getPublishedProfiles(profiles)) routes.push(`/business/${encodeURIComponent(slug)}/`);
  const urls = [...new Set(routes)].map(route => `  <url><loc>${absoluteUrl(route)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function generateLocalSeoPages({ rootDir = ROOT, data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')), profiles = loadBusinesses(), profileTemplate = fs.readFileSync(path.join(ROOT, 'business-profile.html'), 'utf8') } = {}) {
  const generated = [];
  for (const city of data.cities) {
    const cityDir = path.join(rootDir, city.slug);
    fs.mkdirSync(cityDir, { recursive: true });
    fs.writeFileSync(path.join(cityDir, 'index.html'), renderCityPage(city, data));
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
    fs.writeFileSync(path.join(profileDir, 'index.html'), replaceProfileMeta(profileTemplate, profile, slug));
    generated.push(`business/${slug}/index.html`);
  }
  fs.writeFileSync(path.join(rootDir, 'sitemap.xml'), renderSitemap(data, profiles));
  return generated;
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
  homeFilterUrl,
  renderCategoryPage,
  renderCityPage,
  renderProfileMeta: replaceProfileMeta,
  renderSitemap,
  routeForCategory,
  routeForCity
};
