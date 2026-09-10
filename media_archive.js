/**
 * media_archive.js — Permanent video archival to Cloudflare R2.
 *
 * API:
 *   archive(filePath, metadata) →
 *     success: { ok: true, status: 'done', cached, object_key, permanent_url, sha256, warnings: [] }
 *     failure: { ok: false, status: 'failed', reason, object_key }
 *   verify(objectKey) → { reachable: true, size } | { reachable: false, reason }
 *
 * Object key format:
 *   clients/<client_slug>/<provider>/<YYYY-MM>/<provider_job_id>.mp4
 *   Falls back to SHA-256 of file content when provider_job_id is absent.
 *
 * Deduplication: HeadObject is called before PutObject.
 * If stored sha256 matches the local file, returns cached:true without re-uploading.
 *
 * No public access, no presigned URLs, no secret logging.
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// Injected at module level so tests can intercept @aws-sdk/client-s3.
let _s3ClientFactory = () => require('@aws-sdk/client-s3');

function setS3ClientFactory(fn) {
  _s3ClientFactory = fn;
  _client = null;
}

let _client;
function getClient() {
  if (!_client) {
    const { S3Client } = _s3ClientFactory();
    _client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

/**
 * Compute SHA-256 of a file synchronously.
 * @param {string} filePath
 * @returns {string} hex digest
 */
function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

/**
 * Build a deterministic R2 object key.
 * Format: clients/<client_slug>/<provider>/<YYYY-MM>/<id>.mp4
 * id = provider_job_id if provided, else SHA-256 of file.
 */
function buildObjectKey(filePath, { clientSlug, provider, providerJobId, sha256 }) {
  const id = providerJobId || sha256;
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const safeId = id.replace(/[^A-Za-z0-9._-]/g, '_');
  return `clients/${clientSlug || '_unknown'}/${provider || '_unknown'}/${month}/${safeId}.mp4`;
}

/**
 * Upload (or skip) a local file to R2, with deduplication.
 *
 * @param {string} filePath  - Absolute path to the local file.
 * @param {object} metadata  - { clientSlug, provider, providerJobId, contentType?, ...custom }
 * @returns {{ ok, status, cached?, object_key?, permanent_url?, sha256?, warnings?, reason? }}
 */
