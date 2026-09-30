import { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, screen, nativeImage, nativeTheme, clipboard, dialog, shell, protocol } from 'electron';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { iconCandidates } from './icon-images.mjs';
import { NoteStore, defaultDataDir } from '../shared/store.mjs';
import { noteHistory, restoreNoteVersion, duplicateNote, prepareBackup, applyBackup, listBackups, exportBackup, importMarkdown, exportMarkdown, collectMarkdown, safeName } from '../shared/notebook-features.mjs';
import { noteLink, noteIdFromLink } from '../shared/note-links.mjs';
import { connectionInfo } from '../shared/connections.mjs';
import { fetchVaultTheme } from './vault-theme.mjs';
import { PanelMotion } from './panel-motion.mjs';
import { WindowMaterial } from './window-material.mjs';
import { AppFocus } from './app-focus.mjs';
import { MONOKAI_SODA_THEME } from '../shared/themes.mjs';
import { parseAppLink } from '../shared/app-links.mjs';
import { createLinkOpener, installedLinkApps } from './document-links.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
app.setName('Margin Notes');
if (process.platform === 'darwin') app.setActivationPolicy('accessory');
if (!app.isPackaged) app.setPath('userData', path.join(root, '.dev-profile'));
if (process.env.MARGIN_SMOKE_TEST) app.setPath('userData', path.join(process.env.MARGIN_DATA_DIR, 'electron-profile'));
if (!app.isPackaged && !process.env.MARGIN_DATA_DIR) process.env.MARGIN_DATA_DIR = path.join(root, '.margin-data');
protocol.registerSchemesAsPrivileged([{ scheme: 'margin', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!app.requestSingleInstanceLock()) app.quit();
let win, tray, store, settings, timer, edgeTimer, vaultTimer, vaultPalette, quitting = false, revision = -1, errorReported = false;
let vaultStatus = { connected: false, checkedAt: null };
const vaultRequests = new Map();
const edgeBars = new Map();
let panelDisplayId, panelMotion, windowMaterial, appFocus, panelReady = false;
let edgeEnteredAt = null, lastHideAt = 0, quitRequested = false;
const backupPlans = new Map();
const linkLaunches = [];
const linkOpener = createLinkOpener({ openExternal: value => shell.openExternal(value), ...(process.env.MARGIN_LINK_SMOKE_TEST ? { launch: async (application, value) => { linkLaunches.push({ application, value }); } } : {}) });
let pendingNoteLink = process.argv.find(value => value.startsWith('margin://note/'));
async function openNoteLink(value) {
  try {
    const id = noteIdFromLink(value);
    if (!panelReady || !store) { pendingNoteLink = value; return; }
    const state = await store.read(); store.find(state, id, true);
    show(); win.webContents.send('notes:open', id);
  } catch (error) { dialog.showErrorBox('Could not open note', error.message); }
}
app.on('open-url', (event, url) => { event.preventDefault(); void openNoteLink(url); });

function position(displayId = panelDisplayId) {
  const display = screen.getAllDisplays().find(d => d.id === displayId) || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  panelDisplayId = display.id;
  const area = display.workArea;
  const width = Math.min(380, area.width);
  win.setBounds({ x: settings.edge === 'right' ? area.x + area.width - width - 8 : area.x + 8, y: area.y + 8, width, height: Math.max(100, area.height - 16) });
}
function show(displayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id) {
  if (!panelReady) return;
  if (!win.isVisible()) position(displayId);
  for (const bar of edgeBars.values()) bar.hide();
  panelMotion.request(true, settings.edge);
}
async function flushEditor() {
  if (!win || win.isDestroyed() || win.webContents.isLoadingMainFrame()) return true;
  let timeout;
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(`(async () => {
        const detail = {};
        window.dispatchEvent(new CustomEvent('margin:flush-note', { detail }));
        return (await detail.pending) !== false;
      })()`),
      new Promise(resolve => { timeout = setTimeout(() => resolve(false), 3000); })
    ]);
  } catch (error) { console.error('Could not flush the editor:', error); return false; }
  finally { clearTimeout(timeout); }
}
function hide() { void flushEditor(); lastHideAt = Date.now(); panelMotion.request(false, settings.edge); }
function toggle() { panelMotion.visible ? hide() : show(); }
function applySettings() {
  const source = settings.themeId === 'vault' && vaultPalette ? vaultPalette.mode : settings.themeId === MONOKAI_SODA_THEME.id ? 'dark' : settings.theme;
  if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
  windowMaterial.update(settings);
  win.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (process.platform === 'darwin') win.setHiddenInMissionControl(true);
}
function syncEdgeBars() {
  if (quitting) return;
  const displays = screen.getAllDisplays();
  for (const [id, bar] of edgeBars) if (!displays.some(d => d.id === id)) { bar.destroy(); edgeBars.delete(id); }
  if (!settings.showEdgeTab) { for (const bar of edgeBars.values()) bar.hide(); return; }
  for (const display of displays) {
    let bar = edgeBars.get(display.id);
    if (!bar) {
      bar = new BrowserWindow({
        width: 12, height: 88, frame: false, transparent: true, show: false,
        type: process.platform === 'darwin' ? 'panel' : 'normal', focusable: false,
        resizable: false, movable: false, minimizable: false, maximizable: false,
        fullscreenable: false, skipTaskbar: true, hasShadow: false,
        webPreferences: { preload: path.join(root, 'app/edge-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
      });
      if (process.platform === 'darwin') { bar.setWindowButtonVisibility(false); bar.setHiddenInMissionControl(true); }
      bar.setAlwaysOnTop(true, 'floating');
      bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      bar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      bar.webContents.on('will-navigate', event => event.preventDefault());
      const readyBar = bar;
      bar.once('ready-to-show', () => { readyBar.webContents.send('edge:side', settings.edge); if (settings.showEdgeTab && panelReady && !win.isVisible() && !quitting) readyBar.showInactive(); });
      edgeBars.set(display.id, bar);
      bar.loadFile(path.join(root, 'app/edge.html'));
    }
    const bounds = display.bounds;
    const area = display.workArea;
    bar.setBounds({ x: settings.edge === 'right' ? bounds.x + bounds.width - 12 : bounds.x, y: Math.round(area.y + (area.height - 88) / 2), width: 12, height: 88 });
    bar.webContents.send('edge:side', settings.edge);
    if (panelReady && !win.isVisible()) bar.showInactive(); else bar.hide();
  }
}
async function publish() {
  try {
    const state = await store.read();
    if (state.revision !== revision) {
      const oldEdge = settings.edge, oldEdgeTab = settings.showEdgeTab;
      revision = state.revision; settings = state.settings; vaultPalette = state.vaultTheme.palette; applySettings();
      if (settings.edge !== oldEdge) position();
      if (settings.edge !== oldEdge || settings.showEdgeTab !== oldEdgeTab) syncEdgeBars();
      win.webContents.send('notes:changed', state);
    }
    errorReported = false;
  } catch (e) {
    if (!errorReported) { errorReported = true; dialog.showErrorBox('Margin could not read your notes', e.message); }
  }
}
async function refreshVaultTheme() {
  const address = settings.vaultAddress;
  if (vaultRequests.has(address)) return vaultRequests.get(address);
  const request = (async () => {
    const palette = await fetchVaultTheme(address);
    if (quitting || settings.vaultAddress !== address) return vaultStatus;
    if (palette) await store.cacheVaultTheme(palette, address);
    vaultStatus = { connected: Boolean(palette), checkedAt: new Date().toISOString() };
    await publish();
    if (!win.isDestroyed()) win.webContents.send('vault:status', vaultStatus);
    return vaultStatus;
  })();
  vaultRequests.set(address, request);
  try { return await request; } finally { vaultRequests.delete(address); }
}
function register(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted caller');
    try { const result = await fn(...args); await publish(); return { ok: true, value: result }; }
    catch (e) { return { ok: false, error: e.message, conflict: e.name === 'ConflictError' }; }
  });
}

