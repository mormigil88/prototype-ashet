/**
 * AppHeader — explicit primary, fg, W, H, headerH
 */
function renderAppHeader({ primary = '#F2A82C', fg = '#FFFFFF', W = 1080, H = 1350, headerH = 120 }) {
  const avatarSize = 72;
  const y = 44; // status bar height

  return {
    html: `<div style="
      position: absolute; top: ${y}px; left: 0; width: ${W}px; height: ${headerH}px;
      background: ${primary};
      display: flex; align-items: center; padding: 0 16px;
      z-index: 9; box-sizing: border-box;
    ">
      <div style="
        width: ${avatarSize}px; height: ${avatarSize}px; border-radius: 50%;
        background: rgba(255,255,255,0.3);
        display: flex; align-items: center; justify-content: center;
        font-size: 32px; color: ${fg}; flex-shrink: 0;
      ">💬</div>
      <div style="flex:1; padding-left: 12px;">
        <div style="font-size:17px; font-weight:600; color:${fg};">Ассистент</div>
        <div style="font-size:13px; color:rgba(255,255,255,0.8);">В сети</div>
      </div>
      <div style="font-size:24px; color:${fg};">✕</div>
    </div>`,
    height: headerH
  };
}

module.exports = { renderAppHeader };
