#!/usr/bin/env node
/**
 * content-auditor.js — Precise content verification via pixel diff
 *
 * Flow:
 *  1. Render production (full text)
 *  2. Render baseline (text fields → empty string)
 *  3. Extract HeroTitle bbox from production HTML
 *  4. Pixel-diff baseline vs production ONLY in that bbox
 *  5. PASS only if changed-pixel fraction > 3% of zone
 *
 * Also: verify content JSON fields are non-empty and used.
 */
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const APP_DIR  = process.env.APP_DIR || __dirname;
const RENDERER = path.join(APP_DIR, 'editorial-renderer.js');
const CANVAS_W = 1080;
const CANVAS_H = 1350;

const CONTENT_FIELD_MAP = {
  headline:   'HeroTitle',
  bodyText:   'BodyText',
  ctaText:    'CTA',
  accentText: 'AccentText',
  items:      'ListBlock',
};

// ── Render with empty text ───────────────────────────────────────────────
function renderEmptyText(specPath, bgImagePath, contentJson, outPng) {
  let content;
  if (typeof contentJson === 'string') {
    content = JSON.parse(fs.readFileSync(contentJson, 'utf8'));
  } else {
    content = { ...contentJson };
  }
  for (const field of Object.keys(CONTENT_FIELD_MAP)) {
    if (field in content) content[field] = '';
  }
  content.items = [];

  execSync(
    `node "${RENDERER}" --spec "${specPath}" --bg-image "${bgImagePath}" --content-json '${JSON.stringify(content).replace(/'/g,"'\\''")}' --out "${outPng}" 2>&1`,
    { encoding:'utf8', timeout:60000 }
  );
  return fs.existsSync(outPng);
}

// ── Find prod PNG and HTML ──────────────────────────────────────────────
function findOutputFiles(specPath) {
  const dir = path.dirname(specPath);
  const base = path.basename(specPath, '.json');
  // Extract numeric part: v1-variant → 1, variant-2 → 2, v2 → 2
  const numMatch = base.match(/(\d+)/);
  const num = numMatch ? numMatch[1] : '';

  let files;
  try { files = fs.readdirSync(dir); } catch { return null; }

  const candidates = files.filter(f => f.endsWith('.png') && f.includes('prod'));
  for (const f of candidates) {
    // Match if filename contains the same number
    if (f.includes(num)) {
      const png = path.join(dir, f);
      const html = path.join(dir, f.replace('.png', '.html'));
      return { prodPng: png, htmlPath: fs.existsSync(html) ? html : null };
    }
  }
  return null;
}

// ── Extract HeroTitle bbox from HTML ──────────────────────────────────
function extractTextBbox(htmlPath, expectedText) {
  if (!fs.existsSync(htmlPath)) return null;
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Find div containing the exact text
  const escaped = expectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const textRe = new RegExp(escaped, '');

  const divRe = /<div[^>]+style="([^"]*(?:position:\s*absolute|left:\s*\d+|top:\s*\d+)[^"]*)"[^>]*>([^<]*)<\/div>/gi;
  let match;
  while ((match = divRe.exec(html)) !== null) {
    const style = match[1];
    const text = match[2].trim();
    if (text === expectedText || (expectedText.length > 5 && text.includes(expectedText.substring(0, 10)))) {
      const leftMatch  = style.match(/left:\s*(\d+)/i);
      const topMatch   = style.match(/top:\s*(\d+)/i);
      const widthMatch = style.match(/width:\s*(\d+)/i);
      const heightMatch= style.match(/height:\s*(\d+)/i);
      if (leftMatch && topMatch) {
        return {
          x: parseInt(leftMatch[1]),
          y: parseInt(topMatch[1]),
          width:  widthMatch  ? parseInt(widthMatch[1])  : 960,
          height: heightMatch ? parseInt(heightMatch[1]) : 200,
          text: text.substring(0, 50),
        };
      }
    }
  }
  return null;
}

