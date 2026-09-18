/**
 * DecorativeBorder — thin inset frame inside canvas edges.
 * Used for luxury/editorial designs with ornamental borders.
 */
function renderDecorativeBorder({
  borderColor = '#C9A86A',
  borderWidth = 1,
  x = 30, y = 30, width = 1020, height = 1290,
  bg = 'transparent',
  fg = borderColor
}) {
  return {
    html: `<div style="
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      border: ${borderWidth}px solid ${borderColor};
      box-sizing: border-box;
      pointer-events: none;
    "></div>`
  };
}

module.exports = { renderDecorativeBorder };
