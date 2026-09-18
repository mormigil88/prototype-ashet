#!/usr/bin/env node
/**
 * design-analyzer.js
 * Secure pipeline: local OCR preflight → hard stop on sensitive →
 *   save raw-reference.png → Vision API → design-spec.json
 *
 * Usage:
 *   node design-analyzer.js --image <path> [--output-dir <dir>] [--fidelity adapt|close]
 *
 * Output (only on CLEAN input):
 *   <output-dir>/raw-reference.png   — unmodified source bitmap
 *   <output-dir>/manifest.json      — source hash, dimensions, timestamp
 *   <output-dir>/design-spec.json   — component spec
 *   <output-dir>/vision-raw.json   — raw model response
 *   <output-dir>/vision-report.json — cost + stats
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const getArg = (name, defaultVal) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : defaultVal;
};

const outputDir  = getArg('output-dir', '/tmp/carousel-mvp');
const imagePath = getArg('image', process.env.DESIGN_ANALYZER_IMAGE);
const fidelity  = getArg('fidelity', 'adapt');

if (!imagePath) {
  console.error('Usage: node design-analyzer.js --image <path> [--output-dir <dir>] [--fidelity adapt|close]');
  console.error('   or: DESIGN_ANALYZER_IMAGE=/path/to/img node design-analyzer.js');
  process.exit(1);
}

// ── Resolve image path ──────────────────────────────────────────────────────
let resolvedPath = imagePath;

// Unicode path — copy to /tmp to avoid macOS Node unicode issues
const isAscii = imagePath.split('').every(c => c.charCodeAt(0) < 128);
if (!isAscii) {
  const tmpPath = `/tmp/carousel_ref_${Date.now()}.png`;
  execSync(`cp "${imagePath}" "${tmpPath}"`);
  console.error(`[design-analyzer] Copied unicode path to: ${tmpPath}`);
  resolvedPath = tmpPath;
}

if (!fs.existsSync(resolvedPath)) {
  console.error(`Image not found: ${resolvedPath}`);
  process.exit(1);
}

// ── Create output dir ──────────────────────────────────────────────────────
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// ── STEP 1: Local preflight (OCR) — hard stop on sensitive ────────────────
console.error('[design-analyzer] Running local preflight...');
const APP_DIR = process.env.APP_DIR || __dirname;
const pyPreflight = path.join(APP_DIR, 'preflight.py');
let preflightBlocked = false;
let preflightReason = 'unknown';

try {
  const pfOut = execSync(`python3 "${pyPreflight}" "${resolvedPath}" 2>&1`, { encoding: 'utf8' });
  console.error('[design-analyzer] Preflight: ' + (pfOut.includes('CLEAN') ? 'CLEAN' : pfOut.trim()));
} catch (e) {
  const code  = e.status;
  const pfErr = (e.stderr || '').trim() || (e.stdout || '').trim();
  if (code === 2) {
    preflightBlocked = true;
    const reasonMatch = pfErr.match(/reason:\s*(.+)/);
    preflightReason = reasonMatch ? reasonMatch[1] : 'sensitive_document';
    console.error(`[design-analyzer] BLOCKED: ${pfErr.replace(/\n/g, ' ')}`);
    console.error('[design-analyzer] Exiting — no output, no Vision call, no source saved.');
    process.exit(2);
  }
}

// ── STEP 2: Save raw reference — only on CLEAN input ─────────────────────
const rawRefPath = path.join(outputDir, 'raw-reference.png');
const srcHash = crypto.createHash('sha256').update(fs.readFileSync(resolvedPath)).digest('hex');

// Get image dimensions without loading full image (fast)
let srcWidth = 0, srcHeight = 0;
try {
  const dimOut = execSync(
    `python3 -c "from PIL import Image; img = Image.open('${resolvedPath.replace(/'/g, "\\'")}'); print(img.width, img.height)"`,
    { cwd: process.env.APP_DIR || __dirname, timeout: 10000 }
  ).toString().trim().split(' ');
  srcWidth = parseInt(dimOut[0]);
  srcHeight = parseInt(dimOut[1]);
} catch {
  // PIL may not be available in the venv — skip dimensions
}

fs.writeFileSync(rawRefPath, fs.readFileSync(resolvedPath));
fs.chmodSync(rawRefPath, 0o600);  // readable only by owner

const manifest = {
  sourceFile: path.basename(resolvedPath),
  sourceHash: srcHash,
  sourceWidth: srcWidth || null,
  sourceHeight: srcHeight || null,
  savedAt: new Date().toISOString(),
  outputDir,
  fidelity,
  preflight: 'CLEAN',
};
const manifestPath = path.join(outputDir, 'manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
fs.chmodSync(manifestPath, 0o600);

console.error(`[design-analyzer] Raw reference saved: ${rawRefPath}`);
console.error(`[design-analyzer] Source SHA256: ${srcHash.substring(0, 16)}...`);
console.error(`[design-analyzer] Source dimensions: ${srcWidth}×${srcHeight}`);

// ── STEP 3: Vision API analysis ────────────────────────────────────────────
async function run() {
  console.error(`[design-analyzer] Analyzing: ${resolvedPath}`);
  console.error(`[design-analyzer] Fidelity: ${fidelity}`);

  const VP = require('./vision-provider');
  let provider;
  try {
    provider = new VP.MiniMaxVisionProvider();
  } catch (e) {
    console.error(`[design-analyzer] MiniMax unavailable: ${e.message}`);
    try { provider = new VP.OpenRouterVisionProvider(); }
    catch (e2) { throw new Error('No vision provider: ' + e2.message); }
  }

  console.error(`[design-analyzer] Provider: ${provider.constructor.name} | Model: ${provider.model}`);

  const { spec, rawResponse, costUsd, usage } = await provider.analyze(resolvedPath, {
    fidelity,
    targetCanvas: { width: 1080, height: 1350 }
  });

  // Save raw response
  const rawPath = path.join(outputDir, 'vision-raw.json');
  fs.writeFileSync(rawPath, JSON.stringify({ rawResponse, usage }, null, 2));
  console.error(`[design-analyzer] Raw response: ${rawPath}`);

  // Validate
  const { validateSpec } = require('./vision-provider');
  try {
    validateSpec(spec);
    console.error('[design-analyzer] ✓ Spec validation passed');
  } catch (e) {
    const specPath = path.join(outputDir, 'design-spec.json');
    fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
    throw e;
  }

  // Save spec
  const specPath = path.join(outputDir, 'design-spec.json');
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
  console.error(`[design-analyzer] ✓ Spec: ${specPath}`);

  // Save report
  const report = {
    analyzedAt: spec.analyzedAt,
    modelUsed: spec.modelUsed,
    fidelity,
    sourceHash: srcHash,
    sourceDimensions: { width: srcWidth, height: srcHeight },
    costUsd: spec.visionCostUsd,
    usage,
    confidence: spec.confidence,
    paletteConfidence: spec.palette?.confidence,
    typographyConfidence: spec.typography?.confidence,
    layoutConfidence: spec.layout?.confidence,
    componentsCount: spec.components?.length,
  };
  const reportPath = path.join(outputDir, 'vision-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.error(`[design-analyzer] ✓ Report: ${reportPath}`);
  console.error(`[design-analyzer] Cost: $${costUsd.toFixed(6)} | Usage:`, JSON.stringify(usage));

  console.log(specPath);  // stdout for parsing
}

run().catch(e => {
  console.error(`[design-analyzer] FATAL: ${e.message}`);
  process.exit(1);
});
