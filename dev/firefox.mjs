// Stock Firefox with Violentmonkey, for testing the script the way it runs
// for real (including Violentmonkey's content-mode fallback on x.com).
//
//   node dev/firefox.mjs start          launch Firefox (and the script server)
//   node dev/firefox.mjs install        install the script into Violentmonkey, tracking edits
//   node dev/firefox.mjs run <file>     run <file>'s default export: async ({ browser, page }) => result
//   node dev/firefox.mjs stop           quit Firefox
//
// State lives in .dev/: the Violentmonkey xpi and a persistent profile, so
// the x.com login and the installed script survive restarts.

import { spawn } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.dev');
const PROFILE = join(STATE, 'firefox-profile');
const XPI = join(STATE, 'violentmonkey.xpi');
const XPI_URL = 'https://addons.mozilla.org/firefox/downloads/latest/violentmonkey/latest.xpi';
const VM_ID = '{aecec67f-0d10-4fa7-b7c7-609a2db280cf}';
// Fixed so Violentmonkey's pages have a stable moz-extension:// origin.
const VM_UUID = '4b0f5bd5-4a49-4d0e-9f53-2b7a1f0c9e11';
const FIREFOX = process.env.FIREFOX ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const BIDI_PORT = 9223;
const BIDI_URL = `http://127.0.0.1:${BIDI_PORT}/`;
const SCRIPT_PORT = 8765;
const SCRIPT_URL = `http://localhost:${SCRIPT_PORT}/twitter-annoyances.user.js`;

const PREFS = {
  // Enable extensions dropped into the profile's extensions/ directory.
  'extensions.autoDisableScopes': 0,
  'extensions.enabledScopes': 15,
  'extensions.webextensions.uuids': JSON.stringify({ [VM_ID]: VM_UUID }),
  'browser.shell.checkDefaultBrowser': false,
  'browser.startup.homepage_override.mstone': 'ignore',
  'browser.aboutwelcome.enabled': false,
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'app.update.disabledForTesting': true,
  'remote.active-protocols': 1,
};

const isUp = async (url) => {
  try {
    await fetch(url, { method: 'HEAD' });
    return true;
  } catch {
    return false;
  }
};

const waitFor = async (check, what, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
    if (await check()) return;
  }
  throw new Error(`timed out waiting for ${what}`);
};

const connect = () =>
  puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${BIDI_PORT}/session`, protocol: 'webDriverBiDi' });

const start = async () => {
  mkdirSync(join(PROFILE, 'extensions'), { recursive: true });
  if (!existsSync(XPI)) {
    const res = await fetch(XPI_URL);
    if (!res.ok) throw new Error(`downloading Violentmonkey: HTTP ${res.status}`);
    await pipeline(res.body, createWriteStream(XPI));
  }
  copyFileSync(XPI, join(PROFILE, 'extensions', `${VM_ID}.xpi`));
  writeFileSync(
    join(PROFILE, 'user.js'),
    Object.entries(PREFS)
      .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
      .join('\n') + '\n',
  );

  if (!(await isUp(SCRIPT_URL))) {
    spawn('npx', ['-y', 'http-server', '-c-1', '-a', 'localhost', '-p', String(SCRIPT_PORT), '-s', ROOT], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    await waitFor(() => isUp(SCRIPT_URL), 'the script server');
  }

  if (await isUp(BIDI_URL)) return 'already running';
  spawn(FIREFOX, ['--profile', PROFILE, '--no-remote', '--remote-debugging-port', String(BIDI_PORT), 'https://x.com/home'], {
    detached: true,
    stdio: 'ignore',
    // Lets `install` click buttons in Violentmonkey's installer page.
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
  }).unref();
  await waitFor(() => isUp(BIDI_URL), 'Firefox');
  return 'started';
};

// Open the script URL; Violentmonkey intercepts it and opens its installer
// in a new tab. A connection only sees tabs that existed when it connected,
// so look for the installer with a fresh connection each time.
const findInstaller = async () => {
  const browser = await connect();
  const page = (await browser.pages()).find((p) => p.url().startsWith(`moz-extension://${VM_UUID}/confirm/`));
  if (page) return { browser, page };
  await browser.disconnect();
  return null;
};

const install = async () => {
  let found = await findInstaller();
  if (!found) {
    const browser = await connect();
    const page = await browser.newPage();
    await page.goto(SCRIPT_URL).catch(() => {});
    await browser.disconnect();
    await waitFor(async () => (found = await findInstaller()), 'the Violentmonkey installer', 30000);
  }
  const { browser, page } = found;
  try {
    // Violentmonkey 2.50's installer: tick "Reload tab", then "Track external edits".
    return await page.evaluate(async () => {
      const deadline = Date.now() + 15000;
      const find = (re) => [...document.querySelectorAll('button, label')].find((el) => re.test(el.textContent));
      while (!find(/track external edits/i) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      const reload = find(/reload tab/i)?.querySelector('input[type=checkbox]');
      if (reload && !reload.checked) reload.click();
      const track = find(/track external edits/i);
      if (!track) return `no "Track external edits" button; page text: ${document.body.innerText.slice(0, 300)}`;
      track.click();
      return 'tracking';
    });
  } finally {
    await browser.disconnect();
  }
};

const run = async (file) => {
  const fn = (await import(pathToFileURL(resolve(file)).href)).default;
  const browser = await connect();
  try {
    const pages = await browser.pages();
    const page = pages.find((p) => /^https:\/\/(x|twitter)\.com\//.test(p.url())) ?? pages[0] ?? (await browser.newPage());
    return await fn({ browser, page });
  } finally {
    await browser.disconnect();
  }
};

const stop = async () => {
  const browser = await connect();
  await browser.close();
  return 'stopped';
};

const [cmd, arg] = process.argv.slice(2);
const commands = { start, install, run: () => run(arg), stop };
if (!commands[cmd]) {
  console.error('usage: node dev/firefox.mjs start | install | run <file> | stop');
  process.exit(2);
}
const result = await commands[cmd]();
console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
process.exit(0);
