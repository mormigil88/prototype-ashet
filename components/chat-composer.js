/**
 * ChatComposer — explicit x, y, width, height, borderRadius, fontSize
 */
function renderChatComposer({
  textSec = '#7A7A7A',
  bg = '#F5F5F5',
  x = 16, y = 1200, width = 600, height = 80,
  borderRadius = 20,
  fontSize = 16
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
      display: flex; align-items: center; padding: 0 16px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: ${fontSize}px; color: ${textSec};
      box-sizing: border-box;
    ">
      <span style="font-size:22px;margin-right:12px;">📎</span>
      <span style="flex:1;">Напишите сообщение...</span>
      <span style="font-size:22px;">🎤</span>
    </div>`
  };
}

module.exports = { renderChatComposer };
