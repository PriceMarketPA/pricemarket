(() => {
  const LEADS_API_URL = "https://script.google.com/macros/s/AKfycbxU3krjD4BPxDjzSIbRrDVlGLS_mqZ21watyba5k2I_9y7-oHG0aYobftXK0QBVC-Bp/exec";
  const form = document.getElementById('businessProfileForm');
  const hoursEditor = document.getElementById('hoursEditor');
  const jobToggle = document.getElementById('includeJob');
  const jobFields = document.getElementById('jobFields');
  const happyHourToggle = document.getElementById('includeHappyHour');
  const happyHourFields = document.getElementById('happyHourFields');
  const status = document.getElementById('onboardingStatus');
  const submitButton = document.getElementById('submitBusinessProfile');
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  window.initPmDropdowns(document);

  // Native selects keep form dropdowns keyboard- and screen-reader-friendly on desktop and mobile.
  days.forEach(day => {
    const row = document.createElement('div');
    row.className = 'hours-row';
    row.innerHTML = `<strong class="hours-day">${day}</strong><label class="hours-time-label hours-open"><span class="hours-visible-label" aria-hidden="true">Open time</span><span class="sr-only">${day} opens at</span><input type="time" name="hoursOpen-${day}" aria-label="${day} opens at"></label><span class="hours-separator" aria-hidden="true">to</span><label class="hours-time-label hours-close"><span class="hours-visible-label" aria-hidden="true">Close time</span><span class="sr-only">${day} closes at</span><input type="time" name="hoursClose-${day}" aria-label="${day} closes at"></label><label class="hours-closed"><input type="checkbox" name="hoursClosed-${day}"><span>Closed</span></label>`;
    hoursEditor.append(row);
  });

  const byId = id => document.getElementById(id);
  const read = id => byId(id).value.trim();
  const stepPanels = [...form.querySelectorAll('[data-step-panel]')];
  const stepper = form.querySelector?.('.onboarding-stepper');
  const previewAside = byId('onboardingLivePreview');
  let currentStep = 1;
  let uploadSession = null;
  let uploadsInProgress = 0;
  const uploadedAssets = { logo: null, cover: null, gallery: [], document: null };
  const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
  const IMAGE_LIMIT = 10 * 1024 * 1024;
  const PDF_LIMIT = 15 * 1024 * 1024;
  const uploadApi = '/api/business-assets';
  const stepNames = ['Your Business', 'Contact & Hours', 'Photos', 'Promote Something', 'Preview & Submit'];
  function showStep(step, focusHeading = true) {
    currentStep = Math.max(1, Math.min(5, step));
    stepPanels.forEach(panel => { panel.hidden = Number(panel.dataset.stepPanel) !== currentStep; });
    form.querySelectorAll('[data-step-indicator]').forEach(item => { const active = Number(item.dataset.stepIndicator) === currentStep; if (active) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current'); });
    const count = byId('onboardingStepCount'); if (count) count.textContent = 'Step ' + currentStep + ' of 5 � ' + stepNames[currentStep - 1];
    if (previewAside) previewAside.hidden = currentStep !== 5;
    if (focusHeading) { const heading = stepPanels[currentStep - 1]?.querySelector('h2'); heading?.setAttribute('tabindex', '-1'); heading?.focus(); }
  }
  function validateCurrentStep() {
    const panel = stepPanels[currentStep - 1]; if (!panel) return true;
    if (currentStep === 3 && uploadsInProgress) { setUploadStatus('gallery', 'Please wait for uploads to finish.', true); return false; }
    if (currentStep === 1 && !window.validatePmDropdowns(form)) return false;
    for (const field of panel.querySelectorAll('input, select, textarea')) { if (!field.disabled && !field.checkValidity()) { field.reportValidity(); field.focus(); return false; } }
    return true;
  }
  form.querySelectorAll('[data-step-next]').forEach(button => button.addEventListener('click', () => { if (validateCurrentStep()) showStep(currentStep + 1); }));
  form.querySelectorAll('[data-step-back]').forEach(button => button.addEventListener('click', () => showStep(currentStep - 1)));
  showStep(1, false);
  byId('submitAnotherProfile')?.addEventListener('click', () => window.location.reload());
  const setText = (id, value, fallback) => { byId(id).textContent = value || fallback; };

  function validImageUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  function setUploadStatus(slot, message, isError = false) {
    const target = document.querySelector(`[data-upload-status="${slot}"]`);
    if (!target) return;
    target.textContent = message;
    target.classList.toggle('is-error', isError);
  }

  async function callUploadApi(payload) {
    const response = await fetch(uploadApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, submissionId: uploadSession?.submissionId, capability: uploadSession?.capability })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Upload service unavailable. Please try again.');
    return result;
  }

  async function solveUploadChallenge(challenge) {
    if (!window.crypto?.subtle || typeof TextEncoder === 'undefined') throw new Error('This browser cannot prepare the secure upload. Please update your browser or use the image URL fallback.');
    let counter = 0;
    while (counter < 10000000) {
      const digest = new Uint8Array(await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${challenge.nonce}:${counter}`)));
      if (digest[0] === 0 && digest[1] === 0) return counter;
      counter++;
      if (counter % 512 === 0) await new Promise(resolve => window.setTimeout(resolve, 0));
    }
    throw new Error('Upload verification took too long. Please try again.');
  }

  async function ensureUploadSession(slot) {
    if (!uploadSession) {
      setUploadStatus(slot, 'Preparing secure upload.');
      const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
      const challengeResponse = await fetch(uploadApi, { ...options, body: JSON.stringify({ action: 'challenge' }) });
      const challenge = await challengeResponse.json().catch(() => ({}));
      if (!challengeResponse.ok || !challenge.challengeToken) throw new Error(challenge.error || 'Could not prepare upload verification. Please try again.');
      const proof = await solveUploadChallenge(challenge);
      const response = await fetch(uploadApi, { ...options, body: JSON.stringify({ action: 'initialize', challengeId: challenge.challengeId, challengeToken: challenge.challengeToken, proof }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.submissionId || !result.capability) throw new Error(result.error || 'Could not prepare a secure upload. Please try again.');
      uploadSession = result;
    }
  }

  function validateSelectedFile(file, isDocument) {
    const maxSize = isDocument ? PDF_LIMIT : IMAGE_LIMIT;
    const typeOkay = isDocument ? file.type === 'application/pdf' : IMAGE_TYPES.has(file.type);
    if (!typeOkay) throw new Error(isDocument ? 'Choose a PDF document.' : 'Choose a JPG, PNG, WebP, HEIC, or HEIF image.');
    if (!file.size || file.size > maxSize) throw new Error(`This file is too large. The limit is ${isDocument ? '15 MB' : '10 MB'}.`);
  }

  function uploadBytes(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const request = new window.XMLHttpRequest();
      request.open('PUT', url);
      request.setRequestHeader('Content-Type', file.type);
      request.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
      request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error('The file could not be stored. Please try again.'));
      request.onerror = () => reject(new Error('Upload interrupted. Check your connection and try again.'));
      request.onabort = () => reject(new Error('Upload cancelled.'));
      request.send(file);
    });
  }

  function assetPreviewNode(asset, slot) {
    const card = document.createElement('div');
    card.className = 'upload-preview-item';
    if (asset.role !== 'document') {
      const image = document.createElement('img');
      image.src = asset.publicUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.className = 'upload-file-icon';
        fallback.textContent = 'Photo';
        image.replaceWith(fallback);
      }, { once: true });
      card.append(image);
    } else {
      const fileIcon = document.createElement('span');
      fileIcon.className = 'upload-file-icon';
      fileIcon.textContent = 'PDF';
      card.append(fileIcon);
    }
    const details = document.createElement('span');
    details.className = 'upload-preview-name';
    details.textContent = asset.fileName;
    card.append(details);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'upload-remove';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${asset.fileName}`);
    remove.addEventListener('click', () => removeUploadedAsset(slot, asset));
    card.append(remove);
    return card;
  }

  function renderUploadPreviews() {
    for (const slot of ['logo', 'cover', 'gallery', 'document']) {
      const container = document.querySelector(`[data-upload-preview="${slot}"]`);
      if (!container) continue;
      container.replaceChildren();
      const assets = slot === 'gallery' ? uploadedAssets.gallery : uploadedAssets[slot] ? [uploadedAssets[slot]] : [];
      assets.forEach(asset => container.append(assetPreviewNode(asset, slot)));
    }
  }

  async function removeUploadedAsset(slot, asset) {
    try {
      if (uploadSession) await callUploadApi({ action: 'remove', path: asset.path, bucket: asset.bucket, role: asset.role });
      if (slot === 'gallery') uploadedAssets.gallery = uploadedAssets.gallery.filter(item => item.path !== asset.path);
      else uploadedAssets[slot] = null;
      setUploadStatus(slot, slot === 'gallery' ? 'Add up to five extra photos.' : 'Uploaded file removed.');
      renderUploadPreviews();
      refreshPreview();
    } catch (error) { setUploadStatus(slot, error.message || 'Could not remove this file. Please retry.', true); }
  }

  async function uploadOne(slot, role, file) {
    const isDocument = role === 'document';
    validateSelectedFile(file, isDocument);
    await ensureUploadSession(slot);
    const previousAsset = role.startsWith('gallery-') ? uploadedAssets.gallery.find(asset => asset.role === role) : uploadedAssets[slot];
    let signed;
    try {
      signed = await callUploadApi({ action: 'sign', role, contentType: file.type, size: file.size, replacePath: previousAsset?.path || '' });
      setUploadStatus(slot, `Uploading ${file.name} � 0%`);
      await uploadBytes(signed.uploadUrl, file, percent => setUploadStatus(slot, `Uploading ${file.name} � ${percent}%`));
      const complete = await callUploadApi({ action: 'finalize', role, bucket: signed.bucket, path: signed.path, contentType: file.type, size: file.size, fileName: file.name });
      return { ...complete, role, fileName: file.name };
    } catch (error) {
      if (signed?.path) {
        try { await callUploadApi({ action: 'remove', role, bucket: signed.bucket, path: signed.path }); } catch { error.cleanupFailed = true; }
      }
      throw error;
    }
  }

  async function handleFileSelection(input) {
    const slot = input.dataset.uploadRole;
    const files = [...(input.files || [])];
    if (!files.length) return;
    uploadsInProgress++;
    input.disabled = true;
    try {
      if (slot === 'gallery') {
        if (uploadedAssets.gallery.length + files.length > 5) throw new Error('You can add up to five gallery photos. Remove a photo before adding another.');
        for (const [index, file] of files.entries()) {
          const usedRoles = new Set(uploadedAssets.gallery.map(asset => asset.role));
          const role = ['gallery-1', 'gallery-2', 'gallery-3', 'gallery-4', 'gallery-5'].find(candidate => !usedRoles.has(candidate));
          const asset = await uploadOne('gallery', role, file);
          uploadedAssets.gallery.push(asset);
          setUploadStatus('gallery', `${uploadedAssets.gallery.length} of 5 gallery photos uploaded.`);
        }
      } else {
        const asset = await uploadOne(slot, slot, files[0]);
        const previous = uploadedAssets[slot];
        uploadedAssets[slot] = asset;
        let previousRemoved = true;
        const replacedPath = asset.replacedPath || previous?.path;
        if (replacedPath) { try { await callUploadApi({ action: 'remove', path: replacedPath, bucket: previous?.bucket || asset.bucket, role: asset.role }); } catch { previousRemoved = false; } }
        setUploadStatus(slot, `${files[0].name} uploaded.${previous && !previousRemoved ? ' The replaced pending file could not be removed; it will not be submitted.' : ''}`, Boolean(previous && !previousRemoved));
      }
      renderUploadPreviews();
      refreshPreview();
    } catch (error) { setUploadStatus(slot, `${error.message || 'Upload failed. Please try again.'}${error.cleanupFailed ? ' The incomplete pending file could not be removed.' : ''}`, true); }
    finally { input.disabled = false; input.value = ''; uploadsInProgress--; }
  }

  form.querySelectorAll('[data-upload-role]').forEach(input => input.addEventListener('change', () => handleFileSelection(input)));

  function formatTime(value) {
    if (!value) return '';
    const [hour, minute] = value.split(':').map(Number);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
  }

  function populateHappyHourTimeOptions(select) {
    const previousValue = select.value;
    for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
      const hour = Math.floor(minutes / 60);
      const minute = minutes % 60;
      const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = formatTime(value);
      select.append(option);
    }
    if (previousValue) select.value = previousValue;
  }
  ['happyHourStartTime', 'happyHourEndTime'].forEach(id => populateHappyHourTimeOptions(byId(id)));

  function collectHours() {
    return days.flatMap(day => {
      const closed = form.elements[`hoursClosed-${day}`].checked;
      const opening = form.elements[`hoursOpen-${day}`].value;
      const closing = form.elements[`hoursClose-${day}`].value;
      if (closed) return [{ days: day, time: 'Closed' }];
      if (!opening && !closing) return [];
      return [{ days: day, time: `${formatTime(opening)} - ${formatTime(closing)}`.trim() }];
    });
  }

  function refreshPreview() {
    const name = read('businessNameInput');
    const category = read('businessCategory');
    const city = read('businessCity');
    const description = read('businessDescription');
    const image = uploadedAssets.cover?.publicUrl || validImageUrl(read('heroImage'));
    const hours = collectHours();
    const dealTitle = read('dealTitle');
    const dealDescription = read('dealDescription');

    setText('previewBusinessName', name, 'Your Business Name');
    setText('previewCategoryCity', `${category || 'Your category'} � ${city || 'Your city'}, PA`);
    setText('previewDescription', description, 'Your short business introduction will appear here, helping neighbors get to know you.');
    setText('previewAddress', read('businessAddress'), 'Your address');
    setText('previewHours', hours.length ? `${hours.length} day${hours.length === 1 ? '' : 's'} of hours added` : '', 'Add your hours');
    setText('previewDealTitle', dealTitle, 'Your featured deal');
    setText('previewDealDescription', dealDescription, 'A quick look at the offer you'd like to share.');
    const logo = uploadedAssets.logo?.publicUrl || validImageUrl(read('logoImage'));
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
    const gallery = byId('previewGallery');
    gallery.replaceChildren();
    gallery.hidden = uploadedAssets.gallery.length === 0;
    uploadedAssets.gallery.forEach(asset => {
      const item = document.createElement('img');
      item.src = asset.publicUrl;
      item.alt = '';
      item.loading = 'lazy';
      gallery.append(item);
    });
    const documentLink = byId('previewDocument');
    documentLink.hidden = !uploadedAssets.document;
    if (uploadedAssets.document) documentLink.href = uploadedAssets.document.publicUrl;
    byId('previewDeal').hidden = !dealTitle && !dealDescription;

    const happyHourEnabled = happyHourToggle.checked;
    const happyHourTitle = read('happyHourTitleInput');
    const happyHourDays = read('happyHourDays');
    const happyHourStartTime = read('happyHourStartTime');
    const happyHourEndTime = read('happyHourEndTime');
    const happyHourDescription = read('happyHourDescription');
    const happyHourRestrictions = read('happyHourRestrictions');
    const happyHourRange = [formatTime(happyHourStartTime), formatTime(happyHourEndTime)].filter(Boolean).join('-');
    setText('previewHappyHourTitle', happyHourTitle, 'Your Happy Hour offer');
    setText('previewHappyHourSchedule', [happyHourDays, happyHourRange].filter(Boolean).join(' � '), 'Add the days and times');
    setText('previewHappyHourDescription', happyHourDescription, 'A recurring special for your neighbors.');
    const restrictions = byId('previewHappyHourRestrictions');
    restrictions.textContent = happyHourRestrictions;
    restrictions.hidden = !happyHourRestrictions;
    byId('previewHappyHour').hidden = !happyHourEnabled;
  }

  form.addEventListener('input', refreshPreview);
  form.addEventListener('change', refreshPreview);
  byId('businessDescription').addEventListener('input', event => { byId('descriptionCount').textContent = event.target.value.length; });
  jobToggle.addEventListener('change', () => {
    jobFields.hidden = !jobToggle.checked;
    byId('jobTitle').required = jobToggle.checked;
  });
  happyHourToggle.addEventListener('change', () => {
    happyHourFields.hidden = !happyHourToggle.checked;
    ['happyHourTitleInput', 'happyHourDays', 'happyHourStartTime', 'happyHourEndTime'].forEach(id => {
      byId(id).required = happyHourToggle.checked;
    });
    refreshPreview();
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
    const happyHourTitle = happyHourToggle.checked ? read('happyHourTitleInput') : '';
    const happyHourDescription = happyHourToggle.checked ? read('happyHourDescription') : '';
    const happyHourDays = happyHourToggle.checked ? read('happyHourDays') : '';
    const happyHourStartTime = happyHourToggle.checked ? read('happyHourStartTime') : '';
    const happyHourEndTime = happyHourToggle.checked ? read('happyHourEndTime') : '';
    const happyHourRestrictions = happyHourToggle.checked ? read('happyHourRestrictions') : '';
    const heroUrl = uploadedAssets.cover?.publicUrl || validImageUrl(read('heroImage'));
    const logoUrl = uploadedAssets.logo?.publicUrl || validImageUrl(read('logoImage'));
    return {
      demo: false,
      reviewStatus: 'Pending review',
      name: businessName,
      avatarText: businessName.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase(),
      logoImage: logoUrl,
      heroImage: { src: heroUrl, alt: read('imageAlt') || `${businessName} business image` },
      media: {
        logoUrl,
        coverUrl: heroUrl,
        galleryUrls: uploadedAssets.gallery.map(asset => asset.publicUrl),
        documentUrl: uploadedAssets.document?.publicUrl || ''
      },
      gallery: uploadedAssets.gallery.map(asset => asset.publicUrl),
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
      jobs: jobTitle ? [{ title: jobTitle, detail: jobDescription }] : [],
      happyHours: happyHourTitle ? [{
        title: happyHourTitle,
        description: happyHourDescription,
        days: happyHourDays,
        startTime: happyHourStartTime,
        endTime: happyHourEndTime,
        restrictions: happyHourRestrictions
      }] : []
    };
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    status.hidden = true;
    if (!window.validatePmDropdowns(form)) return;
    if (uploadsInProgress) { status.textContent = 'Please wait for your uploads to finish before submitting.'; status.hidden = false; return; }

    const profileData = makeProfileData();
    const happyHour = profileData.happyHours[0] || {};
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
      happyHourTitle: happyHour.title || '',
      happyHourDescription: happyHour.description || '',
      happyHourDays: happyHour.days || '',
      happyHourStartTime: happyHour.startTime || '',
      happyHourEndTime: happyHour.endTime || '',
      happyHourRestrictions: happyHour.restrictions || '',
      profileDataJson: JSON.stringify(profileData)
    };

    submitButton.disabled = true;
    submitButton.textContent = 'Sending for review.';
    try {
      await fetch(LEADS_API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const confirmation = byId('submissionConfirmation');
      if (confirmation) { form.hidden = true; if (stepper) stepper.hidden = true; if (previewAside) previewAside.hidden = true; confirmation.hidden = false; confirmation.focus(); }
      status.textContent = 'Thanks - your profile submission is pending review. It has not been published.';
      status.classList.add('is-success');
      status.hidden = false;
      if (typeof gtag === 'function') gtag('event', 'business_profile_submission', { business_category: profileData.category, city: profileData.city });
    } catch (error) {
      status.textContent = 'We couldn't send that just now. Please try again in a moment.';
      status.classList.remove('is-success');
      status.hidden = false;
    } finally {
      if (!byId('submissionConfirmation')?.hidden) { submitButton.disabled = false; submitButton.innerHTML = 'Submit for review <span aria-hidden="true"></span>'; }
    }
  });

  refreshPreview();
})();

