import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NoteAutosave } from '../renderer/note-autosave.mjs';

const blank = { title: '', body: '', color: 'paper', folderId: 'inbox', kind: 'note', pinned: false };
const note = { ...blank, id: 'note-1', title: 'A note', body: 'Original', revision: 1, attachments: [] };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function session(initial, api, delay = 5) {
  let recovery = null;
  const autosave = new NoteAutosave(initial, api, { delay, changed: () => {}, retain: draft => { recovery = draft; }, clear: () => { recovery = null; } });
  return { autosave, recovery: () => recovery };
}

test('an untouched or empty new note never creates a notebook entry', async () => {
  const { autosave } = session(blank, { create: () => { throw new Error('Should not create'); } });
  assert.equal(await autosave.save(), true);
  autosave.update({ title: '   ' });
  assert.equal(await autosave.save(), true);
  assert.equal(autosave.status, '');
  autosave.dispose();
});

test('pausing creates once and later edits use the returned revision', async () => {
  const calls = [];
  const saved = deferred();
  const { autosave, recovery } = session(blank, {
    create: async fields => { calls.push(fields); return { ok: true, value: { ...fields, id: 'created', revision: 1, attachments: [] } }; },
    update: async (id, fields) => { calls.push({ id, ...fields }); saved.resolve(); return { ok: true, value: { ...fields, id, revision: 2, attachments: [] } }; }
  });
  autosave.update({ body: 'A thought' });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(autosave.draft.id, 'created');
  assert.equal(calls[0].title, 'A thought');
  assert.equal(recovery(), null);
  autosave.update({ body: 'Another thought' });
  await saved.promise;
  await autosave.save();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].id, 'created');
  assert.equal(calls[1].expectedRevision, 1);
  assert.equal(autosave.status, 'Saved');
  autosave.dispose();
});

test('typing during a pending creation is retained and serialized without duplicates', async () => {
  const first = deferred();
  const calls = [];
  const { autosave, recovery } = session(blank, {
    create: fields => { calls.push(fields); return first.promise; },
    update: async (id, fields) => { calls.push({ id, ...fields }); return { ok: true, value: { id, ...fields, revision: 2, attachments: [] } }; }
  }, 60_000);
  autosave.update({ title: 'Start', body: 'First' });
  const pending = autosave.save();
  await Promise.resolve();
  autosave.update({ body: 'Typed while saving', color: 'sage', bodyHeight: 220 });
  assert.equal(recovery().body, 'Typed while saving');
  assert.equal(autosave.save(), pending);
  first.resolve({ ok: true, value: { ...calls[0], id: 'created', revision: 1, attachments: [] } });
  assert.equal(await pending, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body, 'Typed while saving');
  assert.equal(calls[1].bodyHeight, 220, 'Resizing during a pending creation saves with the latest typing');
  assert.equal(calls[1].expectedRevision, 1);
  assert.equal(autosave.draft.body, 'Typed while saving');
  assert.equal(recovery(), null);
  autosave.dispose();
});

test('leaving immediately flushes the debounce and saves clearing an existing note', async () => {
  const updates = [];
  const { autosave } = session(note, { update: async (id, fields) => { updates.push(fields); return { ok: true, value: { ...note, ...fields, revision: 2 } }; } }, 60_000);
  autosave.update({ title: '', body: '' });
  assert.equal(await autosave.save(), true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].body, '');
  assert.equal(updates[0].title, 'Untitled note');
  autosave.dispose();
});

test('a conflicting assistant edit blocks further writes and preserves the current draft', async () => {
  let writes = 0;
  const { autosave, recovery } = session(note, { update: async () => { writes++; return { ok: false, conflict: true, error: 'Changed elsewhere' }; } }, 60_000);
  autosave.update({ body: 'My draft' });
  assert.equal(await autosave.save(), false);
  autosave.update({ body: 'Still writing' });
  assert.equal(await autosave.save(), false);
  assert.equal(writes, 1);
  assert.equal(recovery().body, 'Still writing');
  assert.equal(autosave.conflict, true);
  autosave.reset({ ...note, body: 'Assistant edit', revision: 2 });
  assert.equal(autosave.draft.body, 'Assistant edit');
  assert.equal(autosave.dirty, false);
  assert.equal(recovery(), null);
  autosave.dispose();
});

test('failed saves keep recovery data and can retry', async () => {
  let fail = true;
  const { autosave, recovery } = session(note, { update: async () => { if (fail) throw new Error('Disk unavailable'); return { ok: true, value: { ...note, revision: 2 } }; } }, 60_000);
  autosave.update({ body: 'Keep me' });
  assert.equal(await autosave.save(), false);
  assert.equal(recovery().body, 'Keep me');
  fail = false;
  assert.equal(await autosave.save(), true);
  assert.equal(recovery(), null);
  autosave.dispose();
});

test('attachment dialog pauses autosave and resumes with the attachment revision', async () => {
  const dialog = deferred();
  const opened = deferred();
  const updates = [];
  const { autosave } = session(note, {
    attach: () => { opened.resolve(); return dialog.promise; },
    update: async (id, fields) => { updates.push(fields); return { ok: true, value: { ...note, ...fields, revision: 3, attachments: [{ id: 'file' }] } }; }
  }, 60_000);
  const attaching = autosave.attach();
  await opened.promise;
  assert.equal(autosave.paused, true);
  autosave.update({ body: 'Typed during the dialog' });
  assert.equal(await autosave.save(), false);
  dialog.resolve({ ok: true, value: { ...note, revision: 2, attachments: [{ id: 'file' }] } });
  await attaching;
  await autosave.save();
  assert.equal(updates[0].expectedRevision, 2);
  assert.equal(updates[0].body, 'Typed during the dialog');
  autosave.dispose();
});

test('recovered drafts save and code autosaves keep the source buffer unchanged', async () => {
  const bodies = [];
  const { autosave } = session({ ...blank, kind: 'code', body: 'const answer = 42;', __recovered: true }, {
    create: async fields => { bodies.push(fields.body); return { ok: true, value: { ...fields, id: 'code', revision: 1, attachments: [] } }; },
    update: async (id, fields) => { bodies.push(fields.body); return { ok: true, value: { ...fields, id, revision: 2, attachments: [] } }; }
  }, 60_000);
  await autosave.save();
  assert.equal(bodies[0], '```\nconst answer = 42;\n```');
  assert.equal(autosave.draft.body, 'const answer = 42;');
  autosave.update({ body: 'const answer = 43;' });
  await autosave.save();
  assert.equal(bodies[1], '```\nconst answer = 43;\n```');
  autosave.dispose();
});
