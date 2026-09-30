import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NoteStore } from '../shared/store.mjs';
import { orderNotes, withDividers } from '../shared/order.mjs';
import { exportBackup, prepareBackup, applyBackup, exportMarkdown } from '../shared/notebook-features.mjs';
import { folderLabel, folderTree, rememberSelection, resolveSelection, validateFolderTree } from '../shared/folders.mjs';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'margin-folders-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, store: await new NoteStore(dir).init() };
}
const items = state => withDividers(orderNotes(state.notes, state.noteOrder), state.dividers, state.noteOrder).map(item => item.title ?? `§${item.label}`);

test('folders nest three levels deep and a folder lists its descendants’ notes', async t => {
  const { store } = await fixture(t);
  const work = (await store.read()).folders.find(f => f.id === 'work');
  const client = await store.createFolder('Client A', 'sky', work.id);
  const drafts = await store.createFolder('Drafts', 'sand', client.id);
  await assert.rejects(() => store.createFolder('Too deep', 'paper', drafts.id), /three levels/);
  await assert.rejects(() => store.createFolder('client a', 'paper', work.id), /already exists here/);
  await store.createFolder('Client A', 'paper', 'personal');
  await store.create({ title: 'In Work', folderId: 'work' });
  await store.create({ title: 'In Client A', folderId: client.id });
  await store.create({ title: 'In Drafts', folderId: drafts.id });
  const titles = async options => (await store.list(options)).notes.map(note => note.title).sort();
  assert.deepEqual(await titles({ folderId: 'work' }), ['In Client A', 'In Drafts', 'In Work']);
  assert.deepEqual(await titles({ folderId: client.id }), ['In Client A', 'In Drafts']);
  assert.deepEqual(await titles({ folderId: 'work', includeSubfolders: false }), ['In Work']);
  const state = await store.read();
  assert.equal(folderLabel(state.folders, drafts.id), 'Work / Client A / Drafts');
  assert.deepEqual(folderTree(state.folders).map(({ folder, depth }) => `${depth}:${folder.name}`).slice(0, 5), ['1:Inbox', '1:Work', '2:Client A', '3:Drafts', '1:Personal']);
});

test('moving a folder never creates a loop or exceeds the depth cap', async t => {
  const { store } = await fixture(t);
  const a = await store.createFolder('A'); const b = await store.createFolder('B', 'paper', a.id);
  const c = await store.createFolder('C'); const d = await store.createFolder('D', 'paper', c.id);
  await assert.rejects(() => store.updateFolder(a.id, { name: 'A', parentId: b.id }), /inside itself/);
  await assert.rejects(() => store.updateFolder(a.id, { name: 'A', parentId: a.id }), /inside itself/);
  // A has one level below it; under D it would be four levels deep.
  await assert.rejects(() => store.updateFolder(a.id, { name: 'A', parentId: d.id }), /three levels/);
  const moved = await store.updateFolder(a.id, { name: 'Alpha', parentId: c.id });
  assert.deepEqual([moved.name, moved.parentId], ['Alpha', c.id]);
  assert.equal(folderLabel((await store.read()).folders, b.id), 'C / Alpha / B');
  await assert.rejects(() => store.updateFolder('inbox', { name: 'Inbox', parentId: c.id }), /Inbox/);
  await assert.rejects(() => store.reorderTab(b.id, c.id, 'before'), /within their own row/);
  assert.throws(() => validateFolderTree([{ id: 'x', name: 'X', parentId: 'y' }, { id: 'y', name: 'Y', parentId: 'x' }]), /inside itself/);
});

test('removing a subfolder moves its notes, children and sections up into its parent', async t => {
  const { store } = await fixture(t);
  const client = await store.createFolder('Client A', 'sky', 'work');
  await store.createFolder('Notes', 'paper', 'work');
  const child = await store.createFolder('Notes', 'paper', client.id);
  const note = await store.create({ title: 'Kickoff', folderId: client.id });
  const divider = await store.createDivider({ view: client.id, label: 'This week' });
  assert.deepEqual(await store.deleteFolder(client.id), { movedTo: 'work' });
  const state = await store.read();
  assert.equal(state.notes.find(n => n.id === note.id).folderId, 'work');
  const moved = state.folders.find(f => f.id === child.id);
  assert.deepEqual([moved.parentId, moved.name], ['work', 'Notes (from Client A)'], 'A clashing child name is kept distinct');
  assert.equal(state.dividers.find(d => d.id === divider.id).view, 'work');
});

