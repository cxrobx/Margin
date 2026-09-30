import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { createNoteSchema, updateNoteSchema, stateSchema, settingsSchema, colorSchema, appearanceSchema, dividerLabel } from './schema.mjs';
import { vaultPaletteSchema, savedThemeSchema } from './themes.mjs';
import { moveItem, orderNotes, orderTabs, withDividers } from './order.mjs';
import { canPlace, childrenOf, descendantIds, siblingsOf, uniqueName, validateFolderTree } from './folders.mjs';
import { recordNoteHistory } from './notebook-features.mjs';

export function defaultDataDir() {
  return process.env.MARGIN_DATA_DIR || (process.platform === 'darwin'
    ? path.join(homedir(), 'Library', 'Application Support', 'Margin Notes')
    : path.join(homedir(), '.local', 'share', 'margin-notes'));
}
export class ConflictError extends Error {
  constructor() { super('This note changed in another app. Reload the latest version before saving. Your draft has been preserved.'); this.name = 'ConflictError'; }
}
const now = () => new Date().toISOString();
const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json' };

function freshNotebook() {
  return { notebookId: randomUUID(), folders: [
    { id: 'inbox', name: 'Inbox', color: 'paper', parentId: null },
    { id: 'work', name: 'Work', color: 'sage', parentId: null },
    { id: 'personal', name: 'Personal', color: 'rose', parentId: null }
  ], dividers: [], sectionAppearances: {}, notes: [], noteOrder: [], tabOrder: [], activity: [] };
}
const notebookFields = ['notebookId', 'folders', 'dividers', 'notes', 'noteOrder', 'tabOrder', 'activity', 'sectionAppearances'];
const notebookContent = state => Object.fromEntries(notebookFields.map(key => [key, structuredClone(state[key])]));
function freshState() {
  return { ...freshNotebook(), version: 1, revision: 0, demo: null,
    settings: { alwaysOnTop: true, hotEdge: false, edge: 'right', theme: 'light' } };
}
function demoNotebook() {
  const state = freshNotebook();
  const seeds = [
    { title: 'A little room for your thoughts', body: 'Welcome to **Margin**. A quiet place for the things you want to keep close.\n\nCapture a thought, make a list, or let your assistant leave something here. It’s all saved on this Mac.', pinned: true, color: 'sage' },
    { title: 'Make yourself at home', body: '- [ ] Capture your first thought\n- [ ] Create a folder for a project\n- [ ] Connect Codex or Claude\n\nUse **⌘ ⇧ Space** to bring Margin into view from any app.', kind: 'checklist', color: 'sand' },
    { title: 'Your assistant has a place here', body: 'Open **Connect assistants** below for the MCP setup. Then try:\n\n> Add a note to Margin with the key decisions from this conversation.\n\nYour notes stay local. The assistant can add text, tasks, links, code, and attachments.', color: 'lavender', folderId: 'work' },
    { title: 'Keep the useful bits', body: 'A link, a snippet, a small idea.\n\nUse the **+** button to capture it. Pin what matters, and fold longer notes when you need a little space.', color: 'paper', folderId: 'personal' },
    { title: 'A useful snippet', body: '```js\nconst thought = {\n  title: "Keep the useful bits",\n  source: "Codex"\n};\n```', kind: 'code', color: 'sky', folderId: 'work' },
    { title: 'A link worth keeping', body: '[Model Context Protocol](https://modelcontextprotocol.io)\n\nA place to revisit when connecting your assistant.', kind: 'link', color: 'rose', folderId: 'personal' }
  ];
  for (const seed of seeds) state.notes.push({ ...createNoteSchema.parse({ ...seed, source: 'Demo' }), id: randomUUID(), collapsed: false, revision: 1, attachments: [], createdAt: now(), updatedAt: now(), deletedAt: null });
  return state;
}

