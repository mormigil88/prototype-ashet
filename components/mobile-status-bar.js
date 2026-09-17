/**
 * MobileStatusBar — explicit W, H
 */
function renderMobileStatusBar({ spec, W = 1080, H = 1350 }) {
  const fg = '#1F1F1F';
  const bg = '#FFFFFF';
  const h = 44;

  return {
    html: `<div style="
      position: absolute; top: 0; left: 0; width: ${W}px; height: ${h}px;
      background: ${bg};
      display: flex; align-items: flex-end; justify-content: space-between;
      padding: 0 24px 6px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px; font-weight: 600; color: ${fg};
      z-index: 10; box-sizing: border-box;
    "><span>9:41</span><span>📶 📡 🔋</span></div>`,
    height: h
  };
}

module.exports = { renderMobileStatusBar };
