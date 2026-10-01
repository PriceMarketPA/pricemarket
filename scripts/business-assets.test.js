'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateDescriptor, makeCapability, verifyCapability, safeObjectPath,
  validatePendingPath, inspectMagicBytes
} = require('../api/business-assets-utils');
const { createHandler } = require('../api/business-assets');

const submissionId = '11111111-1111-4111-8111-111111111111';
const objectId = '22222222-2222-4222-8222-222222222222';
const secret = 'server-only-test-key';

test('upload validation maps images and PDFs to their restricted buckets and enforces size/MIME limits', () => {
  assert.equal(validateDescriptor({ role: 'logo', contentType: 'image/jpeg', size: 1024 }).bucket, 'business-images');
  assert.equal(validateDescriptor({ role: 'document', contentType: 'application/pdf', size: 1024 }).bucket, 'business-documents');
  assert.throws(() => validateDescriptor({ role: 'logo', contentType: 'image/svg+xml', size: 10 }), /not allowed/);
  assert.throws(() => validateDescriptor({ role: 'document', contentType: 'application/pdf', size: 15 * 1024 * 1024 + 1 }), /between 1 byte/);
  assert.throws(() => validateDescriptor({ role: 'gallery-6', contentType: 'image/png', size: 10 }), /Unsupported upload type/);
});

test('pending paths are unique, role-scoped, and cannot escape a submission directory', () => {
  const path = safeObjectPath(submissionId, 'gallery-3', 'webp', objectId);
  assert.equal(path, `pending/${submissionId}/gallery-3-${objectId}.webp`);
  assert.equal(validatePendingPath(path, submissionId, 'gallery-3', 'business-images'), true);
  assert.equal(validatePendingPath(path, submissionId, 'gallery-2', 'business-images'), false);
  assert.equal(validatePendingPath(path, '33333333-3333-4333-8333-333333333333', 'gallery-3', 'business-images'), false);
  assert.equal(validatePendingPath(path, submissionId, 'gallery-3', 'business-documents'), false);
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

function call(handler, body, headers = {}) {
  return new Promise(resolve => {
    const res = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(text) { resolve({ status: this.statusCode, headers: this.headers, body: JSON.parse(text) }); }
    };
    handler({ method: 'POST', headers, body }, res);
  });
}

test('server upload flow signs, verifies, returns a public URL, and removes only scoped pending objects', async () => {
  const base = 'https://ofjykpqfdogdpmpneuaz.supabase.co';
  const serviceKey = 'server-service-role-secret';
  const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/object/upload/sign/')) return new Response(JSON.stringify({ signedUrl: `${base}/storage/v1/object/upload/sign/business-images/pending/x?token=limited` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/object/info/')) return new Response(JSON.stringify({ metadata: { size: imageBytes.length, mimetype: 'image/png' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/object/public/')) return new Response(imageBytes, { status: 200 });
    if (options.method === 'DELETE') return new Response('', { status: 200 });
    throw new Error(`Unexpected storage call ${url}`);
  };
  const handler = createHandler({ env: { SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: serviceKey }, fetchImpl: fakeFetch, uuid: () => submissionId, now: () => 1000 });

  const initialized = await call(handler, { action: 'initialize' }, { host: 'preview.example.test', origin: 'https://preview.example.test' });
  assert.equal(initialized.status, 200);
  const session = initialized.body;
  const signed = await call(handler, { action: 'sign', ...session, role: 'logo', contentType: 'image/png', size: imageBytes.length });
  assert.equal(signed.status, 200);
  assert.match(signed.body.path, new RegExp(`^pending/${submissionId}/logo-`));
  assert.equal(signed.body.bucket, 'business-images');
  assert.match(signed.body.uploadUrl, /^https:\/\/ofjykpqfdogdpmpneuaz\.supabase\.co\/storage\/v1\//);
  const finalized = await call(handler, { action: 'finalize', ...session, role: 'logo', contentType: 'image/png', size: imageBytes.length, ...signed.body });
  assert.equal(finalized.status, 200);
  assert.match(finalized.body.publicUrl, /\/storage\/v1\/object\/public\/business-images\/pending\//);
  const removed = await call(handler, { action: 'remove', ...session, role: 'logo', bucket: signed.body.bucket, path: signed.body.path });
  assert.deepEqual(removed.body, { removed: true });
  assert.ok(calls.filter(call => !call.url.includes('/object/public/')).every(call => call.options.headers?.apikey === serviceKey));
  assert.ok(calls.every(call => !call.url.includes(serviceKey)));
});

test('upload endpoint rejects a cross-origin browser request and does not require browser service credentials', async () => {
  const handler = createHandler({ env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: secret } });
  const response = await call(handler, { action: 'initialize' }, { host: 'pricemarketpa.com', origin: 'https://evil.example' });
  assert.equal(response.status, 403);
  const missingConfig = createHandler({ env: {} });
  assert.equal((await call(missingConfig, { action: 'initialize' })).status, 503);
});
