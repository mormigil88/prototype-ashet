/**
 * ChatBubble — explicit positioning, no spec dependency
 * text, direction, primary/secondary/textColor, x, y, width, height, borderRadius, hasShadow, fontSize
 */
function renderChatBubble({
  text = '',
  direction = 'incoming',
  primary = '#F2A82C',
  secondary = '#FBE3B1',
  textColor = '#1F1F1F',
  x = 16, y = 100, width = 600, height = 80,
  borderRadius = 18,
  hasShadow = true,
  fontSize = 16
}) {
  const isOut = direction === 'outgoing';
  const bubbleBg = isOut ? secondary : '#FFFFFF';
  const bubbleFg = textColor;
  const r = borderRadius;

  // Tail SVG
  const tail = isOut
    ? `<svg style="position:absolute;right:-7px;top:10px;width:10px;height:14px;z-index:1" viewBox="0 0 10 14"><path d="M0 0 L10 7 L0 14 Z" fill="${bubbleBg}"/></svg>`
    : `<svg style="position:absolute;left:-7px;top:10px;width:10px;height:14px;z-index:1" viewBox="0 0 10 14"><path d="M10 0 L0 7 L10 14 Z" fill="${bubbleBg}"/></svg>`;

  const shadow = hasShadow && !isOut ? 'box-shadow: 0 1px 4px rgba(0,0,0,0.12)' : '';

  return {
    html: `<div style="
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      min-height: ${height}px;
      background: ${bubbleBg};
      border-radius: ${r}px;
      padding: 10px 14px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: ${fontSize}px;
      line-height: 1.4;
      color: ${bubbleFg};
      box-sizing: border-box;
      ${shadow}
    ">${text}${tail}</div>`
  };
}

module.exports = { renderChatBubble };