test('removing a top-level folder sends notes to the Inbox, lifts children and drops its sections', async t => {
  const { store } = await fixture(t);
  const child = await store.createFolder('Ideas', 'paper', 'personal');
  const note = await store.create({ title: 'Garden', folderId: 'personal' });
  const divider = await store.createDivider({ view: 'personal', label: 'Home' });
  await store.deleteFolder('personal');
  const state = await store.read();
  assert.equal(state.notes.find(n => n.id === note.id).folderId, 'inbox');
  assert.equal(state.folders.find(f => f.id === child.id).parentId, null);
  assert.equal(state.dividers.some(d => d.id === divider.id), false);
  assert.equal(state.noteOrder.includes(divider.id), false);
});

test('section dividers sit among notes, move like notes and can be renamed or removed', async t => {
  const { store } = await fixture(t);
  const first = await store.create({ title: 'First' });
  const second = await store.create({ title: 'Second' });
  // New notes go on top until the first manual move: Second, First.
  const top = await store.createDivider({ view: 'all', label: '  Today  ', targetId: second.id, placement: 'before' });
  assert.equal(top.label, 'Today');
  await store.createDivider({ view: 'all', label: '' });
  assert.deepEqual(items(await store.read()), ['§Today', 'Second', 'First', '§']);
  await store.reorderNote(first.id, top.id, 'before');
  assert.deepEqual(items(await store.read()), ['First', '§Today', 'Second', '§']);
  await store.reorderNote(top.id, first.id, 'before');
  await store.create({ title: 'Third' });
  assert.deepEqual(items(await store.read()), ['Third', '§Today', 'First', 'Second', '§']);
  await store.renameDivider(top.id, 'Now');
  await assert.rejects(() => store.renameDivider(top.id, 'x'.repeat(81)));
  await store.deleteDivider(top.id);
  assert.deepEqual(items(await store.read()), ['Third', 'First', 'Second', '§']);
  await assert.rejects(() => store.createDivider({ view: 'missing' }), /Folder not found/);
});

test('each parent remembers its last sub-tab, falling back to All when that child is gone', () => {
  const folders = [{ id: 'work', parentId: null }, { id: 'a', parentId: 'work' }, { id: 'a1', parentId: 'a' }, { id: 'b', parentId: 'work' }];
  let memory = rememberSelection({}, folders, 'a1');
  assert.deepEqual(memory, { work: 'a', a: 'a1', a1: 'a1' });
  assert.equal(resolveSelection(memory, folders, 'work'), 'a1');
  memory = rememberSelection(memory, folders, 'work');
  assert.equal(resolveSelection(memory, folders, 'work'), 'work', 'Choosing All is remembered too');
  memory = rememberSelection(memory, folders, 'b');
  assert.equal(resolveSelection(memory, folders, 'work'), 'b');
  assert.equal(resolveSelection(memory, folders.filter(f => f.id !== 'b'), 'work'), 'work');
  assert.equal(resolveSelection(memory, folders, 'all'), 'all');
});

test('backups keep nesting and sections, merge by path and refuse loops', async t => {
  const { dir, store } = await fixture(t);
  const client = await store.createFolder('Client A', 'sky', 'work');
  const note = await store.create({ title: 'Brief', folderId: client.id });
  await store.createDivider({ view: client.id, label: 'Open', targetId: note.id });
  const file = path.join(dir, 'backup.json');
  await fs.writeFile(file, JSON.stringify(await exportBackup(store)));
  const plan = await prepareBackup(store, file);
  await applyBackup(store, plan, 'merge', (await store.read()).revision);
  const state = await store.read();
  assert.equal(state.folders.filter(f => f.name === 'Client A').length, 1, 'Merging maps Work / Client A onto itself');
  assert.equal(state.notes.filter(n => n.title === 'Brief' && n.folderId === client.id).length, 2);
  assert.deepEqual(state.dividers.map(d => [d.view, d.label]), [[client.id, 'Open'], [client.id, 'Open']]);
  const broken = JSON.parse(await fs.readFile(file, 'utf8'));
  broken.folders.find(f => f.id === 'work').parentId = client.id;
  await fs.writeFile(file, JSON.stringify(broken));
  await assert.rejects(() => prepareBackup(store, file), /inside itself|three levels/);
  const out = path.join(dir, 'export');
  assert.equal((await exportMarkdown(store, out, { folderId: 'work' })).count, 2, 'Exporting a folder includes its subfolders');
});

test('notebooks from before nesting load with every folder at the top level', async t => {
  const { dir, store } = await fixture(t);
  const raw = JSON.parse(await fs.readFile(path.join(dir, 'notes.json'), 'utf8'));
  for (const folder of raw.folders) delete folder.parentId;
  delete raw.dividers;
  await fs.writeFile(path.join(dir, 'notes.json'), JSON.stringify(raw));
  const state = await store.read();
  assert.ok(state.folders.every(f => f.parentId === null));
  assert.deepEqual(state.dividers, []);
});
