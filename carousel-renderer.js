#!/usr/bin/env node
/**
 * carousel-renderer.js — Mobile Chat UI (close fidelity)
 * Scale by target height, center horizontally, preserve vertical rhythm.
 */
const fs = require('fs');

// Components
const { renderMobileStatusBar } = require('./components/mobile-status-bar');
const { renderAppHeader } = require('./components/app-header');
const { renderChatBubble } = require('./components/chat-bubble');
const { renderPrimaryActionButton } = require('./components/primary-action-button');
const { renderChatComposer } = require('./components/chat-composer');
const { renderKeyboardPlaceholder } = require('./components/keyboard-placeholder');

const getArg = (name, defaultVal) => {
  const idx = process.argv.indexOf('--' + name);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : defaultVal;
};

const specPath = getArg('spec');
const contentArg = getArg('content-json', '');
const outputPath = getArg('out', '/tmp/slide.png');

if (!specPath) {
  console.error('Usage: node carousel-renderer.js --spec <spec.json> [--content-json <json>] --out <out.png>');
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

const messages = content.messages || [];

// Target canvas
const TW = spec.targetCanvas?.width || 1080;
const TH = spec.targetCanvas?.height || 1350;

// Source canvas
const SW = spec.sourceCanvas?.width || 640;
const SH = spec.sourceCanvas?.height || 1280;

// Scale to fit height (center horizontally)
const scale = TH / SH;  // 1350/1280 = 1.055
const scaledW = Math.round(SW * scale);  // 640 * 1.055 = 675
const offsetX = Math.round((TW - scaledW) / 2);  // (1080-675)/2 = 203

console.error(`[renderer] Canvas: ${TW}×${TH} | Source: ${SW}×${SH} | Scale: ${scale.toFixed(3)} | OffsetX: ${offsetX}`);

// Visual tokens
const P = spec.palette || {};
const chatBg = spec.chatBg || P.background?.value || '#F1F1F1';
const primary = P.primary?.value || '#F2A82C';
const secondary = P.secondary?.value || '#FBE9B7';
const textColor = P.text?.value || '#1F1F1F';
const textSec = P.textSecondary?.value || '#7A7A7A';

const scaleY = (v) => Math.round(v * scale);

// ─── BOUNDS with recursion ───────────────────────────────────────────────────
function checkBounds(name, x, y, w, h, canvasW, canvasH) {
  const cx = x + offsetX;
  const clipped = cx < 0 || y < 0 || cx + w > canvasW || y + h > canvasH;
  return { component: name, x: cx, y, width: w, height: h, clipped };
}

function checkAllBounds() {
  const results = [];

  // Status bar (full width of target canvas)
  results.push({ component: 'MobileStatusBar', x: 0, y: 0, width: TW, height: scaleY(44), clipped: false });

  // Header (full width)
  results.push({ component: 'AppHeader', x: 0, y: scaleY(44), width: TW, height: scaleY(110), clipped: false });

  // Bubbles from spec
  const specBubbles = spec.components?.filter(c => c.type === 'IncomingChatBubble' || c.type === 'OutgoingChatBubble') || [];
  specBubbles.forEach((b, i) => {
    const z = b.zone || {};
    const bx = Math.round((z.x || 0) * scale) + offsetX;
    const bw = Math.round((z.width || 400) * scale);
    const by = Math.round((z.y || 0) * scale);
    const bh = Math.round((z.height || 100) * scale);
    results.push({ component: `${b.type}[${i}]`, x: bx, y: by, width: bw, height: bh, clipped: bx < 0 || bx + bw > TW });
  });

  // CTA — PrimaryActionButton zone
  const ctaComp = spec.components?.find(c => c.type === 'PrimaryActionButton');
  const ctaZ = ctaComp?.zone || {};
  const cX = Math.round((ctaZ.x || 32) * scale) + offsetX;
  const cY = Math.round((ctaZ.y || 790) * scale);
  const cW = Math.round((ctaZ.width || 576) * scale);
  const cH = Math.round((ctaZ.height || 84) * scale);
  results.push({ component: 'PrimaryActionButton', x: cX, y: cY, width: cW, height: cH, clipped: cX < 0 || cX + cW > TW });

  // Composer — ChatComposer zone
  const compS = spec.components?.find(c => c.type === 'ChatComposer');
  const compZ = compS?.zone || {};
  const compX2 = Math.round((compZ.x || 16) * scale) + offsetX;
  const compY2 = Math.round((compZ.y || 895) * scale);
  const compW2 = Math.round((compZ.width || 608) * scale);
  const compH2 = Math.round((compZ.height || 86) * scale);
  results.push({ component: 'ChatComposer', x: compX2, y: compY2, width: compW2, height: compH2, clipped: compX2 < 0 || compX2 + compW2 > TW });

  // Keyboard — Custom zone
  const kbS = spec.components?.find(c => c.type === 'Custom');
  const kbZ = kbS?.zone || {};
  const kbY2 = Math.round((kbZ.y || 990) * scale);
  const kbH2 = Math.round((kbZ.height || 290) * scale);
  const kbW2 = Math.round((kbZ.width || 640) * scale);
  const kbX2 = offsetX;
  results.push({ component: 'KeyboardPlaceholder', x: kbX2, y: kbY2, width: kbW2, height: kbH2, clipped: kbY2 + kbH2 > TH });

  // Recursive check: verify keys inside keyboard
  const keyResults = [];
  if (!results.find(r => r.component === 'KeyboardPlaceholder')?.clipped) {
    const rows = [
      'Й Ц У К Е Н Г Ш Щ З Х Ъ'.split(' '),
      'Ф Ы В А П Р О Л Д Ж Э'.split(' '),
      ['⇧', 'Я', 'Ч', 'С', 'М', 'И', 'Т', 'Ь', 'Б', 'Ю', '⌫']
    ];
    const keyW = Math.round(54 * scale);
    const keyH = Math.round(42 * scale);
    const rowGap = Math.round(4 * scale);
    let curY2 = kbY2 + Math.round(6 * scale);

    rows.forEach((row, ri) => {
      const totalKeys = row.length;
      const totalGap = (totalKeys - 1) * rowGap;
      const availW = kbW2 - Math.round(16 * scale);
      const kW = Math.round((availW - totalGap) / totalKeys);
      let curX2 = kbX2 + Math.round(8 * scale);
      row.forEach((key, ki) => {
        const isWide = key === '⇧' || key === '⌫';
        const kw = isWide ? Math.round(kW * 1.5 + rowGap * 0.5) : kW;
        const clipped = curX2 < 0 || curX2 + kw > TW || curY2 + keyH > TH;
        if (clipped) {
          keyResults.push({ component: `Key[${ri}][${ki}]`, x: curX2, y: curY2, width: kw, height: keyH, clipped: true });
        }
        curX2 += kw + rowGap;
      });
      curY2 += keyH + rowGap;
    });
  }

  return [...results, ...keyResults];
}

const allBounds = checkAllBounds();
const clippedComponents = allBounds.filter(b => b.clipped);
const hasClippedDescendants = clippedComponents.some(b => b.component.startsWith('Key['));

console.error('[renderer] Clipped components:', clippedComponents.map(b => `${b.component}(x=${b.x},y=${b.y},w=${b.width},h=${b.height})`).join(', ') || 'none');
if (hasClippedDescendants) {
  console.error('[renderer] WARNING: Keys outside viewport detected');
}

// ─── BUILD HTML ──────────────────────────────────────────────────────────────
const zIndex = (name) => {
  const order = ['MobileStatusBar', 'AppHeader', 'ChatBubble', 'CTA', 'ChatComposer', 'KeyboardPlaceholder'];
  return order.indexOf(name.replace(/\[\d+\]/, '').replace(/incoming|outgoing/, 'ChatBubble'));
};

// Background canvas
const bgHtml = `<div style="position:absolute;top:0;left:0;width:${TW}px;height:${TH}px;background:${chatBg};"></div>`;

// Status bar (full width)
const statusHtml = (() => {
  const h = scaleY(44);
  return `<div style="position:absolute;top:0;left:0;width:${TW}px;height:${h}px;background:#FFFFFF;display:flex;align-items:flex-end;justify-content:space-between;padding:0 24px 6px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;font-weight:600;color:#1F1F1F;z-index:10;box-sizing:border-box;"><span>9:41</span><span>📶 📡 🔋</span></div>`;
})();

// App header (full width)
const headerHtml = (() => {
  const y = scaleY(44);
  const h = scaleY(120);
  return `<div style="position:absolute;top:${y}px;left:0;width:${TW}px;height:${h}px;background:${primary};display:flex;align-items:center;padding:0 16px;z-index:9;box-sizing:border-box;">
    <div style="width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,0.3);display:flex;align-items:center;justify-content:center;font-size:32px;flex-shrink:0;">💬</div>
    <div style="flex:1;padding-left:12px;"><div style="font-size:17px;font-weight:600;color:#FFFFFF;">Ассистент</div><div style="font-size:13px;color:rgba(255,255,255,0.8);">В сети</div></div>
    <div style="font-size:24px;color:#FFFFFF;">✕</div>
  </div>`;
})();

// Bubbles
const bubbleHtmls = (() => {
  const specBubbles = spec.components?.filter(c => c.type === 'IncomingChatBubble' || c.type === 'OutgoingChatBubble') || [];
  return specBubbles.map((b, i) => {
    const z = b.zone || {};
    const bx = Math.round((z.x || 0) * scale) + (b.align === 'right' ? 0 : offsetX);
    const by = Math.round((z.y || 0) * scale);
    const bw = Math.round((z.width || 400) * scale);
    const bh = Math.round((z.height || 100) * scale);
    const isOut = b.type === 'OutgoingChatBubble';
    const bubbleBg = isOut ? (b.background?.value || secondary) : (b.background?.value || '#FFFFFF');
    const r = Math.round((b.borderRadius || 20) * scale);
    const msg = messages[i];
    const text = msg?.text || (isOut ? 'Исходящее сообщение' : 'Входящее сообщение');

    const tail = isOut
      ? `<svg style="position:absolute;right:-7px;top:10px;width:10px;height:14px;z-index:1" viewBox="0 0 10 14"><path d="M0 0 L10 7 L0 14 Z" fill="${bubbleBg}"/></svg>`
      : `<svg style="position:absolute;left:-7px;top:10px;width:10px;height:14px;z-index:1" viewBox="0 0 10 14"><path d="M10 0 L0 7 L10 14 Z" fill="${bubbleBg}"/></svg>`;
    const shadow = b.boxShadow !== 'none' && !isOut ? 'box-shadow: 0 1px 4px rgba(0,0,0,0.12)' : '';

    return `<div style="position:absolute;left:${bx}px;top:${by}px;width:${bw}px;min-height:${bh}px;background:${bubbleBg};border-radius:${r}px;padding:${Math.round(10*scale)}px ${Math.round(14*scale)}px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:${Math.round(16*scale)}px;line-height:1.4;color:${b.foreground?.value || textColor};box-sizing:border-box;${shadow}">${text}${tail}</div>`;
  });
})();

// CTA — read from PrimaryActionButton zone
const ctaComp = spec.components?.find(c => c.type === 'PrimaryActionButton');
const ctaZone = ctaComp?.zone || {};
const ctaX = Math.round((ctaZone.x || 32) * scale) + offsetX;
const ctaY = Math.round((ctaZone.y || 790) * scale);
const ctaW = Math.round((ctaZone.width || 576) * scale);
const ctaH = Math.round((ctaZone.height || 84) * scale);
const rCta = Math.round((ctaComp?.borderRadius || 20) * scale);
const ctaText = content.ctaText || 'Написать в WhatsApp';
const ctaHtml = `<div style="position:absolute;left:${ctaX}px;top:${ctaY}px;width:${ctaW}px;height:${ctaH}px;background:${ctaComp?.background?.value || primary};border-radius:${rCta}px;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:${Math.round(17*scale)}px;font-weight:600;color:${ctaComp?.foreground?.value || '#FFFFFF'};letter-spacing:0.3px;box-sizing:border-box;">${ctaText}</div>`;

// Composer — read from ChatComposer zone
const compSpec = spec.components?.find(c => c.type === 'ChatComposer');
const compZone = compSpec?.zone || {};
const compX = Math.round((compZone.x || 16) * scale) + offsetX;
const compY = Math.round((compZone.y || 895) * scale);
const compW = Math.round((compZone.width || 608) * scale);
const compH = Math.round((compZone.height || 86) * scale);
const rComp = Math.round((compSpec?.borderRadius || 20) * scale);
const composerHtml = `<div style="position:absolute;left:${compX}px;top:${compY}px;width:${compW}px;height:${compH}px;background:${compSpec?.background?.value || '#FFFFFF'};border-radius:${rComp}px;display:flex;align-items:center;padding:0 16px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:${Math.round(16*scale)}px;color:${compSpec?.foreground?.value || textSec};box-sizing:border-box;"><span style="font-size:${Math.round(22*scale)}px;margin-right:12px;">📎</span><span style="flex:1;">Напишите сообщение...</span><span style="font-size:${Math.round(22*scale)}px;">🎤</span></div>`;

// Keyboard — read from Custom component zone
const kbSpec = spec.components?.find(c => c.type === 'Custom');
const kbZone = kbSpec?.zone || {};
const kbY = Math.round((kbZone.y || 990) * scale);
const kbH = Math.round((kbZone.height || 290) * scale);
const kbW = Math.round((kbZone.width || 640) * scale);
const rows = [
  'Й Ц У К Е Н Г Ш Щ З Х Ъ'.split(' '),
  'Ф Ы В А П Р О Л Д Ж Э'.split(' '),
  ['⇧', 'Я', 'Ч', 'С', 'М', 'И', 'Т', 'Ь', 'Б', 'Ю', '⌫']
];
const keyH = Math.round(42 * scale);
const rowGap = Math.round(4 * scale);
const padX = Math.round(8 * scale);

const renderedRows = rows.map((row, ri) => {
  const totalKeys = row.length;
  const availW = kbW - padX * 2;
  const kW = Math.round(availW / totalKeys) - rowGap;
  let curX = offsetX + padX;
  const cells = row.map((key, ki) => {
    const isWide = key === '⇧' || key === '⌫';
    const kw = isWide ? Math.round(kW * 1.4) : kW;
    const isAccent = key === '⇧' || key === '⌫';
    return `<div style="width:${kw}px;height:${keyH}px;background:${isAccent ? primary : '#FFFFFF'};border-radius:${Math.round(5*scale)}px;border:1px solid #ccc;display:flex;align-items:center;justify-content:center;font-size:${Math.round(16*scale)}px;font-family:-apple-system,sans-serif;color:${isAccent ? '#FFFFFF' : '#000'};box-sizing:border-box;margin:${Math.round(rowGap/2)}px;flex-shrink:0;">${key}</div>`;
  });
  return `<div style="display:flex;gap:${rowGap}px;justify-content:center;">${cells.join('')}</div>`;
});

const keyboardHtml = `<div style="position:absolute;left:${offsetX}px;top:${kbY}px;width:${kbW}px;height:${kbH}px;background:#D1D4DC;display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:${Math.round(8*scale)}px;box-sizing:border-box;">${renderedRows.join('')}</div>`;

// Assemble (z-order: status → header → bubbles → CTA → composer → keyboard)
const orderedHtml = [bgHtml, statusHtml, headerHtml, ...bubbleHtmls, ctaHtml, composerHtml, keyboardHtml].join('\n');

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: ${chatBg}; }
  .slide { width: ${TW}px; height: ${TH}px; position: relative; overflow: hidden; }
