import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { NoteStore, ConflictError } from '../shared/store.mjs';
import { orderTabs } from '../shared/order.mjs';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'margin-store-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = await new NoteStore(dir).init();
  await store.setDemoMode(true);
  return { dir, store };
}
test('editing, tasks, folders, search, and Trash preserve note content', async t => {
  const { store } = await fixture(t);
  const folder = await store.createFolder('Project Atlas', 'sky');
  const note = await store.create({ title: 'Launch plan', folderId: folder.id, body: '- [ ] Ship the beta\n\nReference: atlas', source: 'Codex' });
  assert.equal((await store.list({ query: 'atlas', folderId: folder.id })).total, 1);
  const done = await store.toggleTask(note.id, 0, true, note.revision);
  assert.match(done.body, /^- \[x\] Ship/);
  await assert.rejects(() => store.update(note.id, { body: 'stale', expectedRevision: note.revision }), ConflictError);
  const current = await store.get(note.id); assert.equal(current.body, done.body);
  await store.trash(note.id); assert.equal((await store.list({ query: 'launch' })).total, 0);
  assert.equal((await store.list({ deleted: true, query: 'launch' })).total, 1);
  await store.restore(note.id);
  await store.deleteFolder(folder.id);
  assert.equal((await store.get(note.id)).folderId, 'inbox');
  assert.equal((await store.get(note.id)).body, done.body);
  await assert.rejects(() => store.deleteFolder('inbox'), /cannot be deleted/);
});
test('independent processes append without losing writes', async t => {
  const { dir, store } = await fixture(t);
  const note = await store.create({ title: 'Concurrent log' });
  const moduleUrl = new URL('../shared/store.mjs', import.meta.url).href;
  const workers = Array.from({ length: 4 }, (_, worker) => new Promise((resolve, reject) => {
    const code = `import {NoteStore} from ${JSON.stringify(moduleUrl)}; const s=await new NoteStore(${JSON.stringify(dir)}).init(); for(let i=0;i<8;i++)await s.append(${JSON.stringify(note.id)}, 'worker-${worker}-'+i, 'Claude');`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; child.stderr.on('data', d => err += d); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(err)));
  }));
  await Promise.all(workers);
  const saved = await store.get(note.id);
  const entries = saved.body.split('\n\n');
  assert.equal(entries.length, 32); assert.equal(new Set(entries).size, 32); assert.equal(saved.revision, 33);
});
test('data persists, backups are valid, and a corrupt file is never overwritten', async t => {
  const { dir, store } = await fixture(t);
  const note = await store.create({ title: 'Persistent thought', body: 'Keep this' });
  await store.append(note.id, 'And this');
  const reopened = await new NoteStore(dir).init(); assert.equal((await reopened.get(note.id)).body, 'Keep this\n\nAnd this');
  const backups = await fs.readdir(path.join(dir, 'backups')); assert.ok(backups.length >= 2);
  for (const name of backups) assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'backups', name), 'utf8')).version, 1);
  await fs.writeFile(store.file, 'BROKEN DATA');
  await assert.rejects(() => new NoteStore(dir).init(), /has not been replaced/);
  assert.equal(await fs.readFile(store.file, 'utf8'), 'BROKEN DATA');
});
test('attachments are local copies and unavailable IDs cannot escape the attachment directory', async t => {
  const { dir, store } = await fixture(t);
  const file = path.join(dir, 'original.txt'); await fs.writeFile(file, 'a useful input');
  const note = await store.create({ title: 'Files' });
  const saved = await store.attach(note.id, file, 'Codex');
  await fs.unlink(file);
  const attachment = await store.attachmentPath(saved.attachments[0].id);
  assert.equal(await fs.readFile(attachment.path, 'utf8'), 'a useful input');
  await assert.rejects(() => store.attachmentPath('../../notes.json'), /not found/);
  await assert.rejects(() => store.attach(note.id, 'relative.txt'), /absolute/);
});

test('manual note order persists across edits, reopening, Trash, and restore without changing content revisions', async t => {
  const { dir, store } = await fixture(t);
  const original = (await store.list()).notes;
  const first = original[0], last = original.at(-1);
  await store.reorderNote(last.id, first.id, 'before');
  const ids = (await store.list()).notes.map(note => note.id);
  assert.equal(ids[0], last.id, 'A note can be dragged ahead of a pinned note');
  assert.deepEqual(await store.get(last.id), last, 'Reordering must not invalidate an open editor or change note dates');
  await store.update(first.id, { body: 'Edited after moving', expectedRevision: first.revision });
  assert.deepEqual((await store.list()).notes.map(note => note.id), ids, 'Content edits must keep the manual position');
  const reopened = await new NoteStore(dir).init();
  assert.deepEqual((await reopened.list()).notes.map(note => note.id), ids);
  await reopened.trash(last.id);
  assert.deepEqual((await reopened.list()).notes.map(note => note.id), ids.slice(1));
  await reopened.restore(last.id);
  assert.deepEqual((await reopened.list()).notes.map(note => note.id), ids);
  const newNote = await reopened.create({ title: 'A new thought after reordering' });
  assert.equal((await reopened.list()).notes[0].id, newNote.id);
  await reopened.update(first.id, { pinned: false });
  await reopened.update(first.id, { pinned: true });
  assert.equal((await reopened.list()).notes[0].id, first.id, 'Pin to top must still work');
});

