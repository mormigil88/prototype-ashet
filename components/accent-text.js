/**
 * AccentText — badge/pill label with accent background
 */
function renderAccentText({
  text = 'КАРЬЕРА',
  accent = '#E8B84A',
  fg = '#1A1A2E',
  x = 60, y = 80, width = 200, height = 40,
  fontSize = 18
}) {
  return {
    html: `<div style="
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      background: ${accent};
      border-radius: ${Math.round(height / 2)}px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: Arial, sans-serif;
      font-size: ${fontSize}px;
      font-weight: bold;
      color: ${fg};
      letter-spacing: 1px;
      box-sizing: border-box;
    ">${text}</div>`
  };
}

module.exports = { renderAccentText };
