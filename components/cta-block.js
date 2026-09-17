/**
 * CTA — dark pill button
 */
function renderCTABlock({
  text = 'Смотреть все принципы',
  bg = '#1A1A2E',
  fg = '#FFFFFF',
  x = 60, y = 1150, width = 960, height = 80,
  fontSize = 22,
  borderRadius = 40
}) {
  return {
    html: `<div style="
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      background: ${bg};
      border-radius: ${borderRadius}px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: Arial, sans-serif;
      font-size: ${fontSize}px;
      font-weight: 600;
      color: ${fg};
      letter-spacing: 0.5px;
      box-sizing: border-box;
    ">${text}</div>`
  };
}

module.exports = { renderCTABlock };
