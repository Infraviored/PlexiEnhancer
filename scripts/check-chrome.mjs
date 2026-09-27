#!/usr/bin/env node
// Smoke test: load build/chrome into a headless Chromium and confirm Chrome
// accepted it: the extension's own manifest.json must be served under its ID,
// and a declared background service worker must be running.
// Needs a Chromium-based browser; set CHROME=/path/to/binary to pick one.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'build', 'chrome');
if (!existsSync(join(ext, 'manifest.json'))) {
  console.error('build/chrome is missing, run `npm run build:chrome` first');
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const names = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome'];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    for (const n of names) {
      for (const f of [join(dir, n), join(dir, n + '.exe')]) if (dir && existsSync(f)) return f;
    }
  }
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].find(existsSync);
}
const bin = findChrome();
if (!bin) { console.error('no Chrome/Chromium found, set CHROME=/path/to/binary'); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), 'ext-check-'));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(bin, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`, `--load-extension=${ext}`, `--disable-extensions-except=${ext}`,
  // branded Chrome 137+ ignores --load-extension unless this feature is off
  '--disable-features=DisableLoadExtensionCommandLineSwitch', 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const cdp = path => fetch(`http://127.0.0.1:${port}${path}`, path.startsWith('/json/new') ? { method: 'PUT' } : {}).then(r => r.json());

// Chrome derives an unpacked extension's ID from its absolute path:
// sha256, first 32 hex digits, each mapped 0-f -> a-p. (Windows hashes UTF-16.)
const idSource = process.platform === 'win32' ? Buffer.from(ext, 'utf16le') : Buffer.from(ext);
const extId = [...createHash('sha256').update(idSource).digest('hex').slice(0, 32)].map(c => 'abcdefghijklmnop'[parseInt(c, 16)]).join('');

// Evaluate an expression in a page target over the DevTools websocket.
async function evaluate(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const reply = new Promise(res => { ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) res(m); }; });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  const m = await reply;
  ws.close();
  return m.result && m.result.result && m.result.result.value;
}

let ok = false, why = 'browser did not start';
const worker = manifest.background && manifest.background.service_worker;
try {
  for (let i = 0; i < 40 && !ok; i++) {
    await sleep(500);
    try {
      const targets = await cdp('/json/list');
      if (process.env.DEBUG) console.log(targets.map(t => t.type + ' ' + t.url));
      if (worker && !targets.some(t => t.type === 'service_worker' && t.url === `chrome-extension://${extId}/${worker}`)) {
        why = 'background service worker did not start';
        continue;
      }
      const page = await cdp(`/json/new?chrome-extension://${extId}/manifest.json`);
      await sleep(500);
      const text = await evaluate(page, 'document.body ? document.body.innerText : ""');
      await cdp(`/json/close/${page.id}`).catch(() => {});
      ok = typeof text === 'string' && text.includes(`"version": "${manifest.version}"`);
      why = ok ? '' : 'extension not loaded (manifest.json not served under ' + extId + ')';
    } catch { /* browser still starting */ }
  }
} finally {
  proc.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
console.log(ok ? `chrome: OK, ${manifest.name} ${manifest.version} loaded as ${extId}` : 'chrome: FAILED, ' + why);
process.exit(ok ? 0 : 1);