app.whenReady().then(async () => {
if (process.env.MARGIN_SMOKE_TEST) console.log('Smoke: Electron ready');
try { store = await new NoteStore(defaultDataDir()).init(); const state = await store.read(); settings = state.settings; vaultPalette = state.vaultTheme.palette; }
catch (e) { dialog.showErrorBox('Margin could not open your notes', e.message); app.quit(); }
if (store && settings) {
  if (process.env.MARGIN_SMOKE_TEST) console.log('Smoke: storage ready');
  protocol.handle('margin', async request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'attachment' || !/^\/[a-f0-9-]{36}$/.test(url.pathname)) return new Response('Not found', { status: 404 });
      const attachment = await store.attachmentPath(url.pathname.slice(1));
      if (!attachment.mime.startsWith('image/')) return new Response('Not an image', { status: 403 });
      return new Response(await fs.readFile(attachment.path), { headers: { 'Content-Type': attachment.mime, 'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  win = new BrowserWindow({
    width: 380, height: 800, show: false, frame: false, transparent: true,
    type: process.platform === 'darwin' ? 'panel' : 'normal',
    title: 'Margin Notes', backgroundColor: '#00000000', roundedCorners: true,
    resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: true,
    ...(process.platform === 'darwin' ? { vibrancy: 'sidebar', visualEffectState: 'active' } : {}),
    webPreferences: { preload: path.join(root, 'app/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  windowMaterial = new WindowMaterial(win, nativeTheme);
  appFocus = new AppFocus();
  panelMotion = new PanelMotion(win, { material: windowMaterial, focus: appFocus, reducedMotion: () => nativeTheme.prefersReducedMotion, hidden: syncEdgeBars });
  if (process.platform === 'darwin') win.setWindowButtonVisibility(false);
  if (process.env.MARGIN_SMOKE_TEST) win.webContents.on('console-message', event => console.log('Renderer:', event.message));
  position(); applySettings();
  nativeTheme.on('updated', () => {
    if (quitting || win.isDestroyed()) return;
    windowMaterial.update(settings);
    win.webContents.send('appearance:preferences', { reducedTransparency: nativeTheme.prefersReducedTransparency });
  });
  register('appearance:preferences', () => ({ reducedTransparency: nativeTheme.prefersReducedTransparency }));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.on('close', event => { if (!quitting) { event.preventDefault(); hide(); } });
  win.on('hide', () => { if (panelReady) syncEdgeBars(); });
  // Clicking back into the open panel makes it key without activating Margin.
  win.on('focus', () => { if (panelMotion.visible) appFocus.activate(); });
  win.on('focus', () => { if (settings.themeId === 'vault') refreshVaultTheme().catch(console.error); });
  for (const [channel, method] of [['panel:motion-ready', 'ready'], ['panel:motion-finished', 'finish']]) {
    ipcMain.on(channel, (event, id) => {
      if (event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && Number.isInteger(id)) panelMotion[method](id);
    });
  }
  win.once('ready-to-show', () => {
    panelReady = true; syncEdgeBars();
    if (process.argv.includes('--show-panel')) show();
    if (pendingNoteLink) { const link = pendingNoteLink; pendingNoteLink = null; void openNoteLink(link); }
  });
  app.on('second-instance', (_event, argv) => { const link = argv.find(value => value.startsWith('margin://note/')); if (link) void openNoteLink(link); else show(); });
  if (app.isPackaged && !process.env.MARGIN_SMOKE_TEST) app.setAsDefaultProtocolClient('margin');
  app.on('activate', () => { if (panelReady) show(); });
  const screenChanged = () => { position(); syncEdgeBars(); };
  screen.on('display-added', screenChanged);
  screen.on('display-removed', screenChanged);
  screen.on('display-metrics-changed', screenChanged);
  ipcMain.on('panel:open', event => {
    for (const [displayId, bar] of edgeBars) {
      if (event.sender === bar.webContents && event.senderFrame === bar.webContents.mainFrame) { show(displayId); return; }
    }
  });
  const trayIcon = nativeImage.createFromPath(path.join(root, 'assets/trayTemplate.png'));
  if (trayIcon.isEmpty()) throw new Error('The menu bar icon could not be loaded.');
  trayIcon.setTemplateImage(true); tray = new Tray(trayIcon); tray.setToolTip('Margin Notes');
  const newNote = () => { show(); win.webContents.send('app:new'); };
  // Consume this once before either the renderer or native menu handles it.
  win.webContents.on('before-input-event', (event, input) => {
    const command = process.platform === 'darwin' ? input.meta : input.control;
    if (input.type === 'keyDown' && command && !input.shift && !input.alt && input.key.toLowerCase() === 'n') {
      event.preventDefault();
      if (!input.isAutoRepeat) newNote();
    }
  });
  const trayMenu = Menu.buildFromTemplate([
    { label: 'Show / hide Margin', click: toggle },
    { label: 'New note', click: newNote },
    { label: 'Capture clipboard', click: async () => {
      const text = await clipboard.readText();
      if (text.trim()) { await store.create({ title: text.split('\n')[0].slice(0, 80), body: text, source: 'Clipboard' }); await publish(); show(); }
    } },
    { type: 'separator' }, { label: 'Quit Margin', click: () => app.quit() }
  ]);
  tray.on('click', toggle);
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Margin Notes', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Show / hide', accelerator: 'CmdOrCtrl+Shift+Space', click: toggle }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [{ id: 'new-note', label: 'New Note', accelerator: 'CmdOrCtrl+N', click: newNote }] },
    { label: 'Edit', submenu: [{ id: 'undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => win.webContents.send('app:edit-command', 'undo') }, { id: 'redo', label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => win.webContents.send('app:edit-command', 'redo') }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] }
  ]));
  if (!globalShortcut.register('CommandOrControl+Shift+Space', toggle)) console.error('⌘ ⇧ Space is unavailable. Open Margin from the menu bar.');
  register('notes:snapshot', () => store.read());
  register('notebook:demo', enabled => store.setDemoMode(enabled));
  register('notebook:reset', expectedRevision => store.resetNotebook(expectedRevision));
  register('notes:create', input => store.create(input));
  register('notes:update', (id, input) => store.update(id, { ...input, source: 'You' }));
  register('notes:duplicate', id => duplicateNote(store, id));
  register('notes:history', id => noteHistory(store, id));
  register('notes:restore-version', (id, version, revision) => {
    if (!Number.isInteger(version) || !Number.isInteger(revision) || revision < 1) throw new Error('Reload note history before restoring.');
    return restoreNoteVersion(store, id, version, revision);
  });
  register('notes:copy-link', id => { noteLink(id); return clipboard.writeText(noteLink(id)); });
  register('notes:reorder', (id, targetId, placement) => store.reorderNote(id, targetId, placement));
  register('sections:appearance', (id, input) => store.setSectionAppearance(id, input));
  register('icons:choose', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Choose an icon', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }] });
    return result.canceled || !result.filePaths.length ? null : iconCandidates(result.filePaths[0]);
  });
  register('folders:reorder', (id, targetId, placement) => store.reorderTab(id, targetId, placement));
  register('notes:trash', id => store.trash(id));
  register('notes:restore', id => store.restore(id));
  register('notes:task', (id, line, done, expectedRevision) => store.toggleTask(id, line, done, expectedRevision));
  register('folders:create', (name, color) => store.createFolder(name, color));
  register('folders:rename', (id, name) => store.renameFolder(id, name));
  register('folders:delete', id => store.deleteFolder(id));
  register('settings:set', async patch => {
    if (patch.cxtasksLinks === true && !(await installedLinkApps()).cxtasks) throw new Error('Install CXTasks to enable task links.');
    const oldEdge = settings.edge, oldEdgeTab = settings.showEdgeTab, oldAddress = settings.vaultAddress;
    settings = await store.setSettings(patch);
    if (oldAddress !== settings.vaultAddress) { vaultPalette = null; vaultStatus = { connected: false, checkedAt: null }; win.webContents.send('vault:status', vaultStatus); }
    applySettings(); if (settings.edge !== oldEdge) position();
    if (settings.edge !== oldEdge || settings.showEdgeTab !== oldEdgeTab) syncEdgeBars();
    if (settings.themeId === 'vault') refreshVaultTheme().catch(console.error);
    return settings;
  });
  register('themes:vault', refresh => refresh ? refreshVaultTheme() : vaultStatus);
  register('themes:save', (name, id) => store.saveVaultTheme(name, id));
  register('themes:delete', id => store.deleteTheme(id));
  register('app:connections', () => connectionInfo(process.execPath, path.join(root, 'server/index.mjs'), store.dir, true));
  register('notes:attach', async id => {
    const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    if (result.canceled) return null;
    let note;
    for (const file of result.filePaths) note = await store.attach(id, file);
    return note;
  });
  register('notes:drop', async (id, files) => {
    if (!Array.isArray(files) || files.length > 20) throw new Error('Drop up to 20 files at once.');
    let note;
    for (const file of files) note = await store.attach(id, file);
    return note;
  });
  register('app:attachment', async id => {
    const file = await store.attachmentPath(id);
    const error = await shell.openPath(file.path); if (error) throw new Error(error);
  });
  register('app:link', async (value, preferred) => {
    const link = parseAppLink(value);
    if (link.kind === 'note') { await openNoteLink(link.href); return; }
    if (link.kind === 'task' && !settings.cxtasksLinks) throw new Error('Enable CXTasks links in Preferences to open a task reference.');
    await linkOpener.open(value, preferred);
  });
  register('app:link-apps', async () => {
    const installed = await installedLinkApps({ refresh: true });
    return { cxtasks: Boolean(installed.cxtasks) };
  });
  register('app:link-menu', async value => {
    const info = await linkOpener.describe(value);
    if (info.kind !== 'document') return info;
    const open = id => linkOpener.open(value, id).catch(error => dialog.showErrorBox('Could not open document', error.message));
    const menu = Menu.buildFromTemplate([
      ...info.choices.map(choice => ({ label: `Open in ${choice.name}`, click: () => void open(choice.id) })),
      ...(!info.choices.length ? [{ label: 'Install Onyx or Obsidian to open', enabled: false }] : []),
      { type: 'separator' },
      { label: 'Copy document path', click: () => clipboard.writeText(info.path) },
      { label: 'Reveal in Finder', click: () => shell.showItemInFolder(info.path) }
    ]);
    if (!process.env.MARGIN_LINK_SMOKE_TEST) menu.popup({ window: win });
    return info;
  });
  register('app:data', () => shell.openPath(store.dir));
  register('app:copy', text => { if (typeof text !== 'string') throw new Error('Invalid clipboard text'); return clipboard.writeText(text); });
  register('app:native-edit', action => { if (!['undo', 'redo'].includes(action)) throw new Error('Invalid editing action.'); win.webContents[action](); });
  register('app:hide', hide);
  register('app:export', async () => {
    const result = await dialog.showSaveDialog(win, { defaultPath: `margin-notes-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'Margin backup', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, JSON.stringify(await exportBackup(store), null, 2), { mode: 0o600 }); return result.filePath;
  });
  const previewBackup = async file => {
    const plan = await prepareBackup(store, file); const state = await store.read();
    const token = crypto.randomUUID();
    backupPlans.clear(); backupPlans.set(token, { plan, revision: state.revision });
    return { token, revision: state.revision, name: plan.name, count: plan.notebook.notes.length, trash: plan.notebook.notes.filter(note => note.deletedAt).length, folders: plan.notebook.folders.map(folder => folder.name), titles: plan.notebook.notes.slice(0, 50).map(note => note.title) };
  };
  register('notebook:prepare-import', async () => {
    if (!await flushEditor()) throw new Error('Finish or resolve your current edit before importing a backup.');
    const result = await dialog.showOpenDialog(win, { title: 'Import a Margin backup', properties: ['openFile'], filters: [{ name: 'Margin backup', extensions: ['json'] }] });
    return result.canceled ? null : previewBackup(result.filePaths[0]);
  });
  register('notebook:backups', () => listBackups(store));
  register('notebook:preview-backup', async name => {
    if (!await flushEditor()) throw new Error('Finish or resolve your current edit before restoring a backup.');
    if (!/^\d+-\d+-[a-f0-9]+\.json$/.test(name)) throw new Error('Invalid backup.');
    return previewBackup(path.join(store.dir, 'backups', name));
  });
  register('notebook:apply-import', async (token, mode) => {
    const entry = backupPlans.get(token); if (!entry) throw new Error('Preview the backup again before importing.');
    const result = await applyBackup(store, entry.plan, mode, entry.revision); backupPlans.delete(token); return result;
  });
  register('markdown:import', async (folderId, directory = false) => {
    const result = await dialog.showOpenDialog(win, { title: directory ? 'Import a Markdown folder' : 'Import Markdown notes', properties: directory ? ['openDirectory'] : ['openFile', 'multiSelections'], ...(directory ? {} : { filters: [{ name: 'Markdown and text', extensions: ['md', 'markdown', 'txt'] }] }) });
    if (result.canceled) return null;
    return importMarkdown(store, directory ? await collectMarkdown(result.filePaths[0]) : result.filePaths, folderId, directory);
  });
  register('markdown:drop', (files, folderId) => importMarkdown(store, files, folderId));
  register('markdown:export', async ({ noteId, folderId } = {}) => {
    await flushEditor();
    if (noteId) {
      const note = await store.get(noteId);
      const result = await dialog.showSaveDialog(win, { defaultPath: `${safeName(note.title)}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
      return result.canceled || !result.filePath ? null : exportMarkdown(store, result.filePath, { noteId });
    }
    const result = await dialog.showOpenDialog(win, { title: 'Choose where to export Markdown', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    const destination = path.join(result.filePaths[0], `Margin-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    return exportMarkdown(store, destination, { folderId });
  });
  timer = setInterval(publish, 700);
  vaultTimer = setInterval(() => { if (settings.themeId === 'vault') refreshVaultTheme().catch(console.error); }, 60_000);
  edgeTimer = setInterval(() => {
    if (!settings.hotEdge || win.isVisible() || Date.now() - lastHideAt < 1500) { edgeEnteredAt = null; return; }
    const cursor = screen.getCursorScreenPoint(); const bounds = screen.getDisplayNearestPoint(cursor).bounds;
    const atEdge = settings.edge === 'right' ? cursor.x >= bounds.x + bounds.width - 2 : cursor.x <= bounds.x + 1;
    if (!atEdge) { edgeEnteredAt = null; return; }
    if (edgeEnteredAt === null) edgeEnteredAt = Date.now();
    if (Date.now() - edgeEnteredAt >= 450) { show(); edgeEnteredAt = null; }
  }, 150);
  const devUrl = process.env.MARGIN_DEV_URL;
  if (process.env.MARGIN_SMOKE_TEST) console.log('Smoke: loading renderer');
  if (devUrl) await win.loadURL(devUrl); else await win.loadFile(path.join(root, 'dist/index.html'));
  if (settings.themeId === 'vault') refreshVaultTheme().catch(console.error);
  if (process.env.MARGIN_SMOKE_TEST) console.log('Smoke: renderer loaded');
  if (process.env.MARGIN_SMOKE_TEST) {
    const { runSmoke } = await import(process.env.MARGIN_LINK_SMOKE_TEST ? '../scripts/links-smoke.mjs' : process.env.MARGIN_FEATURE_SMOKE_TEST ? '../scripts/features-smoke.mjs' : '../scripts/smoke.mjs');
    try { await runSmoke(win, store, { edgeBars, show, hide, toggle, motion: panelMotion, material: windowMaterial, linkLaunches }); app.quit(); }
    catch (e) {
      console.error(e);
      try {
        await fs.writeFile(path.join(process.env.MARGIN_ARTIFACTS_DIR || path.join(root, 'artifacts'), 'margin-smoke-failure.png'), (await win.webContents.capturePage()).toPNG());
        console.log('Editor failure context:', await win.webContents.executeJavaScript(`({title:document.querySelector('.editor-title')?.value, body:document.querySelector('.rich-body')?.editor?.getMarkdown(), editor:document.querySelector('.rich-body')?.innerHTML})`));
      } catch {}
      quitting = true; app.exit(1);
    }
  }
}
}).catch(e => {
  console.error(e);
  if (process.env.MARGIN_SMOKE_TEST) app.exit(1);
  else { dialog.showErrorBox('Margin could not start', e.message); app.quit(); }
});
app.on('before-quit', event => {
  if (!quitting && win && !win.isDestroyed() && panelReady) {
    event.preventDefault();
    if (!quitRequested) {
      quitRequested = true;
      flushEditor().finally(() => { quitting = true; app.quit(); });
    }
    return;
  }
  quitting = true; panelMotion?.dispose(); clearInterval(timer); clearInterval(edgeTimer); clearInterval(vaultTimer); globalShortcut.unregisterAll(); for (const bar of edgeBars.values()) bar.destroy(); });
app.on('window-all-closed', () => {});
