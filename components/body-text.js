/**
 * BodyText — full-width body paragraph text block
 */
function renderBodyText({
  text = '',
  fg = '#FFFFFF',
  x = 80, y = 680, width = 920, height = 450,
  fontSize = 24,
  fontFamily = 'Inter, sans-serif',
  lineHeight = '1.5'
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
      line-height: ${lineHeight};
      color: ${fg};
      display: flex;
      align-items: flex-start;
      box-sizing: border-box;
    ">${text}</div>`
  };
}

module.exports = { renderBodyText };