</style>
</head>
<body>
<div class="slide">
${orderedHtml}
</div>
</body>
</html>`;

// ─── RENDER ─────────────────────────────────────────────────────────────────
async function render(html, outPath, TW, TH) {
  const { execSync } = require('child_process');
  const tmp = outPath.replace('.png', '_r.html');
  fs.writeFileSync(tmp, html);
  const py = `/tmp/cr_${Date.now()}.py`;
  fs.writeFileSync(py, `
from playwright.sync_api import sync_playwright
import json, sys
html_path, out_path, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": w, "height": h})
    page.goto(f"file://{html_path}", wait_until="networkidle")
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
    page.screenshot(path=out_path, type="png")
    browser.close()
    print(json.dumps(rects))
`);
  try {
    const r = execSync(`cd /Users/andrejorlov/Documents/my-project/neurostaff && .venv/bin/python3 "${py}" "${tmp}" "${outPath}" ${TW} ${TH}`, { timeout: 30000 });
    const rects = JSON.parse(r.toString());
    try { fs.unlinkSync(py); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
    return rects;
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

  const rects = await render(html, outputPath, TW, TH);

  const playwrightClipped = rects.filter(r => r.clipped);
  const report = {
    outputPng: outputPath, outputHtml: htmlPath,
    canvas: { width: TW, height: TH },
    sourceCanvas: { width: SW, height: SH },
    scale: parseFloat(scale.toFixed(4)),
    offsetX,
    chatBg,
    specFile: specPath,
    bounds: allBounds,
    clippedComponents: clippedComponents.map(b => b.component),
    playwrightRects: rects,
    playwrightClippedCount: playwrightClipped.length,
    overflowBlocks: playwrightClipped.length,
    renderedAt: new Date().toISOString()
  };

  const reportPath = outputPath.replace('.png', '-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.error(`[renderer] Saved: ${htmlPath}`);
  console.error(`[renderer] Clipped (bounds): ${clippedComponents.length}`);
  console.error(`[renderer] Clipped (playwright): ${playwrightClipped.length}`);
  console.error(`[renderer] Report: ${reportPath}`);
  if (playwrightClipped.length > 0) {
    playwrightClipped.forEach(r => console.error('  PW CLIPPED:', r.tag, r.y, r.bottom, r.x, r.right));
  }
  console.log(outputPath);
})().catch(e => { console.error('[renderer] FATAL:', e.message); process.exit(1); });
