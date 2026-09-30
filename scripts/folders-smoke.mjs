import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Nested folders, each parent's remembered sub-tab, and section dividers, driven through the panel.
export async function runSmoke(win, store, panel) {
  const run = code => win.webContents.executeJavaScript(`{ ${code} }`, true).catch(e => { throw new Error(`Renderer check failed: ${code}\n${e.message}`); });
  const wait = async code => { for (let i = 0; i < 80; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timed out: ${code}`); };
  const screenshot = async name => { const dir = process.env.MARGIN_ARTIFACTS_DIR || path.join(store.dir, 'artifacts'); await fs.mkdir(dir, { recursive: true }); await new Promise(r => setTimeout(r, 200)); await fs.writeFile(path.join(dir, name), (await win.webContents.capturePage()).toPNG()); };
  const top = name => run(`Array.from(document.querySelectorAll('.folders > .folder-tab')).find(el => el.textContent === ${JSON.stringify(name)}).click()`);
  const sub = name => run(`Array.from(document.querySelectorAll('.subfolders > .subfolder-tab[data-folder-id]')).find(el => el.textContent === ${JSON.stringify(name)}).click()`);
  const subAll = parentId => run(`document.querySelector('[data-subfolder-all="${parentId}"]').click()`);
  const label = text => run(`document.querySelector('[aria-label=${JSON.stringify(text)}]').click()`);
  const button = text => run(`Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === ${JSON.stringify(text)}).click()`);
  const type = (selector, value) => run(`const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));`);
  const heading = () => run(`document.querySelector('.section-heading h2').textContent`);
  const cards = () => run(`Array.from(document.querySelectorAll('.notes-scroll > .note-card')).map(el => el.querySelector('.card-title').textContent)`);
  const rows = () => run(`Array.from(document.querySelectorAll('.subfolders')).map(row => Array.from(row.querySelectorAll('.subfolder-tab')).map(tab => (tab.classList.contains('selected') ? '*' : '') + tab.textContent))`);
  const items = () => run(`Array.from(document.querySelectorAll('.notes-scroll > .note-card, .notes-scroll > .note-divider')).map(el => el.classList.contains('note-divider') ? '§' + (el.textContent || '') : el.querySelector('.card-title').textContent)`);
  const view = async (expectedHeading, expectedCards) => {
    await wait(`document.querySelector('.section-heading h2').textContent === ${JSON.stringify(expectedHeading)} && document.querySelectorAll('.notes-scroll > .note-card').length === ${expectedCards.length}`);
    assert.deepEqual((await cards()).sort(), [...expectedCards].sort(), `Notes shown in ${expectedHeading}`);
  };

  const clientA = await store.createFolder('Client A', 'sky', 'work');
  const drafts = await store.createFolder('Drafts', 'sand', clientA.id);
  const clientB = await store.createFolder('Client B', 'rose', 'work');
  for (const [title, folderId] of [['Work plan', 'work'], ['Client A brief', clientA.id], ['Draft proposal', drafts.id], ['Client B call', clientB.id], ['Groceries', 'personal']]) await store.create({ title, folderId });
  panel.show(); await wait(`document.querySelectorAll('.note-card').length === 5`);
  assert.deepEqual(await run(`Array.from(document.querySelectorAll('.folders > .folder-tab')).map(el => el.textContent)`), ['All', 'Inbox', 'Work', 'Personal'], 'Only top-level folders sit in the top row');
  assert.deepEqual(await rows(), []);

  // A parent shows its own notes and every descendant's, with a row per level.
  await top('Work'); await view('Work', ['Work plan', 'Client A brief', 'Draft proposal', 'Client B call']);
  assert.deepEqual(await rows(), [['*All', 'Client A', 'Client B']]);
  await sub('Client A'); await view('Client A', ['Client A brief', 'Draft proposal']);
  assert.deepEqual(await rows(), [['All', '*Client A', 'Client B'], ['*All', 'Drafts']]);
  await sub('Drafts'); await view('Drafts', ['Draft proposal']);
  assert.equal(await run(`document.querySelector('.folders > .folder-tab.selected').textContent`), 'Work', 'The top tab stays on the ancestor');
  await screenshot('margin-nested-folders.png');

  // Each parent remembers its last sub-tab, whether that was All or a child.
  await top('All'); await view('All notes', ['Work plan', 'Client A brief', 'Draft proposal', 'Client B call', 'Groceries']);
  await top('Work'); await view('Drafts', ['Draft proposal']);
  assert.deepEqual(await rows(), [['All', '*Client A', 'Client B'], ['All', '*Drafts']]);
  await subAll(clientA.id); await view('Client A', ['Client A brief', 'Draft proposal']);
  await top('Personal'); await top('Work'); await view('Client A', ['Client A brief', 'Draft proposal']);
  await subAll('work'); await top('All'); await top('Work'); await view('Work', ['Work plan', 'Client A brief', 'Draft proposal', 'Client B call']);
  await sub('Client B'); await view('Client B', ['Client B call']);
  win.webContents.reload(); await wait(`document.querySelectorAll('.folders > .folder-tab').length === 4`);
  await top('Work'); await view('Client B', ['Client B call']);
  await sub('Client A'); await view('Client A', ['Client A brief', 'Draft proposal']);
  assert.deepEqual(await rows(), [['All', '*Client A', 'Client B'], ['*All', 'Drafts']], 'Client A still remembers All after a reload');

  // New folders inside, moving one to the top level, and paths in the note editor.
  await top('Work'); await sub('Client B'); await view('Client B', ['Client B call']);
  await label('Notebook options'); await button('New folder inside…');
  await wait(`document.querySelector('[aria-label="Folder location"]')?.selectedOptions[0].textContent === 'Work / Client B'`);
  await type('[aria-label="Folder name"]', 'Invoices'); await button('Create folder');
  await wait(`document.querySelector('.section-heading h2').textContent === 'Invoices'`);
  let invoices = (await store.read()).folders.find(f => f.name === 'Invoices');
  assert.equal(invoices.parentId, clientB.id);
  assert.deepEqual(await rows(), [['All', 'Client A', '*Client B'], ['All', '*Invoices']]);
  assert.equal(await run(`Boolean(document.querySelector('[aria-label="New folder in Client B"]'))`), true, 'Client B can hold more third-level folders');
  await label('Notebook options'); assert.equal(await run(`Array.from(document.querySelectorAll('.notebook-menu button')).some(el => el.textContent === 'New folder inside…')`), false, 'A third-level folder offers no deeper folders');
  await button('Rename or move folder…');
  assert.equal(await run(`Array.from(document.querySelector('[aria-label="Folder location"]').options).some(o => o.textContent.startsWith('Work / Client A / Drafts'))`), false, 'A folder cannot move below the third level');
  await type('[aria-label="Folder location"]', ''); await button('Save folder');
  await wait(`Array.from(document.querySelectorAll('.folders > .folder-tab')).some(el => el.textContent === 'Invoices')`);
  invoices = (await store.read()).folders.find(f => f.name === 'Invoices');
  assert.equal(invoices.parentId, null);
  await top('All'); await label('New note');
  await wait(`Boolean(document.querySelector('[aria-label="Note settings"]'))`); await label('Note settings');
  await wait(`Boolean(document.querySelector('[aria-label="Note folder"]'))`);
  const options = await run(`Array.from(document.querySelector('[aria-label="Note folder"]').options).map(o => o.textContent)`);
  assert.ok(options.includes('Work / Client A / Drafts') && options.includes('Invoices'), `Editor folder paths: ${options}`);
  const escapeEditor = () => run(`document.querySelector('.editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await escapeEditor(); await wait(`!document.querySelector('[aria-label="Note folder"]')`);
  await escapeEditor(); await wait(`!document.querySelector('.editor')`);
  assert.equal((await store.read()).notes.length, 5, 'Closing an empty new note saves nothing');

  // Right-click free space to add a section; it sits where you clicked and belongs to this view.
  await top('Work'); await subAll('work'); await view('Work', ['Work plan', 'Client A brief', 'Draft proposal', 'Client B call']);
  const order = await cards();
  const rightClick = y => run(`const scroller = document.querySelector('.notes-scroll'); scroller.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: ${y} }))`);
  const gapAfterFirst = await run(`const [a, b] = document.querySelectorAll('.notes-scroll > .note-card'); (a.getBoundingClientRect().bottom + b.getBoundingClientRect().top) / 2`);
  await rightClick(gapAfterFirst); await wait(`Boolean(document.querySelector('.context-menu'))`);
  await screenshot('margin-section-menu.png');
  await button('Add section here');
  await wait(`document.activeElement?.getAttribute('aria-label') === 'Section name'`);
  await type('[aria-label="Section name"]', 'This week');
  await run(`document.querySelector('[aria-label="Section name"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await wait(`document.querySelector('.note-divider-label')?.textContent === 'This week'`);
  assert.deepEqual(await items(), [order[0], '§This week', ...order.slice(1)]);
  const bottom = await run(`document.querySelector('.notes-scroll').getBoundingClientRect().bottom - 8`);
  await rightClick(bottom); await button('Add section here');
  await wait(`document.activeElement?.getAttribute('aria-label') === 'Section name'`);
  await run(`document.querySelector('[aria-label="Section name"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await wait(`document.querySelectorAll('.note-divider').length === 2 && !document.querySelector('[aria-label="Section name"]')`);
  assert.deepEqual(await items(), [order[0], '§This week', ...order.slice(1), '§'], 'A click below the last note adds an unlabelled line at the end');
  let state = await store.read();
  assert.deepEqual(state.dividers.map(d => [d.view, d.label]), [['work', 'This week'], ['work', '']]);
  await screenshot('margin-sections.png');
  await run(`const d = document.querySelector('.note-divider'); d.focus(); d.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }))`);
  await wait(`document.querySelector('.notes-scroll').firstElementChild?.classList.contains('note-divider')`);
  assert.deepEqual(await items(), ['§This week', ...order, '§'], 'Option ↑ moves a section like a note');
  await run(`document.querySelector('.note-divider').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await type('[aria-label="Section name"]', 'Scratch');
  await run(`document.querySelector('[aria-label="Section name"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(`!document.querySelector('[aria-label="Section name"]')`);
  assert.equal(await run(`document.querySelector('.note-divider-label').textContent`), 'This week', 'Escape keeps the old name');
  assert.equal(panel.motion.visible, true, 'Escape while naming a section must not hide the panel');
  await sub('Client A'); assert.equal(await run(`document.querySelectorAll('.note-divider').length`), 0, 'Sections belong to the view they were added in');
  await top('All'); assert.equal(await run(`document.querySelectorAll('.note-divider').length`), 0);
  await top('Work'); await subAll('work');
  await wait(`document.querySelectorAll('.note-divider').length === 2`);
  await type('[aria-label="Search notes"]', 'plan');
  await wait(`document.querySelectorAll('.note-divider').length === 0`);
  await label('Clear search'); await wait(`document.querySelectorAll('.note-divider').length === 2`);
  await run(`document.querySelector('.note-divider.unlabelled').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 300 }))`);
  await button('Remove section'); await wait(`document.querySelectorAll('.note-divider').length === 1`);

  // Removing a subfolder moves its notes and folders up into the parent.
  await sub('Client A'); await subAll(clientA.id); await view('Client A', ['Client A brief', 'Draft proposal']);
  await label('Notebook options'); await button('Remove folder · keep notes');
  await view('Work', ['Work plan', 'Client A brief', 'Draft proposal', 'Client B call']);
  state = await store.read();
  assert.equal(state.notes.find(n => n.title === 'Client A brief').folderId, 'work');
  assert.equal(state.folders.find(f => f.id === drafts.id).parentId, 'work');
  assert.deepEqual(await rows(), [['*All', 'Drafts', 'Client B']]);
  console.log('Folders smoke passed: three-level nesting with descendant notes, one sub-tab row per level, remembered sub-tabs (All or a child) across reloads, New folder inside, moving a folder, path labels in the editor, right-click sections placed at the pointer, naming, Escape, Option ↑, per-view sections hidden in search, removing a section, and removing a subfolder into its parent.');
}
