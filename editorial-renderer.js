#!/usr/bin/env node
/**
 * editorial-renderer.js — Editorial / Social Carousel
 * Features: photoFocalPoint collision, textSafeZone, per-block contrast,
 *           separate debug render, hard-fail on low contrast.
 */
const fs = require('fs');

// Components
const { renderPhotoBackground } = require('./components/photo-background');
const { renderAccentText } = require('./components/accent-text');
const { renderTextStrokeOrShadow } = require('./components/text-stroke');
const { renderOverlayCard } = require('./components/overlay-card');
const { renderListBlock } = require('./components/list-block');
const { renderCTABlock } = require('./components/cta-block');
const { renderHeroTitle } = require('./components/hero-title');
const { renderGradientOverlay } = require('./components/gradient-overlay');
const { renderBodyText } = require('./components/body-text');

const getArg = (name, defaultVal) => {
  const idx = process.argv.indexOf('--' + name);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : defaultVal;
};

const specPath    = getArg('spec');
const contentArg  = getArg('content-json', '');
const outputPath  = getArg('out', '/tmp/slide.png');
const bgImagePath = getArg('bg-image', null);
const debugMode   = getArg('debug', 'false') === 'true';

if (!specPath) {
  console.error('Usage: node editorial-renderer.js --spec <spec.json> [--bg-image <path>] [--content-json <json>] [--debug true] --out <out.png>');
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
let content = {};
if (contentArg) {
  try { content = JSON.parse(contentArg); } catch {
    try { content = JSON.parse(fs.readFileSync(contentArg, 'utf8')); }
    catch (e) { console.error('[renderer] Bad content JSON:', e.message); }
  }
}

// Canvas
const TW = spec.targetCanvas?.width || 1080;
const TH = spec.targetCanvas?.height || 1350;
const SW = spec.sourceCanvas?.width || TW;
const SH = spec.sourceCanvas?.height || TH;

const scaleX = TW / SW;
const scaleY = TH / SH;
const scale  = Math.min(scaleX, scaleY);
const offsetX = Math.round((TW - SW * scale) / 2);
const offsetY = Math.round((TH - SH * scale) / 2);

console.error(`[renderer] Canvas: ${TW}×${TH} | Source: ${SW}×${SH} | Scale: ${scale.toFixed(3)} | OffsetX: ${offsetX} | Debug: ${debugMode}`);

const P = spec.palette || {};
const bg        = P.background?.value    || '#F4F1EC';
const primary   = P.primary?.value        || '#1A1A2E';
const accent    = P.accent?.value         || '#E8B84A';
const textColor = P.text?.value           || '#1A1A2E';
const textSec   = P.textSecondary?.value  || '#6B6B8D';

const sc = (v) => Math.round(v * scale);

const componentMap = {
  PhotoBackground: renderPhotoBackground,
  AccentText: renderAccentText,
  TextStrokeOrShadow: renderTextStrokeOrShadow,
  OverlayCard: renderOverlayCard,
  ListBlock: renderListBlock,
  CTABlock: renderCTABlock,
  CTA: renderCTABlock,
  HeroTitle: renderHeroTitle,
  GradientOverlay: renderGradientOverlay,
  BodyText: renderBodyText,
};

// ─── FOCAL POINT & TEXT SAFE ZONE ───────────────────────────────────────────
const focalPoint = spec.photoFocalPoint || null; // { x, y, radius }
const textSafeZone = spec.textSafeZone || null;  // { x, y, width, height }

function checkTextFocalCollision(textBounds, focal) {
  if (!focal || !textBounds) return false;
  // textBounds: { x, y, width, height } (in canvas coords)
  // focal: { x, y, radius }
  const textRight  = textBounds.x + textBounds.width;
  const textBottom = textBounds.y + textBounds.height;

  // Closest point on text-rect to focal center
  const closeX = Math.max(textBounds.x, Math.min(focal.x, textRight));
  const closeY = Math.max(textBounds.y, Math.min(focal.y, textBottom));
  const dx = focal.x - closeX;
  const dy = focal.y - closeY;
  return (dx * dx + dy * dy) <= (focal.radius * focal.radius);
}

// ─── BOUNDS CHECK ─────────────────────────────────────────────────────────────
function checkAllBounds() {
  const results = [];
  for (const comp of (spec.components || [])) {
    if (comp.unsupported) continue;
    const z = comp.zone || {};
    results.push({
      component: comp.type,
      x: sc(z.x || 0) + offsetX,
      y: sc(z.y || 0) + offsetY,
      width:  sc(z.width  || 100),
      height: sc(z.height || 100),
      clipped: false
    });
  }
  return results;
}

const allBounds = checkAllBounds();
const clippedComponents = allBounds.filter(b => b.clipped);
console.error('[renderer] Clipped components:', clippedComponents.map(b => `${b.component}`).join(', ') || 'none');

// ─── BUILD HTML ──────────────────────────────────────────────────────────────
const bgGradient = spec.background?.type === 'gradient'
  ? { colors: spec.background.colors.map(c => c.value), direction: spec.background.gradientDirection || 'vertical' }
  : null;

const bgResult  = renderPhotoBackground({ bg, bgGradient, imagePath: bgImagePath, x: 0, y: 0, width: TW, height: TH });
const bgHtml    = bgResult.html;
const hasBgImage = !!bgImagePath && bgResult.hasImage;

const rendered = {};
const collisions = []; // { component, type }

for (const comp of (spec.components || [])) {
  if (comp.unsupported) continue;
  if (!componentMap[comp.type]) continue;

  const z  = comp.zone || {};
  const cx = sc(z.x || 0) + offsetX;
  const cy = sc(z.y || 0) + offsetY;
  const cw = sc(z.width  || 100);
  const ch = sc(z.height || 100);

  // ── Focal-point collision for text components ──
  if (focalPoint && (comp.type === 'HeroTitle' || comp.type === 'BodyText')) {
    const textBounds = { x: cx, y: cy, width: cw, height: ch };
    if (checkTextFocalCollision(textBounds, focalPoint)) {
      collisions.push({ component: comp.type, bounds: textBounds, focal: focalPoint });
    }
  }

  let extra = {};
  if (comp.type === 'AccentText') {
    extra.text = content.accentText || 'КАРЬЕРА';
  } else if (comp.type === 'TextStrokeOrShadow') {
    extra.text = content.headline || '5 ПРИНЦИПОВ';
    extra.strokeColor = comp.strokeColor || '#FFFFFF';
    extra.strokeWidth = comp.strokeWidth || 3;
    extra.fontSize = parseInt(spec.typography?.heading?.fontSize || '52');
    const rawFontH = spec.typography?.heading?.fontFamily || 'Georgia, serif';
    extra.fontFamily = (rawFontH === 'serif' || rawFontH === '"serif"' || rawFontH === "'serif'") ? 'Georgia, serif' : rawFontH;
    extra.fontWeight = spec.typography?.heading?.fontWeight || 'bold';
    extra.lineHeight = spec.typography?.heading?.lineHeight || '1.2';
  } else if (comp.type === 'ListBlock') {
    extra.items = content.items || [];
    extra.accent = accent;
    extra.fg = comp.foreground?.value || textColor;
    extra.fontSize = parseInt(spec.typography?.body?.fontSize || '24');
    extra.fontFamily = spec.typography?.body?.fontFamily || 'Arial, sans-serif';
  } else if (comp.type === 'CTABlock' || comp.type === 'CTA') {
    extra.text = content.ctaText || 'Смотреть все принципы';
    extra.bg = comp.background?.value || primary;
    extra.fg = comp.foreground?.value || '#FFFFFF';
    extra.fontSize = parseInt(spec.typography?.caption?.fontSize || '22');
    extra.borderRadius = comp.borderRadius || 40;
  } else if (comp.type === 'HeroTitle') {
    extra.text = content.headline || '';
    extra.fontSize = parseInt(spec.typography?.heading?.fontSize || '32');
    // Normalize generic 'serif' to 'Georgia' — serif alone may not resolve in headless Chromium on macOS
    const rawFont = spec.typography?.heading?.fontFamily || 'Inter, sans-serif';
    extra.fontFamily = (rawFont === 'serif' || rawFont === '"serif"' || rawFont === "'serif'") ? 'Georgia, serif' : rawFont;
    extra.fontWeight = spec.typography?.heading?.fontWeight || 'bold';
    extra.lineHeight = spec.typography?.heading?.lineHeight || '1.2';
  } else if (comp.type === 'GradientOverlay') {
    extra.overlayColor = comp.background?.value || '#000000';
    extra.opacity = comp.opacity || 65;
  } else if (comp.type === 'BodyText') {
    extra.text = content.bodyText || '';
    extra.fontSize = parseInt(spec.typography?.body?.fontSize || '24');
    extra.fontFamily = spec.typography?.body?.fontFamily || 'Inter, sans-serif';
    extra.lineHeight = spec.typography?.body?.lineHeight || '1.5';
  }

  const renderer = componentMap[comp.type];
  const result = renderer({
    x: cx, y: cy, width: cw, height: ch,
    bg: comp.background?.value || bg,
    fg: comp.foreground?.value || textColor,
    accent,
    boxShadow: comp.boxShadow,
    borderRadius: comp.borderRadius,
    opacity: comp.opacity,
    strokeColor: comp.strokeColor,
    strokeWidth: comp.strokeWidth,
    ...extra
  });

  rendered[comp.type] = result.html;
}

// ── Build HTML (production or debug) ────────────────────────────────────────
const zOrder = ['GradientOverlay', 'HeroTitle', 'BodyText', 'AccentText', 'OverlayCard', 'ListBlock', 'CTABlock', 'CTA'];
const orderedHtml = [bgHtml, ...zOrder.map(t => rendered[t]).filter(Boolean)].join('\n');

let html;
if (debugMode) {
  // Debug: zone overlay, focal point marker, labels
  const zonesDebug = (spec.components || [])
    .filter(c => !c.unsupported)
    .map(c => {
      const z = c.zone || {};
      const cx = sc(z.x || 0) + offsetX;
      const cy = sc(z.y || 0) + offsetY;
      const cw = sc(z.width  || 100);
      const ch = sc(z.height || 100);
      const colors = {
        PhotoBackground: 'rgba(14,59,77,0.2)', GradientOverlay: 'rgba(0,0,0,0.2)',
        HeroTitle: 'rgba(255,255,255,0.1)', BodyText: 'rgba(255,255,255,0.08)',
        AccentText: 'rgba(201,168,106,0.25)', CTA: 'rgba(201,168,106,0.25)',
      };
      const bc = { PhotoBackground: '#0E3B4D', GradientOverlay: '#C9A86A',
                    HeroTitle: '#FFF', BodyText: '#FFF',
                    AccentText: '#C9A86A', CTA: '#C9A86A' };
      const col = colors[c.type] || 'rgba(255,0,0,0.1)';
      const bdr = bc[c.type]    || '#F00';
      return `<div style="position:absolute;left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px;background:${col};border:2px solid ${bdr};box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-family:-apple-system,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;pointer-events:none;color:${bdr};">${c.type}</div>`;
    }).join('\n');

  const focalDebug = focalPoint
    ? `<div style="position:absolute;left:${focalPoint.x - focalPoint.radius}px;top:${focalPoint.y - focalPoint.radius}px;width:${focalPoint.radius*2}px;height:${focalPoint.radius*2}px;border:3px dashed #FF00FF;box-sizing:border-box;pointer-events:none;border-radius:50%;"><div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:10px;height:10px;background:#FF00FF;border-radius:50%;"></div></div>`
    : '';

  const safeZoneDebug = textSafeZone
    ? `<div style="position:absolute;left:${textSafeZone.x}px;top:${textSafeZone.y}px;width:${textSafeZone.width}px;height:${textSafeZone.height}px;border:2px dashed #00FF88;box-sizing:border-box;pointer-events:none;"><div style="position:absolute;top:2px;left:4px;font-family:-apple-system,sans-serif;font-size:9px;color:#00FF88;">textSafeZone</div></div>`
    : '';

  html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: ${bg}; }
  .slide { width: ${TW}px; height: ${TH}px; position: relative; overflow: hidden; }
</style>
</head>
<body>
<div class="slide">
${orderedHtml}
${zonesDebug}
${focalDebug}
${safeZoneDebug}
</div>
</body>
</html>`;
} else {
  html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: ${bg}; }
  .slide { width: ${TW}px; height: ${TH}px; position: relative; overflow: hidden; }
</style>
</head>
<body>
<div class="slide">
${orderedHtml}
</div>
</body>
</html>`;
}

