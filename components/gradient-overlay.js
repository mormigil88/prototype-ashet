/**
 * GradientOverlay — dark gradient applied over lower portion of image
 * for text readability
 */
function renderGradientOverlay({
  bg = '#0E3B4D',
  overlayColor = '#000000',
  opacity = 65,
  x = 0, y = 400, width = 1080, height = 950
}) {
  // opacity: 0-100 maps to 0-1
  const alpha = (opacity / 100).toFixed(2);
  const dir = 'to bottom';
  const stops = `${overlayColor} 0%, ${overlayColor} 100%`;

  return {
    html: `<div style="
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      background: linear-gradient(${dir}, rgba(0,0,0,0) 0%, rgba(0,0,0,${alpha}) 100%);
      box-sizing: border-box;
    "></div>`
  };
}

module.exports = { renderGradientOverlay };