test('reordering in a filtered view preserves hidden notes and concurrent creations', async t => {
  const { dir, store } = await fixture(t);
  const before = (await store.list()).notes;
  const inbox = before.filter(note => note.folderId === 'inbox');
  const hiddenIds = before.filter(note => note.folderId !== 'inbox').map(note => note.id);
  const other = await new NoteStore(dir).init();
  const [newNote] = await Promise.all([
    other.create({ title: 'Concurrent new note', folderId: 'work' }),
    store.reorderNote(inbox[1].id, inbox[0].id, 'before')
  ]);
  const after = (await store.list()).notes;
  assert.deepEqual((await store.list({ folderId: 'inbox' })).notes.map(note => note.id), [inbox[1].id, inbox[0].id]);
  assert.deepEqual(after.filter(note => hiddenIds.includes(note.id)).map(note => note.id), hiddenIds);
  assert.equal(after.filter(note => note.id === newNote.id).length, 1);
  assert.equal(new Set((await store.read()).noteOrder).size, after.length);
});

test('folder tabs including All and Inbox retain their order through reopening and folder changes', async t => {
  const { dir, store } = await fixture(t);
  await store.reorderTab('personal', 'inbox', 'before');
  await store.reorderTab('all', 'work', 'after');
  const ids = state => orderTabs(state.folders, state.tabOrder).map(tab => tab.id);
  assert.deepEqual(ids(await store.read()), ['personal', 'inbox', 'work', 'all']);
  assert.deepEqual((await store.read()).folders.map(folder => folder.id), ['personal', 'inbox', 'work']);
  const reopened = await new NoteStore(dir).init();
  assert.deepEqual(ids(await reopened.read()), ['personal', 'inbox', 'work', 'all']);
  await reopened.renameFolder('personal', 'Home');
  const folder = await reopened.createFolder('Ideas');
  assert.deepEqual(ids(await reopened.read()), ['personal', 'inbox', 'work', 'all', folder.id]);
  await reopened.deleteFolder('personal');
  assert.deepEqual(ids(await reopened.read()), ['inbox', 'work', 'all', folder.id]);
});

test('existing notebooks load without order fields and invalid moves leave the saved notebook untouched', async t => {
  const { store } = await fixture(t);
  const state = await store.read();
  delete state.noteOrder; delete state.tabOrder;
  await fs.writeFile(store.file, JSON.stringify(state));
  const before = await fs.readFile(store.file, 'utf8');
  assert.deepEqual((await store.read()).noteOrder, []);
  assert.deepEqual((await store.read()).tabOrder, []);
  assert.deepEqual(orderTabs(state.folders).map(tab => tab.id), ['all', 'inbox', 'work', 'personal']);
  await assert.rejects(() => store.reorderNote(state.notes[0].id, state.notes[1].id, 'invalid'), /before or after/);
  await assert.rejects(() => store.reorderNote(state.notes[0].id, 'missing', 'after'), /not found/);
  await assert.rejects(() => store.reorderTab('inbox', 'missing', 'after'), /removed/);
  assert.equal(await fs.readFile(store.file, 'utf8'), before);
  await store.trash(state.notes[1].id);
  const trashed = await fs.readFile(store.file, 'utf8');
  await assert.rejects(() => store.reorderNote(state.notes[0].id, state.notes[1].id, 'after'), /not found/);
  assert.equal(await fs.readFile(store.file, 'utf8'), trashed);
});


test('screen-edge tab preference migrates old notebooks and persists independently of hover', async t => {
  const {dir, store} = await fixture(t);
  const old = await store.read(); delete old.settings.showEdgeTab;
  await fs.writeFile(store.file, JSON.stringify(old));
  assert.equal((await store.read()).settings.showEdgeTab, true);
  await store.setSettings({showEdgeTab:false, hotEdge:true});
  const reopened = await new NoteStore(dir).init();
  assert.equal((await reopened.read()).settings.showEdgeTab, false);
  assert.equal((await reopened.read()).settings.hotEdge, true);
  await assert.rejects(() => reopened.setSettings({showEdgeTab:'no'}));
});
