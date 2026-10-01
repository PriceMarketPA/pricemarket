'use strict';

const crypto = require('node:crypto');
const {
  validateDescriptor, makeCapability, verifyCapability, safeObjectPath,
  validatePendingPath, inspectMagicBytes
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

function storageUrlFor(base, bucket, path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${base}/object/${encodeURIComponent(bucket)}/${encoded}`;
}

function createHandler({ env = process.env, fetchImpl = global.fetch, now = Date.now, uuid = crypto.randomUUID } = {}) {
  return async function businessAssets(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST for upload actions.' });
    const origin = req.headers?.origin;
    const requestHost = req.headers?.['x-forwarded-host'] || req.headers?.host;
    if (origin && requestHost) {
      try { if (new URL(origin).host !== String(requestHost).split(',')[0].trim()) return json(res, 403, { error: 'Upload requests must come from the Price Market site.' }); }
      catch { return json(res, 403, { error: 'Invalid request origin.' }); }
    }

    const supabaseUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) return json(res, 503, { error: 'Secure uploads are not configured yet.' });
    let parsedUrl;
    try { parsedUrl = new URL(supabaseUrl); } catch { return json(res, 503, { error: 'Secure uploads are not configured correctly.' }); }
    if (parsedUrl.protocol !== 'https:') return json(res, 503, { error: 'Storage must use HTTPS.' });
    const storageBase = `${supabaseUrl}/storage/v1`;
    const secret = serviceKey;
    const adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    const request = async (path, options = {}) => fetchImpl(`${storageBase}${path}`, { ...options, headers: { ...adminHeaders, ...options.headers } });

    try {
      const body = parseBody(req);
      if (body.action === 'initialize') {
        const submissionId = uuid();
        return json(res, 200, { submissionId, capability: makeCapability(submissionId, secret, now() + 12 * 60 * 60 * 1000) });
      }
      if (!verifyCapability(body.capability, body.submissionId, secret, now())) return json(res, 401, { error: 'This pending upload session has expired. Please choose the file again.' });

      if (body.action === 'sign') {
        const spec = validateDescriptor(body);
        const objectPath = safeObjectPath(body.submissionId, body.role, spec.extension, uuid());
        const signedResponse = await request(`/object/upload/sign/${encodeURIComponent(spec.bucket)}/${objectPath.split('/').map(encodeURIComponent).join('/')}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upsert: false })
        });
        const signedData = await signedResponse.json().catch(() => ({}));
        if (!signedResponse.ok) return json(res, 502, { error: 'Could not prepare the secure upload. Please retry.' });
        let uploadUrl = signedData.signedUrl || signedData.signedURL || signedData.url;
        if (uploadUrl && !/^https:\/\//i.test(uploadUrl)) uploadUrl = `${storageBase}${uploadUrl.startsWith('/') ? '' : '/'}${uploadUrl}`;
        if (!uploadUrl && signedData.token) uploadUrl = `${storageBase}/object/upload/sign/${encodeURIComponent(spec.bucket)}/${objectPath.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(signedData.token)}`;
        if (!uploadUrl || !uploadUrl.startsWith(`${supabaseUrl}/storage/v1/`)) return json(res, 502, { error: 'Storage returned an invalid upload URL.' });
        return json(res, 200, { uploadUrl, path: objectPath, bucket: spec.bucket, role: body.role });
      }

      if (body.action === 'finalize') {
        const spec = validateDescriptor(body);
        if (!validatePendingPath(body.path, body.submissionId, body.role, body.bucket) || body.bucket !== spec.bucket) return json(res, 400, { error: 'Invalid pending file path.' });
        const infoResponse = await request(`/object/info/${encodeURIComponent(body.bucket)}/${body.path.split('/').map(encodeURIComponent).join('/')}`);
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
        return json(res, 200, { path: body.path, bucket: body.bucket, publicUrl, size: storedSize, contentType: storedType });
      }

      if (body.action === 'remove') {
        if (!validatePendingPath(body.path, body.submissionId, body.role, body.bucket)) return json(res, 400, { error: 'Invalid pending file path.' });
        const removeResponse = await request(`/object/${encodeURIComponent(body.bucket)}`, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [body.path] })
        });
        if (!removeResponse.ok) return json(res, 502, { error: 'Could not remove the pending upload. Please try again.' });
        return json(res, 200, { removed: true });
      }
      return json(res, 400, { error: 'Unknown upload action.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const status = /not allowed|between 1 byte|unsupported upload|invalid file extension/i.test(message) ? 400 : 500;
      return json(res, status, { error: status === 400 ? message : 'Upload could not be completed. Please try again.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.storageUrlFor = storageUrlFor;
