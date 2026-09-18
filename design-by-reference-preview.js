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

// ── Background prompt builder ─────────────────────────────────────────────
function buildBackgroundPrompt(def) {
  const desc = def.backgroundDescription || '';
  const palette = def.palette || {};
  const accent = palette.accent?.value || '#C9A86A';
  const primary = palette.primary?.value || '#8B1E2D';

  // If Vision detected a photo/illustration background, generate an editorial background
  if (desc && !desc.match(/solid|gradient|plain/i)) {
    return `Editorial art-deco style background: ${desc}.
Use a licensed stock photo or generate via MiniMax.
Style: luxury editorial, dark moody atmosphere, ${accent} gold accents.
Palette: background ${palette.background?.value || '#1a1a1a'}, accent ${accent}, primary ${primary}.
Do NOT include any text. Vertical 1080x1350.`;
  }
  // Luxury fallback when no description
  if (def.label.match(/luxury|Luxury|marble|sculpture/i)) {
    return `Dark luxury editorial background. Marble texture or dark atmospheric interior.
Style: ${accent} gold accents on dark background. Vertical 1080x1350. No text.`;
  }
  return null; // use gradient only
}

// ── Step 3: Build 2 variants ────────────────────────────────────────────
console.error('\n=== VARIANT GENERATION ===');

// Build variants from Vision spec — NOT hardcoded
// Each variant uses ONE reference's spec as its basis, then maps to components
const variantDefs = refs.map((ref, vi) => {
  const spec = specs[vi % specs.length] || {};
  const hasDecorative = (spec.decorativeElements || []).length > 0;
  const hasEyebrow = !!(spec.typographyHierarchy?.eyebrow?.text);
  const hasSubheading = !!(spec.typographyHierarchy?.subheading?.text);
  const bgDesc = spec.backgroundDescription || '';
  const isLuxury = bgDesc.match(/marble|sculpture|statue|luxury|gold|ornament|dark/i);

  // Build component list from Vision spec, with renderer-ready fallbacks
  const comps = [];

  // 1. Background — solid/gradient from palette (PhotoBackground is for when user provides separate asset)
  const bgType = spec.background?.type || 'gradient';
  const bgColors = (spec.background?.colors || []).map(c => c.value);
  if (bgType === 'gradient' && bgColors.length >= 2) {
    comps.push({
      type: 'GradientOverlay',
      zone: { x:0, y:0, width:1080, height:1350 },
      background: { value: bgColors[0] },
      opacity: isLuxury ? 75 : 60
    });
  } else {
    comps.push({
      type: 'GradientOverlay',
      zone: { x:0, y:0, width:1080, height:1350 },
      background: { value: spec.palette?.background?.value || '#1a1a1a' },
      opacity: isLuxury ? 80 : 65
    });
  }

  // 2. Decorative border if detected
  if (hasDecorative) {
    const borderEl = (spec.decorativeElements || []).find(e => e.type === 'border' || e.type === 'frame');
    if (borderEl) {
      comps.push({
        type: 'DecorativeBorder',
        zone: { x:30, y:30, width:1020, height:1290 },
        foreground: { value: borderEl.color || spec.palette?.accent?.value || '#C9A86A' },
        borderWidth: borderEl.width || 1
      });
    }
    // Gold accent lines
    const accentLines = (spec.decorativeElements || []).filter(e => e.type === 'accent_line' || e.type === 'rule');
    accentLines.slice(0, 2).forEach((el, i) => {
      comps.push({
        type: 'GoldAccentLine',
        zone: { x:60, y: 720 + i * 30, width: el.width || 160, height: 2 },
        foreground: { value: el.color || '#C9A86A' }
      });
    });
  }

  // 3. Eyebrow text (small label above main headline)
  if (hasEyebrow) {
    comps.push({
      type: 'EyebrowText',
      zone: { x:60, y: isLuxury ? 80 : 100, width:960, height: 36 },
      foreground: { value: spec.palette?.accent?.value || '#C9A86A' },
      text: spec.typographyHierarchy.eyebrow.text
    });
  }

  // 4. Subheading (if present)
  if (hasSubheading) {
    comps.push({
      type: 'SubheadingText',
      zone: { x:60, y: hasEyebrow ? 125 : 100, width:960, height: 60 },
      foreground: { value: spec.palette?.textSecondary?.value || '#cccccc' },
      text: spec.typographyHierarchy.subheading.text
    });
  }

  // Safe-area: bottom margin 8% = 108px on 1350px canvas
  const BOTTOM_SAFE = 108;
  const CANVAS_H = 1350;
  const MAX_CONTENT_BOTTOM = CANVAS_H - BOTTOM_SAFE; // 1242px

  // 5. Hero Title — bottom third, respecting safe-area
  const titleH = isLuxury ? 200 : 160;
  const bodyH = 110;
  const ctaH = content.ctaText ? 70 : 0;
  const ctaY = MAX_CONTENT_BOTTOM - ctaH;
  const bodyY = ctaY - bodyH - 16; // 16px gap
  const titleY = bodyY - titleH - 20; // 20px gap

  comps.push({
    type: 'HeroTitle',
    zone: { x:60, y: titleY, width:960, height: titleH },
    foreground: { value: '#ffffff' }
  });

  // 6. Body text zone
  comps.push({
    type: 'BodyText',
    zone: { x:60, y: bodyY, width:960, height: bodyH },
    foreground: { value: '#ffffff' }
  });

  // 7. CTA if content provided — always respect safe-area
  if (content.ctaText) {
    comps.push({
      type: 'CTABlock',
      zone: { x:60, y: ctaY, width:960, height: ctaH },
      background: { value: spec.palette?.primary?.value || '#8B1E2D' }
    });
  }

  const bgTypeLabel = spec.background?.type || 'gradient';
  const description = [
    `Background: ${bgTypeLabel}`,
    spec.backgroundDescription ? `Scene: ${spec.backgroundDescription.substring(0, 50)}` : '',
    hasEyebrow ? `+ eyebrow label` : '',
    hasSubheading ? `+ subheading` : '',
    hasDecorative ? `+ decorative elements` : '',
    isLuxury ? ' (luxury editorial)' : ''
  ].filter(Boolean).join(', ');

  return {
    label: `Variant ${vi+1} — ${spec.compositionClass || (isLuxury ? 'Luxury Editorial' : 'Editorial')}`,
    description,
    compositionClass: spec.compositionClass || (isLuxury ? 'luxury-editorial' : 'editorial'),
    palette: spec.palette || specFor(vi).palette,
    typography: {
      ...(spec.typography || {}),
      eyebrow: spec.typographyHierarchy?.eyebrow || undefined,
      subheading: spec.typographyHierarchy?.subheading || undefined
    },
    components: comps,
    backgroundDescription: spec.backgroundDescription,
    decorativeElements: spec.decorativeElements || [],
    typographyHierarchy: spec.typographyHierarchy,
  };
});

