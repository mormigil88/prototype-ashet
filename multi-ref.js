#!/usr/bin/env node
/**
 * multi-ref.js — Multi-reference carousel design
 *
 * Flow:
 *  1. Analyze N clean references → each gets manifest.json + design-spec.json
 *  2. Extract common tokens (matching confidence, same composition class)
 *  3. Conflicting tokens → mark as variant (not averaged silently)
 *  4. Generate unified spec + N layout variants
 *  5. User picks variant before render
 *  6. Render + acceptance on each variant
 *
 * Usage:
 *   node multi-ref.js --refs ref1.png ref2.png [ref3.png] --output-dir <dir>
 *                       [--content-json <json>] [--fidelity adapt|close]
 *
 * Output:
 *   <output-dir>/
 *     ref-1/ raw-reference.png manifest.json design-spec.json
 *     ref-2/ raw-reference.png manifest.json design-spec.json
 *     ref-N/ ...
 *     unified-spec.json
 *     variant-1.json
 *     variant-2.json
 *     acceptance-variant-1.json
 *     ...
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

const refPaths    = getList('refs').filter(Boolean);
const outputDir   = getArg('output-dir', '/tmp/multi-ref');
const contentArg = getArg('content-json', '');
const fidelity   = getArg('fidelity', 'close');
const skipPreflight = process.argv.includes('--skip-preflight');

if (refPaths.length < 2) {
  console.error('Usage: node multi-ref.js --refs ref1.png ref2.png [ref3.png] --output-dir <dir> [--content-json <json>]');
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const APP_DIR = process.env.APP_DIR || __dirname;

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function runPreflight(p) {
  const py = path.join(APP_DIR, 'preflight.py');
  try {
    const out = execSync(`python3 "${py}" "${p}" 2>&1`, { encoding: 'utf8' });
    return { blocked: false, output: out };
  } catch (e) {
    const code = e.status;
    if (code === 2) return { blocked: true, reason: 'sensitive_document' };
    throw e;
  }
}

function dims(p) {
  try {
    const out = execSync(
      `python3 -c "from PIL import Image; i=Image.open('${p.replace(/'/g, "\\'")}'); print(i.width, i.height)"`,
      { cwd: process.env.APP_DIR || __dirname, timeout: 10000 }
    ).toString().trim().split(' ').map(Number);
    return { w: out[0], h: out[1] };
  } catch { return { w: 0, h: 0 }; }
}

// ── STEP 1: Preflight + save raw references ─────────────────────────────────
const refs = [];
console.error('=== STEP 1: Preflight + raw references ===');

for (const refPath of refPaths) {
  if (!fs.existsSync(refPath)) {
    console.error(`[multi-ref] SKIP ${refPath}: not found`);
    continue;
  }
  const pf = skipPreflight ? { blocked: false } : runPreflight(refPath);
  if (pf.blocked) {
    console.error(`[multi-ref] SKIP ${refPath}: ${pf.reason} — not sent to Vision`);
    continue;
  }

  const refDir = path.join(outputDir, path.basename(refPath, path.extname(refPath)));
  if (!fs.existsSync(refDir)) fs.mkdirSync(refDir, { recursive: true });

  // Preserve original extension: IMG_8448.JPG → raw-reference.jpg, photo.png → raw-reference.png
  const ext = path.extname(refPath).toLowerCase().replace('.jpeg', '.jpg');
  const rawPath = path.join(refDir, 'raw-reference' + ext);
  const { w, h } = dims(refPath);
  const hash = sha256(refPath);

  fs.writeFileSync(rawPath, fs.readFileSync(refPath));
  fs.chmodSync(rawPath, 0o600);

  const manifest = {
    sourceFile: path.basename(refPath),
    sourceHash: hash,
    sourceWidth: w,
    sourceHeight: h,
    savedAt: new Date().toISOString(),
    outputDir: refDir,
    fidelity,
    preflight: 'CLEAN',
  };
  fs.writeFileSync(path.join(refDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.chmodSync(path.join(refDir, 'manifest.json'), 0o600);

  console.error(`[multi-ref] ✓ ${refPath} → ${rawPath} (${w}×${h}, ${hash.substring(0,8)}...)`);
  refs.push({ refPath, refDir, rawPath, manifest });
}

// ── STEP 2: Vision analysis per reference ─────────────────────────────────────
console.error('\n=== STEP 2: Vision analysis ===');

const analyzerPath = path.join(APP_DIR, 'design-analyzer.js');
for (const ref of refs) {
  const specPath = path.join(ref.refDir, 'design-spec.json');
  if (fs.existsSync(specPath)) {
    console.error(`[multi-ref] Reusing spec: ${specPath}`);
    ref.spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    continue;
  }
  try {
    const out = execSync(
      `node "${analyzerPath}" --image "${ref.rawPath}" --output-dir "${ref.refDir}" --fidelity ${fidelity} 2>&1`,
      { encoding: 'utf8', timeout: 120000, env: { ...process.env } }
    ).toString();
    const line = out.trim().split('\n').find(l => l.endsWith('.json'));
    if (line && fs.existsSync(line.trim())) {
      ref.spec = JSON.parse(fs.readFileSync(line.trim(), 'utf8'));
      console.error(`[multi-ref] ✓ Spec: ${line.trim()}`);
    }
  } catch (e) {
    console.error(`[multi-ref] ✗ Vision failed for ${ref.refPath}: ${e.message}`);
  }
}

// ── STEP 3: Extract common + variant tokens ────────────────────────────────────
console.error('\n=== STEP 3: Token alignment ===');

const specs = refs.filter(r => r.spec).map(r => r.spec);
if (specs.length < 2) {
  console.error('[multi-ref] Need at least 2 successfully analyzed references. Aborting.');
  process.exit(1);
}

function tokensMatch(v1, v2, tolerance = 0.1) {
  if (!v1 && !v2) return true;
  if (!v1 || !v2) return false;
  return Math.abs(parseFloat(v1) - parseFloat(v2)) <= tolerance;
}

function sameCompClass(specs) {
  const classes = specs.map(s => s.compositionClass || s.layout?.compositionClass).filter(Boolean);
  return classes.every(c => c === classes[0]) ? classes[0] : null;
}

function mergePalette(specs) {
  const result = {};
  const keys = ['background', 'primary', 'secondary', 'accent', 'text', 'textSecondary'];
  for (const k of keys) {
    const vals = specs.map(s => s.palette?.[k]?.value).filter(Boolean);
    const confs = specs.map(s => s.palette?.[k]?.confidence).filter(Boolean);
    if (!vals.length) continue;
    // All same → common
    const unique = [...new Set(vals)];
    if (unique.length === 1) {
      result[k] = { value: unique[0], confidence: Math.min(...confs), source: 'common' };
    } else {
      // Variants
      result[k] = { value: unique, confidence: Math.min(...confs), source: 'variant', values: vals.map((v, i) => ({ value: v, refIndex: i })) };
    }
  }
  return result;
}

function mergeTypography(specs) {
  const result = {};
  const levels = ['heading', 'body', 'caption'];
  for (const lvl of levels) {
    const fonts = specs.map(s => s.typography?.[lvl]?.fontFamily).filter(Boolean);
    const sizes = specs.map(s => s.typography?.[lvl]?.fontSize).filter(Boolean);
    const weights = specs.map(s => s.typography?.[lvl]?.fontWeight).filter(Boolean);
    const lh = specs.map(s => s.typography?.[lvl]?.lineHeight).filter(Boolean);

    const allSameFont = new Set(fonts).size === 1;
    const allSameSize = new Set(sizes).size === 1;
    const allSameWeight = new Set(weights).size === 1;
    const allSameLh = new Set(lh).size === 1;

    result[lvl] = {
      fontFamily: allSameFont ? [...new Set(fonts)][0] : { common: [...new Set(fonts)], source: 'variant' },
      fontSize: allSameSize ? [...new Set(sizes)][0] : { common: [...new Set(sizes)], source: 'variant' },
      fontWeight: allSameWeight ? [...new Set(weights)][0] : { common: [...new Set(weights)], source: 'variant' },
      lineHeight: allSameLh ? [...new Set(lh)][0] : { common: [...new Set(lh)], source: 'variant' },
    };
  }
  return result;
}

function mergeComponents(specs) {
  // Group by component type
  const byType = {};
  for (const spec of specs) {
    for (const comp of (spec.components || [])) {
      if (!byType[comp.type]) byType[comp.type] = [];
      byType[comp.type].push(comp);
    }
  }
  const merged = [];
  for (const [type, comps] of Object.entries(byType)) {
    // All same zone → common
    const zones = comps.map(c => JSON.stringify(c.zone));
    const uniqueZones = [...new Set(zones)];
    if (uniqueZones.length === 1) {
      merged.push({ ...comps[0], source: 'common' });
    } else {
      // Variant: keep all zone definitions
      merged.push({ type, source: 'variant', variants: comps.map((c, i) => ({ zone: c.zone, refIndex: i })) });
    }
  }
  return merged;
}

const compClass = sameCompClass(specs);
const unified = {
  sourceCanvas: specs[0].sourceCanvas,
  targetCanvas: specs[0].targetCanvas,
  adaptationStrategy: 'unified',
  compositionClass: compClass || 'mixed',
  palette: mergePalette(specs),
  typography: mergeTypography(specs),
  background: specs[0].background,
  components: mergeComponents(specs),
  fidelity,
  refCount: specs.length,
  generatedAt: new Date().toISOString(),
};

// ── STEP 4: Generate layout variants ───────────────────────────────────────────
console.error('\n=== STEP 4: Variant generation ===');

const variants = [];

// For each variant token, create a variant spec
function buildVariant(variantIdx, unifiedSpec) {
  const v = {
    ...unifiedSpec,
    adaptationStrategy: 'variant',
    variantIndex: variantIdx,
    palette: {},
    typography: {},
    components: [],
  };

  // Palette: pick per-variant value or common
  for (const [k, entry] of Object.entries(unifiedSpec.palette)) {
    if (entry.source === 'common') {
      v.palette[k] = { value: entry.value, confidence: entry.confidence };
    } else {
      // Pick variant value
      const pick = entry.values?.[variantIdx] || entry.values?.[0];
      v.palette[k] = { value: pick?.value || entry.value, confidence: entry.confidence, source: 'variant' };
    }
  }

  // Typography: pick per-variant or common
  for (const [lvl, fields] of Object.entries(unifiedSpec.typography)) {
    v.typography[lvl] = {};
    for (const [field, val] of Object.entries(fields)) {
      if (!val || typeof val !== 'object' || !val.source) {
        v.typography[lvl][field] = val;
      } else if (val.source === 'variant') {
        v.typography[lvl][field] = val.common?.[variantIdx] || val.common?.[0];
      } else {
        v.typography[lvl][field] = val;
      }
    }
  }

  // Copy top-level fields from unified spec or first ref spec
  v.compositionClass = unifiedSpec.compositionClass || 'mixed';
  v.backgroundDescription = unifiedSpec.backgroundDescription || (specs[0]?.backgroundDescription || '');
  v.decorativeElements = unifiedSpec.decorativeElements || (specs[0]?.decorativeElements || []);

  // Build backgroundPrompt from backgroundDescription
  if (v.backgroundDescription && !v.backgroundDescription.match(/solid|gradient|plain/i)) {
    const palette = v.palette || {};
    const accent = palette.accent?.value || '#C9A86A';
    const primary = palette.primary?.value || '#8B1E2D';
    const bg = palette.background?.value || '#1a1a1a';
    v.backgroundPrompt = `Editorial art-deco style background: ${v.backgroundDescription}. Style: luxury editorial, dark moody atmosphere, ${accent} gold accents. Palette: background ${bg}, accent ${accent}, primary ${primary}. Vertical 1080x1350. No text.`;
  }

  // Components: pick zone per variant
  for (const comp of unifiedSpec.components) {
    if (comp.source === 'common') {
      v.components.push(comp);
    } else {
      // Pick variant zone
      const pick = comp.variants?.[variantIdx] || comp.variants?.[0];
      if (pick) {
        v.components.push({ ...comp, zone: pick.zone, source: 'variant', variantIndex: variantIdx });
      }
    }
  }

  return v;
}

// Count max variants needed
let maxVariants = 1;
for (const comp of unified.components) {
  if (comp.source === 'variant') {
    maxVariants = Math.max(maxVariants, comp.variants?.length || 1);
  }
}
for (const entry of Object.values(unified.palette)) {
  if (entry.source === 'variant') {
    maxVariants = Math.max(maxVariants, entry.values?.length || 1);
  }
}

console.error(`[multi-ref] Generating ${maxVariants} variant(s)...`);
for (let vi = 0; vi < maxVariants; vi++) {
  const variant = buildVariant(vi, unified);
  const variantPath = path.join(outputDir, `variant-${vi + 1}.json`);
  fs.writeFileSync(variantPath, JSON.stringify(variant, null, 2));
  variants.push({ index: vi, spec: variant, path: variantPath });
  console.error(`[multi-ref] ✓ variant-${vi + 1}: ${variantPath}`);
}

// Save unified spec
const unifiedPath = path.join(outputDir, 'unified-spec.json');
fs.writeFileSync(unifiedPath, JSON.stringify(unified, null, 2));
console.error(`[multi-ref] ✓ unified-spec: ${unifiedPath}`);

// ── STEP 5: List variants for user selection ───────────────────────────────────
console.error('\n=== STEP 5: Variant selection ===');
console.error('Variants available:');
variants.forEach((v, i) => {
  const comps = v.spec.components.map(c => c.type).join(', ');
  console.error(`  [${i}] variant-${i + 1}.json — components: ${comps}`);
});
console.error('\nTo render a specific variant:');
console.error(`  node editorial-renderer.js --spec ${outputDir}/variant-N.json ...`);
console.error('\nUnified spec (all tokens):');
console.error(`  ${unifiedPath}`);

// ── STEP 6: Render + acceptance per variant (if ASK_MODE) ───────────────────────
const askMode = getArg('auto-render', 'false') === 'true';
// providerCalls: multi-ref does NOT call Vision API. Kimi uses Claude multimodal.
// If design-spec.json pre-exists → was written by Kimi via write-design-spec.js.
const providerCalls = 0;

if (!askMode) {
  console.error('\n[multi-ref] Auto-render disabled. Set --auto-render true to proceed automatically.');
  console.error('stdout: ' + JSON.stringify({ variants: variants.map(v => v.path), unified: unifiedPath, providerCalls }));
  process.exit(0);
}

// Auto-render: pick first variant
console.error(`\n=== STEP 6: Auto-render (variant 0) ===`);
const chosen = variants[0];
console.error(`[multi-ref] Rendering variant: ${chosen.path}`);

// Save manifest for acceptance
const refManifest = {
  generatedAt: new Date().toISOString(),
  variants: variants.map(v => ({ path: v.path, index: v.index })),
  unifiedSpec: unifiedPath,
  refs: refs.map(r => ({ rawPath: r.rawPath, manifest: r.manifest })),
};
fs.writeFileSync(path.join(outputDir, 'multi-manifest.json'), JSON.stringify(refManifest, null, 2));
console.error('[multi-ref] Multi-manifest: ' + path.join(outputDir, 'multi-manifest.json'));

console.log(JSON.stringify({ variant: chosen.path, unified: unifiedPath, multiManifest: path.join(outputDir, 'multi-manifest.json') }));
