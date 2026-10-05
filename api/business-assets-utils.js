'use strict';

const crypto = require('node:crypto');

const IMAGE_MIMES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif'
});
const IMAGE_LIMIT = 10 * 1024 * 1024;
const PDF_LIMIT = 15 * 1024 * 1024;

function expectedForRole(role) {
  if (role === 'document') return { bucket: 'business-documents', maxSize: PDF_LIMIT, mimes: { 'application/pdf': 'pdf' } };
  if (['logo', 'cover', 'gallery-1', 'gallery-2', 'gallery-3', 'gallery-4', 'gallery-5'].includes(role)) {
    return { bucket: 'business-images', maxSize: IMAGE_LIMIT, mimes: IMAGE_MIMES };
  }
  throw new Error('Unsupported upload type.');
}

function validateDescriptor({ role, contentType, size }) {
  const expected = expectedForRole(role);
  if (!Object.hasOwn(expected.mimes, contentType)) throw new Error('This file type is not allowed.');
  if (!Number.isSafeInteger(Number(size)) || Number(size) < 1 || Number(size) > expected.maxSize) {
    throw new Error(`This file must be between 1 byte and ${expected.maxSize / 1024 / 1024} MB.`);
  }
  return { ...expected, extension: expected.mimes[contentType], contentType, size: Number(size) };
}

function makeCapability(submissionId, secret, expiresAt = Date.now() + 24 * 60 * 60 * 1000) {
  const payload = Buffer.from(JSON.stringify({ submissionId, expiresAt })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyCapability(token, submissionId, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 512 || typeof submissionId !== 'string') return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return false; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return decoded.submissionId === submissionId && Number.isFinite(decoded.expiresAt) && decoded.expiresAt > now;
  } catch { return false; }
}

function safeObjectPath(submissionId, role, extension, objectId = crypto.randomUUID()) {
  if (!/^[0-9a-f-]{36}$/i.test(submissionId) || !/^[0-9a-f-]{36}$/i.test(objectId)) throw new Error('Invalid upload identifier.');
  const expected = expectedForRole(role);
  if (!Object.values(expected.mimes).includes(extension)) throw new Error('Invalid file extension.');
  const fileRole = role === 'document' ? 'document' : role;
  return `pending/${submissionId}/${fileRole}-${objectId}.${extension}`;
}

function validatePendingPath(path, submissionId, role, bucket) {
  const expected = expectedForRole(role);
  if (bucket !== expected.bucket || typeof path !== 'string') return false;
  const escapedRole = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const extension = Object.values(expected.mimes).join('|');
  return new RegExp(`^pending/${submissionId}/${escapedRole}-[0-9a-f-]{36}\\.(?:${extension})$`, 'i').test(path);
}

function inspectMagicBytes(buffer, contentType) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || []);
  if (contentType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === 'image/webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (contentType === 'application/pdf') return buffer.toString('ascii', 0, 5) === '%PDF-';
  if (contentType === 'image/heic' || contentType === 'image/heif') {
    if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
    const brands = [buffer.toString('ascii', 8, 12)];
    for (let offset = 16; offset + 4 <= Math.min(buffer.length, 64); offset += 4) brands.push(buffer.toString('ascii', offset, offset + 4));
    return brands.some(brand => ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand));
  }
  return false;
}

function normalizeOrigin(origin) {
  if (typeof origin !== 'string' || !origin || origin.length > 300) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.origin !== origin) return null;
    return parsed.origin;
  } catch { return null; }
}

function vercelHost(value) {
  if (typeof value !== 'string') return null;
  const host = value.trim().toLowerCase();
  if (!host || host.length > 253 || host.includes('/') || host.includes(':') || !/^[a-z0-9.-]+$/.test(host)) return null;
  return host.endsWith('.vercel.app') && host.split('.').every(part => part && part !== '..') ? host : null;
}

function approvedOrigins(env = {}) {
  if (env.VERCEL_ENV === 'production') return new Set(['https://pricemarketpa.com', 'https://www.pricemarketpa.com']);
  if (env.VERCEL_ENV === 'preview') {
    return new Set([env.VERCEL_URL, env.VERCEL_BRANCH_URL].map(vercelHost).filter(Boolean).map(host => `https://${host}`));
  }
  return new Set(String(env.BUSINESS_UPLOAD_ALLOWED_ORIGINS || '').split(',').map(value => normalizeOrigin(value.trim())).filter(Boolean));
}

