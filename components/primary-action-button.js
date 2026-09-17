/**
 * PrimaryActionButton — explicit x, y, width, height, borderRadius, fontSize
 */
function renderPrimaryActionButton({
  ctaText = 'Написать',
  primary = '#F2A82C',
  fg = '#FFFFFF',
  x = 16, y = 800, width = 600, height = 90,
  borderRadius = 20,
  fontSize = 17
}) {
  return {
    html: `<div style="
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      background: ${primary};
      border-radius: ${borderRadius}px;
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: ${fontSize}px; font-weight: 600; color: ${fg};
      letter-spacing: 0.3px;
      box-sizing: border-box;
    ">${ctaText}</div>`
  };
}

module.exports = { renderPrimaryActionButton };
