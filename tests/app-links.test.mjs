import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAppLink, fileLink, taskLink, safeAppHref, editableLink } from '../shared/app-links.mjs';
import { referenceNodes, rehypeAppLinks } from '../renderer/app-links.mjs';
import { createLinkOpener } from '../app/document-links.mjs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../shared/store.mjs';

const file = '/Users/me/Notes/Design & café #2.md';
test('document references preserve spaces, Unicode, reserved characters, and home paths', () => {
  const href = fileLink(file);
  assert.equal(href, 'file:///Users/me/Notes/Design%20%26%20caf%C3%A9%20%232.md');
  for (const value of [file, `"${file}"`, href, href.replace('file:///', 'file://localhost/')]) assert.deepEqual(parseAppLink(value), { kind: 'document', path: file, href });
  assert.equal(parseAppLink('~/Notes/Plan.md').path, '~/Notes/Plan.md');
  assert.equal(parseAppLink('http://127.0.0.1:8765/view?src=' + encodeURIComponent(file) + '&folder=notes').path, file);
  assert.equal(parseAppLink('https://example.com/view?src=' + encodeURIComponent(file)).kind, 'web');
  assert.equal(editableLink(file), href);
  assert.equal(editableLink('example.com'), 'https://example.com');
});
test('only uppercase T-number references and explicit CXTasks links resolve to tasks', () => {
  assert.equal(taskLink('T42'), 'cxtasks://task/T42');
  assert.equal(editableLink('T42'), 'cxtasks://task/T42');
  for (const value of ['42', 't42', 'task 42', 'Task #42', '#42']) {
    assert.throws(() => taskLink(value), value);
    assert.throws(() => parseAppLink(value), value);
    assert.throws(() => editableLink(value), value);
  }
  assert.equal(parseAppLink('cxtasks://task/t42/?from=margin#details').href, 'cxtasks://task/T42');
  const id = '12345678-1234-4234-9234-123456789012';
  assert.equal(parseAppLink('cxtasks://task/' + id).reference, id);
});
test('local document links and app schemes reject remote files, executables, and mutation commands', () => {
  for (const value of ['file://server/Note.md', 'file:///tmp/app.command', '/tmp/app.sh', 'file:///tmp/note.md?run=true', 'file:///tmp/note.md#fragment', 'javascript:alert(1)', 'data:text/html,test', 'obsidian://new?vault=Notes&file=oops&content=changed', 'obsidian://open?path=/tmp/note.md&append=true', 'cxtasks://run/T42', 'cxtasks://task/T42/delete', 'https://user:password@example.com', '/tmp/evil\u0000.md']) {
    assert.throws(() => parseAppLink(value), value); assert.equal(safeAppHref(value), '', value);
  }
  assert.equal(parseAppLink('obsidian://open?path=' + encodeURIComponent(file)).kind, 'obsidian');
  assert.equal(parseAppLink('obsidian://open?vault=Notes&file=Plan%23Heading').kind, 'obsidian');
});
test('reading links copied paths and task references without touching code or nested links', () => {
  const links = value => referenceNodes(value, { cxtasksLinks: true }).filter(node => node.tagName === 'a');
  assert.equal(links(file)[0].properties.href, fileLink(file));
  assert.equal(links(`Read "${file}" tomorrow.`)[0].properties.href, fileLink(file));
  assert.deepEqual(links('Follow T42 and task 86, then #9.').map(node => node.properties.href), ['cxtasks://task/T42']);
  for (const value of ['42', 'task 42', 'Task #42', '#42', 't42', 'Follow task 42, #42 and t42.']) assert.equal(links(value).length, 0, value);
  assert.equal(links('There are 42 tasks in 2026.').length, 0);
  assert.equal(links('abcT42 path/T42 T42_more').length, 0);
  const tree = { children: [{ tagName: 'p', children: [{ type: 'text', value: 'T42' }] }, { tagName: 'code', children: [{ type: 'text', value: 'T42' }] }, { tagName: 'a', properties: { href: 'https://example.com' }, children: [{ type: 'text', value: 'T42' }] }] };
  rehypeAppLinks({ cxtasksLinks: true })(tree);
  assert.equal(tree.children[0].children.some(node => node.tagName === 'a'), true);
  assert.equal(tree.children[1].children[0].type, 'text');
  assert.equal(tree.children[2].children[0].type, 'text');
});
test('native routing chooses Onyx, offers both apps, and explicitly opens Obsidian with an encoded path', async () => {
  const launches = []; const web = [];
  const opener = createLinkOpener({ getApps: async () => ({ onyx: '/Applications/Onyx.app', obsidian: '/Applications/Obsidian.app', cxtasks: '/Applications/CXTasks.app' }), launch: async (...args) => launches.push(args), stat: async () => ({ isFile: () => true }), home: '/Users/me', openExternal: async url => web.push(url) });
  assert.deepEqual((await opener.describe(file)).choices.map(choice => choice.id), ['onyx', 'obsidian']);
  await opener.open(file);
  await opener.open(fileLink(file), 'obsidian');
  await opener.open('~/Notes/Plan.md');
  await opener.open('T42');
  await opener.open('obsidian://open?vault=Notes&file=Plan');
  await opener.open('https://example.com');
  assert.deepEqual(launches, [['/Applications/Onyx.app', file], ['/Applications/Obsidian.app', 'obsidian://open?path=' + encodeURIComponent(file)], ['/Applications/Onyx.app', '/Users/me/Notes/Plan.md'], ['/Applications/CXTasks.app', 'cxtasks://task/T42'], ['/Applications/Obsidian.app', 'obsidian://open?vault=Notes&file=Plan']]);
  assert.deepEqual(web, ['https://example.com']);
  await assert.rejects(opener.open(file, 'Terminal'), /Invalid document app/);
});
test('native routing handles Obsidian fallback, missing apps, and stale file references', async () => {
  const launches = [];
  const options = { getApps: async () => ({ obsidian: '/Applications/Obsidian.app' }), launch: async (...args) => launches.push(args), stat: async () => ({ isFile: () => true }) };
  const opener = createLinkOpener(options);
  await opener.open(file); assert.equal(launches[0][0], '/Applications/Obsidian.app');
  assert.equal((await opener.describe(file)).defaultApp, 'obsidian');
  await assert.rejects(opener.open('T42'), /Install CXTasks/);
  await assert.rejects(opener.open(file, 'onyx'), /Onyx is not installed/);
  await assert.rejects(createLinkOpener({ ...options, getApps: async () => ({}) }).open(file), /Install Onyx or Obsidian/);
  await assert.rejects(createLinkOpener({ ...options, stat: async () => { throw new Error('ENOENT'); } }).open(file), /moved/);
  await assert.rejects(createLinkOpener({ ...options, stat: async () => ({ isFile: () => false }) }).open(file), /document file/);
  assert.equal(launches.length, 1);
});

