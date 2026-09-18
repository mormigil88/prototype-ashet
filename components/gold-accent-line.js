/**
 * GoldAccentLine — thin horizontal gold rule/accent line.
 * Used for luxury editorial designs with ornamental dividers.
 */
function renderGoldAccentLine({
  lineColor = '#C9A86A',
  lineHeight = 2,
  x = 60, y = 760, width = 200, height = 2,
  fg = lineColor
}) {
  return {
    html: `<div style="
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      background: ${lineColor};
      box-sizing: border-box;
      pointer-events: none;
    "></div>`
  };
}

module.exports = { renderGoldAccentLine };
