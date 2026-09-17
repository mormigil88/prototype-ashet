#!/usr/bin/env node
/**
 * design-by-reference-preview.js — E2E test for Design by Reference pipeline
 *
 * Takes 2-3 reference images + content JSON → shows preview variants
 * WITHOUT final render. Run is free until user confirms.
 *
 * Usage:
 *   node design-by-reference-preview.js --refs img1.png img2.png [--refs img3.png] \
 *     --content '{"headline":"...","bodyText":"...","ctaText":"..."}' \
 *     --output-dir /tmp/refs-preview/
 *
 * Exit 0 = preview generated, non-zero = blocked/error
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const getArg = (n, def) => {
  const i = process.argv.indexOf('--' + n);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
};
const getList = (n) => {
  const i = process.argv.indexOf('--' + n);
  if (i === -1) return [];
  return process.argv.slice(i + 1).takeWhile(a => !a.startsWith('--'));
};

Array.prototype.takeWhile = function(fn) {
  const out = [];
  for (const v of this) { if (fn(v)) out.push(v); else break; }
  return out;
};

const refPaths  = getList('refs').filter(Boolean);
const contentArg = getArg('content', '');
const outputDir  = getArg('output-dir', '/tmp/refs-preview');
const neutral    = process.argv.includes('--neutral');
const APP_DIR   = process.env.APP_DIR || __dirname;
const PY        = path.join(APP_DIR, 'preflight.py');
const ANALYZER  = path.join(APP_DIR, 'design-analyzer.js');
const RENDERER  = path.join(APP_DIR, 'editorial-renderer.js');

if (refPaths.length < 2) {
  console.error('Usage: node design-by-reference-preview.js --refs img1.png img2.png [--refs img3.png] --content \'{"headline":"..."}\' --output-dir /tmp/ [--neutral]');
  process.exit(1);
}

if (neutral) {
  console.error('[preview] --neutral: creating neutral variants WITHOUT reference analysis');
}

// Parse content
let content;
try {
  content = contentArg.startsWith('{') ? JSON.parse(contentArg) : JSON.parse(fs.readFileSync(contentArg, 'utf8'));
} catch(e) {
  console.error('[preview] Cannot parse content JSON:', e.message);
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function mkdir(dir) { try { fs.mkdirSync(dir, { recursive: true }); } catch {} }

function preflight(p) {
  try {
    execSync(`python3 "${PY}" "${p}" 2>&1`, { encoding: 'utf8', timeout: 30000 });
    return 'CLEAN';
  } catch (e) {
    return e.status === 2 ? 'BLOCKED' : 'ERROR';
  }
}

function analyze(imagePath, outDir) {
  mkdir(outDir);
  try {
    execSync(
      `node "${ANALYZER}" --image "${imagePath}" --output-dir "${outDir}" --fidelity close 2>&1`,
      { encoding: 'utf8', timeout: 120000 }
    );
    const specPath = path.join(outDir, 'design-spec.json');
    if (fs.existsSync(specPath)) {
      return JSON.parse(fs.readFileSync(specPath, 'utf8'));
    }
  } catch(e) { /* ignore */ }
  return null;
}

// ── Step 1: Preflight ────────────────────────────────────────────────────
console.error('\n=== PREFLIGHT ===');
mkdir(outputDir);
const refs = [];

for (const refPath of refPaths) {
  if (!fs.existsSync(refPath)) {
    console.error(`[preview] SKIP: not found — ${refPath}`);
    continue;
  }
  const pf = preflight(refPath);
  const hash = sha256(refPath);
  const ext = path.extname(refPath).toLowerCase().replace('.jpeg', '.jpg');
  const refDir = path.join(outputDir, path.basename(refPath, path.extname(refPath)));
  mkdir(refDir);

  if (pf === 'CLEAN') {
    const rawPath = path.join(refDir, 'raw-reference' + ext);
    fs.writeFileSync(rawPath, fs.readFileSync(refPath));
    refs.push({ refPath, refDir, rawPath, hash, pf });
    console.error(`  ✓ ${path.basename(refPath)} → ${path.basename(rawPath)} (${hash.substring(0,8)})`);
  } else {
    console.error(`  ✗ ${path.basename(refPath)} → BLOCKED (sensitive) — not sent to Vision`);
  }
}