function isApprovedOrigin(origin, env = {}) {
  const normalized = normalizeOrigin(origin);
  return Boolean(normalized && approvedOrigins(env).has(normalized));
}

function signPayload(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function readSignedPayload(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 1200) return null;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return Number.isFinite(payload.expiresAt) && payload.expiresAt > now ? payload : null;
  } catch { return null; }
}

function verifyProofOfWork(nonce, counter, difficultyBits = 16) {
  if (typeof nonce !== 'string' || nonce.length < 20 || nonce.length > 100 || !Number.isSafeInteger(Number(counter)) || Number(counter) < 0 || difficultyBits !== 16) return false;
  const digest = crypto.createHash('sha256').update(`${nonce}:${Number(counter)}`).digest();
  return digest[0] === 0 && digest[1] === 0;
}


function normalizeStorageMimeType(value) {
  if (typeof value !== 'string') return null;
  const mime = value.split(';', 1)[0].trim().toLowerCase();
  if (!mime) return null;
  const aliases = {
    'image/jpg': 'image/jpeg',
    'image/pjpeg': 'image/jpeg',
    'image/x-png': 'image/png',
    'application/x-pdf': 'application/pdf'
  };
  return aliases[mime] || mime;
}

function normalizeStorageByteSize(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^\\d+$/.test(value.trim())) return null;
  const size = Number(value.trim());
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

function extractStoredObjectMetadata(info) {
  const metadata = info?.metadata && typeof info.metadata === 'object' ? info.metadata : {};
  const sizeCandidates = [
    ['metadata.size', metadata.size],
    ['metadata.contentLength', metadata.contentLength],
    ['metadata.content_length', metadata.content_length],
    ['info.size', info?.size],
    ['info.contentLength', info?.contentLength],
    ['info.content_length', info?.content_length]
  ].map(([field, value]) => ({ field, value: normalizeStorageByteSize(value) })).filter(item => item.value !== null);
  const mimeCandidates = [
    ['metadata.mimetype', metadata.mimetype],
    ['metadata.mimeType', metadata.mimeType],
    ['metadata.mime_type', metadata.mime_type],
    ['metadata.contentType', metadata.contentType],
    ['metadata.content_type', metadata.content_type],
    ['metadata.httpMetadata.contentType', metadata.httpMetadata?.contentType],
    ['info.mimetype', info?.mimetype],
    ['info.mimeType', info?.mimeType],
    ['info.contentType', info?.contentType],
    ['info.content_type', info?.content_type]
  ].map(([field, value]) => ({ field, value: normalizeStorageMimeType(value) })).filter(item => item.value !== null);
  const distinctSizes = new Set(sizeCandidates.map(item => item.value));
  const distinctMimes = new Set(mimeCandidates.map(item => item.value));
  return {
    size: sizeCandidates[0]?.value ?? null,
    sizeField: sizeCandidates[0]?.field ?? null,
    sizeFields: sizeCandidates.map(item => item.field),
    sizeConsistent: sizeCandidates.length > 0 && distinctSizes.size === 1,
    contentType: mimeCandidates[0]?.value ?? null,
    contentTypeField: mimeCandidates[0]?.field ?? null,
    contentTypeFields: mimeCandidates.map(item => item.field),
    contentTypeConsistent: mimeCandidates.length > 0 && distinctMimes.size === 1,
    infoFields: info && typeof info === 'object' ? Object.keys(info).sort() : [],
    metadataFields: Object.keys(metadata).sort()
  };
}

module.exports = { extractStoredObjectMetadata, normalizeStorageMimeType, normalizeStorageByteSize, IMAGE_LIMIT, PDF_LIMIT, IMAGE_MIMES, expectedForRole, validateDescriptor, makeCapability, verifyCapability, safeObjectPath, validatePendingPath, inspectMagicBytes, normalizeOrigin, vercelHost, approvedOrigins, isApprovedOrigin, signPayload, readSignedPayload, verifyProofOfWork };