export class NoteStore {
  constructor(dir = defaultDataDir()) { this.dir = path.resolve(dir); this.file = path.join(this.dir, 'notes.json'); }
  async init() {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(this.dir, 'attachments'), { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(this.dir, 'backups'), { recursive: true, mode: 0o700 });
    await this.withLock(async () => {
      try { await this.read(); }
      catch (e) { if (e.code !== 'ENOENT') throw e; await this.write(freshState(), false); }
    });
    return this;
  }
  async withLock(fn) {
    const release = await lockfile.lock(this.file, { realpath: false, stale: 15000, update: 3000, retries: { retries: 40, minTimeout: 25, maxTimeout: 250, randomize: true } });
    try { return await fn(); } finally { await release(); }
  }
  async read() {
    const text = await fs.readFile(this.file, 'utf8');
    try { return stateSchema.parse(JSON.parse(text)); }
    catch (e) { throw new Error(`Cannot read notes.json. Your data has not been replaced. Check backups in ${path.join(this.dir, 'backups')}. ${e.message}`); }
  }
  async write(state, backup = true) {
    const validated = stateSchema.parse(state);
    validateFolderTree(validated.folders);
    if (backup) {
      const backupName = `${Date.now()}-${state.revision}-${randomUUID().slice(0, 6)}.json`;
      await fs.copyFile(this.file, path.join(this.dir, 'backups', backupName));
      const names = (await fs.readdir(path.join(this.dir, 'backups'))).filter(n => n.endsWith('.json')).sort();
      for (const name of names.slice(0, -40)) await fs.unlink(path.join(this.dir, 'backups', name));
    }
    const temp = `${this.file}.${randomUUID()}.tmp`;
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(validated, null, 2)); await handle.sync(); }
    finally { await handle.close(); }
    try { await fs.rename(temp, this.file); }
    finally { await fs.unlink(temp).catch(() => {}); }
  }
  async mutate(fn) {
    return this.withLock(async () => {
      const state = await this.read();
      const previous = structuredClone(state);
      const result = await fn(state);
      await recordNoteHistory(this, previous, state);
      state.revision++;
      await this.write(state);
      return structuredClone(result);
    });
  }
  event(state, action, note, source = 'You') {
    state.activity.unshift({ id: randomUUID(), action, title: note.title || note.name, source, at: now() });
    state.activity = state.activity.slice(0, 50);
  }
  find(state, id, allowDeleted = false) {
    const note = state.notes.find(n => n.id === id && (allowDeleted || !n.deletedAt));
    if (!note) throw new Error('Note not found. Use list_notes to get a current note ID.');
    return note;
  }
  folder(state, id) { if (!state.folders.some(f => f.id === id)) throw new Error('Folder not found. Use list_folders to get a current folder ID.'); }
  // Notes and section dividers share noteOrder so a divider keeps its place among the notes.
  itemOrder(state) { return withDividers(orderNotes(state.notes, state.noteOrder), state.dividers, state.noteOrder).map(item => item.id); }
  checkRevision(note, expected) { if (expected !== undefined && note.revision !== expected) throw new ConflictError(); }
  touch(note) { note.updatedAt = now(); note.revision++; }
  async setDemoMode(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Choose whether demo mode is enabled.');
    return this.mutate(state => {
      if (enabled && !state.demo) {
        const normal = notebookContent(state);
        Object.assign(state, demoNotebook());
        state.demo = { startedAt: now(), normal };
      } else if (!enabled && state.demo) {
        Object.assign(state, state.demo.normal);
        state.demo = null;
      }
      return { demoMode: Boolean(state.demo), notebookId: state.notebookId };
    });
  }
  async resetNotebook(expectedRevision) {
    return this.mutate(state => {
      if (state.demo) throw new Error('Leave demo mode before resetting your regular notebook.');
      if (state.revision !== expectedRevision) throw new Error('Your notebook changed. Review it before resetting.');
      const removedNotes = state.notes.length;
      // write() backs up the entire previous notebook before replacing it.
      Object.assign(state, freshNotebook());
      return { removedNotes, notebookId: state.notebookId };
    });
  }
  async list({ query = '', folderId, includeSubfolders = true, pinned, deleted = false, limit = 100, offset = 0 } = {}) {
    const state = await this.read();
    const q = query.trim().toLowerCase();
    const folders = folderId ? includeSubfolders ? descendantIds(state.folders, folderId) : new Set([folderId]) : null;
    const notes = state.notes.filter(n => Boolean(n.deletedAt) === deleted && (!folders || folders.has(n.folderId)) && (pinned === undefined || n.pinned === pinned) && (!q || `${n.title}\n${n.body}\n${n.attachments.map(a => a.name).join(' ')}`.toLowerCase().includes(q)));
    return { notes: orderNotes(notes, state.noteOrder).slice(offset, offset + limit), total: notes.length, demoMode: Boolean(state.demo) };
  }
  async get(id) { return this.find(await this.read(), id); }
  async create(input) {
    const data = createNoteSchema.parse(input);
    return this.mutate(state => {
      this.folder(state, data.folderId);
      const note = { ...data, id: randomUUID(), collapsed: false, revision: 1, attachments: [], createdAt: now(), updatedAt: now(), deletedAt: null };
      state.notes.push(note);
      if (state.noteOrder.length) state.noteOrder.unshift(note.id);
      this.event(state, 'created', note, data.source); return note;
    });
  }
  async update(id, input) {
    const { expectedRevision, ...data } = updateNoteSchema.parse(input);
    return this.mutate(state => {
      const note = this.find(state, id); this.checkRevision(note, expectedRevision);
      // Size changes keep the note's place in date order and its authorship.
      // Autosave can send unchanged content alongside the new display height.
      const heightOnly = data.bodyHeight !== undefined && Object.entries(data).every(([key, value]) => key === 'bodyHeight' || key === 'source' || note[key] === value);
      if (heightOnly) { note.bodyHeight = data.bodyHeight; note.revision++; return note; }
      if (data.folderId !== undefined) this.folder(state, data.folderId);
      if (data.pinned === true && !note.pinned && state.noteOrder.length) {
        state.noteOrder = [id, ...state.noteOrder.filter(value => value !== id)];
      }
      Object.assign(note, data); this.touch(note); this.event(state, 'updated', note, data.source); return note;
    });
  }
  async append(id, text, source = 'Assistant') {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Input text cannot be empty.');
    return this.mutate(state => {
      const note = this.find(state, id);
      note.source = source;
      note.body += `${note.body ? '\n\n' : ''}${text}`;
      this.touch(note); this.event(state, 'added to', note, source); return note;
    });
  }
  async toggleTask(id, line, completed, expectedRevision, source = 'You') {
    return this.mutate(state => {
      const note = this.find(state, id); this.checkRevision(note, expectedRevision);
      const lines = note.body.split('\n');
      if (!Number.isInteger(line) || !/^\s*[-*+] \[[ xX]\] /.test(lines[line] || '')) throw new Error('Task not found at this line. Read the note again.');
      lines[line] = lines[line].replace(/\[[ xX]\]/, completed ? '[x]' : '[ ]');
      note.source = source; note.body = lines.join('\n'); this.touch(note); this.event(state, 'checked a task in', note, source); return note;
    });
  }
  async trash(id, source = 'You') {
    return this.mutate(state => { const note = this.find(state, id); note.deletedAt = now(); this.touch(note); this.event(state, 'moved to trash', note, source); return note; });
  }
  async restore(id, source = 'You') {
    return this.mutate(state => { const note = this.find(state, id, true); note.deletedAt = null; this.touch(note); this.event(state, 'restored', note, source); return note; });
  }
  async reorderNote(id, targetId, placement) {
    return this.mutate(state => {
      for (const value of [id, targetId]) if (!state.dividers.some(divider => divider.id === value)) this.find(state, value);
      state.noteOrder = moveItem(this.itemOrder(state), id, targetId, placement);
      return state.noteOrder;
    });
  }
  async createDivider({ view, label = '', targetId = null, placement = 'before' } = {}) {
    const clean = dividerLabel.parse(label);
    return this.mutate(state => {
      if (view !== 'all') this.folder(state, view);
      const divider = { id: randomUUID(), view, label: clean };
      const ids = this.itemOrder(state);
      if (targetId !== null && !ids.includes(targetId)) throw new Error('The note was removed. Try again.');
      state.dividers.push(divider);
      state.noteOrder = targetId === null ? [...ids, divider.id] : moveItem([...ids, divider.id], divider.id, targetId, placement);
      return divider;
    });
  }
  async renameDivider(id, label) {
    const clean = dividerLabel.parse(label);
    return this.mutate(state => {
      const divider = state.dividers.find(value => value.id === id);
      if (!divider) throw new Error('This section was removed.');
      divider.label = clean; return divider;
    });
  }
  async deleteDivider(id) {
    return this.mutate(state => {
      if (!state.dividers.some(value => value.id === id)) throw new Error('This section was removed.');
      state.dividers = state.dividers.filter(value => value.id !== id);
      state.noteOrder = state.noteOrder.filter(value => value !== id);
      return { id };
    });
  }
  async reorderTab(id, targetId, placement) {
    return this.mutate(state => {
      const source = state.folders.find(f => f.id === id), target = state.folders.find(f => f.id === targetId);
      if ((source?.parentId ?? null) !== (target?.parentId ?? null)) throw new Error('Tabs can be reordered within their own row. To move a folder into another, rename it and choose where it sits.');
      state.tabOrder = moveItem(orderTabs(state.folders, state.tabOrder).map(tab => tab.id), id, targetId, placement);
      const positions = new Map(state.tabOrder.map((value, index) => [value, index]));
      state.folders.sort((a, b) => positions.get(a.id) - positions.get(b.id));
      return state.tabOrder;
    });
  }
  async createFolder(name, color = 'paper', parentId = null) {
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 200) throw new Error('Folder names must be between 1 and 200 characters.');
    colorSchema.parse(color);
    return this.mutate(state => {
      if (parentId !== null) { this.folder(state, parentId); if (!canPlace(state.folders, null, parentId)) throw new Error('Folders nest up to three levels deep.'); }
      if (childrenOf(state.folders, parentId).some(f => f.name.toLowerCase() === cleanName.toLowerCase())) throw new Error('A folder with that name already exists here.');
      const folder = { id: randomUUID(), name: cleanName, color, parentId }; state.folders.push(folder); return folder;
    });
  }
  async setSectionAppearance(id, input) {
    const appearance = appearanceSchema.parse(input);
    return this.mutate(state => {
      if (['all', 'pinned', 'trash'].includes(id)) { state.sectionAppearances[id] = appearance; return appearance; }
      this.folder(state, id);
      const folder = state.folders.find(f => f.id === id);
      Object.assign(folder, appearance); return folder;
    });
  }
  async renameFolder(id, name) { return this.updateFolder(id, { name }); }
  // Rename a folder and choose where it sits: null is the top level, and an
  // omitted parentId leaves it where it is.
  async updateFolder(id, { name, parentId } = {}) {
    if (parentId !== undefined && parentId !== null && typeof parentId !== 'string') throw new Error('Choose a folder to move this into.');
    return this.mutate(state => {
      const folder = state.folders.find(f => f.id === id);
      if (!folder || id === 'inbox') throw new Error('The Inbox cannot be renamed or moved.');
      if (parentId === undefined) parentId = folder.parentId ?? null;
      const cleanName = typeof name === 'string' ? name.trim() : '';
      if (!cleanName || cleanName.length > 200) throw new Error('Enter a valid folder name.');
      if (parentId !== (folder.parentId ?? null)) {
        if (parentId !== null) this.folder(state, parentId);
        if (!canPlace(state.folders, id, parentId)) throw new Error('A folder cannot go inside itself, and folders nest up to three levels deep.');
      }
      if (childrenOf(state.folders, parentId).some(f => f.id !== id && f.name.toLowerCase() === cleanName.toLowerCase())) throw new Error('A folder with that name already exists here.');
      folder.name = cleanName; folder.parentId = parentId; return folder;
    });
  }
  // A subfolder's notes, dividers and children move up into its parent. A
  // top-level folder's notes move to the Inbox and its children become top-level.
  async deleteFolder(id) {
    return this.mutate(state => {
      if (id === 'inbox') throw new Error('The Inbox cannot be deleted.');
      this.folder(state, id);
      const folder = state.folders.find(f => f.id === id);
      const parentId = folder.parentId ?? null, destination = parentId ?? 'inbox';
      for (const note of state.notes) if (note.folderId === id) { note.folderId = destination; this.touch(note); }
      const removed = new Set(parentId ? [] : state.dividers.filter(divider => divider.view === id).map(divider => divider.id));
      state.dividers = state.dividers.filter(divider => !removed.has(divider.id)).map(divider => divider.view === id ? { ...divider, view: parentId } : divider);
      state.noteOrder = state.noteOrder.filter(value => !removed.has(value));
      for (const child of childrenOf(state.folders, id)) {
        child.name = uniqueName(siblingsOf(state.folders, folder), child.name, `from ${folder.name}`);
        child.parentId = parentId;
      }
      state.folders = state.folders.filter(f => f.id !== id);
      state.tabOrder = state.tabOrder.filter(value => value !== id);
      return { movedTo: destination };
    });
  }
  async setSettings(input) { return this.mutate(state => {
    const settings = settingsSchema.parse({ ...state.settings, ...input });
    if (!['default', 'vault', 'cxtasks-glass', 'monokai-soda'].includes(settings.themeId) && !state.themes.some(t => t.id === settings.themeId)) throw new Error('Theme not found.');
    if (settings.vaultAddress !== state.settings.vaultAddress) state.vaultTheme = { palette: null, variants: { light: null, dark: null } };
    state.settings = settings; return state.settings;
  }); }
  async cacheVaultTheme(input, address) {
    const palette = vaultPaletteSchema.parse(input);
    // Only palette changes need a write or backup, not every poll.
    return this.withLock(async () => {
      const state = await this.read();
      if (state.settings.vaultAddress !== address) return state.vaultTheme;
      const previous = state.vaultTheme.palette;
      // Keep captured colours during a partial Onyx outage. Never carry colours
      // from an older base palette or a different light/dark mode into this one.
      if (previous?.mode === palette.mode && previous.revision === palette.revision && previous.decoration) {
        palette.decoration = { ...previous.decoration, ...palette.decoration };
      }
      if (JSON.stringify(previous) === JSON.stringify(palette)) return state.vaultTheme;
      state.vaultTheme.palette = palette; state.vaultTheme.variants[palette.mode] = palette;
      state.revision++; await this.write(state); return state.vaultTheme;
    });
  }
  async saveVaultTheme(name, id) {
    return this.mutate(state => {
      const vault = state.vaultTheme;
      if (!vault.palette) throw new Error('Connect to your vault before saving a theme.');
      const previous = id ? state.themes.find(t => t.id === id) : null;
      if (id && !previous) throw new Error('Theme not found.');
      const theme = savedThemeSchema.parse({ id: id || randomUUID(), name,
        palettes: { light: vault.variants.light || previous?.palettes.light || null, dark: vault.variants.dark || previous?.palettes.dark || null },
        createdAt: previous?.createdAt || now() });
      if (state.themes.some(t => t.id !== theme.id && t.name.toLowerCase() === theme.name.toLowerCase()) || theme.name.toLowerCase() === 'default') throw new Error('Choose a different theme name.');
      if (previous) state.themes = state.themes.map(t => t.id === id ? theme : t); else state.themes.push(theme);
      state.settings.themeId = theme.id; state.settings.theme = vault.palette.mode;
      return theme;
    });
  }
  async deleteTheme(id) {
    return this.mutate(state => {
      if (!state.themes.some(t => t.id === id)) throw new Error('Only a saved vault copy can be removed.');
      state.themes = state.themes.filter(t => t.id !== id);
      if (state.settings.themeId === id) state.settings.themeId = 'default';
      return id;
    });
  }
  async attach(id, filePath, source = 'You') {
    if (!path.isAbsolute(filePath)) throw new Error('Attachment paths must be absolute.');
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('Only regular files can be attached.');
    if (stat.size > 25 * 1024 * 1024) throw new Error('Attachments are limited to 25 MB.');
    const attachmentId = randomUUID();
    const ext = path.extname(filePath).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 16);
    const attachment = { id: attachmentId, name: path.basename(filePath), filename: attachmentId + ext, size: stat.size, mime: imageTypes[ext] || 'application/octet-stream' };
    const target = path.join(this.dir, 'attachments', attachment.filename);
    await fs.copyFile(filePath, target); await fs.chmod(target, 0o600);
    try {
      return await this.mutate(state => { const note = this.find(state, id); note.attachments.push(attachment); this.touch(note); this.event(state, 'attached a file to', note, source); return note; });
    } catch (e) { await fs.unlink(target).catch(() => {}); throw e; }
  }
  async attachmentPath(id) {
    const state = await this.read();
    const attachment = state.notes.flatMap(n => n.attachments).find(a => a.id === id);
    if (!attachment || path.basename(attachment.filename) !== attachment.filename) throw new Error('Attachment not found.');
    return { path: path.join(this.dir, 'attachments', attachment.filename), mime: attachment.mime };
  }
}