if (refs.length < 2) {
  console.error('[preview] Need at least 2 clean references. Aborting.');
  process.exit(1);
}

// ── Step 2: Vision analysis ─────────────────────────────────────────────
console.error('\n=== VISION ANALYSIS ===');
const specs = [];
for (const ref of refs) {
  const specPath = path.join(ref.refDir, 'design-spec.json');
  if (fs.existsSync(specPath)) {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    ref.spec = spec;
    specs.push(spec);
    console.error(`  ✓ ${path.basename(ref.refPath)}: ${spec.components?.length || 0} components`);
  } else {
    const spec = analyze(ref.rawPath, ref.refDir);
    if (spec) {
      ref.spec = spec;
      specs.push(spec);
      console.error(`  ✓ ${path.basename(ref.refPath)}: ${spec.components?.length || 0} components`);
    } else {
      console.error(`  ✗ ${path.basename(ref.refPath)}: Vision failed`);
    }
  }
}

if (specs.length < 2) {
  if (neutral) {
    console.error('[preview] Vision unavailable — using neutral defaults (--neutral flag)');
  } else {
    console.error('[preview] ERROR: Vision analysis failed for one or more references.');
    console.error('[preview] Either add OPENROUTER_API_KEY to enable Vision, or use --neutral for a design without reference analysis.');
    process.exit(1);
  }
}

// ── Neutral defaults (only with --neutral) ─────────────────────────────────────
const DEFAULT_PALETTE = {
  background:    { value: '#0F0F12', source: 'neutral' },
  primary:      { value: '#F4F4F4', source: 'neutral' },
  secondary:    { value: '#C9A24A', source: 'neutral' },
  accent:       { value: '#E5533D', source: 'neutral' },
  text:         { value: '#FFFFFF', source: 'neutral' },
  textSecondary: { value: '#B8B0A0', source: 'neutral' },
};
const DEFAULT_TYPOGRAPHY = {
  heading: { fontFamily:'Georgia, serif', fontSize:'52px', fontWeight:'normal', lineHeight:'1.1' },
  body:    { fontFamily:'sans-serif', fontSize:'20px', fontWeight:'normal', lineHeight:'1.4' },
  caption: { fontFamily:'sans-serif', fontSize:'14px', fontWeight:'normal', lineHeight:'1.3' },
};
const specFor = (vi) => specs[vi] || { palette: DEFAULT_PALETTE, typography: DEFAULT_TYPOGRAPHY };

// ── Step 3: Build 2 variants ────────────────────────────────────────────
console.error('\n=== VARIANT GENERATION ===');

// Variant palette assignments (alternating per reference)
const variantDefs = [
  {
    label: 'Variant 1 — Portrait Editorial',
    description: neutral
      ? 'Full-height gradient overlay, headline in sans-serif at bottom. Neutral palette (--neutral mode, no Vision).'
      : 'Full-height gradient overlay, headline in sans-serif at bottom. Uses palette from ref-1.',
    compositionClass: 'portrait-editorial-full-overlay',
    palette: specFor(0).palette,
    typography: specFor(0).typography,
    components: [
      { type: 'PhotoBackground', zone: { x:0, y:0, width:1080, height:1350 } },
      { type: 'GradientOverlay', zone: { x:0, y:0, width:1080, height:1350 }, background:{value:'rgba(0,0,0,0)'}, opacity:0 },
      { type: 'HeroTitle', zone: { x:60, y:1050, width:960, height:200 }, foreground:{value:'#ffffff'} },
    ],
  },
  {
    label: 'Variant 2 — Photo Editorial Bottom',
    description: neutral
      ? 'Gradient overlay on bottom half only, headline in serif overlaid on photo. Neutral palette (--neutral mode, no Vision).'
      : 'Gradient overlay on bottom half only, headline in serif overlaid on photo. Uses palette from ref-2.',
    compositionClass: 'photo-editorial-bottom-overlay',
    palette: specFor(1).palette,
    typography: specFor(1).typography,
    components: [
      { type: 'PhotoBackground', zone: { x:0, y:0, width:1080, height:1350 } },
      { type: 'GradientOverlay', zone: { x:0, y:900, width:1080, height:450 }, background:{value:'rgba(0,0,0,0.65)'}, opacity:65 },
      { type: 'HeroTitle', zone: { x:60, y:800, width:960, height:160 }, foreground:{value:'#ffffff'} },
    ],
  },
];

