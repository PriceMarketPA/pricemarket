'use strict';

const crypto = require('node:crypto');
const {
  verifyCapability, validatePendingPath, isApprovedOrigin, signPayload, readSignedPayload, verifyProofOfWork
} = require('./business-assets-utils');
const { CITIES, hashClientIp, makeFingerprint, parsePrice, publicObjectUrl, sanitizePlainText } = require('./community-deals-utils');

const json = (res, status, data) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
};
function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return {};
}
function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || '';
}
function validUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function createHandler({ env = process.env, fetchImpl = global.fetch, now = Date.now, uuid = crypto.randomUUID } = {}) {
  return async function communityDeals(req, res) {
    const supabaseUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) return json(res, 503, { error: 'Community deals are not configured yet.' });
    let parsedUrl;
    try { parsedUrl = new URL(supabaseUrl); } catch { return json(res, 503, { error: 'Community deals are not configured correctly.' }); }
    if (parsedUrl.protocol !== 'https:') return json(res, 503, { error: 'Community data must use HTTPS.' });
    const secret = serviceKey;
    const adminHeaders = { apikey: serviceKey };
    if (!serviceKey.startsWith('sb_secret_')) adminHeaders.Authorization = 'Bearer ' + serviceKey;
    const databaseRequest = (path, options = {}) => fetchImpl(supabaseUrl + '/rest/v1' + path, { ...options, headers: { ...adminHeaders, ...options.headers } });
    const rpc = async (name, args) => {
      const response = await databaseRequest('/rpc/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = String(data?.message || '');
        const error = new Error(detail);
        error.status = /rate limit/i.test(detail) ? 429 : /challenge already used/i.test(detail) ? 403 : /duplicate|no longer active/i.test(detail) ? 409 : 502;
        throw error;
      }
      return data;
    };
    const isTrustedRequest = () => {
      const origin = req.headers?.origin;
      if (!isApprovedOrigin(origin, env)) return false;
      const requestHost = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim().toLowerCase();
      return Boolean(requestHost && requestHost === new URL(origin).host.toLowerCase());
    };
    try {
      if (req.method === 'GET') {
        const city = String(req.query?.city || '');
        if (city && !CITIES.includes(city)) return json(res, 400, { error: 'Choose a launch city.' });
        await rpc('pm_expire_community_deals', {});
        const params = new URLSearchParams({
          select: 'id,store_name,item_title,description,city,normal_price,sale_price,photo_path,spotted_at,status,confirmation_count,expires_at',
          status: 'eq.active',
          expires_at: 'gt.' + new Date(now()).toISOString(),
          order: 'spotted_at.desc',
          limit: '100'
        });
        if (city) params.set('city', 'eq.' + city);
        const response = await databaseRequest('/pm_community_deal_reports?' + params.toString());
        if (!response.ok) return json(res, 502, { error: 'Could not load local deals right now.' });
        const rows = await response.json().catch(() => []);
        const deals = (Array.isArray(rows) ? rows : []).map(row => ({
          id: row.id, storeName: row.store_name, itemTitle: row.item_title, description: row.description, city: row.city,
          normalPrice: row.normal_price, salePrice: row.sale_price,
          photoUrl: row.photo_path ? publicObjectUrl(supabaseUrl, 'business-images', row.photo_path) : '',
          spottedAt: row.spotted_at, status: row.status, confirmationCount: row.confirmation_count || 0,
          expiresAt: row.expires_at, communityReported: true
        }));
        return json(res, 200, { deals });
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'Use GET or POST for community deal actions.' });
      if (!isTrustedRequest()) return json(res, 403, { error: 'This request origin is not allowed.' });
      const body = parseBody(req);
      if (body.action === 'challenge') {
        const challengeId = uuid();
        const nonce = crypto.randomBytes(24).toString('base64url');
        const expiresAt = now() + 5 * 60 * 1000;
        const difficultyBits = 16;
        const challengeToken = signPayload({ kind: 'community-deal-pow', challengeId, nonce, difficultyBits, expiresAt }, secret);
        return json(res, 200, { challengeId, nonce, difficultyBits, expiresAt, challengeToken });
      }
      const ipHash = hashClientIp(clientIp(req), secret);
      if (body.action === 'submit') {
        const challenge = readSignedPayload(body.challengeToken, secret, now());
        if (!challenge || challenge.kind !== 'community-deal-pow' || challenge.challengeId !== body.challengeId ||
            !verifyProofOfWork(challenge.nonce, body.proof, challenge.difficultyBits)) {
          return json(res, 403, { error: 'Submission verification failed. Please try again.' });
        }
        const storeName = sanitizePlainText(body.storeName, 'storeName');
        const itemTitle = sanitizePlainText(body.itemTitle, 'itemTitle');
        const description = sanitizePlainText(body.description, 'description');
        const city = String(body.city || '');
        if (!CITIES.includes(city)) return json(res, 400, { error: 'Choose a Central PA launch city.' });
        const normalPrice = parsePrice(body.normalPrice, { field: 'Normal price', allowZero: false });
        const salePrice = parsePrice(body.salePrice, { field: 'Sale price', required: true });
        if (normalPrice != null && Number(salePrice) > Number(normalPrice)) return json(res, 400, { error: 'Sale price cannot be higher than normal price.' });
        let photoPath = null;
        if (body.photoPath) {
          const uploadId = String(body.photoSubmissionId || '');
          if (!validUuid(uploadId) || !verifyCapability(body.photoCapability, uploadId, secret, now()) ||
              !validatePendingPath(body.photoPath, uploadId, 'gallery-1', 'business-images')) {
            return json(res, 400, { error: 'The optional photo upload could not be verified. Please upload it again.' });
          }
          const sessionParams = new URLSearchParams({ submission_id: 'eq.' + uploadId, expires_at: 'gt.' + new Date(now()).toISOString(), select: 'submission_id' });
          const sessionResponse = await databaseRequest('/pm_business_upload_sessions?' + sessionParams.toString());
          const sessionRows = await sessionResponse.json().catch(() => []);
          if (!sessionResponse.ok || !Array.isArray(sessionRows) || sessionRows.length !== 1) return json(res, 400, { error: 'The optional photo upload session has expired.' });
          const slotParams = new URLSearchParams({ submission_id: 'eq.' + uploadId, role: 'eq.gallery-1', status: 'eq.uploaded', active_path: 'eq.' + body.photoPath, select: 'active_path' });
          const slotResponse = await databaseRequest('/pm_business_upload_slots?' + slotParams.toString());
          const slotRows = await slotResponse.json().catch(() => []);
          if (!slotResponse.ok || !Array.isArray(slotRows) || slotRows.length !== 1) return json(res, 400, { error: 'The optional photo upload is not ready yet.' });
          photoPath = body.photoPath;
        }
        const fingerprint = makeFingerprint({ storeName, itemTitle, city });
        const created = await rpc('pm_submit_community_deal', {
          p_store_name: storeName, p_item_title: itemTitle, p_description: description, p_city: city,
          p_normal_price: normalPrice, p_sale_price: salePrice, p_photo_path: photoPath, p_fingerprint: fingerprint,
          p_ip_hash: ipHash, p_challenge_id: challenge.challengeId
        });
        if (created?.duplicate) return json(res, 409, { error: 'A similar deal was recently reported. Check the live feed before submitting another.' });
        return json(res, 201, { id: created.id, status: 'under_review', message: 'Thanks. Your community report is under review before it can appear in the live feed.' });
      }
      if (body.action === 'vote') {
        if (!validUuid(body.dealId)) return json(res, 400, { error: 'Choose a valid deal.' });
        const voteType = String(body.voteType || '');
        if (!['still_available', 'expired', 'wrong_info'].includes(voteType)) return json(res, 400, { error: 'Choose a valid community status action.' });
        const result = await rpc('pm_vote_community_deal', { p_deal_id: body.dealId, p_vote_type: voteType, p_voter_hash: ipHash });
        return json(res, 200, result);
      }
      return json(res, 400, { error: 'Unknown community deal action.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const status = error.status || (/valid|enter|choose|html|plain text|sale price|invalid json/i.test(message) ? 400 : 500);
      return json(res, status, { error: status === 429 ? 'You have reached the community deal request limit. Please try again later.' : status === 409 ? (message || 'This deal is no longer active.') : status === 400 ? message : 'Community deal request could not be completed. Please try again.' });
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
