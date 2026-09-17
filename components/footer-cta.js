/**
 * FooterCTA component
 * Bottom CTA button with accent color
 */
function renderFooterCTA({ ctaText, spec, startY = 1150 }) {
  const palette = spec.palette || {};
  const accent = palette.accent?.value || palette.primary?.value || '#F5A623';
  const textColor = '#FFFFFF';
  const bodyFont = (spec.typography?.body?.fontFamily || 'Arial').split(',')[0].trim();
  const bodySize = parseInt(spec.typography?.body?.fontSize) || 18;

  return {
    html: `<div class="footer-cta" style="
      position: absolute;
      left: 64px;
      top: ${startY}px;
      width: 952px;
      text-align: center;
    ">
      <div style="
        display: inline-block;
        background: ${accent};
        color: ${textColor};
        font-family: ${bodyFont}, Arial, sans-serif;
        font-size: ${bodySize}px;
        font-weight: bold;
        padding: 16px 48px;
        border-radius: 50px;
      ">${escapeHtml(ctaText)}</div>
    </div>`,
    height: 64
  };
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

module.exports = { renderFooterCTA };