async function archive(filePath, metadata = {}) {
  const bucket = process.env.R2_BUCKET;
  const endpoint = process.env.R2_ENDPOINT;

  if (!endpoint || !bucket) {
    return { ok: false, status: 'failed', reason: 'R2_BUCKET and R2_ENDPOINT must be set', object_key: null };
  }

  if (!metadata.provider || !metadata.clientSlug) {
    return { ok: false, status: 'failed', reason: 'MISSING_REQUIRED_METADATA', object_key: null };
  }

  let fileBuffer;
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, status: 'failed', reason: `File not found: ${filePath}`, object_key: null };
    }
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return { ok: false, status: 'failed', reason: 'File is empty', object_key: null };
    }
    fileBuffer = fs.readFileSync(filePath);
  } catch (err) {
    return { ok: false, status: 'failed', reason: `Cannot read file: ${err.message}`, object_key: null };
  }

  const sha256 = sha256File(filePath);
  const objectKey = buildObjectKey(filePath, { ...metadata, sha256 });
  const permanentUrl = `r2://${bucket}/${objectKey}`;

  const { HeadObjectCommand, PutObjectCommand } = _s3ClientFactory();
  const client = getClient();

  // --- Metadata size guard (before any S3 call) ---
  let warnings = [];
  const r2Metadata = {
    provider: metadata.provider || '',
    client_slug: metadata.clientSlug || '',
    media_type: metadata.contentType || 'video/mp4',
    sha256,
    archived_at: new Date().toISOString(),
  };
  if (metadata.providerJobId) r2Metadata.provider_job_id = metadata.providerJobId;
  if (metadata.sourceUrl) r2Metadata.source_url = metadata.sourceUrl;
  if (metadata.script) {
    r2Metadata.script_sha256 = crypto.createHash('sha256').update(metadata.script, 'utf8').digest('hex');
    r2Metadata.script_length = String(metadata.script.length);
  }
  if (metadata.aspectRatio) r2Metadata.aspect_ratio = metadata.aspectRatio;

  const computeMetaSize = (m) =>
    Object.entries(m).reduce((acc, [k, v]) =>
      acc + Buffer.byteLength(k, 'utf8') + Buffer.byteLength(String(v), 'utf8'), 0);

  if (computeMetaSize(r2Metadata) > 1800 && r2Metadata.source_url) {
    delete r2Metadata.source_url;
    warnings.push('SOURCE_URL_OMITTED_METADATA_LIMIT');
  }
  if (computeMetaSize(r2Metadata) > 1800) {
    return { ok: false, status: 'failed', reason: 'R2_METADATA_TOO_LARGE', object_key: objectKey };
  }

  // --- Deduplication check ---
  try {
    const headCmd = new HeadObjectCommand({ Bucket: bucket, Key: objectKey });
    const headResult = await client.send(headCmd);
    const storedSha = headResult.Metadata ? headResult.Metadata['sha256'] : null;
    if (storedSha === sha256) {
      return {
        ok: true,
        status: 'done',
        cached: true,
        object_key: objectKey,
        permanent_url: permanentUrl,
        sha256,
        warnings: [],
      };
    }
    // sha mismatch — overwrite
  } catch (err) {
    const isNotFound =
      err.name === 'NoSuchKey' ||
      err.name === 'NotFound' ||
      err.$metadata?.httpStatusCode === 404;
    if (!isNotFound) {
      return { ok: false, status: 'failed', reason: `HeadObject failed: ${err.message}`, object_key: objectKey };
    }
    // Not found → proceed with upload
  }

  // --- Upload ---
  let putResult;
  try {

    const putCmd = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: fileBuffer,
      ContentType: metadata.contentType || 'video/mp4',
      Metadata: r2Metadata,
    });
    putResult = await client.send(putCmd);
  } catch (err) {
    return { ok: false, status: 'failed', reason: `PutObject failed: ${err.message}`, object_key: objectKey };
  }

  // --- Verify after upload ---
  try {
    const verifyCmd = new HeadObjectCommand({ Bucket: bucket, Key: objectKey });
    const verifyResult = await client.send(verifyCmd);
    if (!verifyResult.ContentLength || verifyResult.ContentLength === 0) {
      return { ok: false, status: 'failed', reason: 'Object size is 0 after upload', object_key: objectKey };
    }
  } catch (err) {
    return { ok: false, status: 'failed', reason: `Verify after upload failed: ${err.message}`, object_key: objectKey };
  }

  return {
    ok: true,
    status: 'done',
    cached: false,
    object_key: objectKey,
    permanent_url: permanentUrl,
    sha256,
    warnings,
  };
}

/**
 * Verify that an object exists in R2 and is non-empty.
 *
 * @param {string} objectKey - The R2 object key.
 * @returns {{ reachable: true, size: number }} | {{ reachable: false, reason: string }}
 */
async function verify(objectKey) {
  const bucket = process.env.R2_BUCKET;
  const endpoint = process.env.R2_ENDPOINT;

  if (!endpoint || !bucket) {
    return { reachable: false, reason: 'R2_BUCKET and R2_ENDPOINT must be set' };
  }

  const { HeadObjectCommand } = _s3ClientFactory();

  try {
    const command = new HeadObjectCommand({ Bucket: bucket, Key: objectKey });
    const result = await getClient().send(command);
    if (!result.ContentLength || result.ContentLength === 0) {
      return { reachable: false, reason: 'Object is empty (size 0)' };
    }
    return { reachable: true, size: result.ContentLength };
  } catch (err) {
    return { reachable: false, reason: err.message };
  }
}

module.exports = { archive, verify, setS3ClientFactory };
