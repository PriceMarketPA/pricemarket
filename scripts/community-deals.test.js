'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createHandler: createCommunityDealHandler } = require('../api/community-deals');
const { CITIES, formatAge, makeFingerprint, parsePrice, sanitizePlainText } = require('../api/community-deals-utils');
const { makeCapability, safeObjectPath, verifyProofOfWork } = require('../api/business-assets-utils');
const { freshnessBadges } = require('../community-deals-view');

const secret = 'test-service-key';
const env = { VERCEL_ENV: 'production', SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: secret };
const hostHeaders = { origin: 'https://pricemarketpa.com', host: 'pricemarketpa.com', 'x-forwarded-for': '203.0.113.25' };
const ok = data => ({ ok: true, status: 200, json: async () => data });
const bad = (status, message) => ({ ok: false, status, json: async () => ({ message }) });
function createHandler(options = {}) {
  return createCommunityDealHandler({ logger: { error() {} }, ...options });
}
function makeResponse() {
  return {
    statusCode: 0, headers: {}, body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value; this.data = JSON.parse(value); }
  };
}
async function send(handler, method, body, headers = hostHeaders, query = {}) {
  const res = makeResponse();
  await handler({ method, headers, body, query, socket: { remoteAddress: '203.0.113.25' } }, res);
  return res;
}
function findProof(nonce) {
  for (let counter = 0; counter < 1000000; counter += 1) if (verifyProofOfWork(nonce, counter, 16)) return counter;
  throw new Error('No proof found');
}
async function challenge(handler) {
  const result = await send(handler, 'POST', { action: 'challenge' });
  assert.equal(result.statusCode, 200);
  return { ...result.data, proof: findProof(result.data.nonce) };
}
function validReport(proof, extra = {}) {
  return {
    action: 'submit', ...proof, storeName: 'Market Place', itemTitle: 'Coffee beans, 12 oz',
    description: 'A current shelf deal spotted in store.', city: 'Harrisburg',
    normalPrice: '8.99', salePrice: '5.99', ...extra
  };
}

