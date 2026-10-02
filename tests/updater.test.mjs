import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createUpdater, createLog, feedOverride, isNewerStable, releaseNotesText, CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS } from '../app/updater.mjs';

// A fake electron-updater: same surface the module touches, scripted results.
function fixture({ packaged = true, env = {}, version = '0.1.1', latest = '0.2.0', notes = '<p>Faster search.</p>', answers = [], check, download } = {}) {
  const events = [], shown = [], logs = [], timers = { set: [], interval: [], cleared: [] };
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: true, autoInstallOnAppQuit: true, allowDowngrade: true, allowPrerelease: true, logger: null,
    setFeedURL: options => events.push(['setFeedURL', options]),
    checkForUpdates: async () => {
      events.push(['check']);
      if (check) return check();
      return { isUpdateAvailable: latest !== version, updateInfo: { version: latest, releaseNotes: notes } };
    },
    downloadUpdate: async () => { events.push(['download']); if (download) return download(updater); return ['update.zip']; },
    quitAndInstall: () => events.push(['quitAndInstall'])
  });
  let loads = 0;
  const dialog = { showMessageBox: async options => { shown.push(options); return { response: answers.length ? answers.shift() : 0 }; } };
  const focus = { activate: () => events.push(['activate']), restore: () => events.push(['restore']) };
  const log = { info: (...a) => logs.push(['info', ...a]), warn: (...a) => logs.push(['warn', ...a]), error: (...a) => logs.push(['error', ...a]) };
  const fakeTimers = {
    setTimeout: (fn, ms) => { timers.set.push({ fn, ms }); return { unref() {} }; },
    setInterval: (fn, ms) => { timers.interval.push({ fn, ms }); return { unref() {} }; },
    clearTimeout: handle => timers.cleared.push(handle), clearInterval: handle => timers.cleared.push(handle)
  };
  const controller = createUpdater({
    app: { isPackaged: packaged, getVersion: () => version }, dialog, focus, log, env, timers: fakeTimers,
    loadAutoUpdater: async () => { loads++; return updater; },
    beforeInstall: async () => { events.push(['beforeInstall']); },
    installAborted: () => events.push(['installAborted'])
  });
  return { controller, updater, events, shown, logs, timers, answers, loads: () => loads, names: () => events.map(e => e[0]) };
}

test('version gate accepts only a newer stable release', () => {
  assert.equal(isNewerStable('0.1.2', '0.1.1'), true);
  assert.equal(isNewerStable('0.2.0', '0.1.9'), true);
  assert.equal(isNewerStable('1.0.0', '0.9.9'), true);
  assert.equal(isNewerStable('0.1.1', '0.1.1'), false, 'the running version is not an update');
  assert.equal(isNewerStable('0.1.0', '0.1.1'), false, 'no downgrades');
  assert.equal(isNewerStable('0.1.2-beta.1', '0.1.1'), false, 'no prereleases');
  assert.equal(isNewerStable('0.1.2-test', '0.1.1'), false);
  assert.equal(isNewerStable('0.1.2', '0.1.2-beta.1'), true, 'a stable release supersedes its own prerelease');
  assert.equal(isNewerStable('0.1.10', '0.1.9'), true, 'numeric comparison, not lexical');
  for (const bad of ['', null, undefined, 'latest', '1.0', 'v0.2.0', '0.2.0; rm -rf']) assert.equal(isNewerStable(bad, '0.1.1'), false, String(bad));
  assert.equal(isNewerStable('0.2.0', 'garbage'), false);
});

