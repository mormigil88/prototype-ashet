#!/usr/bin/env node
/**
 * schema-validator.js — Variant schema validation + correction
 *
 * Rejects or corrects:
 *  1. fontSize <= 0, empty fontFamily, missing required components
 *  2. Custom used for background (must be PhotoBackground)
 *  3. backgroundAssetHash === sourceReferenceHash (unless allow_source_asset=true)
 *  4. generic/empty compositionClass
 *  5. missing glyph-level content verification (requires render)
 *
 * Exit 0 = PASS/corrected, non-zero = REJECTED
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = {
  requiredComponents: ['HeroTitle', 'PhotoBackground'],
  forbiddenForBackground: ['Custom'],
  allowedCompositionClasses: [
    'photo-editorial-bottom-overlay',
    'portrait-editorial-full-overlay',
    'mobile-chat',
    'landscape-editorial-center',
    'square-editorial-gradient',
    'photo-editorial-center-overlay',
  ],
  minFontSize: 1,
  requiredTypographyFields: ['heading', 'body'],
  requiredPaletteFields: ['background', 'text'],
};

function sha256(p) {
  if (!fs.existsSync(p)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function validate(spec, opts = {}) {
  const { allowSourceAsset = false, bgImagePath = null } = opts;
  const issues = [];
  const corrections = [];
  const warnings = [];

  // 1. Typography checks
  for (const lvl of SCHEMA.requiredTypographyFields) {
    const t = spec.typography?.[lvl];
    if (!t) { issues.push(`typography.${lvl}: missing`); continue; }
    if (t.fontSize !== undefined) {
      const size = parseInt(String(t.fontSize));
      if (isNaN(size) || size <= 0) {
        issues.push(`typography.${lvl}.fontSize: ${t.fontSize} <= 0 — invalid`);
      }
    }
    if (!t.fontFamily || String(t.fontFamily).trim() === '') {
      issues.push(`typography.${lvl}.fontFamily: empty`);
    }
  }

  // 2. Required components
  for (const req of SCHEMA.requiredComponents) {
    const found = (spec.components || []).find(c => c.type === req && !c.unsupported);
    if (!found) {
      // Correction: upgrade Custom to PhotoBackground if bgImagePath exists
      if (req === 'PhotoBackground' && bgImagePath) {
        const customBg = (spec.components || []).find(c =>
          c.type === 'Custom' && !c.unsupported &&
          (c.zone?.width >= 800 || c.zone?.height >= 800)
        );
        if (customBg) {
          corrections.push({
            from: customBg, to: { ...customBg, type: 'PhotoBackground' },
            reason: 'Custom→PhotoBackground: oversized Custom used as background'
          });
        } else {
          issues.push(`required component ${req}: not found and no correctable Custom`);
        }
      } else {
        issues.push(`required component ${req}: not found`);
      }
    }
  }

  // 3. Custom not for background
  for (const comp of (spec.components || [])) {
    if (SCHEMA.forbiddenForBackground.includes(comp.type) && !comp.unsupported) {
      // Check if it occupies most of the canvas (background-like)
      const z = comp.zone || {};
      const canvasW = spec.targetCanvas?.width || 1080;
      const canvasH = spec.targetCanvas?.height || 1350;
      const coverage = ((z.width || 0) * (z.height || 0)) / (canvasW * canvasH);
      if (coverage > 0.5) {
        issues.push(`forbidden component ${comp.type} at zone ${JSON.stringify(z)} covers ${(coverage*100).toFixed(0)}% of canvas — use PhotoBackground`);
      }
    }
  }

  // 4. compositionClass specific
  if (!spec.compositionClass || spec.compositionClass === 'mixed' || spec.compositionClass === 'undefined') {
    issues.push(`compositionClass: "${spec.compositionClass}" is not specific`);
  } else if (!SCHEMA.allowedCompositionClasses.includes(spec.compositionClass)) {
    warnings.push(`compositionClass "${spec.compositionClass}" not in known list (allowed: ${SCHEMA.allowedCompositionClasses.join(', ')})`);
  }

  // 5. Provenance: backgroundAsset must have valid provenance record
  const prov = spec.backgroundAsset?.provenance;
  if (!prov) {
    issues.push('backgroundAsset.provenance: missing — must specify assetType, source, and licenseOrGenerationId');
  } else {
    if (!['user_owned', 'licensed_stock', 'generated'].includes(prov.assetType)) {
      issues.push(`backgroundAsset.provenance.assetType: "${prov.assetType}" not in [user_owned, licensed_stock, generated]`);
    }
    if (!prov.source || prov.source.trim() === '') {
      issues.push('backgroundAsset.provenance.source: empty — must specify origin');
    }
    if (prov.derivedFromReference) {
      issues.push(`backgroundAsset.provenance.derivedFromReference: true — reference assets cannot be used as backgrounds`);
    }
    if (prov.assetType === 'licensed_stock' && (!prov.licenseOrGenerationId || prov.licenseOrGenerationId.trim() === '')) {
      issues.push('backgroundAsset.provenance.licenseOrGenerationId: required for licensed_stock assets');
    }
  }

  // 6. Path-based hard reject: bgAssetPath cannot be under any ref-N/ directory
  if (spec.backgroundAsset?.assetPath) {
    // Hard reject: path contains /ref-N/ as a directory segment (anywhere on disk)
    const refPattern = /\/ref-\d+\//;
    if (refPattern.test(spec.backgroundAsset.assetPath)) {
      issues.push(`backgroundAsset.assetPath: path "${spec.backgroundAsset.assetPath}" is under a ref-N/ directory — forbidden`);
    }
    // Hard reject: known reference root directories
    for (const seg of ['/tmp/multi-ref/', '/tmp/ig-ref4/']) {
      if (spec.backgroundAsset.assetPath.startsWith(seg)) {
        issues.push(`backgroundAsset.assetPath: "${spec.backgroundAsset.assetPath}" is in a reference directory — forbidden`);
      }
    }
  }

  // 7. backgroundAssetHash ≠ sourceReferenceHash
  if (spec.sourceReferenceHash && spec.backgroundAssetHash) {
    if (spec.backgroundAssetHash === spec.sourceReferenceHash && !allowSourceAsset) {
      issues.push(`backgroundAssetHash === sourceReferenceHash (${spec.sourceReferenceHash.substring(0,8)}...) — source asset cannot be used as background without allow_source_asset=true`);
    }
  }

  // 6. Normalize serif → Georgia
  for (const lvl of ['heading', 'body', 'caption']) {
    const t = spec.typography?.[lvl];
    if (t?.fontFamily === 'serif') {
      corrections.push({
        path: `typography.${lvl}.fontFamily`,
        from: 'serif', to: 'Georgia, serif',
        reason: 'generic "serif" may not resolve in headless Chromium'
      });
    }
  }

  return { issues, corrections, warnings };
}

function applyCorrections(spec, corrections) {
  const corrected = JSON.parse(JSON.stringify(spec));
  for (const c of corrections) {
    if (c.path) {
      // Simple field correction
      const parts = c.path.split('.');
      let obj = corrected;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = c.to;
    } else if (c.from && c.to) {
      // Component type correction
      const idx = corrected.components.findIndex(comp =>
        comp.type === c.from.type && JSON.stringify(comp.zone) === JSON.stringify(c.from.zone)
      );
      if (idx !== -1) corrected.components[idx] = c.to;
    }
  }
  return corrected;
}

module.exports = { validate, applyCorrections, SCHEMA, sha256 };
