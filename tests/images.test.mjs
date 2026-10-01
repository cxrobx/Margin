import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { NoteStore, ConflictError } from '../shared/store.mjs';
import { NoteAutosave } from '../renderer/note-autosave.mjs';
import { attachmentUrl, imageAttachmentId, MAX_ATTACHMENT_BYTES, separateAttachments } from '../shared/attachments.mjs';
import { exportBackup, prepareBackup, applyBackup, exportMarkdown, importMarkdown } from '../shared/notebook-features.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const file = { size: png.length, name: 'Clipboard.png', arrayBuffer: async () => png };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'margin-images-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, store: await new NoteStore(dir).init() };
}
test('pasted images persist locally and stale pastes leave no extra files', async t => {
  const { dir, store } = await fixture(t);
  const note = await store.create({ title: 'Pictures' });
  const pasted = await store.attachImage(note.id, png, '../../Clipboard.jpg', note.revision);
  assert.equal(pasted.attachment.name, 'Clipboard.png');
  assert.equal(pasted.attachment.inline, true);
  assert.deepEqual(await fs.readFile((await store.attachmentPath(pasted.attachment.id)).path), png);
  assert.equal((await fs.stat((await store.attachmentPath(pasted.attachment.id)).path)).mode & 0o777, 0o600);
  await assert.rejects(() => store.attachImage(note.id, png, 'Stale.png', note.revision), ConflictError);
  await assert.rejects(() => store.attachImage(note.id, Buffer.from('<svg/>'), 'Bad.png', pasted.note.revision), /read/);
  await assert.rejects(() => store.attachImage(note.id, new Uint8Array(MAX_ATTACHMENT_BYTES + 1), 'Huge.png', pasted.note.revision), /25 MB/);
  assert.equal((await fs.readdir(path.join(dir, 'attachments'))).length, 1);
  const reopened = await new NoteStore(dir).init();
  assert.deepEqual((await reopened.get(note.id)).attachments, [pasted.attachment]);
  assert.equal(imageAttachmentId(attachmentUrl(pasted.attachment.id)), pasted.attachment.id);
  for (const src of ['https://example.com/image.png', 'data:image/png;base64,abc', attachmentUrl(pasted.attachment.id) + '?extra', 'margin://attachment/../notes.json']) assert.equal(imageAttachmentId(src), undefined);
});
test('inline image positions survive portable backups and Markdown export/import', async t => {
  const { dir, store } = await fixture(t);
  let note = await store.create({ title: 'Pictures', body: 'Before\n\nAfter' });
  const pasted = await store.attachImage(note.id, png, 'Clipboard.png', note.revision);
  note = await store.update(note.id, { body: `Before\n\n![Picture](${attachmentUrl(pasted.attachment.id)})\n\nAfter`, expectedRevision: pasted.note.revision });
  const archive = path.join(dir, 'backup.json');
  await fs.writeFile(archive, JSON.stringify(await exportBackup(store)));
  for (const mode of ['merge', 'replace']) {
    const target = await fixture(t);
    await applyBackup(target.store, await prepareBackup(target.store, archive), mode, (await target.store.read()).revision);
    const imported = (await target.store.read()).notes[0];
    assert.notEqual(imported.attachments[0].id, pasted.attachment.id);
    assert.equal(imported.body, note.body.replace(pasted.attachment.id, imported.attachments[0].id));
    assert.deepEqual(await fs.readFile((await target.store.attachmentPath(imported.attachments[0].id)).path), png);
  }
  const markdown = path.join(dir, 'export', 'Pictures.md');
  await exportMarkdown(store, markdown, { noteId: note.id });
  const text = await fs.readFile(markdown, 'utf8');
  assert.equal(text.includes('margin://attachment/'), false);
  assert.equal(text.match(/!\[/g).length, 1);
  assert.match(text, /Before\n\n!\[Picture\]\(attachments\/[^)]+\)\n\nAfter/);
  const [imported] = await importMarkdown(store, [markdown]);
  assert.equal(imported.body.trim(), note.body.replace(pasted.attachment.id, imported.attachments[0].id));
  assert.deepEqual(separateAttachments(imported), []);
  assert.deepEqual(separateAttachments({ ...note, body: 'Image removed by undo' }), []);
});
test('empty-note pastes create once, serialize repeated images, and flush their Markdown before closing', async t => {
  const { store } = await fixture(t);
  const writes = [];
  let release;
  const decoding = new Promise(resolve => { release = resolve; });
  const initial = { title: '', body: '', folderId: 'inbox', color: 'paper', kind: 'note', pinned: false };
  const api = {
    create: async fields => { writes.push('create'); return { ok: true, value: await store.create(fields) }; },
    update: async (id, fields) => ({ ok: true, value: await store.update(id, fields) }),
    pasteImage: async (id, image, revision) => { writes.push('image'); return { ok: true, value: await store.attachImage(id, image.bytes, image.name, revision) }; }
  };
  const autosave = new NoteAutosave(initial, api, { delay: 60_000, changed: () => {}, retain: () => {}, clear: () => {} });
  t.after(() => autosave.dispose());
  const insert = attachment => autosave.update({ body: autosave.draft.body + `\n\n![Picture](${attachmentUrl(attachment.id)})` });
  const first = autosave.pasteImage({ ...file, arrayBuffer: () => decoding }, insert);
  const second = autosave.pasteImage(file, insert);
  const closing = autosave.save();
  autosave.update({ body: 'Typing while the clipboard is being read' });
  release(png);
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(await closing, true);
  assert.deepEqual(writes, ['create', 'image', 'image']);
  const saved = await store.get(autosave.draft.id);
  assert.equal(saved.body, autosave.draft.body);
  assert.match(saved.body, /^Typing while/);
  assert.equal(saved.attachments.length, 2);
  assert.equal(autosave.status, 'Saved');
});
test('an image conflict preserves newer typing and a failed paste never inserts a broken reference', async () => {
  let resolve;
  const response = new Promise(done => { resolve = done; });
  const initial = { id: 'note', title: 'Pictures', body: 'Original', revision: 1, attachments: [] };
  const autosave = new NoteAutosave(initial, {
    pasteImage: () => response
  }, { delay: 60_000, changed: () => {}, retain: () => {}, clear: () => {} });
  let inserted = false;
  const pending = autosave.pasteImage(file, () => { inserted = true; });
  while (!autosave.paused) await new Promise(done => setImmediate(done));
  autosave.update({ body: 'Keep this typing' });
  resolve({ ok: false, conflict: true, error: 'Changed elsewhere' });
  assert.equal(await pending, false);
  assert.equal(inserted, false);
  assert.equal(autosave.draft.body, 'Keep this typing');
  assert.equal(await autosave.save(), false);
  autosave.dispose();
});
