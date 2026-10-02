import nodeFs from 'node:fs';
import path from 'node:path';

// Margin Notes checks GitHub Releases for a newer signed build, asks before it
// downloads, and asks again before it restarts. Nothing here installs without a
// click: autoDownload and autoInstallOnAppQuit are both off.

export const FIRST_CHECK_DELAY_MS = 20_000;
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const FEED_ENV = 'MARGIN_UPDATE_FEED';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const NOTES_LIMIT = 900;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
function parseVersion(value) {
  const match = SEMVER.exec(String(value ?? '').trim());
  return match ? { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null } : null;
}

// True only for a stable release strictly newer than the running version. A
// downgrade, a repeat, a prerelease or anything that is not a version is refused,
// whatever the feed claims.
export function isNewerStable(candidate, current) {
  const next = parseVersion(candidate), now = parseVersion(current);
  if (!next || !now || next.pre) return false;
  for (let i = 0; i < 3; i++) if (next.core[i] !== now.core[i]) return next.core[i] > now.core[i];
  return Boolean(now.pre);
}

// Test-only feed override. It exists so a packaged build can be pointed at a
// local server, and it is deliberately narrow: plain http, a loopback host, no
// credentials. Anything else is ignored and the GitHub feed baked into the app
// (app-update.yml) stays in force. Unset, it does nothing at all.
export function feedOverride(env = process.env) {
  const raw = env[FEED_ENV];
  if (raw === undefined || raw === '') return null;
  let url;
  try { url = new URL(raw); } catch { return { rejected: `${FEED_ENV} is not a URL` }; }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password || !url.port) {
    return { rejected: `${FEED_ENV} must be http://127.0.0.1:<port>/ (or localhost, [::1]); it was ignored` };
  }
  return { url: `${url.origin}${url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`}` };
}

const ENTITIES = { '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&amp;': '&' };
// GitHub serves release notes as HTML; a native dialog shows plain text only.
export function releaseNotesText(notes, limit = NOTES_LIMIT) {
  let text = Array.isArray(notes) ? notes.map(item => item?.note ?? '').join('\n\n') : String(notes ?? '');
  text = text
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '\n• ')
    .replace(/<\s*\/\s*(p|div|h[1-6]|ul|ol|pre|blockquote|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|lt|gt|quot|#39|#x27|amp);/g, entity => ENTITIES[entity])
    .split('\n').map(line => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > limit) text = `${text.slice(0, limit).replace(/\s+\S*$/, '')}…`;
  return text;
}

function summarize(error) {
  const first = String(error?.message ?? error ?? 'Unknown error').split('\n')[0].trim();
  return first.length > 240 ? `${first.slice(0, 237)}…` : first;
}

const format = value => value instanceof Error ? (value.stack || value.message) : typeof value === 'string' ? value : JSON.stringify(value);
// One small rotating file, so a failed update can be diagnosed from a menu-bar app.
export function createLog({ file, fs = nodeFs, echo = console, maxBytes = 256 * 1024, now = () => new Date() }) {
  const write = (level, args) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try { if (fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`); } catch { /* No log yet. */ }
      fs.appendFileSync(file, `${now().toISOString()} ${level} ${args.map(format).join(' ')}\n`);
    } catch { /* Logging must never break the app. */ }
    echo?.[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log']?.('[updater]', ...args);
  };
  return { info: (...args) => write('INFO', args), warn: (...args) => write('WARN', args), error: (...args) => write('ERROR', args), debug() {} };
}

