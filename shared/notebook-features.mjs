import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stateSchema, noteSchema, createNoteSchema } from './schema.mjs';
import { descendantIds, folderTree, validateFolderTree } from './folders.mjs';
import { orderNotes, withDividers } from './order.mjs';
import { attachmentUrl, replaceAttachmentUrls } from './attachments.mjs';

const LIMIT = 25 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const contentKeys = ['title', 'body', 'folderId', 'kind', 'color', 'icon', 'iconColor', 'attachments'];
const snapshot = note => ({ revision: note.revision, savedAt: note.updatedAt, source: note.source, note });
const historyFile = (store, notebookId, id) => {
  if (!uuid.test(id) || !/^[a-zA-Z0-9-]{1,80}$/.test(notebookId)) throw new Error('Invalid note identity.');
  return path.join(store.dir, 'history', notebookId, `${id}.json`);
};
async function readHistory(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')).map(entry => ({ ...entry, note: noteSchema.parse(entry.note) })); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function atomicJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, JSON.stringify(data), { flag: 'wx', mode: 0o600 }); await fs.rename(temp, file); }
  finally { await fs.unlink(temp).catch(() => {}); }
}
export async function recordNoteHistory(store, before, after) {
  if (before.notebookId !== after.notebookId) return;
  const next = new Map(after.notes.map(note => [note.id, note]));
  for (const note of before.notes) {
    const changed = next.get(note.id);
    if (!changed || !contentKeys.some(key => JSON.stringify(note[key]) !== JSON.stringify(changed[key]))) continue;
    const file = historyFile(store, before.notebookId, note.id);
    const entries = await readHistory(file);
    if (!entries.some(entry => entry.revision === note.revision)) entries.unshift(snapshot(note));
    await atomicJson(file, entries.slice(0, 100));
  }
}
export async function noteHistory(store, id) {
  const state = await store.read(); const current = store.find(state, id, true);
  const entries = await readHistory(historyFile(store, state.notebookId, id));
  // Bring existing versions into the history viewer from pre-feature backups.
  const names = (await fs.readdir(path.join(store.dir, 'backups'))).filter(name => /^\d+-\d+-[a-f0-9]+\.json$/.test(name)).sort().reverse();
  for (const name of names) {
    try {
      const old = stateSchema.parse(JSON.parse(await fs.readFile(path.join(store.dir, 'backups', name), 'utf8')));
      if (old.notebookId !== state.notebookId) continue;
      const note = old.notes.find(value => value.id === id);
      if (note && note.revision < current.revision && !entries.some(entry => entry.revision === note.revision)) entries.push(snapshot(note));
    } catch { /* A damaged automatic snapshot does not hide valid history. */ }
  }
  return [snapshot(current), ...entries.filter(entry => entry.revision < current.revision).sort((a, b) => b.revision - a.revision)];
}
export async function restoreNoteVersion(store, id, revision, expectedRevision) {
  const notebookId = (await store.read()).notebookId;
  const savedEntries = await noteHistory(store, id);
  return store.mutate(async state => {
    if (state.notebookId !== notebookId) throw new Error('Your notebook changed. Reload note history.');
    const current = store.find(state, id, true); store.checkRevision(current, expectedRevision);
    const entry = savedEntries.find(value => value.revision === revision);
    if (!entry) throw new Error('That saved version is unavailable.');
    for (const attachment of entry.note.attachments) await localAttachment(store, attachment);
    for (const key of contentKeys) current[key] = structuredClone(entry.note[key]);
    if (!state.folders.some(folder => folder.id === current.folderId)) current.folderId = 'inbox';
    current.source = 'You'; current.deletedAt = null; store.touch(current);
    store.event(state, 'restored a version of', current); return current;
  });
}
export async function duplicateNote(store, id, source = 'You') {
  return store.mutate(state => {
    const original = store.find(state, id);
    const note = { ...structuredClone(original), id: randomUUID(), title: `${original.title.slice(0, 193)} (copy)`, pinned: false, revision: 1, source, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    state.notes.push(note); state.noteOrder.unshift(note.id); store.event(state, 'duplicated', note, source); return note;
  });
}
async function localAttachment(store, attachment) {
  if (path.basename(attachment.filename) !== attachment.filename || !attachment.filename || attachment.filename.includes('\\')) throw new Error('Invalid attachment filename.');
  const file = path.join(store.dir, 'attachments', attachment.filename);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMIT) throw new Error('Invalid attachment file.');
  return file;
}
export async function exportBackup(store) {
  const state = await store.read();
  return { ...state, demo: null, notes: await Promise.all(state.notes.map(async note => ({ ...note, attachments: await Promise.all(note.attachments.map(async attachment => ({ ...attachment, data: (await fs.readFile(await localAttachment(store, attachment))).toString('base64') }))) }))) };
}
export async function prepareBackup(store, file) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 100 * 1024 * 1024) throw new Error('Choose a Margin backup smaller than 100 MB.');
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  const notebook = stateSchema.parse(raw);
  if (notebook.demo) throw new Error('This is a demo-mode snapshot. Export the active notebook before importing it.');
  if (notebook.notes.length > 5000 || notebook.folders.length > 500) throw new Error('This backup contains too many notes or folders.');
  if (!notebook.folders.some(folder => folder.id === 'inbox') || new Set(notebook.folders.map(folder => folder.id)).size !== notebook.folders.length || new Set(notebook.notes.map(note => note.id)).size !== notebook.notes.length) throw new Error('Invalid notebook identities.');
  validateFolderTree(notebook.folders);
  if (new Set(notebook.dividers.map(divider => divider.id)).size !== notebook.dividers.length || notebook.dividers.some(divider => divider.view !== 'all' && !notebook.folders.some(folder => folder.id === divider.view))) throw new Error('A section refers to a missing folder.');
  const embedded = new Map();
  for (let index = 0; index < notebook.notes.length; index++) {
    const note = notebook.notes[index];
    if (!notebook.folders.some(folder => folder.id === note.folderId)) throw new Error('A note refers to a missing folder.');
    for (let a = 0; a < note.attachments.length; a++) {
      const attachment = note.attachments[a]; const data = raw.notes[index].attachments[a].data;
      if (typeof data === 'string') {
        if (data.length > Math.ceil(LIMIT / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('Invalid embedded attachment.');
        const bytes = Buffer.from(data, 'base64');
        if (bytes.length !== attachment.size || bytes.length > LIMIT) throw new Error('An attachment has an invalid size.');
        if (embedded.has(attachment.id) && !embedded.get(attachment.id).equals(bytes)) throw new Error('Conflicting attachment identities.');
        embedded.set(attachment.id, bytes);
      } else await localAttachment(store, attachment);
    }
  }
  return { notebook, embedded, name: path.basename(file) };
}
export async function applyBackup(store, plan, mode, expectedRevision) {
  if (!['merge', 'replace'].includes(mode)) throw new Error('Choose merge or restore.');
  const written = [];
  try {
    return await store.mutate(async state => {
      if (state.revision !== expectedRevision) throw new Error('Your notebook changed. Preview the backup again before importing.');
      if (mode === 'replace' && state.demo) throw new Error('Leave demo mode before restoring a notebook.');
      const incoming = structuredClone(plan.notebook);
      const attachmentMap = new Map();
      for (const note of incoming.notes) for (const attachment of note.attachments) {
        if (!plan.embedded.has(attachment.id)) continue;
        if (!attachmentMap.has(attachment.id)) {
          const id = randomUUID(); const ext = path.extname(attachment.name).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 16);
          const replacement = { ...attachment, id, filename: id + ext };
          const target = path.join(store.dir, 'attachments', replacement.filename);
          await fs.writeFile(target, plan.embedded.get(attachment.id), { flag: 'wx', mode: 0o600 }); written.push(target);
          attachmentMap.set(attachment.id, replacement);
        }
        Object.assign(attachment, attachmentMap.get(attachment.id));
      }
      const urls = new Map(Array.from(attachmentMap, ([oldId, attachment]) => [oldId, attachmentUrl(attachment.id)]));
      for (const note of incoming.notes) note.body = replaceAttachmentUrls(note.body, urls);
      if (mode === 'replace') {
        for (const key of ['notes', 'folders', 'dividers', 'noteOrder', 'tabOrder', 'sectionAppearances', 'activity']) state[key] = incoming[key];
        state.notebookId = randomUUID();
      } else {
        // Parents come first, so each folder merges into its mapped parent by name.
        const folders = new Map();
        for (const { folder } of folderTree(incoming.folders)) {
          const parentId = folder.parentId ? folders.get(folder.parentId) : null;
          let target = state.folders.find(value => (value.parentId ?? null) === parentId && value.name.toLowerCase() === folder.name.toLowerCase());
          if (!target) { target = { ...folder, id: randomUUID(), parentId }; state.folders.push(target); }
          folders.set(folder.id, target.id);
        }
        const ids = new Map();
        for (const note of incoming.notes) {
          ids.set(note.id, note.id = randomUUID()); note.folderId = folders.get(note.folderId); note.revision = 1;
          state.notes.push(note);
        }
        for (const divider of incoming.dividers) {
          ids.set(divider.id, divider.id = randomUUID()); divider.view = divider.view === 'all' ? 'all' : folders.get(divider.view);
          state.dividers.push(divider);
        }
        const incomingOrder = plan.notebook.noteOrder;
        for (const item of withDividers(orderNotes(plan.notebook.notes, incomingOrder), plan.notebook.dividers, incomingOrder)) state.noteOrder.push(ids.get(item.id));
      }
      store.event(state, mode === 'replace' ? 'restored notebook from' : 'imported', { title: plan.name });
      return { count: incoming.notes.length, mode };
    });
  } catch (error) { await Promise.all(written.map(file => fs.unlink(file).catch(() => {}))); throw error; }
}
export async function listBackups(store) {
  const names = (await fs.readdir(path.join(store.dir, 'backups'))).filter(name => /^\d+-\d+-[a-f0-9]+\.json$/.test(name)).sort().reverse();
  const result = [];
  for (const name of names) {
    try { const state = stateSchema.parse(JSON.parse(await fs.readFile(path.join(store.dir, 'backups', name), 'utf8'))); result.push({ name, at: new Date(Number(name.split('-')[0])).toISOString(), count: state.notes.length, demo: Boolean(state.demo) }); }
    catch { /* An unreadable snapshot stays on disk but cannot be restored here. */ }
  }
  return result;
}
export const safeName = value => value.normalize('NFC').replace(/[\x00-\x1f/\\:*?"<>|]/g, '-').replace(/^\.+|[. ]+$/g, '').trim().slice(0, 100) || 'Untitled';
export function parseMarkdown(text, filename) {
  if (text.includes('\0') || Buffer.byteLength(text) > 1_000_000) throw new Error('Markdown notes must be text files smaller than 1 MB.');
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const heading = normalized.match(/^# ([^\n]+)\n?(?:\n)?/);
  return { title: (heading?.[1] || path.basename(filename, path.extname(filename))).trim().slice(0, 200) || 'Untitled note', body: heading ? normalized.slice(heading[0].length) : normalized };
}
export async function importMarkdown(store, files, folderId = 'inbox', directories = false) {
  if (!Array.isArray(files) || files.length > 500 || !files.length) throw new Error('Import between 1 and 500 Markdown files.');
  const inputs = []; let totalBytes = 0;
  for (const item of files) {
    const file = typeof item === 'string' ? item : item.file;
    if (!path.isAbsolute(file) || !/\.(md|markdown|txt)$/i.test(file)) throw new Error('Choose Markdown or text files.');
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_000_000) throw new Error('Choose regular text files smaller than 1 MB.');
    const parsed = parseMarkdown(await fs.readFile(file, 'utf8'), file);
    const assets = [];
    for (const match of parsed.body.matchAll(/!?\[[^\]]*\]\((attachments\/[^)\n]+)\)/g)) {
      const relative = decodeURIComponent(match[1]); const directory = path.dirname(file);
      const asset = path.resolve(directory, relative);
      if (!asset.startsWith(path.join(directory, 'attachments') + path.sep)) throw new Error('Invalid Markdown attachment path.');
      if (assets.some(item => item.file === asset)) continue;
      const realDirectory = await fs.realpath(directory); const realAsset = await fs.realpath(asset);
      if (!realAsset.startsWith(path.join(realDirectory, 'attachments') + path.sep)) throw new Error('Markdown attachments must stay within their folder.');
      const assetStat = await fs.lstat(asset);
      if (!assetStat.isFile() || assetStat.isSymbolicLink() || assetStat.size > LIMIT) throw new Error('Invalid Markdown attachment file.');
      totalBytes += assetStat.size;
      if (totalBytes > 100 * 1024 * 1024) throw new Error('Import up to 100 MB of Markdown attachments at once.');
      assets.push({ file: asset, url: match[1], bytes: await fs.readFile(asset), name: path.basename(asset).replace(/^[a-f0-9]{8}-/, '') });
    }
    inputs.push({ ...parsed, assets, folderName: directories && item.folderName ? item.folderName : null });
  }
  const written = [];
  try { return await store.mutate(async state => {
    store.folder(state, folderId); const created = [];
    for (const input of inputs) {
      let target = folderId;
      if (input.folderName) {
        const name = input.folderName.trim().slice(0, 200);
        let folder = state.folders.find(value => !value.parentId && value.name.toLowerCase() === name.toLowerCase());
        if (!folder) { folder = { id: randomUUID(), name, color: 'paper', parentId: null, icon: null, iconColor: null }; state.folders.push(folder); }
        target = folder.id;
      }
      const note = { ...createNoteSchema.parse({ title: input.title, body: input.body, folderId: target, source: 'Markdown import' }), id: randomUUID(), collapsed: false, revision: 1, attachments: [], deletedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      for (const asset of input.assets) {
        const id = randomUUID(); const ext = path.extname(asset.name).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 16);
        const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.md': 'text/markdown', '.txt': 'text/plain' })[ext] || 'application/octet-stream';
        const attachment = { id, name: asset.name, filename: id + ext, mime, size: asset.bytes.length };
        const target = path.join(store.dir, 'attachments', attachment.filename);
        await fs.writeFile(target, asset.bytes, { flag: 'wx', mode: 0o600 }); written.push(target); note.attachments.push(attachment);
        if (mime.startsWith('image/')) note.body = note.body.replaceAll(`(${asset.url})`, `(${attachmentUrl(id)})`);
      }
      state.notes.push(note); state.noteOrder.push(note.id); store.event(state, 'imported', note, 'Markdown import'); created.push(note);
    }
    return created;
  }); } catch (error) { await Promise.all(written.map(file => fs.unlink(file).catch(() => {}))); throw error; }
}
export async function exportMarkdown(store, destination, { noteId, folderId } = {}) {
  const state = await store.read();
  const folders = folderId ? descendantIds(state.folders, folderId) : null;
  const notes = noteId ? [store.find(state, noteId)] : state.notes.filter(note => !note.deletedAt && (!folders || folders.has(note.folderId)));
  const output = noteId ? path.dirname(destination) : destination;
  await fs.mkdir(output, { recursive: true });
  const directoryNames = new Map(); const folderNames = {};
  for (const folder of state.folders) {
    let name = safeName(folder.name);
    if (Object.keys(folderNames).some(value => value.toLowerCase() === name.toLowerCase())) name += `-${folder.id.slice(0, 8)}`;
    directoryNames.set(folder.id, name); folderNames[name] = folder.name;
  }
  if (!noteId) await fs.writeFile(path.join(output, '.margin-export.json'), JSON.stringify({ format: 'margin-markdown', version: 1, folders: folderNames }), { mode: 0o600 });
  for (const note of notes) {
    const folder = state.folders.find(value => value.id === note.folderId);
    const directory = noteId ? output : path.join(output, directoryNames.get(note.folderId) || 'Inbox');
    await fs.mkdir(directory, { recursive: true });
    let text = `# ${note.title.replace(/\n/g, ' ')}\n\n${note.body}\n`;
    if (note.attachments.length) {
      const assets = path.join(directory, 'attachments', note.id);
      await fs.mkdir(assets, { recursive: true });
      const links = [];
      for (const attachment of note.attachments) {
        const name = `${attachment.id.slice(0, 8)}-${safeName(attachment.name)}`;
        await fs.copyFile(await localAttachment(store, attachment), path.join(assets, name));
        const url = `attachments/${note.id}/${encodeURIComponent(name)}`;
        const label = attachment.name.replace(/[\[\]\\\n]/g, ' ');
        const localUrl = attachmentUrl(attachment.id);
        if (note.body.includes(localUrl)) text = replaceAttachmentUrls(text, new Map([[attachment.id, url]]));
        else if (!attachment.inline) links.push(`${attachment.mime.startsWith('image/') ? '!' : ''}[${label}](${url})`);
      }
      text += `\n${links.join('\n\n')}\n`;
    }
    await fs.writeFile(noteId ? destination : path.join(directory, `${safeName(note.title)}-${note.id.slice(0, 8)}.md`), text, { mode: 0o600 });
  }
  return { count: notes.length, path: destination };
}
export async function collectMarkdown(directory) {
  const files = []; let folderNames = {};
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(directory, '.margin-export.json'), 'utf8'));
    if (manifest.format === 'margin-markdown' && manifest.version === 1 && manifest.folders && typeof manifest.folders === 'object') {
      folderNames = Object.fromEntries(Object.entries(manifest.folders).filter(([key, value]) => path.basename(key) === key && typeof value === 'string' && value.trim() && value.length <= 200));
    }
  } catch { /* Regular Markdown folders need no Margin manifest. */ }
  const walk = async (dir, depth) => {
    if (depth > 8) throw new Error('Markdown folders may be up to eight levels deep.');
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (item.name.startsWith('.') || item.name === 'attachments' || item.isSymbolicLink()) continue;
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await walk(file, depth + 1);
      else if (item.isFile() && /\.(md|markdown|txt)$/i.test(item.name)) {
        const relative = path.relative(directory, path.dirname(file));
        files.push({ file, folderName: relative ? (folderNames[relative.split(path.sep)[0]] || relative.split(path.sep)[0]) : null });
        if (files.length > 500) throw new Error('Import up to 500 Markdown files at once.');
      }
    }
  };
  await walk(directory, 0); return files;
}
