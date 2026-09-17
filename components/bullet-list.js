/**
 * BulletList component
 * Vertical list with bullet markers
 */
function renderBulletList({ items = [], spec, startY = 400 }) {
  const palette = spec.palette || {};
  const textColor = palette.text?.value || '#333333';
  const accentColor = palette.accent?.value || palette.primary?.value || '#F5A623';
  const bodyFont = (spec.typography?.body?.fontFamily || 'Arial').split(',')[0].trim();
  const bodySize = parseInt(spec.typography?.body?.fontSize) || 18;
  const lineHeight = spec.typography?.body?.lineHeight || '1.5';

  const itemHeight = Math.ceil(bodySize * parseFloat(lineHeight)) + 12;

  return {
    html: `<div class="bullet-list" style="
      position: absolute;
      left: 64px;
      top: ${startY}px;
      width: 952px;
      font-family: ${bodyFont}, Arial, sans-serif;
      font-size: ${bodySize}px;
      color: ${textColor};
      line-height: ${lineHeight};
    ">${items.map(item => `
      <div style="display:flex; align-items:flex-start; margin-bottom:${itemHeight - bodySize}px;">
        <span style="color:${accentColor}; margin-right:16px; flex-shrink:0;">•</span>
        <span>${escapeHtml(item)}</span>
      </div>`).join('\n')}</div>`,
    height: items.length * itemHeight
  };
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

module.exports = { renderBulletList };
