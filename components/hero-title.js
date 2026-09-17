/**
 * HeroTitle — large bold headline text
 */
function renderHeroTitle({
  text = 'HEY! VINA',
  fg = '#FFFFFF',
  x = 80, y = 580, width = 920, height = 60,
  fontSize = 32,
  fontFamily = 'Inter, sans-serif',
  fontWeight = 'bold',
  lineHeight = '1.2'
}) {
  return {
    html: `<div style="
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      display: flex;
      align-items: center;
      font-family: ${fontFamily};
      font-size: ${fontSize}px;
      font-weight: ${fontWeight};
      line-height: ${lineHeight};
      color: ${fg};
      box-sizing: border-box;
    ">${text}</div>`
  };
}

module.exports = { renderHeroTitle };
