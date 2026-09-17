/**
 * OverlayCard — white card with shadow
 */
function renderOverlayCard({
  bg = '#FFFFFF',
  fg = '#1A1A2E',
  x = 60, y = 360, width = 960, height = 760,
  borderRadius = 24,
  boxShadow = 'blur 16px',
  opacity = 0.95
}) {
  let shadowStyle = 'none';
  if (boxShadow.startsWith('blur')) {
    const blurPx = parseInt(boxShadow.replace('blur', '').trim()) || 16;
    shadowStyle = `0 4px ${blurPx}px rgba(0,0,0,0.12)`;
  }

  return {
    html: `<div style="
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      background: ${bg};
      border-radius: ${borderRadius}px;
      box-shadow: ${shadowStyle};
      opacity: ${opacity};
      box-sizing: border-box;
    "></div>`
  };
}

module.exports = { renderOverlayCard };