test('the feed override accepts only plain-http loopback addresses and is inert when unset', () => {
  assert.equal(feedOverride({}), null);
  assert.equal(feedOverride({ MARGIN_UPDATE_FEED: '' }), null);
  assert.deepEqual(feedOverride({ MARGIN_UPDATE_FEED: 'http://127.0.0.1:8123' }), { url: 'http://127.0.0.1:8123/' });
  assert.deepEqual(feedOverride({ MARGIN_UPDATE_FEED: 'http://localhost:8123/feed' }), { url: 'http://localhost:8123/feed/' });
  assert.deepEqual(feedOverride({ MARGIN_UPDATE_FEED: 'http://[::1]:8123/' }), { url: 'http://[::1]:8123/' });
  for (const hostile of [
    'https://127.0.0.1:8123/', 'http://example.com:8123/', 'http://127.0.0.1.evil.example:8123/', 'http://evil.example@127.0.0.1:8123/',
    'http://user:pass@127.0.0.1:8123/', 'http://127.0.0.1/', 'http://192.168.4.22:8123/', 'https://github.com/cxrobx/Margin/releases/', 'file:///tmp/feed/', 'not a url'
  ]) assert.ok(feedOverride({ MARGIN_UPDATE_FEED: hostile }).rejected, `${hostile} must be rejected`);
});

test('release notes become plain dialog text', () => {
  assert.equal(releaseNotesText('<h2>New</h2><ul><li>Search is faster</li><li>A &amp; B &lt;ok&gt;</li></ul><script>alert(1)</script>'), 'New\n\n• Search is faster\n• A & B <ok>');
  assert.equal(releaseNotesText([{ version: '0.2.0', note: '<p>One</p>' }, { version: '0.1.9', note: 'Two' }]), 'One\n\nTwo');
  assert.equal(releaseNotesText(undefined), '');
  assert.equal(releaseNotesText(null), '');
  assert.ok(releaseNotesText('word '.repeat(500)).length <= 901);
  assert.ok(releaseNotesText('word '.repeat(500)).endsWith('…'));
});

test('an unpackaged app never loads, schedules or shows anything', async () => {
  const f = fixture({ packaged: false });
  assert.equal(f.controller.enabled, false);
  assert.equal(f.controller.start(), false);
  assert.deepEqual(await f.controller.checkNow(), { status: 'disabled' });
  assert.deepEqual(await f.controller.check(), { status: 'disabled' });
  assert.equal(f.loads(), 0);
  assert.equal(f.timers.set.length + f.timers.interval.length, 0);
  assert.equal(f.shown.length, 0);
});

test('the smoke-test harness disables updates even in a packaged app', async () => {
  const f = fixture({ env: { MARGIN_SMOKE_TEST: '1' } });
  assert.equal(f.controller.enabled, false);
  assert.equal(f.controller.start(), false);
  assert.equal(f.loads(), 0);
});

test('a packaged app checks shortly after launch and then every 24 hours, once', async () => {
  const f = fixture({ latest: '0.1.1' });
  assert.equal(f.controller.start(), true);
  assert.equal(f.controller.start(), false, 'starting twice must not double the schedule');
  assert.equal(f.timers.set.length, 1); assert.equal(f.timers.interval.length, 1);
  assert.equal(f.timers.set[0].ms, FIRST_CHECK_DELAY_MS);
  assert.ok(FIRST_CHECK_DELAY_MS >= 5_000 && FIRST_CHECK_DELAY_MS <= 60_000, 'shortly after launch');
  assert.equal(f.timers.interval[0].ms, CHECK_INTERVAL_MS);
  assert.equal(CHECK_INTERVAL_MS, 24 * 60 * 60 * 1000);
  assert.equal(f.loads(), 0, 'nothing is loaded until the first check');
  f.timers.set[0].fn(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.names(), ['check']);
  assert.equal(f.shown.length, 0, 'an up-to-date background check is silent');
  f.controller.stop();
  assert.equal(f.timers.cleared.length, 2);
});

