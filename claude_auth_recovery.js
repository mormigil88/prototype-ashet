// Восстановление OAuth Claude Code, когда channels-бот больше не может сам
// ответить в Telegram. Этот модуль запускается companion.js, а не Claude: он
// продолжает работать при "Not logged in".
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Ждём перевод строки после URL: stdout может прийти кусками, и нельзя
// отправлять частичную OAuth-ссылку после первого chunk.
const LOGIN_URL_RE = /https:\/\/claude\.com\/cai\/oauth\/authorize\?[^\s\x1b]+(?=\s)/;

class ClaudeAuthRecovery {
  constructor({
    chatId,
    sendLoginLink,
    sendStatus,
    stateFile = '/data/claude-home/auth-recovery-state.json',
    cooldownMs = 10 * 60 * 1000,
    spawnFn = spawn,
    now = () => Date.now(),
    logger = console,
  }) {
    this.chatId = String(chatId || '');
    this.sendLoginLink = sendLoginLink;
    this.sendStatus = sendStatus;
    this.stateFile = stateFile;
    this.cooldownMs = cooldownMs;
    this.spawnFn = spawnFn;
    this.now = now;
    this.logger = logger;
    this.child = null;
    this.linkSent = false;
    this.codeSubmitted = false;
    this.outputBuffer = '';
  }

  loadState() {
    try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch (_) { return {}; }
  }

  saveState(patch) {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify({ ...this.loadState(), ...patch }, null, 2));
    } catch (e) {
      this.logger.error('[auth-recovery] cannot persist state:', String(e.message || e));
    }
  }

  canStart() {
    if (!this.chatId || this.child) return false;
    const state = this.loadState();
    return !state.last_started_at || this.now() - state.last_started_at >= this.cooldownMs;
  }

  start() {
    if (!this.canStart()) return false;
    this.linkSent = false;
    this.codeSubmitted = false;
    this.outputBuffer = '';
    this.saveState({ status: 'starting', last_started_at: this.now() });

    // script создаёт pty, который нужен Claude Code. stdin остаётся pipe: туда
    // безопасно попадёт только код из команды /kimi-login нужного chat ID.
    // /dev/null намеренно: `script` иначе запишет OAuth-ссылку на persistent volume.
    this.child = this.spawnFn('script', ['-qec', 'claude auth login --claudeai', '/dev/null'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    this.child.stdout.on('data', (buf) => this.acceptOutput(buf.toString()));
    this.child.stderr.on('data', (buf) => this.acceptOutput(buf.toString()));
    this.child.on('error', (err) => this.finish(false, `Не удалось запустить восстановление входа: ${String(err.message || err)}`));
    this.child.on('exit', (code) => this.finish(code === 0));
    return true;
  }

  acceptOutput(text) {
    if (this.linkSent) return;
    this.outputBuffer = (this.outputBuffer + String(text)).slice(-16 * 1024);
    const match = this.outputBuffer.match(LOGIN_URL_RE);
    if (!match) return;
    this.linkSent = true;
    this.saveState({ status: 'waiting_for_code', link_sent_at: this.now() });
    // URL не пишем в логи и state: он одноразовый и должен существовать только
    // в личном Telegram-сообщении получателя.
    Promise.resolve(this.sendLoginLink(match[0])).catch((e) => {
      this.logger.error('[auth-recovery] cannot send login link:', String(e.message || e));
      this.linkSent = false;
    });
  }

  submitCode(chatId, text, receivedAt) {
    if (String(chatId) !== this.chatId || !this.child || !this.child.stdin.writable) return false;
    const state = this.loadState();
    // Старый код из transcript не годится для нового OAuth challenge.
    if (!state.link_sent_at || Number(receivedAt || 0) < state.link_sent_at || this.codeSubmitted) return false;
    const match = String(text || '').trim().match(/^\/kimi-login\s+([^\s<]{4,2048})$/i);
    if (!match) return false;
    // Никогда не логируем и не сохраняем OAuth-код.
    this.child.stdin.write(`${match[1]}\n`);
    this.codeSubmitted = true;
    this.saveState({ status: 'code_submitted', code_submitted_at: this.now() });
    return true;
  }

  finish(success, detail) {
    if (!this.child) return;
    this.child = null;
    this.saveState({ status: success ? 'complete' : 'failed', finished_at: this.now() });
    if (success) {
      Promise.resolve(this.sendStatus('✅ Вход Kimi восстановлен. Можно снова писать боту.')).catch(() => {});
    } else if (detail) {
      Promise.resolve(this.sendStatus(`⚠️ Не удалось запустить восстановление Kimi: ${detail}`)).catch(() => {});
    }
  }
}

module.exports = { ClaudeAuthRecovery, LOGIN_URL_RE };