const variants = variantDefs.map((def, vi) => {
  const ref = refs[vi % refs.length];
  const variant = {
    adaptationStrategy: 'variant',
    variantIndex: vi,
    variantLabel: def.label,
    variantDescription: def.description,
    sourceReferenceHash: ref.hash,
    sourceReferencePath: ref.rawPath,
    // backgroundAsset: to be filled before render — see backgroundPrompt below
    compositionClass: def.compositionClass,
    fidelity: 'close',
    palette: def.palette,
    typography: def.typography,
    components: def.components,
    // KEY: carry Vision-detected fields through to renderer
    backgroundDescription: def.backgroundDescription || '',
    backgroundPrompt: buildBackgroundPrompt(def),
    decorativeElements: def.decorativeElements || [],
    typographyHierarchy: def.typographyHierarchy || null,
    // Safe-area: enforce bottom margin (8% = ~108px on 1350px height)
    safeArea: { bottom: Math.round(1350 * 0.08) }, // prevents bottom elements from touching edge
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
console.error('┌─────────────────────────────────────────────────────────────────────────────────────┐');
console.error('│                         DESIGN BY REFERENCE — PREVIEW                                  │');
console.error('├────┬──────────────────────────┬────────────────────┬──────────────────────────────────┤');
console.error('│    │ Label                    │ Composition        │ Components                        │');
console.error('├────┼──────────────────────────┼────────────────────┼──────────────────────────────────┤');
for (const v of variants) {
  const comps = v.def.components.map(c => c.type).join('+');
  console.error(`│ ${v.index+1}  │ ${(v.def.label).padEnd(24)} │ ${(v.def.compositionClass).padEnd(18)} │ ${comps.padEnd(32)} │`);
}
console.error('└────┴──────────────────────────┴────────────────────┴──────────────────────────────────┘');
console.error('');

// Background prompt for each variant — Kimi must generate/retrieve asset before rendering
console.error('=== BACKGROUND ASSETS REQUIRED ===');
for (const v of variants) {
  const bp = v.variant.backgroundPrompt;
  if (bp) {
    console.error(`[variant ${v.index+1}] BACKGROUND PROMPT (generate before render):`);
    console.error(`  ${bp}`);
    console.error(`  → Save to: /data/backgrounds/variant-${v.index+1}-bg.png`);
  } else {
    console.error(`[variant ${v.index+1}] No backgroundPrompt — using gradient only`);
  }
}
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