const variants = variantDefs.map((def, vi) => {
  const ref = refs[vi % refs.length];
  const variant = {
    adaptationStrategy: 'variant',
    variantIndex: vi,
    variantLabel: def.label,
    variantDescription: def.description,
    sourceReferenceHash: ref.hash,
    sourceReferencePath: ref.rawPath,
    // backgroundAsset: to be filled by user from safe assets
    compositionClass: def.compositionClass,
    fidelity: 'close',
    palette: def.palette,
    typography: def.typography,
    components: def.components,
    sourceCanvas: { width:1080, height:1350 },
    targetCanvas: { width:1080, height:1350 },
    appliedTokens: ['heading.fontFamily','body.fontFamily','caption.fontFamily'],
    variantOnlyTokens: ['palette.background','palette.primary','compositionClass','components.GradientOverlay.zone'],
    generatedAt: new Date().toISOString(),
  };

  const varPath = path.join(outputDir, `variant-${vi+1}.json`);
  fs.writeFileSync(varPath, JSON.stringify(variant, null, 2));
  console.error(`  ✓ ${def.label}: ${varPath}`);
  return { index: vi, def, variant, path: varPath };
});

// ── Step 4: Show preview table (NO render) ────────────────────────────────
console.error('\n=== PREVIEW (no render yet) ===');
console.error('');
console.error('┌─────────────────────────────────────────────────────────────────────┐');
console.error('│                    DESIGN BY REFERENCE — PREVIEW                     │');
console.error('├────┬────────────────────────┬──────────────┬────────────────────────┤');
console.error('│    │ Label                  │ Composition  │ Components              │');
console.error('├────┼────────────────────────┼──────────────┼────────────────────────┤');
for (const v of variants) {
  const comps = v.def.components.map(c => c.type).join('+');
  console.error(`│ ${v.index+1}  │ ${(v.def.label).padEnd(22)} │ ${(v.def.compositionClass).padEnd(12)} │ ${comps.padEnd(22)} │`);
}
console.error('└────┴────────────────────────┴──────────────┴────────────────────────┘');
console.error('');
console.error('Content fields:');
for (const [k, v] of Object.entries(content)) {
  if (Array.isArray(v)) continue;
  console.error(`  ${k}: ${String(v).substring(0, 60)}`);
}
console.error('');
console.error('Source references:');
for (const ref of refs) {
  console.error(`  ${path.basename(ref.refPath)}: ${ref.hash.substring(0,16)}...`);
}
console.error('');
console.error('Safe background assets needed: NOT YET — choose from licensed_stock, user_owned, or generated.');
console.error('After confirmation: add backgroundAsset + provenance, then render with editorial-renderer.js.');
console.error('');
console.error('To confirm: "Подтверждаю вариант 1" or "Подтверждаю вариант 2"');

// ── Summary output ────────────────────────────────────────────────────
const result = {
  variants: variants.map(v => ({
    index: v.index,
    label: v.def.label,
    description: v.def.description,
    compositionClass: v.def.compositionClass,
    componentTypes: v.def.components.map(c => c.type),
    sourceRefHash: refs[v.index % refs.length].hash,
    specPath: v.path,
    previewReady: false,
    renderPending: true,
  })),
  refs: refs.map(r => ({ path: r.refPath, hash: r.hash, preflight: r.pf })),
  content,
  outputDir,
};

fs.writeFileSync(path.join(outputDir, 'preview-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(0);
