#!/usr/bin/env node
/**
 * M14 bridge: Kimi saves its current final/provisional draft to Irina Content Hub.
 * No Telegram/Buffer/Toto credentials are read or used here.
 *
 * Usage:
 * CONTENT_HUB_URL=... KIMI_CONTENT_HUB_SECRET=... \
 * node content_hub_draft.js --thread-key chat:topic --title "..." --language ru --file /tmp/draft.txt
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const threadKey = value('--thread-key');
const title = value('--title');
const language = value('--language') || 'ru';
const file = value('--file');
const body = file ? fs.readFileSync(file, 'utf8') : value('--body');
const baseUrl = process.env.CONTENT_HUB_URL;
const secret = process.env.KIMI_CONTENT_HUB_SECRET;

if (!baseUrl || !secret || !threadKey || !body) {
  console.error('CONTENT_HUB_URL, KIMI_CONTENT_HUB_SECRET, --thread-key and --body/--file are required');
  process.exit(2);
}
const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/internal/kimi/drafts`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-kimi-content-hub-secret': secret },
  body: JSON.stringify({ thread_key: threadKey, title, language, body }),
});
if (!response.ok) {
  console.error(`Content Hub rejected draft: HTTP ${response.status}`);
  process.exit(1);
}
console.log('Draft saved to Content Hub');