test('task links default off, migrate without rewriting notes, and persist only after opt-in', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'margin-task-opt-in-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = await new NoteStore(dir).init();
  assert.equal((await store.read()).settings.cxtasksLinks, false);
  const note = await store.create({ title: 'References', body: 'T42 task 42 42' });
  const legacy = await store.read(); delete legacy.settings.cxtasksLinks;
  await fs.writeFile(store.file, JSON.stringify(legacy));
  const before = await fs.readFile(store.file, 'utf8');
  const reopened = await new NoteStore(dir).init();
  assert.equal((await reopened.read()).settings.cxtasksLinks, false);
  assert.equal(await fs.readFile(store.file, 'utf8'), before);
  assert.equal(referenceNodes('T42').some(node => node.tagName === 'a'), false);
  assert.equal(referenceNodes(file).some(node => node.tagName === 'a'), true);
  await reopened.setSettings({ cxtasksLinks: true });
  assert.equal((await new NoteStore(dir).read()).settings.cxtasksLinks, true);
  assert.equal((await reopened.get(note.id)).body, note.body);
  await reopened.setSettings({ cxtasksLinks: false });
  assert.equal((await new NoteStore(dir).read()).settings.cxtasksLinks, false);
  await assert.rejects(reopened.setSettings({ cxtasksLinks: 'yes' }));
});

test('automatic update checks default on, migrate, and persist when turned off', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'margin-update-pref-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = await new NoteStore(dir).init();
  assert.equal((await store.read()).settings.autoUpdateCheck, true);
  const legacy = await store.read(); delete legacy.settings.autoUpdateCheck;
  await fs.writeFile(store.file, JSON.stringify(legacy));
  const reopened = await new NoteStore(dir).init();
  assert.equal((await reopened.read()).settings.autoUpdateCheck, true, 'existing notebooks keep checking');
  await reopened.setSettings({ autoUpdateCheck: false });
  assert.equal((await new NoteStore(dir).read()).settings.autoUpdateCheck, false);
  await assert.rejects(reopened.setSettings({ autoUpdateCheck: 'no' }));
});
