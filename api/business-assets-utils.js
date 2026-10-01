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

module.exports = { IMAGE_LIMIT, PDF_LIMIT, IMAGE_MIMES, expectedForRole, validateDescriptor, makeCapability, verifyCapability, safeObjectPath, validatePendingPath, inspectMagicBytes };