test('turning automatic checks off stops the schedule; the menu check still works', async () => {
  const f = fixture({ latest: '0.1.1' });
  assert.equal(f.controller.setAutomatic(true), true);
  assert.equal(f.controller.setAutomatic(true), false, 'already on: no second schedule');
  assert.equal(f.timers.set.length, 1); assert.equal(f.timers.interval.length, 1);
  assert.equal(f.controller.setAutomatic(false), false);
  assert.equal(f.timers.cleared.length, 2, 'both timers are cleared');
  assert.equal(f.loads(), 0, 'off before the first check means no request at all');
  await f.controller.checkNow();
  assert.ok(f.names().includes('check'), 'Check for Updates… still checks while automatic checks are off');
  assert.equal(f.controller.setAutomatic(true), true, 'turning it back on schedules again');
  assert.equal(f.timers.set.length, 2);
  f.controller.stop();
});

test('automatic checks do nothing in an unpackaged app', () => {
  const f = fixture({ packaged: false });
  assert.equal(f.controller.setAutomatic(true), false);
  assert.equal(f.timers.set.length, 0);
});

test('updater settings: nothing downloads or installs on its own, no downgrades, no prereleases', async () => {
  const f = fixture({ latest: '0.1.1' });
  await f.controller.check();
  assert.equal(f.updater.autoDownload, false);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowDowngrade, false);
  assert.equal(f.updater.allowPrerelease, false);
  assert.ok(f.updater.logger, 'the updater logs through Margin\'s logger');
  assert.equal(f.names().includes('setFeedURL'), false, 'without the override the feed baked into app-update.yml (GitHub) is used');
});

test('the feed override is applied only when valid, and says so in the log', async () => {
  const good = fixture({ latest: '0.1.1', env: { MARGIN_UPDATE_FEED: 'http://127.0.0.1:8123/' } });
  await good.controller.check();
  assert.deepEqual(good.events.find(e => e[0] === 'setFeedURL'), ['setFeedURL', { provider: 'generic', url: 'http://127.0.0.1:8123/' }]);
  assert.ok(good.logs.some(l => l[0] === 'warn' && /overridden/.test(l[1])));
  const bad = fixture({ latest: '0.1.1', env: { MARGIN_UPDATE_FEED: 'https://evil.example/' } });
  await bad.controller.check();
  assert.equal(bad.names().includes('setFeedURL'), false);
  assert.ok(bad.logs.some(l => l[0] === 'warn' && /ignored/.test(l[1])));
});

test('Check for Updates reports "up to date" when nothing is newer, and a background check does not', async () => {
  const f = fixture({ latest: '0.1.1' });
  assert.deepEqual(await f.controller.check(), { status: 'current' });
  assert.equal(f.shown.length, 0);
  assert.deepEqual(await f.controller.checkNow(), { status: 'current' });
  assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0].message, "You're up to date");
  assert.match(f.shown[0].detail, /0\.1\.1/);
  assert.deepEqual(f.shown[0].buttons, ['OK']);
});

test('a feed offering a downgrade or a prerelease is treated as up to date', async () => {
  for (const latest of ['0.1.0', '0.0.9', '0.2.0-beta.1', '0.2.0-test']) {
    const f = fixture({ latest, check: async () => ({ isUpdateAvailable: true, updateInfo: { version: latest } }) });
    assert.deepEqual(await f.controller.checkNow(), { status: 'current' }, latest);
    assert.equal(f.shown.length, 1); assert.equal(f.shown[0].message, "You're up to date");
    assert.equal(f.names().includes('download'), false);
  }
});

test('the full flow asks twice and installs only after the second yes', async () => {
  const f = fixture({ answers: [0, 0] });
  const result = await f.controller.checkNow();
  assert.deepEqual(result, { status: 'installing', version: '0.2.0' });
  assert.equal(f.shown.length, 2);
  assert.equal(f.shown[0].message, 'Margin Notes 0.2.0 is available');
  assert.match(f.shown[0].detail, /You have 0\.1\.1\./);
  assert.match(f.shown[0].detail, /Faster search\./);
  assert.deepEqual(f.shown[0].buttons, ['Download', 'Later']);
  assert.equal(f.shown[1].message, 'Margin Notes 0.2.0 is ready to install');
  assert.deepEqual(f.shown[1].buttons, ['Restart Now', 'Later']);
  const order = f.names().filter(name => ['check', 'download', 'beforeInstall', 'quitAndInstall'].includes(name));
  assert.deepEqual(order, ['check', 'download', 'beforeInstall', 'quitAndInstall']);
  assert.equal(f.events.filter(e => e[0] === 'download').length, 1);
});

