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
    const match = /^(\\d{2}):(\\d{2})$/.exec(value || '');
    if (!match) return value || '';
    const hour = Number(match[1]);
    const minute = match[2];
    if (hour > 23 || Number(minute) > 59) return value;
    return (hour % 12 || 12) + ':' + minute + (hour < 12 ? ' AM' : ' PM');
  }

  const happyHours = Array.isArray(business.happyHours)
    ? business.happyHours.filter(item => item && typeof item === 'object' && typeof item.title === 'string' && item.title.trim())
    : [];
  if (happyHours.length) {
    const section = document.getElementById('happyHours');
    section.hidden = false;
    document.getElementById('happyHourExampleTag').textContent = business.demo ? 'Example Happy Hour' : 'Current Happy Hour';
    const list = document.getElementById('businessHappyHours');
    happyHours.forEach(happyHour => {
      const card = document.createElement('article');
      card.className = 'profile-happy-hour-card';
      const label = document.createElement('span');
      label.className = 'profile-deal-label';
      label.textContent = business.demo ? 'Example Happy Hour' : 'Happy Hour';
      const title = document.createElement('h3');
      title.textContent = happyHour.title;
      const description = document.createElement('p');
      description.textContent = happyHour.description || 'Ask the business for offer details.';
      const schedule = document.createElement('strong');
      const times = [formatHappyHourTime(happyHour.startTime), formatHappyHourTime(happyHour.endTime)].filter(Boolean).join('–');
      schedule.className = 'profile-happy-hour-schedule';
      schedule.textContent = [happyHour.days || '', times].filter(Boolean).join(' · ');
      card.append(label, title, description, schedule);
      const notes = happyHour.restrictions || happyHour.notes;
      if (notes) {
        const restriction = document.createElement('small');
        restriction.className = 'profile-happy-hour-notes';
        restriction.textContent = notes;
        card.append(restriction);
      }
      list.append(card);
    });
  }

  const jobs = business.jobs || [];
  if (jobs.length) {
    document.getElementById('jobs').hidden = false;
    const list = document.getElementById('businessJobs');
    jobs.forEach(job => {
      const row = document.createElement('article');
      row.className = 'profile-job-card';
      const mark = document.createElement('span');
      mark.className = 'profile-job-mark';
      mark.textContent = 'JOB';
      const content = document.createElement('div');
      const title = document.createElement('h3');
      title.textContent = job.title;
      const detail = document.createElement('p');
      detail.textContent = job.detail;
      content.append(title, detail);
      row.append(mark, content);
      list.append(row);
    });
  }

  const gallery = business.gallery || [];
  if (gallery.length) {
    document.getElementById('profileGallery').hidden = false;
    const grid = document.getElementById('businessGallery');
    gallery.forEach(photo => {
      const figure = document.createElement('figure');
      const image = document.createElement('img');
      image.src = photo.src;
      image.alt = photo.alt;
      image.loading = 'lazy';
      image.decoding = 'async';
      const caption = document.createElement('figcaption');
      caption.textContent = photo.caption || '';
      figure.append(image, caption);
      grid.append(figure);
    });
  }

  const contact = document.getElementById('businessContact');
  const addContact = (label, text, href, external = false) => {
    if (!text) return;
    const row = document.createElement('div');
    row.className = 'profile-contact-row';
    const title = document.createElement('span');
    title.textContent = label;
    const value = href ? document.createElement('a') : document.createElement('strong');
    value.textContent = text;
    if (href) value.href = href;
    if (external) { value.target = '_blank'; value.rel = 'noopener noreferrer'; }
    row.append(title, value);
    contact.append(row);
  };
  addContact('Address', business.address, business.address ? `https://maps.google.com/?q=${encodeURIComponent(business.address)}` : '', true);
  addContact('Phone', business.phone, business.phone ? `tel:${business.phone.replace(/[^+\d]/g, '')}` : '');
  addContact('Email', business.email, business.email ? `mailto:${business.email}` : '');
  addContact('Website', business.website?.label, business.website?.href, true);

  const hours = business.hours || [];
  if (hours.length) {
    document.getElementById('profileHours').hidden = false;
    const list = document.getElementById('businessHours');
    hours.forEach(entry => {
      const item = document.createElement('li');
      const days = document.createElement('span');
      days.textContent = entry.days;
      const time = document.createElement('strong');
      time.textContent = entry.time;
      item.append(days, time);
      list.append(item);
    });
  }
})();

