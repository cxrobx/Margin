import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { NoteStore } from '../shared/store.mjs';
import { noteHistory, restoreNoteVersion, duplicateNote, exportBackup, prepareBackup, applyBackup, listBackups, importMarkdown, exportMarkdown, collectMarkdown } from '../shared/notebook-features.mjs';
import { noteLink, noteIdFromLink } from '../shared/note-links.mjs';
import { matchesNote, searchParts, rehypeSearch } from '../renderer/search.mjs';
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'margin-features-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, store: await new NoteStore(dir).init() };
}
test('history retains user and assistant writing, restores attachments, and rejects stale edits', async t => {
  const { dir, store } = await fixture(t);
  const first = await store.create({ title: 'Decisions', body: 'Original', source: 'Codex' });
  const file = path.join(dir, 'local.txt'); await fs.writeFile(file, 'attachment');
  const attached = await store.attach(first.id, file);
  await store.update(first.id, { body: 'Changed', source: 'You', expectedRevision: attached.revision });
  await store.append(first.id, 'Assistant input', 'Claude');
  const entries = await noteHistory(store, first.id);
  assert.equal(entries[0].note.body, 'Changed\n\nAssistant input');
  assert.ok(entries.some(entry => entry.note.body === 'Original' && entry.note.attachments.length === 1));
  await assert.rejects(() => restoreNoteVersion(store, first.id, attached.revision, first.revision), /changed/);
  const restored = await restoreNoteVersion(store, first.id, attached.revision, entries[0].revision);
  assert.equal(restored.body, 'Original'); assert.equal(restored.attachments.length, 1);
  assert.ok((await noteHistory(store, first.id)).some(entry => entry.note.body === 'Changed\n\nAssistant input'));
  assert.equal((await new NoteStore(dir).init().then(store => noteHistory(store, first.id)))[0].note.body, 'Original');
});
test('history discovers existing backup versions and stays separate in demo and reset notebooks', async t => {
  const { dir, store } = await fixture(t);
  const note = await store.create({ title: 'Before upgrade', body: 'Old body' });
  const updated = await store.update(note.id, { body: 'New body' });
  await fs.rm(path.join(dir, 'history'), { recursive: true, force: true });
  assert.ok((await noteHistory(store, note.id)).some(entry => entry.note.body === 'Old body'));
  assert.equal((await restoreNoteVersion(store, note.id, note.revision, updated.revision)).body, 'Old body');
  await store.setDemoMode(true); await assert.rejects(() => noteHistory(store, note.id), /not found/);
  await store.setDemoMode(false); assert.equal((await noteHistory(store, note.id))[0].note.body, 'Old body');
  await store.resetNotebook((await store.read()).revision); await assert.rejects(() => noteHistory(store, note.id), /not found/);
});
test('portable backup merge remaps notes and attachments without changing current notes or preferences', async t => {
  const source = await fixture(t), target = await fixture(t);
  const note = await source.store.create({ title: 'Imported note', body: '**Markdown**', folderId: 'work' });
  const file = path.join(source.dir, 'asset.txt'); await fs.writeFile(file, 'portable data'); await source.store.attach(note.id, file);
  const archive = path.join(target.dir, 'portable.json'); await fs.writeFile(archive, JSON.stringify(await exportBackup(source.store)));
  const existing = await target.store.create({ title: 'Keep me', body: 'Unchanged' });
  await target.store.setSettings({ theme: 'dark' });
  const plan = await prepareBackup(target.store, archive);
  const original = await target.store.read();
  await applyBackup(target.store, plan, 'merge', original.revision);
  const state = await target.store.read(); assert.equal(state.notes.length, 2); assert.deepEqual(await target.store.get(existing.id), existing); assert.equal(state.settings.theme, 'dark');
  const imported = state.notes.find(note => note.title === 'Imported note');
  assert.notEqual(imported.id, note.id); assert.equal(imported.folderId, 'work');
  assert.equal(await fs.readFile((await target.store.attachmentPath(imported.attachments[0].id)).path, 'utf8'), 'portable data');
});
test('backup restore is atomic, preserves settings, saves a rollback snapshot, and rejects stale previews', async t => {
  const { dir, store } = await fixture(t); const note = await store.create({ title: 'Restore me' });
  const file = path.join(dir, 'backup.json'); await fs.writeFile(file, JSON.stringify(await exportBackup(store)));
  const plan = await prepareBackup(store, file); const before = await store.read();
  await store.create({ title: 'Later note' });
  await assert.rejects(() => applyBackup(store, plan, 'replace', before.revision), /changed/);
  await store.setSettings({ theme: 'dark' }); const latest = await store.read();
  await applyBackup(store, plan, 'replace', latest.revision);
  const restored = await store.read(); assert.equal(restored.notes.length, 1); assert.equal(restored.notes[0].id, note.id); assert.equal(restored.settings.theme, 'dark'); assert.notEqual(restored.notebookId, latest.notebookId);
  const backups = await listBackups(store); const last = JSON.parse(await fs.readFile(path.join(dir, 'backups', backups[0].name), 'utf8'));
  assert.equal(last.notes.length, 2);
});
test('invalid archives and missing attachments leave the notebook intact', async t => {
  const { dir, store } = await fixture(t); const note = await store.create({ title: 'Protected' });
  const state = await store.read(); const raw = await exportBackup(store);
  raw.notes[0].attachments = [{ id: note.id, filename: '../notes.json', name: 'bad', size: 1, mime: 'text/plain' }];
  const file = path.join(dir, 'bad.json'); await fs.writeFile(file, JSON.stringify(raw));
  await assert.rejects(() => prepareBackup(store, file), /filename/);
  assert.deepEqual(await store.read(), state);
  raw.notes[0].attachments[0].filename = 'missing.txt'; await fs.writeFile(file, JSON.stringify(raw));
  await assert.rejects(() => prepareBackup(store, file), /ENOENT/);
  raw.notes[0].attachments[0].data = 'YQ=='; await fs.writeFile(file, JSON.stringify(raw));
  const plan = await prepareBackup(store, file);
  await assert.rejects(() => applyBackup(store, plan, 'invalid', state.revision), /Choose/);
  assert.deepEqual(await store.read(), state);
});
test('duplicate preserves formatting and attachment copies while giving the note its own identity', async t => {
  const { dir, store } = await fixture(t);
  const note = await store.create({ title: 'Template', body: '- [ ] Repeat', color: 'sage', pinned: true, source: 'Codex' });
  const file = path.join(dir, 'file.txt'); await fs.writeFile(file, 'Data'); await store.attach(note.id, file);
  const copy = await duplicateNote(store, note.id);
  assert.notEqual(copy.id, note.id); assert.equal(copy.title, 'Template (copy)'); assert.equal(copy.pinned, false); assert.equal(copy.source, 'You'); assert.equal(copy.color, 'sage'); assert.equal(copy.attachments.length, 1);
  await store.update(copy.id, { body: 'Independent' }); assert.equal((await store.get(note.id)).body, '- [ ] Repeat');
});
test('Markdown folder exports readable files and copied attachments; import preserves headings and folders', async t => {
  const source = await fixture(t), target = await fixture(t);
  const note = await source.store.create({ title: 'A / useful thought', body: '## Heading\n\n**Strong**\n\n- [ ] Task', folderId: 'work' });
  const file = path.join(source.dir, 'a [file].txt'); await fs.writeFile(file, 'asset'); await source.store.attach(note.id, file);
  const output = path.join(source.dir, 'markdown');
  await exportMarkdown(source.store, output, { folderId: 'work' });
  const files = await collectMarkdown(output); assert.equal(files.length, 1); assert.equal(files[0].folderName, 'Work');
  const markdown = await fs.readFile(files[0].file, 'utf8'); assert.match(markdown, /^# A \/ useful thought/); assert.match(markdown, /\*\*Strong\*\*/); assert.match(markdown, /attachments\//);
  const created = await importMarkdown(target.store, files, 'inbox', true);
  assert.equal(created[0].folderId, 'work'); assert.equal(created[0].attachments.length, 1); assert.equal(await fs.readFile((await target.store.attachmentPath(created[0].attachments[0].id)).path, 'utf8'), 'asset'); assert.equal(created[0].title, 'A / useful thought'); assert.ok(created[0].body.includes('## Heading'));
  const invalid = path.join(source.dir, 'binary.md'); await fs.writeFile(invalid, 'oops\0'); const before = await target.store.read();
  await assert.rejects(() => importMarkdown(target.store, [files[0].file, invalid]), /text files/); assert.deepEqual(await target.store.read(), before);
});
test('note links accept exact note IDs; search highlights text without modifying URLs or injecting markup', () => {
  const id = '34b830fc-1248-4c5c-83b3-48a852c36998'; assert.equal(noteIdFromLink(noteLink(id)), id);
  for (const url of ['margin://attachment/'+id, 'https://note/'+id, 'margin://note/../../file', noteLink(id)+'?query=x']) assert.throws(() => noteIdFromLink(url));
  assert.equal(searchParts('One one ONE', 'one').filter(part => part.match).length, 3);
  const tree = { children: [{ type: 'element', tagName: 'a', properties: { href: 'https://needle.test' }, children: [{ type: 'text', value: '<needle>' }] }] };
  rehypeSearch({ query: 'needle' })(tree); assert.equal(tree.children[0].properties.href, 'https://needle.test'); assert.equal(tree.children[0].children[1].tagName, 'mark');
  assert.ok(matchesNote({ title: 'Title', body: 'Body', attachments: [{ name: 'Needle.txt' }] }, ' NEEDLE '));
});
test('Alfred capture saves multiline Unicode input, respects demo mode, and rejects empty input', async t => {
  const { dir, store } = await fixture(t);
  const capture = input => new Promise(resolve => {
    const child = spawn(process.execPath, [path.resolve('scripts/capture.mjs')], { env: { ...process.env, MARGIN_DATA_DIR: dir } }); let output = '', error = '';
    child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => error += chunk);
    child.on('close', code => resolve({ code, output, error })); child.stdin.end(input);
  });
  const result = await capture('  \nCafé 📝\nSecond line $(echo nope)'); assert.equal(result.code, 0); assert.equal(JSON.parse(result.output).title, 'Café 📝');
  assert.equal((await store.list()).notes[0].body, '  \nCafé 📝\nSecond line $(echo nope)');
  const empty = await capture('   '); assert.equal(empty.code, 1); assert.match(empty.error, /clipboard is empty/);
  await store.setDemoMode(true); assert.equal(JSON.parse((await capture('Demo capture')).output).demoMode, true);
  await store.setDemoMode(false); assert.equal((await store.list()).notes.length, 1);
});
