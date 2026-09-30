import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NoteStore } from '../shared/store.mjs';
import { NoteAutosave } from '../renderer/note-autosave.mjs';
import { validImageIcon } from '../shared/icons.mjs';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhXcAAAAASUVORK5CYII=';
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'margin-icons-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, store: await new NoteStore(dir).init() };
}

test('section and note icons survive edits, reopening, rename, Trash, and reset to their default appearance', async t => {
  const { dir, store } = await fixture(t);
  const note = await store.create({ title: 'A thought', body: 'Keep this', color: 'rose', kind: 'checklist' });
  const chosen = await store.update(note.id, { icon: 'lucide:rocket', iconColor: 'purple', expectedRevision: note.revision });
  await store.update(note.id, { body: 'Keep this too', expectedRevision: chosen.revision });
  for (const id of ['inbox', 'work', 'all', 'pinned', 'trash']) await store.setSectionAppearance(id, { icon: 'lucide:book-open', iconColor: 'blue' });
  const reopened = await new NoteStore(dir).init();
  await reopened.renameFolder('work', 'Projects');
  const state = await reopened.read();
  assert.equal(state.folders.find(f => f.id === 'work').icon, 'lucide:book-open');
  assert.equal(state.folders.find(f => f.id === 'work').color, 'sage');
  assert.equal(state.sectionAppearances.pinned.iconColor, 'blue');
  await reopened.trash(note.id); await reopened.restore(note.id);
  const saved = await reopened.get(note.id);
  assert.equal(saved.icon, 'lucide:rocket'); assert.equal(saved.iconColor, 'purple');
  assert.equal(saved.color, 'rose'); assert.equal(saved.kind, 'checklist'); assert.equal(saved.body, 'Keep this too');
  await reopened.update(note.id, { icon: null, iconColor: null });
  await reopened.setSectionAppearance('work', { icon: null, iconColor: null });
  assert.equal((await reopened.get(note.id)).icon, null);
  assert.equal((await reopened.read()).folders.find(f => f.id === 'work').iconColor, null);
});

test('old regular and demo notebooks gain defaults without losing content', async t => {
  const { store } = await fixture(t);
  const note = await store.create({ title: 'Regular', icon: 'lucide:music' });
  await store.setSectionAppearance('all', { icon: 'lucide:star', iconColor: 'amber' });
  await store.setDemoMode(true);
  await store.setSectionAppearance('all', { icon: 'lucide:heart', iconColor: 'pink' });
  assert.equal((await store.read()).sectionAppearances.all.icon, 'lucide:heart');
  await store.setDemoMode(false);
  assert.equal((await store.get(note.id)).icon, 'lucide:music');
  assert.equal((await store.read()).sectionAppearances.all.icon, 'lucide:star');
  await store.setDemoMode(true);
  const old = await store.read();
  for (const notebook of [old, old.demo.normal]) {
    delete notebook.sectionAppearances;
    for (const row of [...notebook.folders, ...notebook.notes]) { delete row.icon; delete row.iconColor; }
  }
  await fs.writeFile(store.file, JSON.stringify(old));
  const migrated = await store.read();
  assert.deepEqual(migrated.sectionAppearances, {});
  assert.equal(migrated.folders[0].icon, null); assert.equal(migrated.notes[0].iconColor, null);
  await store.setDemoMode(false);
  assert.equal((await store.get(note.id)).title, 'Regular');
  assert.equal((await store.get(note.id)).icon, null);
});

test('images are portable, unknown glyphs are retained, and invalid appearance writes leave data intact', async t => {
  const { dir, store } = await fixture(t);
  assert.ok(validImageIcon(image));
  const note = await store.create({ title: 'Image', icon: image, iconColor: 'green' });
  await store.setSectionAppearance('work', { icon: image });
  assert.equal((await new NoteStore(dir).init()).file, store.file);
  assert.equal((await store.get(note.id)).icon, image);
  await store.update(note.id, { icon: 'lucide:future-glyph' });
  const before = await fs.readFile(store.file, 'utf8');
  for (const input of [{ icon: 'https://example.com/icon.png' }, { icon: 'data:image/svg+xml;base64,PHN2Zz4=' }, { icon: 'data:image/png;base64,AAAA' }, { icon: image + 'AAAA' }, { iconColor: 'chartreuse' }, { icon: 'lucide:rocket', body: 'Overwrite' }]) {
    await assert.rejects(() => store.setSectionAppearance('work', input));
  }
  await assert.rejects(() => store.setSectionAppearance('missing', { icon: 'lucide:star' }));
  await assert.rejects(() => store.update(note.id, { icon: 'lucide:heart', expectedRevision: note.revision }));
  assert.equal(await fs.readFile(store.file, 'utf8'), before);
});

test('an editor preserves icon choices through autosave and draft recovery', async t => {
  const { store } = await fixture(t);
  const note = await store.create({ title: 'Draft', icon: 'lucide:star', iconColor: 'amber' });
  let recovery;
  const autosave = new NoteAutosave(note, { update: async (id, patch) => ({ ok: true, value: await store.update(id, patch) }) }, { changed: () => {}, retain: draft => { recovery = draft; }, clear: () => { recovery = null; }, delay: 60_000 });
  t.after(() => autosave.dispose());
  autosave.update({ body: 'Writing', icon: 'lucide:music', iconColor: 'teal' });
  assert.equal(recovery.icon, 'lucide:music');
  assert.equal(await autosave.save(), true);
  autosave.update({ body: 'More writing' });
  assert.equal(await autosave.save(), true);
  assert.equal((await store.get(note.id)).icon, 'lucide:music');
  assert.equal((await store.get(note.id)).iconColor, 'teal');
  assert.equal(recovery, null);
});