test('"Later" on the first dialog downloads nothing and is not repeated by background checks', async () => {
  const f = fixture({ answers: [1] });
  assert.deepEqual(await f.controller.check(), { status: 'later', version: '0.2.0' });
  assert.equal(f.names().includes('download'), false);
  assert.equal(f.shown.length, 1);
  assert.deepEqual(await f.controller.check(), { status: 'declined', version: '0.2.0' });
  assert.equal(f.shown.length, 1, 'a declined version is not offered again in the background');
  f.answers.push(1);
  assert.equal((await f.controller.checkNow()).status, 'later');
  assert.equal(f.shown.length, 2, 'the menu item offers it again');
  assert.equal(f.names().includes('quitAndInstall'), false);
});

test('a newer release than the declined one is offered in the background', async () => {
  const f = fixture({ answers: [1, 1] });
  await f.controller.check();
  f.updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: '0.3.0' } });
  assert.equal((await f.controller.check()).status, 'later');
  assert.equal(f.shown[1].message, 'Margin Notes 0.3.0 is available');
});

test('"Later" on the restart dialog never installs, and the menu item asks again without re-checking', async () => {
  const f = fixture({ answers: [0, 1, 0] });
  assert.deepEqual(await f.controller.checkNow(), { status: 'ready', version: '0.2.0' });
  assert.equal(f.names().includes('quitAndInstall'), false);
  assert.equal(f.names().includes('beforeInstall'), false);
  assert.deepEqual(await f.controller.check(), { status: 'ready', version: '0.2.0' }, 'a background check does not nag');
  assert.equal(f.shown.length, 2);
  const checks = f.events.filter(e => e[0] === 'check').length;
  assert.equal((await f.controller.checkNow()).status, 'installing');
  assert.equal(f.shown.length, 3); assert.equal(f.shown[2].message, 'Margin Notes 0.2.0 is ready to install');
  assert.equal(f.events.filter(e => e[0] === 'check').length, checks, 'the downloaded update is reused');
  assert.equal(f.events.filter(e => e[0] === 'download').length, 1);
  assert.equal(f.events.filter(e => e[0] === 'quitAndInstall').length, 1);
});

test('dialogs take focus and give it back, in pairs', async () => {
  const f = fixture({ answers: [0, 1] });
  await f.controller.checkNow();
  const focusEvents = f.names().filter(name => name === 'activate' || name === 'restore');
  assert.deepEqual(focusEvents, ['activate', 'restore', 'activate', 'restore']);
});

test('background failures are logged and never shown', async () => {
  const f = fixture({ check: async () => { throw new Error('getaddrinfo ENOTFOUND github.com'); } });
  assert.deepEqual(await f.controller.check(), { status: 'error' });
  assert.equal(f.shown.length, 0);
  assert.ok(f.logs.some(l => l[0] === 'error' && /Update check failed/.test(l[1])));
  f.timers.set.length = 0; f.controller.start(); f.timers.set[0].fn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.shown.length, 0);
});

test('a failed manual check says so, once, without a stack trace', async () => {
  const f = fixture({ check: async () => { throw new Error('Cannot find latest-mac.yml\n    at stack line'); } });
  assert.deepEqual(await f.controller.checkNow(), { status: 'error' });
  assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0].message, 'Margin Notes could not check for updates');
  assert.match(f.shown[0].detail, /Cannot find latest-mac\.yml/);
  assert.doesNotMatch(f.shown[0].detail, /stack line/);
});

