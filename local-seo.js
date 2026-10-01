(function attachPriceMarketSeo(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PriceMarketSEO = api;
})(typeof globalThis === 'object' ? globalThis : this, function createPriceMarketSeo() {
  'use strict';

  const ORIGIN = 'https://pricemarketpa.com';

  function absoluteAsset(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try { return new URL(value, `${ORIGIN}/`).href; } catch { return ''; }
  }

  function postalAddress(value, city, state) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const streetAddress = String(value.streetAddress || '').trim();
      const addressLocality = String(value.addressLocality || city || '').trim();
      const addressRegion = String(value.addressRegion || state || '').trim();
      const postalCode = String(value.postalCode || '').trim();
      if (city && addressLocality.toLocaleLowerCase() !== String(city).trim().toLocaleLowerCase()) return null;
      if (state && addressRegion.toUpperCase() !== String(state).trim().toUpperCase()) return null;
      if (streetAddress && addressLocality && addressRegion && postalCode) {
        return { '@type': 'PostalAddress', streetAddress, addressLocality, addressRegion, postalCode, addressCountry: 'US' };
      }
      return null;
    }

    const raw = typeof value === 'string' ? value.trim() : '';
    const match = raw.match(/^(.+?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
    if (!match) return null;
    if (city && match[2].trim().toLocaleLowerCase() !== String(city).trim().toLocaleLowerCase()) return null;
    if (state && match[3].toUpperCase() !== String(state).trim().toUpperCase()) return null;
    return {
      '@type': 'PostalAddress',
      streetAddress: match[1].trim(),
      addressLocality: match[2].trim(),
      addressRegion: match[3].toUpperCase(),
      postalCode: match[4],
      addressCountry: 'US'
    };
  }

  function profileUrl(slug) {
    return `${ORIGIN}/business/${encodeURIComponent(slug)}/`;
  }

  function buildLocalBusinessSchema(profile, slug) {
    if (!profile || profile.demo !== false || !profile.name || !slug) return null;
    const address = postalAddress(profile.address, profile.city, profile.state);
    if (!address) return null;

    const canonical = profileUrl(slug);
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      '@id': `${canonical}#business`,
      name: String(profile.name).trim(),
      description: String(profile.description || '').trim(),
      address,
      mainEntityOfPage: canonical,
      url: profile.website && profile.website.href ? absoluteAsset(profile.website.href) : canonical
    };
    const image = absoluteAsset(profile.heroImage && profile.heroImage.src);
    if (image) schema.image = image;
    if (profile.phone) schema.telephone = String(profile.phone).trim();
    if (profile.email) schema.email = String(profile.email).trim();
    return schema;
  }

  return { ORIGIN, absoluteAsset, buildLocalBusinessSchema, postalAddress, profileUrl };
});