test('valid report is sanitized, fingerprinted server-side, and always starts Under review', async () => {
  let submitted;
  const handler = createHandler({ env, fetchImpl: async (url, options) => {
    if (String(url).includes('/rpc/pm_submit_community_deal')) { submitted = JSON.parse(options.body); return ok({ id: 'a0ea5305-65be-405e-b978-ccacb2896772', status: 'under_review' }); }
    throw new Error('Unexpected request ' + url);
  } });
  const proof = await challenge(handler);
  const res = await send(handler, 'POST', validReport(proof));
  assert.equal(res.statusCode, 201);
  assert.equal(res.data.status, 'under_review');
  assert.equal(res.data.id, 'a0ea5305-65be-405e-b978-ccacb2896772');
  assert.equal(submitted.p_store_name, 'Market Place');
  assert.equal(submitted.p_sale_price, '5.99');
  assert.equal(submitted.p_normal_price, '8.99');
  assert.equal(submitted.p_city, 'Harrisburg');
  assert.match(submitted.p_fingerprint, /^[0-9a-f]{64}$/);
  assert.match(submitted.p_ip_hash, /^[0-9a-f]{64}$/);
});
test('successful report sends the admin a complete pending-review email through Resend', async () => {
  const notificationEnv = { ...env, RESEND_API_KEY: 're_test_server_only' };
  const submittedAt = Date.UTC(2026, 9, 6, 15, 30, 0);
  let emailRequest;
  let reportCreated = false;
  const handler = createHandler({ env: notificationEnv, now: () => submittedAt, fetchImpl: async (url, options) => {
    if (String(url).includes('/rpc/pm_submit_community_deal')) {
      reportCreated = true;
      return ok({ id: 'a0ea5305-65be-405e-b978-ccacb2896772', status: 'under_review' });
    }
    if (String(url) === 'https://api.resend.com/emails') {
      assert.equal(reportCreated, true);
      emailRequest = { headers: options.headers, payload: JSON.parse(options.body) };
      return ok({ id: 'resend-message-id' });
    }
    throw new Error('Unexpected request ' + url);
  } });
  const res = await send(handler, 'POST', validReport(await challenge(handler)));
  assert.equal(res.statusCode, 201);
  assert.equal(res.data.status, 'under_review');
  assert.equal(emailRequest.headers.Authorization, 'Bearer re_test_server_only');
  assert.deepEqual(emailRequest.payload.to, ['pat@pricemarketpa.com']);
  assert.equal(emailRequest.payload.from, 'Price Market <notifications@pricemarketpa.com>');
  for (const expected of [
    'Store/business: Market Place', 'Item/deal title: Coffee beans, 12 oz', 'City: Harrisburg',
    'Normal price: $8.99', 'Sale price: $5.99', 'Description: A current shelf deal spotted in store.',
    'Photo included: No', 'Submission ID: a0ea5305-65be-405e-b978-ccacb2896772',
    'Submission time: 2026-10-06T15:30:00.000Z', 'Status: Under review',
    'not public and will not appear in the marketplace until Price Market approves it'
  ]) assert.ok(emailRequest.payload.text.includes(expected), expected);
});
test('Resend failure is logged but does not fail an already-created deal submission', async () => {
  const logs = [];
  const handler = createHandler({
    env: { ...env, RESEND_API_KEY: 're_test_server_only' },
    logger: { error: (...values) => logs.push(values) },
    fetchImpl: async url => {
      if (String(url).includes('/rpc/pm_submit_community_deal')) return ok({ id: 'a0ea5305-65be-405e-b978-ccacb2896772' });
      if (String(url) === 'https://api.resend.com/emails') return { ok: false, status: 503 };
      throw new Error('Unexpected request ' + url);
    }
  });
  const res = await send(handler, 'POST', validReport(await challenge(handler)));
  assert.equal(res.statusCode, 201);
  assert.equal(res.data.status, 'under_review');
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], '[community-deals] admin email notification failed');
  assert.equal(logs[0][1].submissionId, 'a0ea5305-65be-405e-b978-ccacb2896772');
  assert.match(logs[0][1].error, /HTTP 503/);
  assert.doesNotMatch(JSON.stringify(logs), /re_test_server_only/);
});
test('duplicate report does not send an admin email', async () => {
  let emailCalls = 0;
  const handler = createHandler({ env: { ...env, RESEND_API_KEY: 're_test_server_only' }, fetchImpl: async url => {
    if (String(url).includes('/rpc/pm_submit_community_deal')) return ok({ duplicate: true });
    if (String(url) === 'https://api.resend.com/emails') emailCalls += 1;
    throw new Error('Unexpected request ' + url);
  } });
  const res = await send(handler, 'POST', validReport(await challenge(handler)));
  assert.equal(res.statusCode, 409);
  assert.equal(emailCalls, 0);
});
test('failed and rate-limited reports do not send an admin email', async () => {
  for (const scenario of [
    { response: bad(500, 'Database unavailable'), status: 502 },
    { response: bad(429, 'Community deal submission rate limit reached'), status: 429 }
  ]) {
    let emailCalls = 0;
    const handler = createHandler({ env: { ...env, RESEND_API_KEY: 're_test_server_only' }, fetchImpl: async url => {
      if (String(url).includes('/rpc/pm_submit_community_deal')) return scenario.response;
      if (String(url) === 'https://api.resend.com/emails') emailCalls += 1;
      throw new Error('Unexpected request ' + url);
    } });
    const res = await send(handler, 'POST', validReport(await challenge(handler)));
    assert.equal(res.statusCode, scenario.status);
    assert.equal(emailCalls, 0);
  }
});
test('invalid or unapproved origins cannot request a challenge or submit', async () => {
  const handler = createHandler({ env });
  for (const headers of [
    { host: 'pricemarketpa.com' },
    { origin: 'https://attacker.example', host: 'attacker.example' },
    { origin: 'https://pricemarketpa.com', host: 'attacker.example' }
  ]) {
    const res = await send(handler, 'POST', { action: 'challenge' }, headers);
    assert.equal(res.statusCode, 403);
  }
});
test('invalid prices and sale-above-normal are rejected before database submission', async () => {
  let rpcCalls = 0;
  const handler = createHandler({ env, fetchImpl: async () => { rpcCalls += 1; return ok({}); } });
  const proof = await challenge(handler);
  for (const fields of [
    { normalPrice: '', salePrice: '1.00' },
    { normalPrice: '-1', salePrice: '1.00' },
    { normalPrice: '4.999', salePrice: '1.00' },
    { normalPrice: '4.00', salePrice: '5.00' },
    { salePrice: 'NaN' },
    { salePrice: '1.999' }
  ]) {
    const res = await send(handler, 'POST', validReport(proof, fields));
    assert.equal(res.statusCode, 400);
  }
  assert.equal(rpcCalls, 0);
  assert.equal(parsePrice('0.00', { required: true }), '0.00');
  assert.throws(() => parsePrice('1.001', { required: true }));
});
test('rate-limit and duplicate decisions from the atomic database gate are surfaced safely', async () => {
  const proof = await challenge(createHandler({ env }));
  const limited = createHandler({ env, fetchImpl: async () => bad(429, 'Community deal submission rate limit reached') });
  const limitResponse = await send(limited, 'POST', validReport(proof));
  assert.equal(limitResponse.statusCode, 429);
  assert.match(limitResponse.data.error, /request limit/i);

  const duplicate = createHandler({ env, fetchImpl: async () => ok({ duplicate: true }) });
  const duplicateResponse = await send(duplicate, 'POST', validReport(await challenge(duplicate)));
  assert.equal(duplicateResponse.statusCode, 409);
  assert.match(duplicateResponse.data.error, /similar deal/i);

  const reusedChallenge = createHandler({ env, fetchImpl: async () => bad(400, 'Community deal challenge already used') });
  const reused = await send(reusedChallenge, 'POST', validReport(await challenge(reusedChallenge)));
  assert.equal(reused.statusCode, 403);
});
test('a report photo is accepted only from the verified existing secure upload session', async () => {
  const uploadId = '85c24a5b-06d6-489a-a5ae-2e260685810f';
  const photoPath = safeObjectPath(uploadId, 'gallery-1', 'jpg', '74151238-5227-4c22-9710-05ac2a7949e9');
  const capability = makeCapability(uploadId, secret, Date.now() + 60000);
  let createdArgs;
  let emailText = '';
  const handler = createHandler({ env: { ...env, RESEND_API_KEY: 're_test_server_only' }, fetchImpl: async (url, options = {}) => {
    if (String(url).includes('/pm_business_upload_sessions?')) return ok([{ submission_id: uploadId }]);
    if (String(url).includes('/pm_business_upload_slots?')) return ok([{ active_path: photoPath }]);
    if (String(url).includes('/rpc/pm_submit_community_deal')) { createdArgs = JSON.parse(options.body); return ok({ id: 'a0ea5305-65be-405e-b978-ccacb2896772' }); }
    if (String(url) === 'https://api.resend.com/emails') { emailText = JSON.parse(options.body).text; return ok({ id: 'resend-message-id' }); }
    throw new Error('Unexpected request ' + url);
  } });
  const payload = validReport(await challenge(handler), { photoPath, photoSubmissionId: uploadId, photoCapability: capability });
  const res = await send(handler, 'POST', payload);
  assert.equal(res.statusCode, 201);
  assert.equal(createdArgs.p_photo_path, photoPath);
  assert.match(emailText, /Photo included: Yes/);

  const forged = await send(handler, 'POST', validReport(await challenge(handler), { photoPath: 'https://attacker.example/fake.jpg' }));
  assert.equal(forged.statusCode, 400);
});
test('vote actions preserve the three allowed community signals and reject arbitrary status changes', async () => {
  let voteArgs;
  const handler = createHandler({ env, fetchImpl: async (url, options) => {
    if (String(url).includes('/rpc/pm_vote_community_deal')) { voteArgs = JSON.parse(options.body); return ok({ status: 'active', confirmationCount: 2, expiredCount: 1, wrongInfoCount: 0 }); }
    throw new Error('Unexpected request ' + url);
  } });
  for (const voteType of ['still_available', 'expired', 'wrong_info']) {
    const res = await send(handler, 'POST', { action: 'vote', dealId: 'a0ea5305-65be-405e-b978-ccacb2896772', voteType });
    assert.equal(res.statusCode, 200);
    assert.equal(voteArgs.p_vote_type, voteType);
    assert.match(voteArgs.p_voter_hash, /^[0-9a-f]{64}$/);
  }
  const badVote = await send(handler, 'POST', { action: 'vote', dealId: 'a0ea5305-65be-405e-b978-ccacb2896772', voteType: 'publish' });
  assert.equal(badVote.statusCode, 400);
});
test('expired listings stay out of the active feed and city filtering is passed to Supabase', async () => {
  const active = { id: 'a0ea5305-65be-405e-b978-ccacb2896772', store_name: 'Market Place', item_title: 'Coffee beans', description: 'Deal detail', city: 'Carlisle', normal_price: '8.99', sale_price: '5.99', spotted_at: new Date().toISOString(), status: 'active', confirmation_count: 3, expires_at: new Date(Date.now() + 3600000).toISOString() };
  let feedUrl = '';
  const handler = createHandler({ env, fetchImpl: async (url, options = {}) => {
    if (String(url).includes('/rpc/pm_expire_community_deals')) return ok(0);
    feedUrl = String(url);
    return ok([active]);
  } });
  const res = await send(handler, 'GET', undefined, {}, { city: 'Carlisle' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.deals.length, 1);
  assert.equal(res.data.deals[0].status, 'active');
  assert.equal(res.data.deals[0].confirmationCount, 3);
  assert.match(feedUrl, /status=eq.active/);
  assert.match(feedUrl, /city=eq.Carlisle/);
  assert.match(feedUrl, /order=spotted_at.desc/);
  const invalidCity = await send(handler, 'GET', undefined, {}, { city: 'Nowhere' });
  assert.equal(invalidCity.statusCode, 400);
});
test('plain-text sanitation, allowed cities, duplicate fingerprinting, and freshness display are stable', () => {
  assert.equal(CITIES.length, 5);
  assert.throws(() => sanitizePlainText('<script>alert(1)</script>', 'itemTitle'));
  assert.equal(sanitizePlainText('  Deal    details  ', 'description'), 'Deal details');
  const a = makeFingerprint({ city: 'Harrisburg', storeName: 'Market Place', itemTitle: 'Coffee beans' });
  const b = makeFingerprint({ city: 'HARRISBURG', storeName: ' market   place ', itemTitle: 'coffee BEANS' });
  assert.equal(a, b);
  assert.equal(formatAge(new Date(Date.now() - 22 * 60000).toISOString()), 'Spotted 22 minutes ago');
  assert.equal(formatAge(new Date(Date.now() - 3660 * 1000).toISOString()), 'Spotted 1 hour ago');
});
test('SQL keeps moderation private, stores only hashes for rate/vote identity, dedupes open reports and expires/reconfirms', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261005000000_community_deal_spotter.sql'), 'utf8');
  assert.match(sql, /status text not null default 'under_review'/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on function public\.pm_submit_community_deal/);
  assert.match(sql, /where status in \('under_review', 'active'\)/);
  assert.match(sql, /submissions >= 3/);
  assert.match(sql, /votes >= 40/);
  assert.match(sql, /interval '7 days'/);
  assert.match(sql, /v_wrong >= 3/);
  assert.match(sql, /v_expired >= 3/);
  assert.match(sql, /Community deal challenge already used/);
  assert.match(sql, /used_at < now\(\) - interval '1 day'/);
});
test('feed page is noindex, has no user-generated HTML templates, and offers both actions', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'community-deals.html'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '..', 'community-deals.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(html, /name="robots" content="noindex,follow"/);
  assert.match(html, /Spot a Deal/);
  assert.match(html, /Live Community Deals/);
  assert.match(html, /Nothing spotted here yet — be the first to report one\./);
  assert.match(html, /Takes about 30 seconds\./);
  assert.match(html, /community-deals-view\.js["']/);
  assert.match(client, /Community reported • confirm with store/);
  assert.match(client, /freshnessBadges\(deal\)/);
  assert.match(client, /makeButton\('Still available'/);
  assert.match(client, /makeButton\('Expired'/);
  assert.match(client, /makeButton\('Wrong info'/);
  assert.match(client, /textContent = deal\.itemTitle/);
  assert.doesNotMatch(client, /innerHTML\s*=\s*.*deal\./);
  assert.match(css, /\.community-deals-list\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:700px\)\{[\s\S]*?\.community-deals-list\{grid-template-columns:1fr\}/);
  assert.match(css, /\.community-deal-body\{min-width:0/);
  assert.match(css, /\.community-empty-state\[hidden\]\{display:none\}/);
  assert.match(css, /\.community-deal-actions button:focus-visible\{/);
});

test('community deal freshness badges distinguish new, today, and confirmed reports', () => {
  const now = new Date(2026, 5, 18, 12, 0, 0);
  const minutesAgo = minutes => new Date(now.getTime() - minutes * 60000).toISOString();
  assert.deepEqual(freshnessBadges({ spottedAt: minutesAgo(12), confirmationCount: 0 }, now), ['New']);
  assert.deepEqual(freshnessBadges({ spottedAt: minutesAgo(95), confirmationCount: 2 }, now), ['Today', 'Community confirmed']);
  assert.deepEqual(freshnessBadges({ spottedAt: minutesAgo(1500), confirmationCount: 0 }, now), []);
  assert.deepEqual(freshnessBadges({ spotted_at: minutesAgo(12), confirmation_count: 1 }, now), ['New', 'Community confirmed']);
});

test('homepage emphasizes Live Deals while retaining Spot a Deal', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(home, /<a class="primary" href="\/community-deals#community-feed">Live Deals/);
  assert.match(home, /<a href="\/community-deals#report-deal">Spot a Deal/);
});

test('community deal prices pair on desktop and the photo picker is custom but keyboard accessible', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'community-deals.html'), 'utf8');
  const home = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '..', 'community-deals.js'), 'utf8');
  assert.equal(home.includes(String.fromCharCode(92) + 'n'), false);
  assert.equal(css.includes(String.fromCharCode(92) + 'n'), false);
  assert.match(home, /<span class="preview-note">[\s\S]*?<\/span>\r?\n\s*<nav class="marketplace-community-links"/);
  assert.ok(html.includes('community-price-fields community-field-wide'));
  assert.ok(html.includes('name="normalPrice" required'));
  assert.ok(html.includes('name="salePrice" required'));
  assert.ok(html.includes('id="communityDealPhoto" class="community-file-input" type="file"'));
  assert.ok(html.includes('class="community-upload-control" for="communityDealPhoto"'));
  assert.ok(html.includes('<span class="community-upload-button">Add photo</span>'));
  assert.ok(html.includes('JPG, PNG, WebP, HEIC or HEIF · up to 10 MB'));
  assert.ok(css.includes('.community-price-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))'));
  assert.ok(css.includes('.community-file-input:focus-visible+.community-upload-control'));
  assert.ok(css.includes('.community-upload-control:hover'));
  assert.ok(css.includes('@media(max-width:700px){.community-price-fields{grid-template-columns:minmax(0,1fr)}'));
  assert.ok(client.includes("photoFilename.textContent = file.name || 'Photo selected'"));
});

