import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipboard, ClipboardItem, nativeImage } from 'electron';

export async function runSmoke(win, store, panel) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const output = process.env.MARGIN_ARTIFACTS_DIR || path.join(root, 'artifacts');
  await fs.mkdir(output, { recursive: true });
  const run = code => win.webContents.executeJavaScript(`{ ${code} }`, true);
  const wait = async code => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await run(code)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${code}\n${JSON.stringify(await run(`({active:document.activeElement?.className,paste:window.smokeImagePaste,error:document.querySelector('.editor-error')?.textContent})`))}`);
  };
  const click = label => run(`document.querySelector('[aria-label="${label}"]').click()`);
  const focusBody = async () => {
    win.focus();
    await run(`document.querySelector('.rich-body').editor.commands.focus('end')`);
    await wait(`document.hasFocus() && document.activeElement === document.querySelector('.rich-body')`);
  };
  const originalClipboard = await Promise.all((await clipboard.read()).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
  const png = nativeImage.createFromPath(path.join(root, 'assets/icon.png')).resize({ width: 200 }).toPNG();
  try {
    panel.show();
    await wait(`document.querySelector('[aria-label="New note"]') && document.getElementById('root').dataset.panelMotion === 'open'`);
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
    assert.equal(await clipboard.has('image/png'), true);
    await click('New note');
    await wait(`Boolean(document.querySelector('.rich-body')?.editor)`);
    await run(`document.addEventListener('paste',event=>{window.smokeImagePaste={types:Array.from(event.clipboardData?.types||[]),files:Array.from(event.clipboardData?.files||[],file=>({type:file.type,size:file.size})),items:Array.from(event.clipboardData?.items||[],item=>({kind:item.kind,type:item.type}))}},true)`);
    await focusBody(); win.webContents.paste();
    await wait(`document.querySelector('.rich-body img')?.naturalWidth > 0 && document.querySelector('.editor-save-status')?.textContent === 'Saved'`);
    const id = await run(`document.querySelector('.editor').dataset.noteId`);
    let note = await store.get(id);
    assert.equal(note.attachments.length, 1, 'Pasting into a blank note creates and attaches the image');
    assert.match(note.body, /!\[[^\]]+\]\(margin:\/\/attachment\/[a-f0-9-]+\)/);
    assert.equal(await run(`document.querySelectorAll('.editor .attachments img').length`), 0, 'Inline pictures are not duplicated below the body');
    await run(`document.querySelector('.rich-body').editor.commands.undo()`);
    await wait(`!document.querySelector('.editor img') && document.querySelector('.editor-save-status')?.textContent === 'Saved'`);
    await run(`document.querySelector('.rich-body').editor.commands.redo()`);
    await wait(`document.querySelector('.rich-body img')?.naturalWidth > 0`);
    await click('Done editing');
    await wait(`!document.querySelector('.editor') && document.querySelector('.note-body img')?.naturalWidth > 0`);
    const reopen = async () => {
      await run(`document.querySelector('[data-note-id="${id}"] .card-title').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}))`);
      await wait(`document.querySelector('.rich-body img')?.naturalWidth > 0`);
    };
    await reopen();
    await focusBody(); win.webContents.insertText('Text after the picture');
    win.webContents.paste(); win.webContents.paste();
    await wait(`document.querySelectorAll('.rich-body img').length === 3 && document.querySelector('.editor-save-status')?.textContent === 'Saved'`);
    assert.ok(await run(`document.querySelector('.rich-body').textContent.includes('Text after the picture')`));
    await click('Done editing');
    await wait(`!document.querySelector('.editor')`);
    note = await store.get(id);
    assert.equal(note.attachments.length, 3);
    assert.equal(note.body.match(/margin:\/\/attachment\//g).length, 3);
    // A normal text paste still follows the Markdown path.
    await reopen();
    await clipboard.writeText('**Pasted text**');
    await focusBody(); win.webContents.paste();
    await wait(`document.querySelector('.rich-body strong')?.textContent === 'Pasted text'`);
    await click('Done editing'); await wait(`!document.querySelector('.editor')`);
    // Main-process validation rejects non-images without touching the note.
    const before = await store.get(id);
    const result = await run(`window.margin.pasteImage('${id}',{bytes:new Uint8Array([1,2,3]),name:'invalid.png'},${before.revision})`);
    assert.equal(result.ok, false);
    assert.deepEqual(await store.get(id), before);
    await reopen();
    await run(`const ed=document.querySelector('.rich-body').editor; ed.commands.setContent('Before\\n\\nAfter',{contentType:'markdown'}); ed.commands.setTextSelection(7); ed.commands.focus()`);
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }), 'text/html': '<p>Duplicate image HTML</p>', 'text/plain': 'Duplicate image text' })]);
    win.focus(); win.webContents.paste();
    await wait(`document.querySelector('.rich-body img')?.naturalWidth > 0 && document.querySelector('.editor-save-status')?.textContent === 'Saved'`);
    assert.match(await run(`document.querySelector('.rich-body').editor.getMarkdown()`), /Before\s+!\[[^\]]+\]\(margin:\/\/attachment\/[^)]+\)\s+After/);
    assert.equal(await run(`document.querySelector('.rich-body').textContent.includes('Duplicate image')`), false, 'Bitmap paste consumes duplicate HTML and text representations');
    await click('Done editing'); await wait(`!document.querySelector('.editor')`);
    await fs.writeFile(path.join(output, 'margin-pasted-images.png'), (await win.webContents.capturePage()).toPNG());
    const savedBody = (await store.get(id)).body;
    const reloaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    win.webContents.reload(); await reloaded;
    await wait(`document.querySelector('[data-note-id="${id}"] .note-body img')?.naturalWidth > 0`);
    await reopen();
    assert.equal(await run(`document.querySelector('.rich-body').editor.getMarkdown()`), savedBody);
    console.log('Image paste smoke passed: native clipboard, empty notes, inline placement, repeat paste, undo/redo, text paste, validation, reading/editing previews and reload persistence.');
  } finally { await clipboard.write(originalClipboard); }
}
