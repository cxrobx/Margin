import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { parseAppLink } from '../shared/app-links.mjs';
import { documentFile, installedLinkApps } from './document-links.mjs';

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = text => text.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (match, dec, hex, name) => {
  const code = dec ? Number(dec) : hex ? parseInt(hex, 16) : null;
  if (code !== null) return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  return entities[name.toLowerCase()] ?? match;
});
const tidy = value => decode(value).replace(/\s+/g, ' ').trim().slice(0, 200);
// A document's own name: its HTML <title>, Markdown front-matter title or first
// top-level heading, and otherwise its filename.
export function documentTitle(file, head = '') {
  let title = '';
  if (/\.html?$/i.test(file)) title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] || '';
  else if (/\.(?:md|markdown)$/i.test(file)) {
    const front = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(head);
    const named = front && /^title:[ \t]*(.+?)[ \t]*$/m.exec(front[1])?.[1].replace(/^(["'])(.*)\1$/, '$2');
    const heading = /^#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/m.exec(front ? head.slice(front[0].length) : head)?.[1];
    title = named || (heading || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '');
  }
  return tidy(title) || path.basename(file).replace(/\.[^.]+$/, '');
}
async function readHead(file, bytes = 65_536) {
  const handle = await fs.open(file, 'r');
  try { const buffer = Buffer.alloc(bytes); const { bytesRead } = await handle.read(buffer, 0, bytes, 0); return buffer.subarray(0, bytesRead).toString('utf8'); }
  finally { await handle.close(); }
}
export const taskDatabase = () => path.join(process.env.CXTASKS_DATA_DIR || path.join(os.homedir(), 'Library/Application Support/com.cxtasks.app'), 'cxtasks.db');
// Read-only, like CXTasks' own Alfred search: Margin never writes to CXTasks.
// Returns null when no such task exists and throws when the database can't be read.
export function readTask(reference, database = taskDatabase()) {
  const db = new DatabaseSync(database, { readOnly: true, timeout: 1000 });
  try {
    const columns = 'SELECT short_id, title, status, deleted_at, archived_at FROM tasks WHERE';
    const row = /^T\d+$/.test(reference) ? db.prepare(`${columns} short_id = ?`).get(Number(reference.slice(1))) : db.prepare(`${columns} id = ?`).get(reference);
    if (!row) return null;
    return { reference: row.short_id == null ? reference : `T${row.short_id}`, title: tidy(String(row.title || '')) || null, status: row.deleted_at ? 'trashed' : row.archived_at ? 'archived' : row.status };
  } finally { db.close(); }
}
// What a reading-view chip shows for a link: the app that opens it, that app's
// icon, and the target's own title. Nothing here opens or changes the target.
// Chips belong to Onyx and CXTasks users only; without the app there is no preview.
export function createLinkPreviews({ fileIcon, getApps = installedLinkApps, stat = fs.stat, read = readHead, task = readTask, home = os.homedir() }) {
  const icons = new Map(), titles = new Map();
  const icon = application => {
    if (!application) return null;
    if (!icons.has(application)) icons.set(application, Promise.resolve().then(() => fileIcon(application)).then(image => image.isEmpty() ? null : image.toDataURL()).catch(() => null));
    return icons.get(application);
  };
  async function preview(value, { tasks = false } = {}) {
    const link = parseAppLink(value);
    const apps = await getApps();
    if (link.kind === 'document' && apps.onyx) {
      const file = documentFile(link.path, home);
      let info; try { info = await stat(file); } catch {}
      if (!info?.isFile()) return { kind: 'document', app: 'onyx', icon: await icon(apps.onyx), title: documentTitle(file), missing: true };
      const key = `${info.mtimeMs}:${info.size}`;
      if (titles.get(file)?.key !== key) titles.set(file, { key, title: documentTitle(file, /\.pdf$/i.test(file) ? '' : await read(file).catch(() => '')) });
      return { kind: 'document', app: 'onyx', icon: await icon(apps.onyx), title: titles.get(file).title, missing: false };
    }
    if (link.kind === 'task' && tasks && apps.cxtasks) {
      let found = null, known = true;
      try { found = task(link.reference); } catch { known = false; }
      return { kind: 'task', app: 'cxtasks', icon: await icon(apps.cxtasks), reference: found?.reference || link.reference, title: found?.title || null, status: found?.status || null, missing: known && !found };
    }
    return null;
  }
  return { preview };
}