test('a failed download is reported, nothing installs, and the running app is unchanged', async () => {
  const f = fixture({ answers: [0], download: async () => { throw new Error('sha512 checksum mismatch'); } });
  assert.deepEqual(await f.controller.checkNow(), { status: 'download-failed', version: '0.2.0' });
  assert.equal(f.shown.length, 2);
  assert.equal(f.shown[1].message, 'The update could not be downloaded');
  assert.match(f.shown[1].detail, /sha512 checksum mismatch/);
  assert.equal(f.names().includes('quitAndInstall'), false);
  assert.deepEqual(await f.controller.check(), { status: 'declined', version: '0.2.0' }, 'a version that failed is not retried in the background');
});

test('an install the OS refuses (a bad signature) is reported and the app keeps running', async () => {
  const f = fixture({ answers: [0, 0] });
  f.updater.quitAndInstall = () => {
    f.events.push(['quitAndInstall']);
    setImmediate(() => f.updater.emit('error', new Error('Code signature at URL did not pass validation: code failed to satisfy specified code requirement(s)')));
  };
  assert.deepEqual(await f.controller.checkNow(), { status: 'installing', version: '0.2.0' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.shown.length, 3);
  assert.equal(f.shown[2].message, 'The update could not be installed');
  assert.match(f.shown[2].detail, /code requirement/);
  assert.match(f.shown[2].detail, /0\.1\.1 is unchanged/);
  assert.ok(f.names().includes('installAborted'));
  assert.deepEqual(await f.controller.check(), { status: 'declined', version: '0.2.0' });
});

test('a failure before the install begins is reported too', async () => {
  const f = fixture();
  const failing = createUpdater({
    app: { isPackaged: true, getVersion: () => '0.1.1' }, dialog: { showMessageBox: async o => (f.shown.push(o), { response: 0 }) }, log: { info() {}, warn() {}, error() {} },
    loadAutoUpdater: async () => f.updater, beforeInstall: async () => { throw new Error('editor would not flush'); }, installAborted: () => f.events.push(['installAborted'])
  });
  assert.equal((await failing.checkNow()).status, 'install-failed');
  assert.equal(f.names().includes('quitAndInstall'), false);
  assert.ok(f.names().includes('installAborted'));
  assert.equal(f.shown.at(-1).message, 'The update could not be installed');
});

test('overlapping checks do not start a second request', async () => {
  let release;
  const f = fixture({ check: () => new Promise(resolve => { release = () => resolve({ isUpdateAvailable: false, updateInfo: { version: '0.1.1' } }); }) });
  const first = f.controller.check();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await f.controller.check(), { status: 'busy' });
  assert.equal(f.shown.length, 0, 'a background check that finds one already running is silent');
  assert.deepEqual(await f.controller.checkNow(), { status: 'busy' });
  assert.equal(f.shown.length, 1); assert.equal(f.shown[0].message, 'Already checking for updates');
  release(); await first;
  assert.equal(f.events.filter(e => e[0] === 'check').length, 1);
});

test('the log file is timestamped, rotates, and survives an unwritable folder', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'margin-log-'));
  try {
    const file = path.join(dir, 'logs', 'updater.log');
    const echoed = [];
    const log = createLog({ file, maxBytes: 200, echo: { log: (...a) => echoed.push(a), warn() {}, error() {} }, now: () => new Date('2026-09-30T12:00:00Z') });
    log.info('Checking for update'); log.error(new Error('boom'));
    const text = readFileSync(file, 'utf8');
    assert.match(text, /^2026-09-30T12:00:00.000Z INFO Checking for update\n2026-09-30T12:00:00.000Z ERROR Error: boom/);
    for (let i = 0; i < 10; i++) log.info('x'.repeat(40));
    assert.ok(existsSync(`${file}.1`), 'an oversized log is rotated');
    assert.deepEqual(echoed[0], ['[updater]', 'Checking for update']);
    const blocker = path.join(dir, 'file'); writeFileSync(blocker, '');
    assert.doesNotThrow(() => createLog({ file: path.join(blocker, 'nested', 'updater.log'), echo: null }).error('cannot write'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
