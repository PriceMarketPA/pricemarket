(() => {
  const profiles = window.priceMarketBusinesses || {};
  const slug = new URLSearchParams(window.location.search).get('business') || 'keystone-pizza';
  const business = profiles[slug];
  const root = document.getElementById('profileRoot');
  const missing = document.getElementById('profileNotFound');

  if (!business) {
    missing.hidden = false;
    return;
  }

  root.hidden = false;
  document.title = `${business.name} | ${business.demo ? 'Demo Business Profile' : 'Business Profile'} | Price Market`;
  document.getElementById('businessDemoLabel').hidden = !business.demo;
  document.getElementById('profileDemoNote').hidden = !business.demo;
  document.getElementById('dealExampleTag').textContent = business.demo ? 'Example offers' : 'Current offers';
  document.getElementById('jobExampleTag').textContent = business.demo ? 'Example openings' : 'Open roles';
  document.getElementById('profileFooterNote').textContent = business.demo ? 'Demo profile · Central Pennsylvania' : 'Central Pennsylvania';
  document.getElementById('businessName').textContent = business.name;
  document.getElementById('businessCategoryCity').textContent = `${business.category} · ${business.city}, ${business.state}`;
  document.getElementById('businessDescription').textContent = business.description;

  const hero = document.getElementById('businessHero');
  hero.src = business.heroImage.src;
  hero.alt = business.heroImage.alt;
  document.getElementById('businessCoverCaption').textContent = `${business.city}, ${business.state}`;

  const avatar = document.getElementById('businessAvatar');
  if (business.logoImage) {
    const logo = document.createElement('img');
    logo.src = business.logoImage;
    logo.alt = `${business.name} logo`;
    avatar.append(logo);
  } else {
    avatar.textContent = business.avatarText || business.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2);
  }

  const tags = document.getElementById('businessTags');
  [business.city, business.category].forEach(text => {
    const tag = document.createElement('span');
    tag.textContent = text;
    tags.append(tag);
  });

  const actions = document.getElementById('businessActions');
  const addAction = (text, href, style, external = false) => {
    if (!href) return;
    const link = document.createElement('a');
    link.className = `btn ${style}`;
    link.href = href;
    link.textContent = text;
    if (external) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    actions.append(link);
  };
  addAction('Call', business.phone ? `tel:${business.phone.replace(/[^+\d]/g, '')}` : '', 'blue');
  addAction('Visit website', business.website?.href, 'white', true);
  addAction('View Deals', '#deals', 'dark');
  addAction('Claim this business', 'index.html#businesses', 'ghost');

  const deals = document.getElementById('businessDeals');
  (business.deals || []).forEach(deal => {
    const card = document.createElement('article');
    card.className = 'profile-deal-card';
    const label = document.createElement('span');
    label.className = 'profile-deal-label';
    label.textContent = business.demo ? 'Example deal' : 'Featured deal';
    const title = document.createElement('h3');
    title.textContent = deal.title;
    const detail = document.createElement('p');
    detail.textContent = deal.description;
    card.append(label, title, detail);
    deals.append(card);
  });
  if (!deals.childElementCount) deals.innerHTML = '<p class="profile-empty-state">Check back soon for local offers.</p>';

  function formatHappyHourTime(value) {
  if (!value) return '';
  const parts = value.split(':');
  if (parts.length !== 2 || parts[0].length !== 2 || parts[1].length !== 2) return value;
  const hour = Number(parts[0]);
  const minute = parts[1];
  if (!Number.isInteger(hour) || hour > 23 || !/^\\d{2}$/.test(minute) || Number(minute) > 59) return value;
  return (hour % 12 || 12) + ':' + minute + (hour < 12 ? ' AM' : ' PM');
})();

