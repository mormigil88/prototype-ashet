/**
 * SolutionCard component
 * Card/plate with background color, border-radius, optional shadow
 */
function renderSolutionCard({ label, items = [], spec, startY = 400 }) {
  const palette = spec.palette || {};
  const cardBg = palette.secondary?.value || '#F5F5F5';
  const primary = palette.primary?.value || '#F5A623';
  // If background is dark, use light text
  const textColor = isDark(cardBg) ? '#FFFFFF' : (palette.text?.value || '#333333');
  const bodyFont = (spec.typography?.body?.fontFamily || 'Arial').split(',')[0].trim();
  const bodySize = parseInt(spec.typography?.body?.fontSize) || 18;
  const r = spec.quickScan?.r || 12;

  const cardHeight = 80 + items.length * (bodySize * 1.6);

  return {
    html: `<div class="solution-card" style="
      position: absolute;
      left: 64px;
      top: ${startY}px;
      width: 952px;
      min-height: ${cardHeight}px;
      background: ${cardBg};
      border-radius: ${r}px;
      border-left: 6px solid ${primary};
      padding: 24px 32px;
      box-sizing: border-box;
      font-family: ${bodyFont}, Arial, sans-serif;
      font-size: ${bodySize}px;
      color: ${textColor};
      line-height: 1.6;
    ">
      ${label ? `<div style="font-weight:bold; margin-bottom:12px; color:${primary};">${escapeHtml(label)}</div>` : ''}
      ${items.map(item => `<div style="margin-bottom:8px;">• ${escapeHtml(item)}</div>`).join('\n')}
    </div>`,
    height: cardHeight + 48
  };
}

function isDark(hex) {
  if (!hex || !hex.startsWith('#')) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) < 150;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

module.exports = { renderSolutionCard };
