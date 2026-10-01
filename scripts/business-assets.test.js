'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  validateDescriptor, makeCapability, verifyCapability, safeObjectPath,
  validatePendingPath, inspectMagicBytes, isApprovedOrigin, verifyProofOfWork
} = require('../api/business-assets-utils');
const { createHandler } = require('../api/business-assets');

const submissionId = '11111111-1111-4111-8111-111111111111';
const objectId = '22222222-2222-4222-8222-222222222222';
const secret = 'server-only-test-key';
const productionEnv = { VERCEL_ENV: 'production', SUPABASE_URL: 'https://ofjykpqfdogdpmpneuaz.supabase.co', SUPABASE_SERVICE_ROLE_KEY: secret };
const productionHeaders = { host: 'pricemarketpa.com', origin: 'https://pricemarketpa.com', 'x-forwarded-for': '203.0.113.10' };

test('upload validation maps images and PDFs to restricted buckets and enforces size/MIME limits', () => {
  assert.equal(validateDescriptor({ role: 'logo', contentType: 'image/jpeg', size: 1024 }).bucket, 'business-images');
  assert.equal(validateDescriptor({ role: 'document', contentType: 'application/pdf', size: 1024 }).bucket, 'business-documents');
  assert.throws(() => validateDescriptor({ role: 'logo', contentType: 'image/svg+xml', size: 10 }), /not allowed/);
  assert.throws(() => validateDescriptor({ role: 'document', contentType: 'application/pdf', size: 15 * 1024 * 1024 + 1 }), /between 1 byte/);
  assert.throws(() => validateDescriptor({ role: 'gallery-6', contentType: 'image/png', size: 10 }), /Unsupported upload type/);
});

test('pending paths are unique, role-scoped, and cannot escape a submission directory', () => {
  const objectPath = safeObjectPath(submissionId, 'gallery-3', 'webp', objectId);
  assert.equal(objectPath, `pending/${submissionId}/gallery-3-${objectId}.webp`);
  assert.equal(validatePendingPath(objectPath, submissionId, 'gallery-3', 'business-images'), true);
  assert.equal(validatePendingPath(objectPath, submissionId, 'gallery-2', 'business-images'), false);
  assert.equal(validatePendingPath(objectPath, '33333333-3333-4333-8333-333333333333', 'gallery-3', 'business-images'), false);
  assert.equal(validatePendingPath(objectPath, submissionId, 'gallery-3', 'business-documents'), false);
});

test('upload capabilities are signed, scoped to one submission, and expire', () => {
  const token = makeCapability(submissionId, secret, 2000);
  assert.equal(verifyCapability(token, submissionId, secret, 1000), true);
  assert.equal(verifyCapability(token, '33333333-3333-4333-8333-333333333333', secret, 1000), false);
  assert.equal(verifyCapability(token, submissionId, 'wrong-key', 1000), false);
  assert.equal(verifyCapability(token, submissionId, secret, 2000), false);
});

