/**
 * PhotoBackground — solid, gradient, or local image background.
 * If imagePath is provided, the image MUST load successfully or the render fails.
 * No silent fallback to solid color.
 */
const fs = require('fs');

function renderPhotoBackground({
  bg = '#F4F1EC',
  bgGradient = null, // { colors: ['#color1', '#color2'], direction: 'vertical'|'horizontal' }
  imagePath = null,   // local image file — REQUIRED for close mode, no silent fallback
  x = 0, y = 0, width = 1080, height = 1350
}) {
  // Case 1: local image (fixture) — must exist and load
  if (imagePath) {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`[PhotoBackground] Local background image not found: ${imagePath}. Refusing silent fallback.`);
    }
    // Use file:// URL so Playwright can load it
    const fileUrl = `file://${imagePath.replace(/ /g, '%20')}`;
    return {
      html: `<div style="
        position: absolute;
        left: ${x}px;
        top: ${y}px;
        width: ${width}px;
        height: ${height}px;
        background-image: url('${fileUrl}');
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        box-sizing: border-box;
      " data-bg-image="${fileUrl}"></div>`,
      hasImage: true
    };
  }

  // Case 2: CSS gradient
  if (bgGradient && bgGradient.colors && bgGradient.colors.length >= 2) {
    const dir = bgGradient.direction === 'horizontal' ? 'to right' : 'to bottom';
    const stops = bgGradient.colors.map((c, i) =>
      `${c} ${Math.round(i * 100 / (bgGradient.colors.length - 1))}%`
    ).join(', ');
    return {
      html: `<div style="
        position: absolute;
        left: ${x}px;
        top: ${y}px;
        width: ${width}px;
        height: ${height}px;
        background: linear-gradient(${dir}, ${stops});
        box-sizing: border-box;
      "></div>`
    };
  }

  // Case 3: solid color
  return {
    html: `<div style="
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      background: ${bg};
      box-sizing: border-box;
    "></div>`
  };
}

module.exports = { renderPhotoBackground };
