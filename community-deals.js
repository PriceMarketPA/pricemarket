(() => {
  const API = '/api/community-deals';
  const UPLOAD_API = '/api/business-assets';
  const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
  const IMAGE_LIMIT = 10 * 1024 * 1024;
  const form = document.getElementById('communityDealForm');
  if (!form) return;
  if (typeof window.initPmDropdowns === 'function') window.initPmDropdowns(document);
  const cityFilter = document.getElementById('communityCityFilter');
  const reportCity = document.getElementById('communityReportCity');
  const feed = document.getElementById('communityDealsList');
  const feedStatus = document.getElementById('communityFeedStatus');
  const emptyState = document.getElementById('communityDealsEmpty');
  const reportStatus = document.getElementById('communityReportStatus');
  const photoInput = document.getElementById('communityDealPhoto');
  const photoStatus = document.getElementById('communityPhotoStatus');
  const photoProgress = document.getElementById('communityPhotoProgress');
  const photoPreview = document.getElementById('communityPhotoPreview');
  const photoPreviewImage = document.getElementById('communityPhotoPreviewImage');
  let uploadSession = null;
  let uploadedPhoto = null;
  let pending = false;

  async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
    return data;
  }

  async function solveProof(challenge) {
    if (!window.crypto?.subtle || typeof TextEncoder === 'undefined') throw new Error('This browser cannot prepare the spam check. Please try a current browser.');
    let counter = 0;
    while (counter < 10000000) {
      const digest = new Uint8Array(await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(challenge.nonce + ':' + counter)));
      if (digest[0] === 0 && digest[1] === 0) return counter;
      counter += 1;
      if (counter % 512 === 0) await new Promise(resolve => window.setTimeout(resolve, 0));
    }
    throw new Error('The spam check took too long. Please try again.');
  }

  async function getProofToken() {
    const challenge = await requestJson(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'challenge' }) });
    return { challengeId: challenge.challengeId, challengeToken: challenge.challengeToken, proof: await solveProof(challenge) };
  }

  async function uploadApi(payload) {
    if (!uploadSession) throw new Error('Secure photo upload is not ready.');
    return requestJson(UPLOAD_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, submissionId: uploadSession.submissionId, capability: uploadSession.capability })
    });
  }

  async function ensureUploadSession() {
    if (uploadSession) return uploadSession;
    photoStatus.textContent = 'Preparing secure photo upload…';
    const challenge = await requestJson(UPLOAD_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'challenge' }) });
    const proof = await solveProof(challenge);
    uploadSession = await requestJson(UPLOAD_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'initialize', challengeId: challenge.challengeId, challengeToken: challenge.challengeToken, proof })
    });
    return uploadSession;
  }

  function uploadBytes(url, file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', file.type);
      photoProgress.hidden = false;
      photoProgress.value = 0;
      xhr.upload.onprogress = event => { if (event.lengthComputable) photoProgress.value = Math.round(event.loaded / event.total * 100); };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('The photo could not be stored. Please try again.'));
      xhr.onerror = () => reject(new Error('Photo upload interrupted. Check your connection and try again.'));
      xhr.send(file);
    });
  }

  function renderPhoto(asset) {
    uploadedPhoto = asset;
    photoPreviewImage.src = asset.publicUrl;
    photoPreview.hidden = false;
    photoStatus.textContent = 'Photo uploaded securely. It will stay out of the feed until this report is reviewed and approved.';
    photoProgress.hidden = true;
  }

  async function removePhoto() {
    if (!uploadedPhoto) return;
    const current = uploadedPhoto;
    photoStatus.textContent = 'Removing uploaded photo…';
    await uploadApi({ action: 'remove', role: 'gallery-1', bucket: current.bucket, path: current.path });
    uploadedPhoto = null;
    photoPreviewImage.removeAttribute('src');
    photoPreview.hidden = true;
    photoProgress.hidden = true;
    photoStatus.textContent = 'Photo removed.';
    photoInput.value = '';
  }

  async function uploadPhoto(file) {
    if (!IMAGE_TYPES.has(file.type)) throw new Error('Choose a JPG, PNG, WebP, HEIC, or HEIF photo.');
    if (!file.size || file.size > IMAGE_LIMIT) throw new Error('Photo must be smaller than 10 MB.');
    await ensureUploadSession();
    photoStatus.textContent = 'Preparing secure upload…';
    const signed = await uploadApi({
      action: 'sign', role: 'gallery-1', contentType: file.type, size: file.size,
      fileName: file.name, ...(uploadedPhoto ? { replacePath: uploadedPhoto.path } : {})
    });
    try {
      await uploadBytes(signed.uploadUrl, file);
      const finalized = await uploadApi({
        action: 'finalize', role: 'gallery-1', bucket: signed.bucket, path: signed.path,
        contentType: file.type, size: file.size, fileName: file.name
      });
      renderPhoto({ ...finalized, role: 'gallery-1', bucket: signed.bucket, submissionId: uploadSession.submissionId, capability: uploadSession.capability });
      if (finalized.replacedPath) {
        try { await uploadApi({ action: 'remove', role: 'gallery-1', bucket: signed.bucket, path: finalized.replacedPath }); }
        catch { photoStatus.textContent = 'The new photo is ready. Cleanup of the replaced pending photo could not finish; retry removing the photo before submitting.'; }
      }
    } catch (error) {
      try { await uploadApi({ action: 'remove', role: 'gallery-1', bucket: signed.bucket, path: signed.path }); } catch {}
      throw error;
    }
  }

  function money(value) {
    if (value == null || value === '') return '';
    const amount = Number(value);
    return Number.isFinite(amount) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount) : '';
  }

  function makeButton(text, voteType, dealId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn ' + (voteType === 'still_available' ? 'white' : 'ghost') + ' small';
    button.dataset.voteType = voteType;
    button.dataset.dealId = dealId;
    button.textContent = text;
    return button;
  }

  function dealCard(deal) {
    const article = document.createElement('article');
    article.className = 'community-deal-card' + (deal.photoUrl ? ' has-photo' : '');
    if (deal.photoUrl) {
      const image = document.createElement('img');
      image.className = 'community-deal-photo';
      image.src = deal.photoUrl;
      image.alt = 'Community-reported deal photo at ' + deal.storeName;
      image.loading = 'lazy';
      image.decoding = 'async';
      article.append(image);
    }
    const body = document.createElement('div');
    body.className = 'community-deal-body';
    const badges = document.createElement('div');
    badges.className = 'community-deal-badges';
    const community = document.createElement('span');
    community.className = 'community-deal-badge';
    community.textContent = 'Community reported';
    const status = document.createElement('span');
    status.className = 'community-deal-badge status';
    status.textContent = 'Active';
    badges.append(community, status);
    const store = document.createElement('p');
    store.className = 'community-deal-store';
    store.textContent = deal.storeName + ' · ' + deal.city;
    const title = document.createElement('h3');
    title.className = 'community-deal-title';
    title.textContent = deal.itemTitle;
    const price = document.createElement('p');
    price.className = 'community-deal-price';
    const sale = document.createElement('strong');
    sale.className = 'community-sale-price';
    sale.textContent = money(deal.salePrice);
    price.append(sale);
    if (deal.normalPrice != null) {
      const normal = document.createElement('span');
      normal.className = 'community-normal-price';
      normal.textContent = money(deal.normalPrice);
      price.append(normal);
    }
    const description = document.createElement('p');
    description.className = 'community-deal-description';
    description.textContent = deal.description;
    const freshness = document.createElement('time');
    freshness.className = 'community-deal-freshness';
    freshness.dateTime = deal.spottedAt;
    freshness.dataset.spottedAt = deal.spottedAt;
    freshness.textContent = ageText(deal.spottedAt);
    const confirmations = document.createElement('p');
    confirmations.className = 'community-deal-freshness';
    confirmations.dataset.confirmations = 'true';
    confirmations.textContent = (deal.confirmationCount || 0) + ' confirmations';
    const actions = document.createElement('div');
    actions.className = 'community-deal-actions';
    actions.append(
      makeButton('Still available', 'still_available', deal.id),
      makeButton('Expired', 'expired', deal.id),
      makeButton('Wrong info', 'wrong_info', deal.id)
    );
    body.append(badges, store, title, price, description, freshness, confirmations, actions);
    article.append(body);
    return article;
  }

  function ageText(value) {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return 'Recently spotted';
    const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
    if (minutes < 1) return 'Spotted just now';
    if (minutes < 60) return 'Spotted ' + minutes + (minutes === 1 ? ' minute' : ' minutes') + ' ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return 'Spotted ' + hours + (hours === 1 ? ' hour' : ' hours') + ' ago';
    const days = Math.floor(hours / 24);
    return 'Spotted ' + days + (days === 1 ? ' day' : ' days') + ' ago';
  }

  async function loadFeed() {
    feedStatus.textContent = 'Loading current deals…';
    emptyState.hidden = true;
    try {
      const query = cityFilter.value ? '?city=' + encodeURIComponent(cityFilter.value) : '';
      const result = await requestJson(API + query, { cache: 'no-store' });
      feed.replaceChildren(...result.deals.map(dealCard));
      const count = result.deals.length;
      feedStatus.textContent = count ? count + (count === 1 ? ' active deal' : ' active deals') + ' · newest first' : '';
      emptyState.hidden = count > 0;
    } catch (error) {
      feed.replaceChildren();
      feedStatus.textContent = error.message || 'Could not load local deals. Please try again.';
      emptyState.hidden = true;
    }
  }

  async function vote(button) {
    if (pending) return;
    pending = true;
    const prior = button.textContent;
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const result = await requestJson(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'vote', dealId: button.dataset.dealId, voteType: button.dataset.voteType })
      });
      if (result.status !== 'active') {
        reportStatus.textContent = result.status === 'expired' ? 'Thanks. This deal is now marked expired.' : 'Thanks. This report has been sent back for review.';
      } else if (button.dataset.voteType === 'still_available') {
        reportStatus.textContent = 'Thanks for confirming. This deal stays active for another 7 days.';
      } else {
        reportStatus.textContent = 'Thanks. Your report was added to the community check.';
      }
      await loadFeed();
    } catch (error) {
      reportStatus.textContent = error.message || 'Could not submit that status. Please try again.';
      button.disabled = false;
      button.textContent = prior;
    } finally { pending = false; }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-vote-type]');
    if (button) vote(button);
  });
  cityFilter.addEventListener('change', loadFeed);
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    photoStatus.textContent = '';
    try { await uploadPhoto(file); }
    catch (error) { photoStatus.textContent = error.message || 'Photo upload failed.'; photoProgress.hidden = true; }
    photoInput.value = '';
  });
  document.getElementById('removeCommunityPhoto').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await removePhoto(); }
    catch (error) { photoStatus.textContent = error.message || 'Could not remove this photo.'; }
    finally { button.disabled = false; }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    if (!reportCity.value) {
      reportStatus.textContent = 'Choose a city for this deal.';
      document.getElementById('communityReportCityTrigger').focus();
      return;
    }
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const normalPrice = data.get('normalPrice').trim();
    const salePrice = data.get('salePrice').trim();
    if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(salePrice) || (normalPrice && !/^(?:[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(normalPrice))) {
      reportStatus.textContent = 'Enter prices with up to two decimal places.';
      return;
    }
    if (normalPrice && Number(salePrice) > Number(normalPrice)) {
      reportStatus.textContent = 'Sale price cannot be higher than normal price.';
      return;
    }
    pending = true;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Sending for Review…';
    reportStatus.textContent = '';
    try {
      const proof = await getProofToken();
      const result = await requestJson(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...proof, action: 'submit',
          storeName: data.get('storeName'), itemTitle: data.get('itemTitle'),
          description: data.get('description'), city: data.get('city'),
          normalPrice, salePrice,
          ...(uploadedPhoto ? { photoPath: uploadedPhoto.path, photoSubmissionId: uploadSession.submissionId, photoCapability: uploadSession.capability } : {})
        })
      });
      reportStatus.textContent = result.message || 'Thanks. Your report is Under review and is not public yet.';
      form.reset();
      reportCity.dispatchEvent(new Event('change', { bubbles: true }));
      if (uploadedPhoto) {
        uploadedPhoto = null;
        photoPreviewImage.removeAttribute('src');
        photoPreview.hidden = true;
        photoStatus.textContent = 'The uploaded photo is attached to your report for review.';
      }
      await loadFeed();
    } catch (error) {
      reportStatus.textContent = error.message || 'Could not send your report. Please try again.';
    } finally {
      pending = false;
      submit.disabled = false;
      submit.innerHTML = 'Send for Review <span aria-hidden="true">→</span>';
    }
  });

  loadFeed();
  window.setInterval(() => {
    feed.querySelectorAll('[data-spotted-at]').forEach(node => { node.textContent = ageText(node.dataset.spottedAt); });
  }, 60000);
})();
