/**
 * EyebrowText — small uppercase label above the main headline.
 * Used for luxury editorial designs (e.g. "LIFESTYLE", "EDITORIAL").
 */
function renderEyebrowText({
  text = '',
  fontSize = 14,
  fontFamily = 'Arial, sans-serif',
  fontWeight = 'bold',
  letterSpacing = 3,
  x = 60, y = 80, width = 960, height = 36,
  fg = '#C9A86A',
  bg = 'transparent'
}) {
  return {
    html: `<div style="
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      font-family: ${fontFamily};
      font-size: ${fontSize}px;
      font-weight: ${fontWeight};
      letter-spacing: ${letterSpacing}px;
      color: ${fg};
      text-transform: uppercase;
      box-sizing: border-box;
      pointer-events: none;
    ">${text}</div>`
  };
}

module.exports = { renderEyebrowText };
