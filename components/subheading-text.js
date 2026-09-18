/**
 * SubheadingText — secondary heading below eyebrow, above main title.
 * Used for luxury editorial designs with multi-level typography.
 */
function renderSubheadingText({
  text = '',
  fontSize = 24,
  fontFamily = 'Georgia, serif',
  fontWeight = 'normal',
  x = 60, y = 125, width = 960, height = 60,
  fg = '#cccccc',
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
      color: ${fg};
      box-sizing: border-box;
      pointer-events: none;
    ">${text}</div>`
  };
}

module.exports = { renderSubheadingText };