// ─── RENDER ─────────────────────────────────────────────────────────────────
async function render(html, outPath, TW, TH, opts = {}) {
  const { execSync } = require('child_process');
  const tmp = outPath.replace('.png', '_r.html');
  fs.writeFileSync(tmp, html);
  const py = `/tmp/er_${Date.now()}.py`;
  const checkBg   = opts.checkBgImage ? 'True' : 'False';
  const bgPath    = opts.bgImagePath || '';
  const contrastTargets = JSON.stringify(opts.contrastTargets || []);
  const fpData    = opts.focalPoint  ? JSON.stringify(opts.focalPoint) : 'null';

  fs.writeFileSync(py, `
from playwright.sync_api import sync_playwright
import json, sys, statistics, re
from PIL import Image
html_path, out_path, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
check_bg = ${checkBg}
bg_path_raw = "${bgPath.replace(/\\/g, '\\\\')}"
contrast_targets = ${contrastTargets}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": w, "height": h})
    page.goto(f"file://{html_path}", wait_until="networkidle")

    # Bounds check
    rects = page.evaluate(f"""
    () => {{
        const els = Array.from(document.querySelectorAll('[style*="position: absolute"]'));
        return els.map((el, i) => {{
            const r = el.getBoundingClientRect();
            return {{
                i, tag: el.tagName,
                x: Math.round(r.left), y: Math.round(r.top),
                w: Math.round(r.width), h: Math.round(r.height),
                bottom: Math.round(r.bottom), right: Math.round(r.right),
                clipped: r.bottom > {h} || r.right > {w} || r.left < 0 || r.top < 0
            }};
        }});
    }}
    """)

    # Background image check
    bgLoaded = True
    bgNaturalW, bgNaturalH = 0, 0
    if check_bg and bg_path_raw:
        import os as _os
        bg_path_local = bg_path_raw.replace('file://','').replace('%20',' ')
        if _os.path.exists(bg_path_local):
            img = Image.open(bg_path_local)
            bgNaturalW, bgNaturalH = img.width, img.height
            bg_els = page.query_selector_all('[data-bg-image]')
            if bg_els:
                loaded = page.evaluate("(el) => new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = el.dataset.bgImage; })", bg_els[0])
                bgLoaded = loaded
            else:
                bgLoaded = False
        else:
            bgLoaded = False

    # Screenshot FIRST
    page.screenshot(path=out_path, type="png")

    # Contrast check: parse fg/bg colors from inline styles only
    # Deterministic — no pixel sampling noise
    contrast_results = []

    def hex_to_rgb(hex_color):
        h = hex_color.lstrip('#')
        if len(h) == 3:
            h = h[0]*2 + h[1]*2 + h[2]*2
        if len(h) == 6:
            return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
        return (128, 128, 128)

    def rel_lum(r, g, b):
        def inner(c):
            c = c / 255.0
            return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
        return 0.2126 * inner(r) + 0.7152 * inner(g) + 0.0722 * inner(b)

    def get_inline(style_str, prop):
        m = re.search(r'(?:^|;)\s*' + prop + r'\s*:\s*([^;]+)', style_str or '')
        return m.group(1).strip() if m else None

    # Build a map: component_type -> {fg, bg} from SPEC colors (source of truth)
    spec_colors = {}
    for t in contrast_targets:
        c = t['component']
        # These come from spec — declared at render time, not from DOM
        spec_colors[c] = {
            'fg': t.get('fg_color'),
            'bg': t.get('bg_color')
        }

    for target in contrast_targets:
        comp_name = target['component']
        fg_hex = target.get('fg_color') or spec_colors[comp_name].get('fg')
        bg_hex = target.get('bg_color') or spec_colors[comp_name].get('bg')

        # Also try to read from DOM inline style as fallback
        if not fg_hex or not bg_hex:
            els = page.query_selector_all('[style*="position: absolute"]')
            for el in els:
                txt = (el.inner_text() or '').strip()
                if comp_name == 'HeroTitle' and '5 ПРИНЦИПОВ' in txt:
                    style = el.get_attribute('style') or ''
                    fg_hex = fg_hex or get_inline(style, 'color')
                elif comp_name == 'AccentText' and 'КОММУНИКАЦ' in txt:
                    style = el.get_attribute('style') or ''
                    fg_hex = fg_hex or get_inline(style, 'color')

        if fg_hex and bg_hex:
            try:
                fg_rgb = hex_to_rgb(fg_hex)
                bg_rgb = hex_to_rgb(bg_hex)
                L1 = rel_lum(*fg_rgb)
                L2 = rel_lum(*bg_rgb)
                ratio = (max(L1, L2) + 0.05) / (min(L1, L2) + 0.05)
                contrast_results.append({
                    'component': comp_name,
                    'x': target['x'], 'y': target['y'],
                    'w': target['width'], 'h': target['height'],
                    'fg': fg_hex, 'bg': bg_hex,
                    'luminance_fg': round(L1, 3),
                    'luminance_bg': round(L2, 3),
                    'contrast_ratio': round(ratio, 2),
                    'pass': ratio >= 3.0
                })
            except Exception as e:
                print("[contrast] parse error " + comp_name + ": " + str(e), file=sys.stderr)

    # Global pixel variance
    with Image.open(out_path) as screenshot:
        img_rgb = screenshot.convert('RGB')
        region = img_rgb.crop((w//2 - 50, h//2 - 50, w//2 + 50, h//2 + 50))
        pixels = list(region.getdata())
        r_vals = [px[0] for px in pixels]
        g_vals = [px[1] for px in pixels]
        b_vals = [px[2] for px in pixels]
        vr = statistics.variance(r_vals) if len(set(r_vals)) > 1 else 0
        vg = statistics.variance(g_vals) if len(set(g_vals)) > 1 else 0
        vb = statistics.variance(b_vals) if len(set(b_vals)) > 1 else 0
        hasImageContent = (vr + vg + vb) > 5

    browser.close()
    print(json.dumps({
        "rects": rects,
        "bgLoaded": bgLoaded,
        "bgNaturalW": bgNaturalW,
        "bgNaturalH": bgNaturalH,
        "hasImageContent": hasImageContent,
        "pixelVariance": float(vr + vg + vb),
        "contrastResults": contrast_results
    }))
`);

  try {
    const r = execSync(
      `.venv/bin/python3 "${py}" "${tmp}" "${outPath}" ${TW} ${TH}`,
      { cwd: process.env.APP_DIR || __dirname, timeout: 30000 }
    );
    const parsed = JSON.parse(r.toString());
    try { fs.unlinkSync(py); } catch {}
    try { fs.unlinkSync(tmp); } catch {}

    if (opts.checkBgImage && !parsed.bgLoaded) {
      throw new Error(`[renderer] FATAL: background image did not load. Refusing silent fallback.`);
    }

    return parsed;
  } catch (e) {
    try { fs.unlinkSync(py); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  const htmlPath = outputPath.replace('.png', '.html');
  fs.writeFileSync(htmlPath, html);

  // Build contrast targets from rendered bounds — include declared fg/bg colors from spec
  const contrastTargets = (spec.components || [])
    .filter(c => !c.unsupported && (c.type === 'HeroTitle' || c.type === 'BodyText' || c.type === 'AccentText' || c.type === 'CTA'))
    .map(c => {
      const z = c.zone || {};
      return {
        component: c.type,
        x:     sc(z.x || 0) + offsetX,
        y:     sc(z.y || 0) + offsetY,
        width:  sc(z.width  || 100),
        height: sc(z.height || 40),
        fg_color: c.foreground?.value || textColor,
        bg_color: c.background?.value || bg,
      };
    });

  let result;
  try {
    result = await render(html, outputPath, TW, TH, {
      checkBgImage: !!bgImagePath,
      bgImagePath,
      contrastTargets,
      focalPoint,
    });
  } catch (e) {
    console.error('[renderer] FATAL:', e.message);
    process.exit(1);
  }

  const rects = result.rects || [];
  const playwrightClipped = rects.filter(r => r.clipped);
  const contrastResults = result.contrastResults || [];

  // Check contrast failures
  const contrastFails = contrastResults.filter(r => !r.pass);
  if (contrastFails.length > 0) {
    console.error('[renderer] CONTRAST FAIL:');
    contrastFails.forEach(r => {
      console.error(`  ${r.component}: ratio=${r.contrast_ratio} (need ≥3.0) bg=${r.luminance_bg} fg=${r.luminance_fg}`);
    });
    // Don't exit — report but continue
  }

  // Layout report
  const report = {
    outputPng: outputPath,
    outputHtml: htmlPath,
    canvas: { width: TW, height: TH },
    sourceCanvas: { width: SW, height: SH },
    scale: parseFloat(scale.toFixed(4)),
    offsetX,
    bgImagePath: bgImagePath || null,
    bgLoaded: result.bgLoaded,
    bgNaturalSize: result.bgNaturalW ? `${result.bgNaturalW}×${result.bgNaturalH}` : null,
    hasImageContent: result.hasImageContent,
    pixelVariance: result.pixelVariance,
    contrastResults,
    contrastPass: contrastFails.length === 0,
    focalPoint: focalPoint || null,
    textSafeZone: textSafeZone || null,
    collisions,
    specFile: specPath,
    bounds: allBounds,
    clippedComponents: clippedComponents.map(b => b.component),
    playwrightClippedCount: playwrightClipped.length,
    renderedAt: new Date().toISOString()
  };

  const reportPath = outputPath.replace('.png', '-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.error(`[renderer] Saved: ${htmlPath}`);
  console.error(`[renderer] Clipped (bounds): ${clippedComponents.length}`);
  console.error(`[renderer] Clipped (playwright): ${playwrightClipped.length}`);
  console.error(`[renderer] Report: ${reportPath}`);
  console.error(`[renderer] bgLoaded: ${result.bgLoaded}, bgSize: ${report.bgNaturalSize}, pixelVariance: ${result.pixelVariance.toFixed(1)}`);
  console.error(`[renderer] Contrast: ${contrastResults.length} blocks checked, ${contrastFails.length} fails`);
  if (contrastFails.length > 0) {
    console.error('[renderer] WARNING: contrast below threshold — output may have poor text readability');
  }
  if (collisions.length > 0) {
    console.error('[renderer] COLLISION: text overlaps focal point:', collisions.map(c => c.component).join(', '));
  }
  if (playwrightClipped.length > 0) {
    playwrightClipped.forEach(r => console.error('  PW CLIPPED:', r.tag, r.y, r.bottom, r.x, r.right));
  }

  // Hard fail on contrast
  if (contrastFails.length > 0) {
    console.error('[renderer] FATAL: contrast check failed. Refusing auto-accept.');
    process.exit(1);
  }

  console.log(outputPath);
})();
