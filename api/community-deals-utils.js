'use strict';

const crypto = require('node:crypto');
const CITIES = Object.freeze(['Mechanicsburg', 'Camp Hill', 'Carlisle', 'Harrisburg', 'Hershey']);
const TEXT_LIMITS = Object.freeze({ storeName: 100, itemTitle: 120, description: 500 });

function sanitizePlainText(value, field, maxLength = TEXT_LIMITS[field]) {
  if (typeof value !== 'string') throw new Error('Enter a valid ' + field + '.');
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || text.length > maxLength) throw new Error('Enter a ' + field + ' under ' + maxLength + ' characters.');
  if (/<\s*\/?\s*[a-z!][^>]*>/i.test(text)) throw new Error('HTML is not allowed. Enter plain text.');
  return text;
}

function parsePrice(value, { required = false, field = 'Price', allowZero = true } = {}) {
  if (value == null || value === '') {
    if (required) throw new Error(field + ' is required.');
    return null;
  }
  const input = typeof value === 'number' ? String(value) : String(value).trim();
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(input)) throw new Error('Enter a valid ' + field.toLowerCase() + ' with up to two decimal places.');
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0)) throw new Error('Enter a valid ' + field.toLowerCase() + '.');
  return parsed.toFixed(2);
}

function normalizeForFingerprint(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function makeFingerprint({ storeName, itemTitle, city }) {
  return crypto.createHash('sha256').update([city, storeName, itemTitle].map(normalizeForFingerprint).join('|')).digest('hex');
}
function hashClientIp(ip, secret) {
  if (typeof ip !== 'string' || !ip.trim()) throw new Error('Could not verify the request context.');
  return crypto.createHmac('sha256', secret).update('community-deal-ip:' + ip.trim()).digest('hex');
}
function publicObjectUrl(supabaseUrl, bucket, objectPath) {
  return String(supabaseUrl).replace(/\/$/, '') + '/storage/v1/object/public/' + encodeURIComponent(bucket) + '/' + objectPath.split('/').map(encodeURIComponent).join('/');
}
function formatAge(value, now = Date.now()) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'Recently spotted';
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return 'Spotted just now';
  if (minutes < 60) return 'Spotted ' + minutes + (minutes === 1 ? ' minute' : ' minutes') + ' ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return 'Spotted ' + hours + (hours === 1 ? ' hour' : ' hours') + ' ago';
  const days = Math.floor(hours / 24);
  return 'Spotted ' + days + (days === 1 ? ' day' : ' days') + ' ago';
}
module.exports = { CITIES, TEXT_LIMITS, formatAge, hashClientIp, makeFingerprint, normalizeForFingerprint, parsePrice, publicObjectUrl, sanitizePlainText };
