import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileLink } from '../shared/app-links.mjs';
import { createLinkPreviews, documentTitle, readTask } from '../app/link-previews.mjs';

test('document titles come from the HTML title, Markdown front matter or heading, then the filename', () => {
  assert.equal(documentTitle('/a/Publish, Don\'t Scroll.html', '<html><head>\n<title>\n  Publish, Don&#39;t Scroll </title>'), "Publish, Don't Scroll");
  assert.equal(documentTitle('/a/x.htm', '<TITLE lang="en">R&amp;D &#x2014; Notes&nbsp;</TITLE>'), 'R&D — Notes');
  assert.equal(documentTitle('/a/Untitled page.html', '<html><body><h1>Not a title</h1>'), 'Untitled page');
  assert.equal(documentTitle('/a/plan.md', '---\ntags: [x]\ntitle: "The Roster Play"\n---\n# Heading'), 'The Roster Play');
  assert.equal(documentTitle('/a/plan.md', '---\ntags: [x]\n---\n\nIntro\n\n# The **Secure** [Handoff](x.md) ##\n\n# Second'), 'The Secure Handoff');
  assert.equal(documentTitle('/a/plan.md', '## Only a subheading\nText'), 'plan');
  assert.equal(documentTitle('/a/Design & café #2.markdown', ''), 'Design & café #2');
  assert.equal(documentTitle('/a/Report.pdf', '%PDF-1.7'), 'Report');
  assert.equal(documentTitle('/a/notes.txt', '# Not parsed in plain text'), 'notes');
  assert.equal(documentTitle('/a/long.html', `<title>${'x'.repeat(500)}</title>`).length, 200);
});

test('tasks are read from a read-only CXTasks database by T-number or id', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'margin-cxtasks-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const database = path.join(dir, 'cxtasks.db');
  const db = new DatabaseSync(database);
  db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, short_id INTEGER, title TEXT, status TEXT, deleted_at TEXT, archived_at TEXT)');
  const insert = db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?)');
  insert.run('7d3c1a52-0000-4000-8000-000000000042', 42, '  Ship   the chips ', 'in_progress', null, null);
  insert.run('7d3c1a52-0000-4000-8000-000000000007', 7, 'Finished', 'done', null, null);
  insert.run('7d3c1a52-0000-4000-8000-000000000009', 9, 'Removed', 'inbox', '2026-10-01', null);
  insert.run('7d3c1a52-0000-4000-8000-000000000011', 11, 'Shelved', 'todo', null, '2026-10-01');
  db.close();
  const before = await fs.readFile(database);
  assert.deepEqual(readTask('T42', database), { reference: 'T42', title: 'Ship the chips', status: 'in_progress' });
  assert.deepEqual(readTask('7d3c1a52-0000-4000-8000-000000000007', database), { reference: 'T7', title: 'Finished', status: 'done' });
  assert.equal(readTask('T9', database).status, 'trashed');
  assert.equal(readTask('T11', database).status, 'archived');
  assert.equal(readTask('T404', database), null);
  assert.throws(() => readTask('T42', path.join(dir, 'missing.db')));
  assert.deepEqual(await fs.readFile(database), before, 'Looking up a task never writes to CXTasks');
});

test('previews pair the opening app icon with the target title, cache titles by file version, and never read tasks unless enabled', async () => {
  const doc = '/Users/me/Notes/Plan.html';
  const apps = { onyx: '/Applications/Onyx.app', obsidian: '/Applications/Obsidian.app', cxtasks: '/Applications/CXTasks.app' };
  let version = 1, reads = 0, tasks = 0;
  const iconCalls = [];
  const options = {
    getApps: async () => apps,
    fileIcon: async file => { iconCalls.push(file); return { isEmpty: () => false, toDataURL: () => `data:image/png;base64,${path.basename(file)}` }; },
    stat: async file => { if (file !== doc) throw new Error('ENOENT'); return { isFile: () => true, mtimeMs: version, size: 10 }; },
    read: async () => { reads++; return `<title>Plan v${version}</title>`; },
    task: reference => { tasks++; if (reference === 'T404') return null; if (reference === 'T500') throw new Error('locked'); return { reference, title: 'Ship the chips', status: 'done' }; },
  };
  const previews = createLinkPreviews(options);
  assert.deepEqual(await previews.preview(fileLink(doc)), { kind: 'document', app: 'onyx', icon: 'data:image/png;base64,Onyx.app', title: 'Plan v1', missing: false });
  await previews.preview(doc);
  assert.equal(reads, 1, 'An unchanged file is not read twice');
  version = 2;
  assert.equal((await previews.preview(doc)).title, 'Plan v2');
  assert.equal(reads, 2);
  assert.deepEqual(await previews.preview('/Users/me/Notes/Gone.md'), { kind: 'document', app: 'onyx', icon: 'data:image/png;base64,Onyx.app', title: 'Gone', missing: true });

  assert.equal(await previews.preview('T42'), null, 'Task previews stay off until CXTasks links are enabled');
  assert.equal(tasks, 0);
  assert.deepEqual(await previews.preview('T42', { tasks: true }), { kind: 'task', app: 'cxtasks', icon: 'data:image/png;base64,CXTasks.app', reference: 'T42', title: 'Ship the chips', status: 'done', missing: false });
  assert.equal((await previews.preview('cxtasks://task/T404', { tasks: true })).missing, true);
  assert.deepEqual(await previews.preview('T500', { tasks: true }), { kind: 'task', app: 'cxtasks', icon: 'data:image/png;base64,CXTasks.app', reference: 'T500', title: null, status: null, missing: false }, 'An unreadable database is unknown, not missing');
  assert.equal(await previews.preview('https://example.com', { tasks: true }), null);
  assert.deepEqual(iconCalls, ['/Applications/Onyx.app', '/Applications/CXTasks.app'], 'Each app icon is loaded once');

  const obsidianOnly = createLinkPreviews({ ...options, getApps: async () => ({ obsidian: apps.obsidian }), fileIcon: async () => ({ isEmpty: () => true }) });
  assert.deepEqual(await obsidianOnly.preview(doc), { kind: 'document', app: 'obsidian', icon: null, title: 'Plan v2', missing: false });
  assert.equal(await obsidianOnly.preview('T42', { tasks: true }), null, 'No task preview without CXTasks installed');
  const noApps = createLinkPreviews({ ...options, getApps: async () => ({}), fileIcon: async () => { throw new Error('no icon'); } });
  assert.equal((await noApps.preview(doc)).icon, null);
});
