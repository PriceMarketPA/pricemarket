(function attachPriceMarketSeo(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PriceMarketSEO = api;
})(typeof globalThis === 'object' ? globalThis : this, function createPriceMarketSeo() {
  'use strict';

  const ORIGIN = 'https://pricemarketpa.com';
  const CITY_SLUGS = Object.freeze({
    mechanicsburg: 'mechanicsburg',
    'camp hill': 'camp-hill',
    carlisle: 'carlisle',
    harrisburg: 'harrisburg',
    hershey: 'hershey'
  });
  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  function httpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value, `${ORIGIN}/`);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  }

  function absoluteAsset(value) {
    return httpUrl(value);
  }

  function cityRoute(city) {
    const key = String(city || '').trim().toLocaleLowerCase();
    const slug = CITY_SLUGS[key];
    return slug ? `/${slug}` : '';
  }

  function postalAddress(value, city, state) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const streetAddress = String(value.streetAddress || '').trim();
      const addressLocality = String(value.addressLocality || city || '').trim();
      const addressRegion = String(value.addressRegion || state || '').trim();
      const postalCode = String(value.postalCode || '').trim();
      if (city && addressLocality.toLocaleLowerCase() !== String(city).trim().toLocaleLowerCase()) return null;
      if (state && addressRegion.toUpperCase() !== String(state).trim().toUpperCase()) return null;
      if (!addressLocality && !addressRegion) return null;
      const address = { '@type': 'PostalAddress', addressCountry: 'US' };
      if (streetAddress) address.streetAddress = streetAddress;
      if (addressLocality) address.addressLocality = addressLocality;
      if (addressRegion) address.addressRegion = addressRegion;
      if (postalCode) address.postalCode = postalCode;
      return address;
    }

    const raw = typeof value === 'string' ? value.trim() : '';
    const match = raw.match(/^(.+?),\s*([^,]+),\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/i);
    if (!match) {
      const parts = raw.split(',').map(item => item.trim());
      if (parts.length === 2 && parts[1].toUpperCase() === String(state || '').toUpperCase()) return { '@type': 'PostalAddress', addressLocality: parts[0], addressRegion: parts[1].toUpperCase(), addressCountry: 'US' };
      if (!city || !state) return null;
      return { '@type': 'PostalAddress', addressLocality: String(city).trim(), addressRegion: String(state).trim().toUpperCase(), addressCountry: 'US' };
    }
    if (city && match[2].trim().toLocaleLowerCase() !== String(city).trim().toLocaleLowerCase()) return null;
    if (state && match[3].toUpperCase() !== String(state).trim().toUpperCase()) return null;
    const address = {
      '@type': 'PostalAddress',
      streetAddress: match[1].trim(),
      addressLocality: match[2].trim(),
      addressRegion: match[3].toUpperCase(),
      addressCountry: 'US'
    };
    if (match[4]) address.postalCode = match[4];
    return address;
  }

  function businessProfileUrl(slug) {
    return `${ORIGIN}/business/${encodeURIComponent(slug)}`;
  }

  function localBusinessType(category) {
    const value = String(category || '').toLocaleLowerCase();
    if (/\b(cafe|coffee shop|coffeehouse)\b/.test(value)) return 'CafeOrCoffeeShop';
    if (/\b(restaurant|pizzeria|pizza)\b/.test(value)) return 'Restaurant';
    if (/\b(beauty|salon|barber)\b/.test(value)) return 'BeautySalon';
    if (/\b(fitness|gym|yoga|pilates)\b/.test(value)) return 'ExerciseGym';
    if (/\b(home services|trades|contractor|construction|plumb|electrician|hvac)\b/.test(value)) return 'HomeAndConstructionBusiness';
    if (/\b(retail|shop|store|shopping)\b/.test(value)) return 'Store';
    if (/\bprofessional services?\b/.test(value)) return 'ProfessionalService';
    return 'LocalBusiness';
  }

  function dayList(value) {
    const raw = String(value || '').trim().toLocaleLowerCase();
    if (!raw || /\bclosed\b/.test(raw)) return [];
    if (/^(daily|every day|all days)$/.test(raw)) return DAY_NAMES.slice();
    if (/^weekdays$/.test(raw)) return DAY_NAMES.slice(0, 5);
    if (/^weekends$/.test(raw)) return DAY_NAMES.slice(5);
    const names = DAY_NAMES.map(name => name.toLocaleLowerCase());
    const aliases = new Map(DAY_NAMES.flatMap((name, index) => [
      [name.toLocaleLowerCase(), index],
      [name.slice(0, 3).toLocaleLowerCase(), index]
    ]));
    const range = raw.match(/^\s*(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\s*(?:-|–|—|\bthrough\b|\bto\b)\s*(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\s*$/);
    if (range) {
      const from = aliases.get(range[1].slice(0, 3)) ?? aliases.get(range[1]);
      const to = aliases.get(range[2].slice(0, 3)) ?? aliases.get(range[2]);
      if (from === undefined || to === undefined || to < from) return [];
      return DAY_NAMES.slice(from, to + 1);
    }
    const tokens = raw.split(/\s*(?:,|&|\band\b)\s*/).filter(Boolean);
    const indexes = tokens.map(token => aliases.get(token.slice(0, 3)) ?? aliases.get(token));
    return indexes.some(index => index === undefined) ? [] : [...new Set(indexes)].sort((a, b) => a - b).map(index => DAY_NAMES[index]);
  }

  function parseClock(value) {
    const raw = String(value || '').trim();
    let match = raw.match(/^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)$/i);
    if (match) {
      let hour = Number(match[1]);
      const minute = Number(match[2] || '00');
      if (hour < 1 || hour > 12) return '';
      hour = hour % 12 + (/PM/i.test(match[3]) ? 12 : 0);
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
    match = raw.match(/^(\d{2}):([0-5]\d)$/);
    if (!match || Number(match[1]) > 23) return '';
    return `${match[1]}:${match[2]}`;
  }

  function parseTimeRange(value) {
    const parts = String(value || '').trim().split(/\s+(?:to|–|—|-)\s+/i);
    if (parts.length !== 2) return null;
    const opens = parseClock(parts[0]);
    const closes = parseClock(parts[1]);
    if (!opens || !closes || closes <= opens) return null;
    return { opens, closes };
  }

  function openingHoursSpecifications(hours) {
    if (!Array.isArray(hours)) return [];
    return hours.flatMap(entry => {
      if (!entry || typeof entry !== 'object') return [];
      const days = dayList(entry.days || entry.day);
      let timeRange = parseTimeRange(entry.time);
      if (!timeRange && entry.opens && entry.closes) {
        const opens = parseClock(entry.opens);
        const closes = parseClock(entry.closes);
        if (opens && closes && closes > opens) timeRange = { opens, closes };
      }
      if (!days.length || !timeRange) return [];
      return [{
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: days.map(day => `https://schema.org/${day}`),
        opens: timeRange.opens,
        closes: timeRange.closes
      }];
    });
  }

  function buildBreadcrumbList(profile, slug) {
    const canonical = businessProfileUrl(slug);
    const crumbs = [{ name: 'Price Market', route: '/' }];
    const city = String(profile.city || '').trim();
    const cityUrl = cityRoute(city);
    if (city && cityUrl) {
      crumbs.push({ name: `${city}, PA`, route: cityUrl });
      crumbs.push({ name: String(profile.category || 'Businesses').trim(), route: `${cityUrl}/businesses` });
    }
    crumbs.push({ name: String(profile.name).trim(), route: canonical });
    return {
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumb`,
      itemListElement: crumbs.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        item: item.route.startsWith('http') ? item.route : new URL(item.route, `${ORIGIN}/`).href
      }))
    };
  }

  function buildLocalBusinessSchema(profile, slug) {
    if (!profile || profile.demo !== false || !String(profile.name || '').trim() || !slug) return null;
    const address = postalAddress(profile.address, profile.city, profile.state);
    const canonical = businessProfileUrl(slug);
    const website = httpUrl(profile.website && profile.website.href);
    const type = localBusinessType(profile.category);
    const schema = {
      '@context': 'https://schema.org',
      '@type': type,
      '@id': `${canonical}#business`,
      name: String(profile.name).trim(),
      mainEntityOfPage: canonical,
      url: website || canonical
    };
    const description = String(profile.description || '').trim();
    if (description) schema.description = description;
    if (address) schema.address = address;
    const images = [profile.heroImage?.src, profile.logoImage, ...(Array.isArray(profile.gallery) ? profile.gallery.map(photo => photo?.src) : [])]
      .map(absoluteAsset).filter(Boolean);
    if (images.length) schema.image = [...new Set(images)];
    const logo = absoluteAsset(profile.logoImage);
    if (logo) schema.logo = logo;
    if (profile.phone) schema.telephone = String(profile.phone).trim();
    if (profile.email) schema.email = String(profile.email).trim();
    const hours = openingHoursSpecifications(profile.hours);
    if (hours.length) schema.openingHoursSpecification = hours;
    return schema;
  }

  function buildBusinessProfileJsonLd(profile, slug) {
    if (!profile || profile.demo !== false || !profile.name || !slug) return null;
    const graph = [];
    const business = buildLocalBusinessSchema(profile, slug);
    if (business) graph.push(business);
    graph.push(buildBreadcrumbList(profile, slug));
    return { '@context': 'https://schema.org', '@graph': graph };
  }

  return {
    ORIGIN, CITY_SLUGS, absoluteAsset, cityRoute, postalAddress, businessProfileUrl,
    localBusinessType, dayList, parseClock, openingHoursSpecifications,
    buildLocalBusinessSchema, buildBreadcrumbList, buildBusinessProfileJsonLd
  };
});