// ── Pixel diff in bbox ─────────────────────────────────────────────────
function pixelDiffInBbox(prodPng, emptyPng, bbox, threshold = 10) {
  if (!bbox || bbox.width === 0 || bbox.height === 0) return { changed: 0, pass: false };

  const py = '/tmp/ca_diff_' + Date.now() + '.py';
  const script = [
    'from PIL import Image',
    'import numpy as np',
    'import sys',
    '',
    'prod  = np.array(Image.open(\'' + prodPng  + '\').convert(\'RGB\'))',
    'empty = np.array(Image.open(\'' + emptyPng + '\').convert(\'RGB\'))',
    '',
    'H, W = prod.shape[:2]',
    'x1 = max(0, ' + bbox.x + ')',
    'y1 = max(0, ' + bbox.y + ')',
    'x2 = min(W, x1 + max(1, ' + bbox.width  + '))',
    'y2 = min(H, y1 + max(1, ' + bbox.height + '))',
    '',
    'diff  = np.abs(prod.astype(float) - empty.astype(float))',
    'zone  = diff[y1:y2, x1:x2]',
    'changed = int((zone > 10).sum())',
    'print(str(changed))',
  ].join('\n');

  fs.writeFileSync(py, script);
  try {
    const out = execSync(
      `python3 "${py}"`,
      { cwd: process.env.APP_DIR || __dirname, encoding:'utf8', timeout:20000 }
    ).toString().trim();
    const changed = parseInt(out);
    const zoneArea = bbox.width * bbox.height;
    const fraction = changed / zoneArea;
    return { changed, zoneArea, fraction, pass: fraction > 0.03 };
  } catch(e) {
    return { changed: 0, zoneArea: 0, fraction: 0, pass: false, error: e.message };
  } finally { try { fs.unlinkSync(py); } catch {} }
}

// ── Main audit ─────────────────────────────────────────────────────────
function auditVariant(specPath, bgImagePath, contentJson, variantLabel) {
  const issues = [];

  // contentJson can be a JSON file path or a plain object
  let content;
  if (typeof contentJson === 'string') {
    try {
      content = JSON.parse(fs.readFileSync(contentJson, 'utf8'));
    } catch {
      issues.push('cannot read/parse content JSON: ' + contentJson);
      return { issues };
    }
  } else {
    content = contentJson;
  }
  const usedFields = Object.keys(CONTENT_FIELD_MAP)
    .filter(f => f in content && String(content[f]).trim() !== '');

  console.error(`[auditor] ${variantLabel}: content fields: ${usedFields.join(', ')}`);

  // Find output files
  const outputs = findOutputFiles(specPath);
  if (!outputs) {
    issues.push('production PNG not found for spec: ' + specPath);
    return { issues };
  }
  const { prodPng, htmlPath } = outputs;
  const emptyPng = prodPng.replace('-prod', '-empty');

  // Render empty baseline
  if (!fs.existsSync(emptyPng)) {
    console.error(`[auditor] ${variantLabel}: rendering empty baseline...`);
    if (!renderEmptyText(specPath, bgImagePath, contentJson, emptyPng)) {
      issues.push('failed to render empty baseline');
      return { issues };
    }
  }

  // Extract bbox for primary text field
  const primaryField = usedFields[0] || 'headline';
  const expectedText = String(content[primaryField] || '');
  const bbox = htmlPath ? extractTextBbox(htmlPath, expectedText) : null;

  if (!bbox) {
    issues.push(`could not extract bbox for "${expectedText}" from HTML`);
    return { issues };
  }
  console.error(`[auditor] ${variantLabel}: bbox=${JSON.stringify(bbox)}`);

  // Pixel diff
  const diff = pixelDiffInBbox(prodPng, emptyPng, bbox);
  console.error(`[auditor] ${variantLabel}: changed=${diff.changed}/${diff.zoneArea} (${(diff.fraction*100).toFixed(1)}%) → ${diff.pass ? 'PASS' : 'FAIL'}`);

  if (!diff.pass) {
    issues.push(`text glyphs: ${(diff.fraction*100).toFixed(1)}% of zone (need >3%) — text may be invisible`);
  }

  // Bbox sanity
  if (bbox.x < 0 || bbox.y < 0 || bbox.x + bbox.width > CANVAS_W || bbox.y + bbox.height > CANVAS_H) {
    issues.push(`bbox outside canvas: ${JSON.stringify(bbox)}`);
  }

  return { issues, bbox, diff, primaryField, expectedText };
}

module.exports = { auditVariant };
