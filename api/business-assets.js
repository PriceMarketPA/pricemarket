'use strict';

const crypto = require('node:crypto');
const {
  validateDescriptor, makeCapability, verifyCapability, safeObjectPath,
  validatePendingPath, inspectMagicBytes, isApprovedOrigin,
  signPayload, readSignedPayload, verifyProofOfWork
} = require('./business-assets-utils');

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

function createHandler({ env = process.env, fetchImpl = global.fetch, now = Date.now, uuid = crypto.randomUUID } = {}) {
  return async function businessAssets(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST for upload actions.' });
    const origin = req.headers?.origin;
    if (!isApprovedOrigin(origin, env)) return json(res, 403, { error: 'This upload request origin is not allowed.' });
    const requestHost = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim().toLowerCase();
    if (!requestHost || requestHost !== new URL(origin).host.toLowerCase()) return json(res, 403, { error: 'The upload request host does not match its approved origin.' });

    const supabaseUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) return json(res, 503, { error: 'Secure uploads are not configured yet.' });
    let parsedUrl;
    try { parsedUrl = new URL(supabaseUrl); } catch { return json(res, 503, { error: 'Secure uploads are not configured correctly.' }); }
    if (parsedUrl.protocol !== 'https:') return json(res, 503, { error: 'Storage must use HTTPS.' });
    const storageBase = `${supabaseUrl}/storage/v1`;
    const secret = serviceKey;
    // Supabase's current sb_secret keys are API keys, not JWTs; legacy service_role keys also need Bearer auth.
    const adminHeaders = { apikey: serviceKey };
    if (!serviceKey.startsWith('sb_secret_')) adminHeaders.Authorization = `Bearer ${serviceKey}`;
    const storageRequest = (path, options = {}) => fetchImpl(`${storageBase}${path}`, { ...options, headers: { ...adminHeaders, ...options.headers } });
    const databaseRequest = (path, options = {}) => fetchImpl(`${supabaseUrl}/rest/v1${path}`, { ...options, headers: { ...adminHeaders, ...options.headers } });
    const rpc = async (name, args) => {
      const response = await databaseRequest(`/rpc/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = typeof data?.message === 'string' ? data.message : '';
        const error = new Error(detail || 'Upload quota could not be reserved.');
        error.status = /rate limit/i.test(detail) ? 429 : /limit|already in use|already been used|duplicate key|replacement|expired|reservation/i.test(detail) ? 409 : 502;
        throw error;
      }
      return data;
    };
    const storageObjectInfo = path => storageRequest(`/object/info/${encodeURIComponent(path.bucket)}/${path.path.split('/').map(encodeURIComponent).join('/')}`);
    const isConfirmedMissingObject = async (bucket, objectPath) => {
      // A DELETE error is only retry-safe when a separate Storage info request confirms absence.
      try {
        const response = await storageObjectInfo({ bucket, path: objectPath });
        if (response.status !== 404 && response.status !== 400) return false;
        const detail = await response.json().catch(() => null);
        const message = String(detail?.message || detail?.error || '').toLowerCase();
        const code = String(detail?.statusCode || detail?.code || '').toLowerCase();
        return /object (was )?not found|object not found|no such key/.test(message) || code === 'objectnotfound' || code === 'nosuchkey';
      } catch { return false; }
    };
    const checkSession = async (submissionId, capability) => {
      if (!verifyCapability(capability, submissionId, secret, now())) return false;
      const query = new URLSearchParams({ submission_id: `eq.${submissionId}`, expires_at: `gt.${new Date(now()).toISOString()}`, select: 'submission_id' });
      const response = await databaseRequest(`/pm_business_upload_sessions?${query.toString()}`);
      if (!response.ok) return false;
      const rows = await response.json().catch(() => []);
      return Array.isArray(rows) && rows.length === 1;
    };

    try {
      const body = parseBody(req);
      if (body.action === 'challenge') {
        const challengeId = uuid();
        const nonce = crypto.randomBytes(24).toString('base64url');
        const expiresAt = now() + 5 * 60 * 1000;
        const difficultyBits = 16;
        const challengeToken = signPayload({ kind: 'business-upload-pow', challengeId, nonce, difficultyBits, expiresAt }, secret);
        return json(res, 200, { challengeId, nonce, difficultyBits, expiresAt, challengeToken });
      }

      if (body.action === 'initialize') {
        const challenge = readSignedPayload(body.challengeToken, secret, now());
        if (!challenge || challenge.kind !== 'business-upload-pow' || challenge.challengeId !== body.challengeId || !verifyProofOfWork(challenge.nonce, body.proof, challenge.difficultyBits)) {
          return json(res, 403, { error: 'Upload verification failed. Please try again.' });
        }
        const submissionId = uuid();
        const expiresAt = new Date(now() + 12 * 60 * 60 * 1000).toISOString();
        const forwardedIp = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
        const clientIp = forwardedIp || req.socket?.remoteAddress || '';
        if (!clientIp) return json(res, 400, { error: 'Could not verify the upload request context.' });
        const ipHash = crypto.createHmac('sha256', secret).update(`business-upload-ip:${clientIp}`).digest('hex');
        await rpc('pm_create_business_upload_session', {
          p_submission_id: submissionId,
          p_challenge_id: challenge.challengeId,
          p_expires_at: expiresAt,
          p_ip_hash: ipHash
        });
        return json(res, 200, { submissionId, capability: makeCapability(submissionId, secret, now() + 12 * 60 * 60 * 1000) });
      }

      if (!await checkSession(body.submissionId, body.capability)) return json(res, 401, { error: 'This pending upload session has expired. Please start the upload again.' });

      if (body.action === 'sign') {
        const spec = validateDescriptor(body);
        const objectPath = safeObjectPath(body.submissionId, body.role, spec.extension, uuid());
        await rpc('pm_reserve_business_upload_slot', {
          p_submission_id: body.submissionId,
          p_role: body.role,
          p_object_path: objectPath,
          p_replace_path: body.replacePath || null
        });
        const releaseReservation = () => rpc('pm_remove_business_upload_slot_file', { p_submission_id: body.submissionId, p_role: body.role, p_object_path: objectPath }).catch(() => false);
        let signedResponse;
        try {
          signedResponse = await storageRequest(`/object/upload/sign/${encodeURIComponent(spec.bucket)}/${objectPath.split('/').map(encodeURIComponent).join('/')}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upsert: false })
          });
        } catch {
          await releaseReservation();
          return json(res, 502, { error: 'Could not prepare the secure upload. Please retry.' });
        }
        const signedData = await signedResponse.json().catch(() => ({}));
        if (!signedResponse.ok) {
          await releaseReservation();
          return json(res, 502, { error: 'Could not prepare the secure upload. Please retry.' });
        }
        let uploadUrl = signedData.signedUrl || signedData.signedURL || signedData.url;
        if (uploadUrl && !/^https:\/\//i.test(uploadUrl)) {
          if (uploadUrl.startsWith('/storage/v1/')) uploadUrl = `${supabaseUrl}${uploadUrl}`;
          else uploadUrl = `${storageBase}${uploadUrl.startsWith('/') ? '' : '/'}${uploadUrl}`;
        }
        if (!uploadUrl || !uploadUrl.startsWith(`${supabaseUrl}/storage/v1/`)) {
          await releaseReservation();
          return json(res, 502, { error: 'Storage returned an invalid upload URL.' });
        }
        return json(res, 200, { uploadUrl, path: objectPath, bucket: spec.bucket, role: body.role });
      }

      if (body.action === 'finalize') {
        const spec = validateDescriptor(body);
        if (!validatePendingPath(body.path, body.submissionId, body.role, body.bucket) || body.bucket !== spec.bucket) return json(res, 400, { error: 'Invalid pending file path.' });
        const infoResponse = await storageRequest(`/object/info/${encodeURIComponent(body.bucket)}/${body.path.split('/').map(encodeURIComponent).join('/')}`);
        if (!infoResponse.ok) return json(res, 400, { error: 'The uploaded file could not be verified.' });
        const info = await infoResponse.json();
        const metadata = info.metadata || info;
        const storedSize = Number(metadata.size ?? metadata.contentLength ?? info.size);
        const storedType = metadata.mimetype || metadata.contentType || info.mimetype || info.contentType;
        if (storedSize !== spec.size || storedType !== spec.contentType) return json(res, 400, { error: 'The stored file did not match the selected file. Please upload it again.' });
        const publicUrl = `${storageBase}/object/public/${encodeURIComponent(body.bucket)}/${body.path.split('/').map(encodeURIComponent).join('/')}`;
        const fileResponse = await fetchImpl(publicUrl, { headers: { Range: 'bytes=0-63' } });
        if (!fileResponse.ok) return json(res, 400, { error: 'Could not inspect the uploaded file.' });
        const bytes = Buffer.from(await fileResponse.arrayBuffer()).subarray(0, 64);
        if (!inspectMagicBytes(bytes, spec.contentType)) return json(res, 400, { error: 'The file contents do not match the selected file type.' });
        const replacedPath = await rpc('pm_finalize_business_upload_slot', { p_submission_id: body.submissionId, p_role: body.role, p_object_path: body.path });
        return json(res, 200, { path: body.path, bucket: body.bucket, publicUrl, size: storedSize, contentType: storedType, replacedPath: replacedPath || '' });
      }

      if (body.action === 'remove') {
        if (!validatePendingPath(body.path, body.submissionId, body.role, body.bucket)) return json(res, 400, { error: 'Invalid pending file path.' });
        const ledgerArgs = { p_submission_id: body.submissionId, p_role: body.role, p_object_path: body.path };
        const tracked = await rpc('pm_validate_business_upload_slot_file', ledgerArgs);
        if (tracked !== true) {
          // A completed request whose response was lost is idempotent once Storage confirms absence.
          if (await isConfirmedMissingObject(body.bucket, body.path)) return json(res, 200, { removed: true, alreadyRemoved: true });
          return json(res, 404, { error: 'This file is not part of the pending upload session.' });
        }
        const removeResponse = await storageRequest(`/object/${encodeURIComponent(body.bucket)}`, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [body.path] })
        });
        if (!removeResponse.ok && !(await isConfirmedMissingObject(body.bucket, body.path))) return json(res, 502, { error: 'Could not remove the pending upload. Please try again.' });
        const result = await rpc('pm_commit_business_upload_slot_file_removal', ledgerArgs);
        if (!result || result.removed !== true) return json(res, 502, { error: 'The file was deleted, but its upload state could not be updated. Please retry removal.' });
        return json(res, 200, { removed: true, restoredPath: result.restoredPath || '' });
      }
      return json(res, 400, { error: 'Unknown upload action.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const status = error.status || (/not allowed|between 1 byte|unsupported upload|invalid file extension/i.test(message) ? 400 : 500);
      return json(res, status, { error: status === 409 || status === 429 ? (message || 'The upload quota for this slot has been reached.') : status === 400 ? message : 'Upload could not be completed. Please try again.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;