test('server verifies common image, HEIC/HEIF, and PDF signatures instead of trusting file names', () => {
  assert.equal(inspectMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg'), true);
  assert.equal(inspectMagicBytes(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'), true);
  assert.equal(inspectMagicBytes(Buffer.from('RIFF0000WEBP'), 'image/webp'), true);
  assert.equal(inspectMagicBytes(Buffer.from('0000ftypheic0000mif1'), 'image/heic'), true);
  assert.equal(inspectMagicBytes(Buffer.from('%PDF-1.7'), 'application/pdf'), true);
  assert.equal(inspectMagicBytes(Buffer.from('<svg/>'), 'image/png'), false);
});

test('production and preview origins are allowlisted from deployment configuration only', () => {
  assert.equal(isApprovedOrigin('https://pricemarketpa.com', { VERCEL_ENV: 'production' }), true);
  assert.equal(isApprovedOrigin('https://www.pricemarketpa.com', { VERCEL_ENV: 'production' }), true);
  assert.equal(isApprovedOrigin('http://pricemarketpa.com', { VERCEL_ENV: 'production' }), false);
  assert.equal(isApprovedOrigin('https://evil.example', { VERCEL_ENV: 'production' }), false);
  assert.equal(isApprovedOrigin('https://pricemarket-git-feature-pm.vercel.app', { VERCEL_ENV: 'preview', VERCEL_URL: 'pricemarket-git-feature-pm.vercel.app' }), true);
  assert.equal(isApprovedOrigin('https://attacker.vercel.app', { VERCEL_ENV: 'preview', VERCEL_URL: 'pricemarket-git-feature-pm.vercel.app' }), false);
  assert.equal(isApprovedOrigin('https://pricemarketpa.com', { VERCEL_ENV: 'preview', VERCEL_URL: 'pricemarket-git-feature-pm.vercel.app' }), false);
  assert.equal(isApprovedOrigin('https://pricemarketpa.com/path', { VERCEL_ENV: 'production' }), false);
});

test('server-verifiable proof-of-work accepts only a valid nonce/counter pair', () => {
  let counter = 0;
  const nonce = 'G2ukKfU-0qmbbq2I5bJrJzvTKcKv6K8m';
  while (true) {
    const digest = crypto.createHash('sha256').update(`${nonce}:${counter}`).digest();
    if (digest[0] === 0 && digest[1] === 0) break;
    counter++;
  }
  assert.equal(verifyProofOfWork(nonce, counter, 16), true);
  assert.equal(verifyProofOfWork(nonce, counter + 1, 16), false);
  assert.equal(verifyProofOfWork(nonce, counter, 8), false);
});

function call(handler, body, headers = productionHeaders) {
  return new Promise(resolve => {
    const res = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(text) { resolve({ status: this.statusCode, headers: this.headers, body: JSON.parse(text) }); }
    };
    handler({ method: 'POST', headers, body }, res);
  });
}

function solveProof(nonce) {
  let counter = 0;
  while (true) {
    const digest = crypto.createHash('sha256').update(`${nonce}:${counter}`).digest();
    if (digest[0] === 0 && digest[1] === 0) return counter;
    counter++;
  }
}

function mockBackend(base, serviceKey, controls = {}) {
  const sessions = new Map();
  const challenges = new Set();
  const rateCounts = new Map();
  const slots = new Map();
  const galleryIssues = new Map();
  const storageObjects = new Set();
  const failDeletes = new Map();
  const failCommits = new Map();
  for (const [key, value] of Object.entries(controls.failDeletes || {})) failDeletes.set(key, value);
  for (const [key, value] of Object.entries(controls.failCommits || {})) failCommits.set(key, value);
  const calls = [];
  const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/rest/v1/pm_business_upload_sessions?')) {
      const id = new URL(url).searchParams.get('submission_id').slice(3);
      return new Response(JSON.stringify(sessions.has(id) ? [{ submission_id: id }] : []), { status: 200 });
    }
    if (url.includes('/rest/v1/rpc/pm_create_business_upload_session')) {
      const row = JSON.parse(options.body);
      if (challenges.has(row.p_challenge_id)) return new Response(JSON.stringify({ message: 'This upload challenge has already been used' }), { status: 400 });
      const rate = rateCounts.get(row.p_ip_hash) || 0;
      if (rate >= 10) return new Response(JSON.stringify({ message: 'Upload session rate limit reached' }), { status: 400 });
      sessions.set(row.p_submission_id, row);
      challenges.add(row.p_challenge_id);
      rateCounts.set(row.p_ip_hash, rate + 1);
      return new Response('true', { status: 200 });
    }
    if (url.includes('/rest/v1/rpc/pm_reserve_business_upload_slot')) {
      const value = JSON.parse(options.body);
      const key = `${value.p_submission_id}:${value.p_role}`;
      const slot = slots.get(key) || { count: 0, state: 'empty', active: null, previous: null, pending: null };
      if (slot.count >= 5) return new Response(JSON.stringify({ message: 'Upload replacement limit reached for this slot' }), { status: 400 });
      if (value.p_role.startsWith('gallery-')) {
        const issueKey = value.p_submission_id;
        const issued = galleryIssues.get(issueKey) || 0;
        if (issued >= 10) return new Response(JSON.stringify({ message: 'Gallery upload limit reached for this submission' }), { status: 400 });
        galleryIssues.set(issueKey, issued + 1);
      }
      if (['issued', 'uploaded'].includes(slot.state)) {
        if (slot.previous) return new Response(JSON.stringify({ message: 'Previous replacement cleanup must finish before another replacement' }), { status: 400 });
        if (slot.pending) return new Response(JSON.stringify({ message: 'A previous upload reservation is still pending' }), { status: 400 });
        if (slot.state !== 'uploaded' || !value.p_replace_path || value.p_replace_path !== slot.active) return new Response(JSON.stringify({ message: 'This upload slot is already in use' }), { status: 400 });
      } else if (value.p_replace_path) return new Response(JSON.stringify({ message: 'The file selected for replacement is no longer active' }), { status: 400 });
      slot.pending = value.p_object_path;
      storageObjects.add(value.p_object_path);
      slot.state = 'issued';
      slot.count++;
      slots.set(key, slot);
      return new Response('true', { status: 200 });
    }
    if (url.includes('/rest/v1/rpc/pm_finalize_business_upload_slot')) {
      const value = JSON.parse(options.body);
      const slot = slots.get(`${value.p_submission_id}:${value.p_role}`);
      if (!slot || slot.state !== 'issued' || slot.pending !== value.p_object_path) return new Response(JSON.stringify({ message: 'Upload reservation does not match' }), { status: 400 });
      slot.previous = slot.active;
      slot.active = slot.pending;
      slot.pending = null;
      slot.state = 'uploaded';
      return new Response(JSON.stringify(slot.previous), { status: 200 });
    }
    if (url.includes('/rest/v1/rpc/pm_validate_business_upload_slot_file')) {
      const value = JSON.parse(options.body);
      const slot = slots.get(`${value.p_submission_id}:${value.p_role}`);
      return new Response(String(Boolean(slot && (slot.active === value.p_object_path || slot.previous === value.p_object_path || slot.pending === value.p_object_path))), { status: 200 });
    }
    if (url.includes('/rest/v1/rpc/pm_commit_business_upload_slot_file_removal')) {
      const value = JSON.parse(options.body);
      const slot = slots.get(`${value.p_submission_id}:${value.p_role}`);
      const remainingFailures = failCommits.get(value.p_object_path) || 0;
      if (remainingFailures > 0) {
        failCommits.set(value.p_object_path, remainingFailures - 1);
        return new Response(JSON.stringify({ message: 'Temporary ledger error' }), { status: 500 });
      }
      if (!slot) return new Response(JSON.stringify({ removed: false }), { status: 200 });
      if (slot.pending === value.p_object_path) {
        slot.pending = null;
        slot.state = slot.active ? 'uploaded' : 'removed';
        return new Response(JSON.stringify({ removed: true, restoredPath: null }), { status: 200 });
      }
      if (slot.active === value.p_object_path) {
        if (slot.previous) { const restoredPath = slot.previous; slot.active = restoredPath; slot.previous = null; slot.state = 'uploaded'; return new Response(JSON.stringify({ removed: true, restoredPath }), { status: 200 }); }
        slot.active = null; slot.previous = null; slot.state = 'removed';
        return new Response(JSON.stringify({ removed: true, restoredPath: null }), { status: 200 });
      }
      if (slot.previous === value.p_object_path) { slot.previous = null; return new Response(JSON.stringify({ removed: true, restoredPath: null }), { status: 200 }); }
      return new Response(JSON.stringify({ removed: false }), { status: 200 });
    }
    if (url.includes('/object/upload/sign/')) return new Response(JSON.stringify({ signedUrl: `${base}/storage/v1/object/upload/sign/business-images/pending/x?token=limited` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/object/info/')) {
      const pathStart = url.indexOf('/object/info/') + '/object/info/'.length;
      const [, ...segments] = url.slice(pathStart).split('/');
      const objectPath = segments.map(decodeURIComponent).join('/');
      if (!storageObjects.has(objectPath)) return new Response(JSON.stringify({ statusCode: '404', error: 'ObjectNotFound', message: 'Object not found' }), { status: 404 });
      return new Response(JSON.stringify({ metadata: { size: imageBytes.length, mimetype: 'image/png' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/object/public/')) return new Response(imageBytes, { status: 200 });
    if (options.method === 'DELETE') {
      const objectPath = JSON.parse(options.body).prefixes[0];
      const remainingFailures = failDeletes.get(objectPath) || 0;
      if (remainingFailures > 0) {
        failDeletes.set(objectPath, remainingFailures - 1);
        return new Response(JSON.stringify({ message: 'Temporary Storage failure' }), { status: 503 });
      }
      if (!storageObjects.has(objectPath)) return new Response(JSON.stringify({ statusCode: '404', error: 'ObjectNotFound', message: 'Object not found' }), { status: 404 });
      storageObjects.delete(objectPath);
      return new Response('', { status: 200 });
    }
    throw new Error(`Unexpected storage call ${url}`);
  };
  return { fakeFetch, calls, sessions, slots, storageObjects, failDeletes, failCommits };
}

async function createSession(handler, headers = productionHeaders) {
  const challengeResponse = await call(handler, { action: 'challenge' }, headers);
  assert.equal(challengeResponse.status, 200);
  const challenge = challengeResponse.body;
  const proof = solveProof(challenge.nonce);
  const initialized = await call(handler, { action: 'initialize', challengeId: challenge.challengeId, challengeToken: challenge.challengeToken, proof }, headers);
  return { challenge, proof, initialized, session: initialized.body };
}

test('requests with missing or invalid Origin cannot initialize an upload session', async () => {
  const { fakeFetch } = mockBackend('https://ofjykpqfdogdpmpneuaz.supabase.co', secret);
  const handler = createHandler({ env: productionEnv, fetchImpl: fakeFetch });
  assert.equal((await call(handler, { action: 'challenge' }, { host: 'pricemarketpa.com' })).status, 403);
  assert.equal((await call(handler, { action: 'initialize' }, { host: 'pricemarketpa.com' })).status, 403);
  assert.equal((await call(handler, { action: 'initialize' }, { host: 'pricemarketpa.com', origin: 'null' })).status, 403);
});

test('unauthorized hosts are rejected even when they send a Price Market Origin header', async () => {
  const { fakeFetch } = mockBackend('https://ofjykpqfdogdpmpneuaz.supabase.co', secret);
  const handler = createHandler({ env: productionEnv, fetchImpl: fakeFetch });
  assert.equal((await call(handler, { action: 'challenge' }, { host: 'evil.example', origin: 'https://pricemarketpa.com' })).status, 403);
  assert.equal((await call(handler, { action: 'challenge' }, { host: 'pricemarketpa.com', origin: 'https://evil.example' })).status, 403);
});

test('valid Price Market production flow challenges, initializes, signs, verifies, returns a public URL, and removes a pending file', async () => {
  const base = 'https://ofjykpqfdogdpmpneuaz.supabase.co';
  const { fakeFetch, calls } = mockBackend(base, secret);
  const handler = createHandler({ env: productionEnv, fetchImpl: fakeFetch, uuid: (() => { let ids = ['00000000-0000-4000-8000-000000000001', submissionId, objectId, '33333333-3333-4333-8333-333333333333']; return () => ids.shift() || objectId; })() });
  const { initialized, session } = await createSession(handler);
  assert.equal(initialized.status, 200);
  const signed = await call(handler, { action: 'sign', ...session, role: 'logo', contentType: 'image/png', size: 8 });
  assert.equal(signed.status, 200);
  assert.match(signed.body.path, new RegExp(`^pending/${submissionId}/logo-`));
  assert.equal(signed.body.bucket, 'business-images');
  const finalized = await call(handler, { action: 'finalize', ...session, role: 'logo', contentType: 'image/png', size: 8, ...signed.body });
  assert.equal(finalized.status, 200);
  assert.match(finalized.body.publicUrl, /\/storage\/v1\/object\/public\/business-images\/pending\//);
  const replacement = await call(handler, { action: 'sign', ...session, role: 'logo', contentType: 'image/png', size: 8, replacePath: signed.body.path });
  assert.equal(replacement.status, 200);
  const replaced = await call(handler, { action: 'finalize', ...session, role: 'logo', contentType: 'image/png', size: 8, ...replacement.body });
  assert.equal(replaced.status, 200);
  assert.equal(replaced.body.replacedPath, signed.body.path);
  const removedOld = await call(handler, { action: 'remove', ...session, role: 'logo', bucket: signed.body.bucket, path: replaced.body.replacedPath });
  assert.deepEqual(removedOld.body, { removed: true, restoredPath: '' });
  const removed = await call(handler, { action: 'remove', ...session, role: 'logo', bucket: replacement.body.bucket, path: replacement.body.path });
  assert.deepEqual(removed.body, { removed: true, restoredPath: '' });
  const pathCalls = calls.filter(entry => entry.options?.body?.includes?.(replacement.body.path) || entry.url.includes('/object/business-images'));
  const validationIndex = calls.findIndex(entry => entry.url.includes('/rpc/pm_validate_business_upload_slot_file') && entry.options.body.includes(replacement.body.path));
  const deleteIndex = calls.findIndex(entry => entry.options.method === 'DELETE' && entry.options.body.includes(replacement.body.path));
  const commitIndex = calls.findIndex(entry => entry.url.includes('/rpc/pm_commit_business_upload_slot_file_removal') && entry.options.body.includes(replacement.body.path));
  assert.ok(validationIndex < deleteIndex && deleteIndex < commitIndex, 'ledger validation, Storage deletion, then ledger commit');
  assert.ok(pathCalls.length > 0);
  assert.ok(calls.filter(call => !call.url.includes('/object/public/')).every(call => call.options.headers?.apikey === secret));
  assert.ok(calls.every(call => !call.url.includes(secret)));
});

test('Storage delete failure leaves the ledger intact and a retry removes the object before updating it', async () => {
  const { fakeFetch, calls, slots, failDeletes } = mockBackend(productionEnv.SUPABASE_URL, secret);
  const handler = createHandler({ env: productionEnv, fetchImpl: fakeFetch });
  const { session } = await createSession(handler);
  const signed = await call(handler, { action: 'sign', ...session, role: 'logo', contentType: 'image/png', size: 8 });
  await call(handler, { action: 'finalize', ...session, role: 'logo', contentType: 'image/png', size: 8, ...signed.body });
  const slot = slots.get(`${session.submissionId}:logo`);
  failDeletes.set(signed.body.path, 1);

  const failed = await call(handler, { action: 'remove', ...session, role: 'logo', bucket: signed.body.bucket, path: signed.body.path });
  assert.equal(failed.status, 502);
  assert.equal(slot.active, signed.body.path);
  assert.equal(slot.state, 'uploaded');
  assert.ok(calls.some(entry => entry.url.includes('/rpc/pm_validate_business_upload_slot_file')));
  assert.equal(calls.some(entry => entry.url.includes('/rpc/pm_commit_business_upload_slot_file_removal') && entry.options.body.includes(signed.body.path)), false);

  const retry = await call(handler, { action: 'remove', ...session, role: 'logo', bucket: signed.body.bucket, path: signed.body.path });
  assert.equal(retry.status, 200);
  assert.equal(slot.active, null);
  assert.equal(slot.state, 'removed');
  assert.equal((await call(handler, { action: 'remove', ...session, role: 'logo', bucket: signed.body.bucket, path: signed.body.path })).body.alreadyRemoved, true);
});

test('retry completes the ledger update when Storage deletion succeeded but the first ledger commit failed', async () => {
  const { fakeFetch, slots, failCommits } = mockBackend(productionEnv.SUPABASE_URL, secret);
  const handler = createHandler({ env: productionEnv, fetchImpl: fakeFetch });
  const { session } = await createSession(handler);
  const signed = await call(handler, { action: 'sign', ...session, role: 'gallery-1', contentType: 'image/png', size: 8 });
  await call(handler, { action: 'finalize', ...session, role: 'gallery-1', contentType: 'image/png', size: 8, ...signed.body });
  const slot = slots.get(`${session.submissionId}:gallery-1`);
  failCommits.set(signed.body.path, 1);

  const firstAttempt = await call(handler, { action: 'remove', ...session, role: 'gallery-1', bucket: signed.body.bucket, path: signed.body.path });
  assert.equal(firstAttempt.status, 502);
  assert.equal(slot.active, signed.body.path, 'ledger reference survives the failed commit');
  const retry = await call(handler, { action: 'remove', ...session, role: 'gallery-1', bucket: signed.body.bucket, path: signed.body.path });
  assert.equal(retry.status, 200, 'confirmed absence in Storage makes the retry idempotent');
  assert.equal(slot.active, null);
});

test('replacement cleanup failure keeps the old file tracked and retryable without displacing the new active file', async () => {
  const { fakeFetch, calls, slots, failDeletes } = mockBackend(productionEnv.SUPABASE_URL, secret);
  const handler = createHandler({ env: productionEnv, fetchImpl: fakeFetch });
  const { session } = await createSession(handler);
  const first = await call(handler, { action: 'sign', ...session, role: 'cover', contentType: 'image/png', size: 8 });
  await call(handler, { action: 'finalize', ...session, role: 'cover', contentType: 'image/png', size: 8, ...first.body });
  const replacement = await call(handler, { action: 'sign', ...session, role: 'cover', contentType: 'image/png', size: 8, replacePath: first.body.path });
  await call(handler, { action: 'finalize', ...session, role: 'cover', contentType: 'image/png', size: 8, ...replacement.body });
  const slot = slots.get(`${session.submissionId}:cover`);
  assert.equal(slot.active, replacement.body.path);
  assert.equal(slot.previous, first.body.path);

  failDeletes.set(first.body.path, 1);
  const failedCleanup = await call(handler, { action: 'remove', ...session, role: 'cover', bucket: first.body.bucket, path: first.body.path });
  assert.equal(failedCleanup.status, 502);
  assert.equal(slot.active, replacement.body.path);
  assert.equal(slot.previous, first.body.path);
  const replacementWhilePending = await call(handler, { action: 'sign', ...session, role: 'cover', contentType: 'image/png', size: 8, replacePath: replacement.body.path });
  assert.equal(replacementWhilePending.status, 409);

  const retry = await call(handler, { action: 'remove', ...session, role: 'cover', bucket: first.body.bucket, path: first.body.path });
  assert.equal(retry.status, 200);
  assert.equal(slot.active, replacement.body.path);
  assert.equal(slot.previous, null);
  const validationIndex = calls.findIndex(entry => entry.url.includes('/rpc/pm_validate_business_upload_slot_file') && entry.options.body.includes(first.body.path));
  const failedDeleteIndex = calls.findIndex(entry => entry.options.method === 'DELETE' && entry.options.body.includes(first.body.path));
  const cleanupCommitIndex = calls.findIndex(entry => entry.url.includes('/rpc/pm_commit_business_upload_slot_file_removal') && entry.options.body.includes(first.body.path));
  assert.ok(validationIndex < failedDeleteIndex && failedDeleteIndex < cleanupCommitIndex);
});

test('failed replacement upload cleanup leaves the prior uploaded asset active', async () => {
  const { fakeFetch, slots, failDeletes } = mockBackend(productionEnv.SUPABASE_URL, secret);
  const handler = createHandler({ env: productionEnv, fetchImpl: fakeFetch });
  const { session } = await createSession(handler);
  const first = await call(handler, { action: 'sign', ...session, role: 'logo', contentType: 'image/png', size: 8 });
  await call(handler, { action: 'finalize', ...session, role: 'logo', contentType: 'image/png', size: 8, ...first.body });
  const replacement = await call(handler, { action: 'sign', ...session, role: 'logo', contentType: 'image/png', size: 8, replacePath: first.body.path });
  const slot = slots.get(`${session.submissionId}:logo`);
  assert.equal(slot.active, first.body.path, 'the old asset remains active during replacement upload');
  assert.equal(slot.pending, replacement.body.path);

  failDeletes.set(replacement.body.path, 1);
  const failedCleanup = await call(handler, { action: 'remove', ...session, role: 'logo', bucket: replacement.body.bucket, path: replacement.body.path });
  assert.equal(failedCleanup.status, 502);
  assert.equal(slot.active, first.body.path);
  assert.equal(slot.pending, replacement.body.path, 'failed cleanup remains tracked as a pending path');

  const retry = await call(handler, { action: 'remove', ...session, role: 'logo', bucket: replacement.body.bucket, path: replacement.body.path });
  assert.equal(retry.status, 200);
  assert.equal(slot.active, first.body.path);
  assert.equal(slot.pending, null);
});

test('valid trusted Vercel Preview origin can initialize and sign while other preview hosts are rejected', async () => {
  const base = 'https://ofjykpqfdogdpmpneuaz.supabase.co';
  const { fakeFetch } = mockBackend(base, secret);
  const env = { ...productionEnv, VERCEL_ENV: 'preview', VERCEL_URL: 'pricemarket-git-uploads-team.vercel.app' };
  const handler = createHandler({ env, fetchImpl: fakeFetch, uuid: crypto.randomUUID });
  const headers = { ...productionHeaders, host: env.VERCEL_URL, origin: `https://${env.VERCEL_URL}` };
  const { initialized, session } = await createSession(handler, headers);
  assert.equal(initialized.status, 200);
  const signed = await call(handler, { action: 'sign', ...session, role: 'logo', contentType: 'image/png', size: 8 }, headers);
  assert.equal(signed.status, 200);
  assert.equal((await call(handler, { action: 'challenge' }, { host: 'attacker.vercel.app', origin: 'https://attacker.vercel.app' })).status, 403);
});

test('server enforces per-session role and gallery quotas through the atomic quota ledger', async () => {
  const base = 'https://ofjykpqfdogdpmpneuaz.supabase.co';
  const { fakeFetch } = mockBackend(base, secret);
  const handler = createHandler({ env: productionEnv, fetchImpl: fakeFetch, uuid: (() => { let n = 1; return () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`; })() });
  const { initialized, session } = await createSession(handler);
  assert.equal(initialized.status, 200);

  for (const role of ['logo', 'cover', 'document']) {
    const contentType = role === 'document' ? 'application/pdf' : 'image/png';
    const first = await call(handler, { action: 'sign', ...session, role, contentType, size: 8 });
    assert.equal(first.status, 200, `${role} first slot reservation`);
    const duplicate = await call(handler, { action: 'sign', ...session, role, contentType, size: 8 });
    assert.equal(duplicate.status, 409, `${role} duplicate slot reservation`);
  }
  for (let i = 1; i <= 5; i++) {
    const result = await call(handler, { action: 'sign', ...session, role: `gallery-${i}`, contentType: 'image/png', size: 8 });
    assert.equal(result.status, 200, `gallery slot ${i}`);
  }
  const sixth = await call(handler, { action: 'sign', ...session, role: 'gallery-6', contentType: 'image/png', size: 8 });
  assert.equal(sixth.status, 400);
  const repeat = await call(handler, { action: 'sign', ...session, role: 'gallery-1', contentType: 'image/png', size: 8 });
  assert.equal(repeat.status, 409, 'same gallery slot cannot mint another URL without a verified replacement');

  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261001220000_business_upload_quotas.sql'), 'utf8');
  assert.match(migration, /gallery_issue_count between 0 and 10/);
  assert.match(migration, /issue_count between 0 and 5/);
  assert.match(migration, /Gallery is limited to five files/);
  assert.match(migration, /Upload replacement limit reached for this slot/);
  assert.match(migration, /Upload session rate limit reached/);
  assert.match(migration, /session_count between 0 and 10/);
  assert.match(migration, /challenge_id uuid not null unique/);
  assert.match(migration, /revoke all on public\.pm_business_upload_sessions from anon, authenticated/);
  assert.match(migration, /revoke all on public\.pm_business_upload_slots from anon, authenticated/);
  assert.match(migration, /revoke all on public\.pm_business_upload_rate_limits from anon, authenticated/);
});

test('session initialization applies a persistent per-IP rate limit after proof-of-work', async () => {
  const { fakeFetch } = mockBackend(productionEnv.SUPABASE_URL, secret);
  const handler = createHandler({ env: productionEnv, fetchImpl: fakeFetch });
  let last;
  for (let attempt = 0; attempt < 11; attempt++) last = await createSession(handler, productionHeaders);
  assert.equal(last.initialized.status, 429);
  assert.match(last.initialized.body.error, /rate limit/i);
});

test('replacement permits are finite and cannot mint a sixth signed URL for the same role/session', async () => {
  const { fakeFetch } = mockBackend(productionEnv.SUPABASE_URL, secret);
  const handler = createHandler({ env: productionEnv, fetchImpl: fakeFetch });
  const { initialized, session } = await createSession(handler, productionHeaders);
  assert.equal(initialized.status, 200);
  let activePath = '';
  for (let issue = 0; issue < 5; issue++) {
    const signed = await call(handler, { action: 'sign', ...session, role: 'logo', contentType: 'image/png', size: 8, replacePath: activePath });
    assert.equal(signed.status, 200);
    const finalized = await call(handler, { action: 'finalize', ...session, role: 'logo', contentType: 'image/png', size: 8, ...signed.body });
    assert.equal(finalized.status, 200);
    if (finalized.body.replacedPath) {
      const cleaned = await call(handler, { action: 'remove', ...session, role: 'logo', bucket: signed.body.bucket, path: finalized.body.replacedPath });
      assert.equal(cleaned.status, 200, 'prior asset cleanup completes before the next replacement');
    }
    activePath = signed.body.path;
  }
  const sixth = await call(handler, { action: 'sign', ...session, role: 'logo', contentType: 'image/png', size: 8, replacePath: activePath });
  assert.equal(sixth.status, 409);
  assert.match(sixth.body.error, /replacement limit/i);
});

