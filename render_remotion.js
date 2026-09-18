#!/usr/bin/env node
/**
 * render_remotion.js
 *
 * CLI wrapper for Remotion video rendering via Node.js API.
 * Works without CLI — uses @remotion/renderer + ffmpeg already in container.
 *
 * Usage:
 *   node /app/render_remotion.js --spec <video-spec.json> --out <output.mp4>
 *   node /app/render_by_reference_remotion.js --composition <id> --props <json> --out <mp4>
 *
 * Exit codes:
 *   0 – success, MP4 written
 *   1 – usage / invalid args
 *   2 – composition not found
 *   3 – render failed
 *   4 – Chromium not available
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const APP_DIR = process.env.APP_DIR || '/app';

// ── Args ──────────────────────────────────────────────────────────────────────
const getArg = (n, def) => {
  const i = process.argv.indexOf('--' + n);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
};

const specPath = getArg('spec', null);
const outPath  = getArg('out',  null);
const compId   = getArg('composition', getArg('compositionId', null));
const propsArg = getArg('props', '{}');

// ── Spec parsing ──────────────────────────────────────────────────────────────
let spec = {};
if (specPath) {
  if (!fs.existsSync(specPath)) {
    console.error(`[render_remotion] Spec not found: ${specPath}`);
    process.exit(1);
  }
  spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  spec.outPath = outPath || spec.outPath || null;
} else {
  spec.compositionId = compId;
  spec.outPath = outPath;
  try { spec.props = JSON.parse(propsArg); } catch { spec.props = {}; }
}

if (!spec.compositionId) {
  console.error('[render_remotion] Usage: render_remotion.js --spec <spec.json> [--out <out.mp4>]');
  console.error('[render_remotion]    or: render_remotion.js --composition <id> --props <json> --out <mp4>');
  process.exit(1);
}

// ── FFmpeg check ──────────────────────────────────────────────────────────────
function checkFFmpeg() {
  try {
    const v = execSync('ffmpeg -version 2>&1 | head -1').toString().trim();
    console.error(`[render_remotion] ffmpeg: ${v.split('\n')[0]}`);
    return true;
  } catch {
    console.error('[render_remotion] ffmpeg not found');
    return false;
  }
}

// ── Chromium check ────────────────────────────────────────────────────────────
function checkChromium() {
  const chromiumPaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/opt/venv/bin/chromium',
    path.join(APP_DIR, 'node_modules', '.cache', 'playwright', 'chromium-*', 'chrome-linux', 'chrome'),
  ];
  for (const p of chromiumPaths) {
    try {
      execSync(`ls "${p.replace(/\*/g, '*')}" 2>/dev/null`, { stdio: 'pipe' });
      console.error(`[render_remotion] chromium: found at ${p}`);
      return true;
    } catch { /* try next */ }
  }
  // Try playwright's chromium
  try {
    const out = execSync('playwright install --dry-run chromium 2>&1 || true').toString();
    if (out.includes('chromium')) console.error('[render_remotion] chromium: playwright available');
    return true;
  } catch { return false; }
}

// ── Render via npx remotion (uses bundled chromium) ───────────────────────────
async function render() {
  const remotionDir = path.join(APP_DIR, 'remotion');
  const out = spec.outPath || path.join('/tmp', `remotion-${spec.compositionId}-${Date.now()}.mp4`);

  // Ensure output dir
  fs.mkdirSync(path.dirname(out), { recursive: true });

  console.error(`[render_remotion] Rendering: ${spec.compositionId}`);
  console.error(`[render_remotion] Output: ${out}`);
  console.error(`[render_remotion] Props: ${JSON.stringify(spec.props || {})}`);

  const propsFile = path.join('/tmp', `remotion-props-${Date.now()}.json`);
  fs.writeFileSync(propsFile, JSON.stringify(spec.props || {}));

  // Use local remotion binary from node_modules
  const remotionBin = path.join(APP_DIR, 'node_modules', '.bin', 'remotion');
  const args = [
    remotionBin, 'render',
    spec.compositionId,
    '--props', propsFile,
    '--output', out,
    '--log',
    '--project-root', remotionDir,
  ];

  try {
    const result = execSync(args.join(' '), {
      cwd: APP_DIR, // must be /app so node_modules/.bin/remotion is resolved
      env: { ...process.env, REMOTION_CHROMIUM_PATH: process.env.REMOTION_CHROMIUM_PATH || '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300000, // 5 min max
    });
    console.error('[render_remotion] stdout: ' + result.toString());
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : '';
    const stdout = e.stdout ? e.stdout.toString() : '';
    const combined = stderr + stdout;

    // Chromium not found → exit 4
    if (combined.includes('No usable chromium') || combined.includes('ENOENT') || combined.includes('no such file')) {
      console.error('[render_remotion] Chromium not available: ' + combined.split('\n').slice(-3).join(' '));
      process.exit(4);
    }
    console.error('[render_remotion] Render failed: ' + combined.split('\n').slice(-5).join(' '));
    process.exit(3);
  }

  if (!fs.existsSync(out)) {
    console.error('[render_remotion] Output file not found: ' + out);
    process.exit(3);
  }

  console.log(out); // stdout → path for caller
  console.error(`[render_remotion] Done: ${out}`);
  console.error(`[render_remotion] size: ${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB`);

  // Cleanup props file
  try { fs.unlinkSync(propsFile); } catch {}

  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!checkFFmpeg()) process.exit(3);
  // Chromium check is informational — npx remotion handles it
  await render();
})();
