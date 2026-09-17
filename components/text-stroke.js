/**
 * TextStrokeOrShadow — text with stroke (outline) effect
 * Uses -webkit-text-stroke for clean outlines on any background
 */
function renderTextStrokeOrShadow({
  text = '5 ПРИНЦИПОВ',
  fg = '#1A1A2E',
  strokeColor = '#FFFFFF',
  strokeWidth = 2,
  x = 60, y = 140, width = 960, height = 180,
  fontSize = 52,
  fontFamily = 'Georgia, serif',
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
      align-items: flex-start;
      padding-top: ${Math.round(height * 0.05)}px;
      box-sizing: border-box;
      overflow: hidden;
    ">
      <div style="
        font-family: ${fontFamily};
        font-size: ${fontSize}px;
        font-weight: ${fontWeight};
        line-height: ${lineHeight};
        color: ${fg};
        -webkit-text-stroke: ${strokeWidth}px ${strokeColor};
        -webkit-text-fill-color: ${fg};
        white-space: pre-wrap;
        padding: 0 4px;
      ">${text}</div>
    </div>`
  };
}

module.exports = { renderTextStrokeOrShadow };
