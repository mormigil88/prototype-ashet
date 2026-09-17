/**
 * KeyboardPlaceholder — explicit x, y, width, height, fontSize
 * Simplified: 3 rows of keys, all fitting within bounds
 */
function renderKeyboardPlaceholder({
  primary = '#F2A82C',
  textColor = '#1F1F1F',
  x = 0, y = 1100, width = 1080, height = 220,
  fontSize = 16
}) {
  const keyW = Math.round(width / 11) - 4;
  const keyH = 42;
  const keyR = 5;
  const rows = [
    'Й Ц У К Е Н Г Ш Щ З Х Ъ'.split(' '),
    'Ф Ы В А П Р О Л Д Ж Э'.split(' '),
    ['⇧', 'Я Ч С М И Т Ь Б Ю', '⌫']
  ];

  const makeKey = (label, isAccent = false) =>
    `<div style="
      width:${keyW}px;height:${keyH}px;
      background:${isAccent ? primary : '#FFFFFF'};
      border-radius:${keyR}px;
      border:1px solid #ccc;
      display:flex;align-items:center;justify-content:center;
      font-size:${Math.round(fontSize * 0.9)}px;
      font-family:-apple-system,sans-serif;
      color:${isAccent ? '#FFF' : textColor};
      box-sizing:border-box;margin:2px;
      flex-shrink:0;
    ">${label}</div>`;

  const makeRow = (keys) =>
    `<div style="display:flex;gap:${Math.round(width * 0.005)}px;justify-content:center;margin:${Math.round(height * 0.02)}px 0;">${
      keys.map(k => {
        const isAccent = typeof k === 'string' && k.length > 1;
        // Merge multi-char keys like "Я Ч С М И Т Ь Б Ю"
        if (k.includes(' ')) {
          const chars = k.split(' ');
          const subW = keyW * chars.length + (chars.length - 1) * 4;
          return `<div style="display:flex;gap:2px;flex-shrink:0;"><div style="width:${subW}px;height:${keyH}px;background:${primary};border-radius:${keyR}px;display:flex;align-items:center;justify-content:center;font-size:${Math.round(fontSize*0.8)}px;color:#FFF;font-family:-apple-system,sans-serif;margin:2px;box-sizing:border-box;">${chars.join('')}</div></div>`;
        }
        return makeKey(k, isAccent);
      }).join('')
    }</div>`;

  return {
    html: `<div style="
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      background: #D1D4DC;
      display: flex; flex-direction: column; justify-content: flex-end;
      padding-bottom: ${Math.round(height * 0.04)}px;
      box-sizing: border-box;
    ">${rows.map(makeRow).join('')}</div>`
  };
}

module.exports = { renderKeyboardPlaceholder };
