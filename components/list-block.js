/**
 * ListBlock — numbered list items
 * Receives items via content.items array or generates placeholder items
 */
function renderListBlock({
  items = [],
  accent = '#E8B84A',
  fg = '#1A1A2E',
  x = 100, y = 400, width = 880, height = 680,
  fontSize = 24,
  fontFamily = 'Arial, sans-serif'
}) {
  if (!items || items.length === 0) {
    items = [
      'Говорите правду — даже когда молчать проще',
      'Инвестируйте в навыки, а не только в оборудование',
      'Стройте отношения, а не просто контакты',
      'Создавайте ценность раньше, чем просьте о ней',
      'Планируйте отдых так же серьёзно, как работу'
    ];
  }

  const itemHeight = Math.floor(height / items.length);
  const padY = Math.floor(itemHeight * 0.08);
  const badgeSize = Math.min(44, Math.floor(itemHeight * 0.38));

  const itemsHtml = items.map((item, i) => {
    const num = String(i + 1).padStart(2, '0');
    const text = typeof item === 'string' ? item : (item.text || item);
    return `<div style="
      display: flex;
      align-items: flex-start;
      min-height: ${itemHeight}px;
      padding: ${padY}px 0;
      box-sizing: border-box;
    ">
      <div style="
        width: ${badgeSize}px;
        height: ${badgeSize}px;
        min-width: ${badgeSize}px;
        background: ${accent};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: ${fontFamily};
        font-size: ${Math.max(12, Math.round(badgeSize * 0.45))}px;
        font-weight: bold;
        color: #1A1A2E;
        margin-right: 16px;
        margin-top: ${Math.max(0, Math.round((badgeSize - fontSize) / 2))}px;
        flex-shrink: 0;
      ">${num}</div>
      <div style="
        flex: 1;
        font-family: ${fontFamily};
        font-size: ${fontSize}px;
        line-height: 1.4;
        color: ${fg};
      ">${text}</div>
    </div>`;
  }).join('');

  return {
    html: `<div style="
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      box-sizing: border-box;
    ">${itemsHtml}</div>`
  };
}

module.exports = { renderListBlock };
