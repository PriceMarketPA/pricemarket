(() => {
  const LEADS_API_URL = "https://script.google.com/macros/s/AKfycbxU3krjD4BPxDjzSIbRrDVlGLS_mqZ21watyba5k2I_9y7-oHG0aYobftXK0QBVC-Bp/exec";
  const form = document.getElementById('businessProfileForm');
  const hoursEditor = document.getElementById('hoursEditor');
  const jobToggle = document.getElementById('includeJob');
  const jobFields = document.getElementById('jobFields');
  const status = document.getElementById('onboardingStatus');
  const submitButton = document.getElementById('submitBusinessProfile');
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // Native selects keep form dropdowns keyboard- and screen-reader-friendly on desktop and mobile.
  days.forEach((day, index) => {
    const row = document.createElement('div');
    row.className = 'hours-row';
    row.innerHTML = `<strong>${day}</strong><label class="hours-time-label"><span class="sr-only">${day} opens at</span><input type="time" name="hoursOpen-${day}" aria-label="${day} opens at" ${index === 6 ? 'disabled' : ''}></label><span class="hours-separator" aria-hidden="true">to</span><label class="hours-time-label"><span class="sr-only">${day} closes at</span><input type="time" name="hoursClose-${day}" aria-label="${day} closes at" ${index === 6 ? 'disabled' : ''}></label><label class="hours-closed"><input type="checkbox" name="hoursClosed-${day}" ${index === 6 ? 'checked' : ''}><span>Closed</span></label>`;
    hoursEditor.append(row);
  });

  const byId = id => document.getElementById(id);
  const read = id => byId(id).value.trim();
  const setText = (id, value, fallback) => { byId(id).textContent = value || fallback; };

  function validImageUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  function formatTime(value) {
    if (!value) return '';
    const [hour, minute] = value.split(':').map(Number);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
  }

  function collectHours() {
    return days.flatMap(day => {
      const closed = form.elements[`hoursClosed-${day}`].checked;
      const opening = form.elements[`hoursOpen-${day}`].value;
      const closing = form.elements[`hoursClose-${day}`].value;
      if (closed) return [{ days: day, time: 'Closed' }];
      if (!opening && !closing) return [];
      return [{ days: day, time: `${formatTime(opening)} – ${formatTime(closing)}`.trim() }];
    });
  }

  function refreshPreview() {
    const name = read('businessNameInput');
    const category = read('businessCategory');
    const city = read('businessCity');
    const description = read('businessDescription');
    const image = validImageUrl(read('heroImage'));
    const hours = collectHours();
    const dealTitle = read('dealTitle');
    const dealDescription = read('dealDescription');

    setText('previewBusinessName', name, 'Your Business Name');
    setText('previewCategoryCity', `${category || 'Your category'} · ${city || 'Your city'}, PA`);
    setText('previewDescription', description, 'Your short business introduction will appear here, helping neighbors get to know you.');
    setText('previewAddress', read('businessAddress'), 'Your address');
    setText('previewHours', hours.length ? `${hours.length} day${hours.length === 1 ? '' : 's'} of hours added` : '', 'Add your hours');
    setText('previewDealTitle', dealTitle, 'Your featured deal');
    setText('previewDealDescription', dealDescription, 'A quick look at the offer you’d like to share.');
    const logo = validImageUrl(read('logoImage'));
    byId('previewAvatar').textContent = '';
    if (logo) {
      const avatarImage = document.createElement('img');
      avatarImage.src = logo;
      avatarImage.alt = '';
      byId('previewAvatar').append(avatarImage);
    } else {
      byId('previewAvatar').textContent = name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'B';
    }
    byId('previewImage').src = image || 'assets/showcase-restaurant.jpg';
    byId('previewImage').alt = read('imageAlt') || (name ? `${name} business preview` : 'Sample local business preview image');
    byId('previewDeal').hidden = !dealTitle && !dealDescription;
  }

  form.addEventListener('input', refreshPreview);
  form.addEventListener('change', refreshPreview);
  byId('businessDescription').addEventListener('input', event => { byId('descriptionCount').textContent = event.target.value.length; });
  jobToggle.addEventListener('change', () => {
    jobFields.hidden = !jobToggle.checked;
    byId('jobTitle').required = jobToggle.checked;
  });
  hoursEditor.addEventListener('change', event => {
    const row = event.target.closest('.hours-row');
    if (!row || !event.target.matches('.hours-closed input')) return;
    row.querySelectorAll('input[type="time"]').forEach(input => { input.disabled = event.target.checked; });
  });

  function makeProfileData() {
    const businessName = read('businessNameInput');
    const websiteUrl = read('businessWebsite');
    const dealTitle = read('dealTitle');
    const dealDescription = read('dealDescription');
    const jobTitle = jobToggle.checked ? read('jobTitle') : '';
    const jobDescription = jobToggle.checked ? read('jobDescription') : '';
    const heroUrl = validImageUrl(read('heroImage'));
    const logoUrl = validImageUrl(read('logoImage'));
    return {
      demo: false,
      reviewStatus: 'Pending review',
      name: businessName,
      avatarText: businessName.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase(),
      logoImage: logoUrl,
      heroImage: { src: heroUrl, alt: read('imageAlt') || `${businessName} business image` },
      category: read('businessCategory'),
      city: read('businessCity'),
      state: 'PA',
      address: read('businessAddress'),
      description: read('businessDescription'),
      phone: read('businessPhone'),
      email: read('businessEmail'),
      website: websiteUrl ? { label: websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''), href: websiteUrl } : null,
      hours: collectHours(),
      deals: dealTitle || dealDescription ? [{ title: dealTitle, description: dealDescription }] : [],
      jobs: jobTitle ? [{ title: jobTitle, detail: jobDescription }] : []
    };
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    status.hidden = true;
    if (!form.reportValidity()) return;

    const profileData = makeProfileData();
    const payload = {
      leadType: 'Business',
      businessName: profileData.name,
      businessCategory: profileData.category,
      city: profileData.city,
      streetAddress: profileData.address,
      description: profileData.description,
      phone: profileData.phone,
      email: profileData.email,
      website: profileData.website?.href || '',
      notes: 'Business profile submission; pending review before publication.',
      reviewStatus: 'Pending review',
      businessHours: profileData.hours.map(entry => `${entry.days}: ${entry.time}`).join('; '),
      featuredDealTitle: profileData.deals[0]?.title || '',
      featuredDealDescription: profileData.deals[0]?.description || '',
      jobTitle: profileData.jobs[0]?.title || '',
      jobDetails: profileData.jobs[0]?.detail || '',
      profileDataJson: JSON.stringify(profileData)
    };

    submitButton.disabled = true;
    submitButton.textContent = 'Sending for review…';
    try {
      await fetch(LEADS_API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      status.textContent = 'Thanks — your profile submission is pending review. It has not been published.';
      status.classList.add('is-success');
      status.hidden = false;
      if (typeof gtag === 'function') gtag('event', 'business_profile_submission', { business_category: profileData.category, city: profileData.city });
      form.reset();
      jobFields.hidden = true;
      byId('jobTitle').required = false;
      hoursEditor.querySelectorAll('.hours-row').forEach((row, index) => {
        const closed = row.querySelector('.hours-closed input');
        closed.checked = index === 6;
        row.querySelectorAll('input[type="time"]').forEach(input => { input.value = ''; input.disabled = index === 6; });
      });
      byId('descriptionCount').textContent = '0';
      refreshPreview();
      status.focus?.();
    } catch (error) {
      status.textContent = 'We couldn’t send that just now. Please try again in a moment.';
      status.classList.remove('is-success');
      status.hidden = false;
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = 'Submit for review <span aria-hidden="true">→</span>';
    }
  });

  refreshPreview();
})();
