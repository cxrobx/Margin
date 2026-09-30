#!/usr/bin/env node
import { NoteStore } from '../shared/store.mjs';
import { noteLink } from '../shared/note-links.mjs';
let body = '';
try {
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    body += chunk;
    if (Buffer.byteLength(body) > 1_000_000) throw new Error('Capture up to 1 MB of text.');
  }
  if (!body.trim()) throw new Error('The clipboard is empty. Type n followed by your note, or copy some text first.');
  const store = await new NoteStore().init();
  const title = body.split(/\r?\n/).find(line => line.trim())?.trim().replace(/^#{1,6}\s+/, '').slice(0, 200) || 'Quick capture';
  const note = await store.create({ title, body, folderId: 'inbox', source: 'Alfred' });
  process.stdout.write(JSON.stringify({ title: note.title, url: noteLink(note.id), demoMode: Boolean((await store.read()).demo) }));
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