export function createUpdater({
  app, dialog, loadAutoUpdater, log = console, env = process.env, focus = null,
  beforeInstall = async () => {}, installAborted = () => {}, timers = { setTimeout, setInterval, clearTimeout, clearInterval }
}) {
  const enabled = Boolean(app.isPackaged) && !env.MARGIN_SMOKE_TEST;
  let updater = null, started = false, firstTimer = null, repeatTimer = null;
  let state = 'idle', readyVersion = null, declinedVersion = null, installing = false;

  async function show(options) {
    focus?.activate?.();
    try { return await dialog.showMessageBox({ type: 'info', noLink: true, buttons: ['OK'], defaultId: 0, ...options }); }
    finally { focus?.restore?.(); }
  }
  const tell = (message, detail) => show({ message, detail });
  const ask = (message, detail, buttons) => show({ message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 });

  async function configure() {
    if (updater) return updater;
    const candidate = await loadAutoUpdater();
    candidate.autoDownload = false;
    candidate.autoInstallOnAppQuit = false;
    candidate.allowDowngrade = false;
    candidate.allowPrerelease = false;
    candidate.logger = log;
    const override = feedOverride(env);
    if (override?.url) { candidate.setFeedURL({ provider: 'generic', url: override.url }); log.warn(`Update feed overridden for testing: ${override.url}`); }
    else if (override?.rejected) log.warn(override.rejected);
    candidate.on('error', error => {
      log.error('Updater error:', error);
      if (installing) void installFailed(error);
    });
    updater = candidate;
    return updater;
  }

  async function installFailed(error) {
    const version = readyVersion;
    installing = false; state = 'idle'; readyVersion = null; declinedVersion = version;
    try { installAborted(); } catch (failure) { log.error('Could not resume after a failed install:', failure); }
    await tell('The update could not be installed', `${summarize(error)}\n\nMargin Notes ${app.getVersion()} is unchanged and keeps running.`);
  }

  async function promptRestart(version) {
    const choice = await ask(`Margin Notes ${version} is ready to install`, 'Restart Margin Notes to finish updating. Your notes are saved automatically.', ['Restart Now', 'Later']);
    if (choice.response !== 0) return { status: 'ready', version };
    installing = true;
    try { await beforeInstall(); updater.quitAndInstall(); }
    catch (error) { log.error('Could not start the install:', error); await installFailed(error); return { status: 'install-failed', version }; }
    return { status: 'installing', version };
  }

  async function download(version) {
    state = 'downloading';
    try { await updater.downloadUpdate(); }
    catch (error) {
      state = 'idle'; declinedVersion = version; log.error('Download failed:', error);
      await tell('The update could not be downloaded', `${summarize(error)}\n\nMargin Notes ${app.getVersion()} is unchanged. Try again from Check for Updates.`);
      return { status: 'download-failed', version };
    }
    readyVersion = version; state = 'ready';
    return promptRestart(version);
  }

  // manual: the person chose "Check for Updates…". Background checks stay silent
  // unless a newer release exists, and never show an error.
  async function check({ manual = false } = {}) {
    if (!enabled) return { status: 'disabled' };
    if (installing) return { status: 'installing' };
    if (state === 'checking' || state === 'downloading') {
      if (manual) await tell(state === 'checking' ? 'Already checking for updates' : 'The update is still downloading', 'Margin Notes will ask before it restarts.');
      return { status: 'busy' };
    }
    if (state === 'ready') return manual ? promptRestart(readyVersion) : { status: 'ready', version: readyVersion };
    state = 'checking';
    let result;
    try { result = await (await configure()).checkForUpdates(); }
    catch (error) {
      state = 'idle'; log.error('Update check failed:', error);
      if (manual) await tell('Margin Notes could not check for updates', `${summarize(error)}\n\nCheck your connection and try again.`);
      return { status: 'error' };
    }
    state = 'idle';
    const info = result?.updateInfo;
    if (result == null) return { status: 'disabled' };
    if (!result.isUpdateAvailable || !isNewerStable(info?.version, app.getVersion())) {
      if (result.isUpdateAvailable) log.warn(`Ignored ${info?.version}: not a newer stable release than ${app.getVersion()}.`);
      if (manual) await tell("You're up to date", `Margin Notes ${app.getVersion()} is the newest version.`);
      return { status: 'current' };
    }
    const version = info.version;
    if (!manual && declinedVersion === version) return { status: 'declined', version };
    const notes = releaseNotesText(info.releaseNotes);
    const choice = await ask(`Margin Notes ${version} is available`, `You have ${app.getVersion()}.${notes ? `\n\n${notes}` : ''}`, ['Download', 'Later']);
    if (choice.response !== 0) { declinedVersion = version; return { status: 'later', version }; }
    return download(version);
  }

  function start() {
    if (!enabled || started) return false;
    started = true;
    const background = () => void check().catch(error => log.error('Background update check crashed:', error));
    firstTimer = timers.setTimeout(background, FIRST_CHECK_DELAY_MS);
    repeatTimer = timers.setInterval(background, CHECK_INTERVAL_MS);
    firstTimer?.unref?.(); repeatTimer?.unref?.();
    return true;
  }
  function stop() {
    timers.clearTimeout(firstTimer); timers.clearInterval(repeatTimer);
    firstTimer = repeatTimer = null; started = false;
  }
  // Preferences → Check for updates automatically. Off stops the schedule, so no
  // background request is made; Check for Updates… still works on demand.
  function setAutomatic(on) {
    if (on) return start();
    stop(); return false;
  }

  return { enabled, start, stop, setAutomatic, checkNow: () => check({ manual: true }), check };
}
