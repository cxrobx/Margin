import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dialog, nativeImage } from 'electron';
import { iconCandidates } from '../app/icon-images.mjs';
import { validImageIcon } from '../shared/icons.mjs';

export async function iconsSmoke({ win, store, run, waitFor, click, screenshot }) {
  const savedDialog = dialog.showOpenDialog;
  const first = (await store.list()).notes[0];
  const tab = '[data-folder-id="work"]';
  const icon = `${tab} .node-icon`;
  const close = () => click('Close icon picker');
  const pick = async label => { await click(label); await waitFor(`!document.querySelector('.icon-picker [aria-busy=true]') && document.querySelector('.icon-picker')?.getAttribute('aria-busy') === 'false'`); };
  const section = () => run(`document.querySelector('${tab}').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));`);
  await section(); await waitFor(`!!document.querySelector('.icon-picker')`);
  await pick('Use rocket icon'); await pick('purple icon color');
  assert.equal((await store.read()).folders.find(f => f.id === 'work').icon, 'lucide:rocket');
  assert.equal(await run(`document.querySelector('${icon}').dataset.icon`), 'lucide:rocket');
  await screenshot('margin-section-icon-picker.png');
  await run(`document.querySelector('.icon-picker').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));`);
  await waitFor(`!document.querySelector('.icon-picker')`);
  assert.ok(win.isVisible(), 'Escape closes only the picker');
  await run(`document.querySelector('${tab}').click()`);
  await waitFor(`document.querySelector('.section-heading .node-icon')?.dataset.icon === 'lucide:rocket'`);
  await click('Notebook options');
  await run(`Array.from(document.querySelectorAll('.notebook-menu button')).find(b => b.textContent.includes('Icon &')).click()`);
  await waitFor(`!!document.querySelector('.icon-picker')`);
  await run(`Array.from(document.querySelectorAll('.icon-picker footer button')).find(b => b.textContent.includes('Reset')).click()`);
  await waitFor(`document.querySelector('${icon}').dataset.icon === 'default'`);
  await close();
  await run(`document.querySelector('[data-folder-id="all"]').click()`);
  await click(`Actions for ${first.title}`);
  await run(`document.querySelector('[data-note-id="${first.id}"] .popup-menu button:nth-child(2)').click()`);
  await waitFor(`!!document.querySelector('.icon-picker')`);
  await pick('Use music icon'); await pick('teal icon color');
  assert.equal((await store.get(first.id)).kind, first.kind);
  assert.equal((await store.get(first.id)).body, first.body);
  assert.equal((await store.get(first.id)).color, first.color);
  await screenshot('margin-note-icon-picker.png');
  await close();
  // Imported images are converted through the actual file-dialog IPC; stub
  // only the OS dialog so the test can pick its own temporary fixture.
  const imageFile = path.join(store.dir, 'icon-fixture.png');
  const width = 100, height = 100, pixels = Buffer.alloc(width * height * 4, 255);
  for (let y = 30; y < 70; y++) for (let x = 40; x < 60; x++) {
    const offset = (y * width + x) * 4; pixels[offset] = 0; pixels[offset + 1] = 0; pixels[offset + 2] = 255;
  }
  await fs.writeFile(imageFile, nativeImage.createFromBitmap(pixels, { width, height }).toPNG());
  const variants = await iconCandidates(imageFile);
  assert.equal(variants.length, 2); assert.ok(variants.every(v => validImageIcon(v.dataUrl)));
  const cutout = nativeImage.createFromDataURL(variants[1].dataUrl);
  assert.deepEqual(cutout.getSize(), { width: 64, height: 64 });
  const trimmed = cutout.toBitmap();
  assert.equal(trimmed[3], 0); assert.ok(trimmed[(32 * 64 + 32) * 4 + 3] > 240);
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  await section(); await waitFor(`!!document.querySelector('.icon-picker')`);
  try {
    await pick('Choose image…');
    assert.equal((await store.read()).folders.find(f => f.id === 'work').icon, null);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imageFile] });
    await pick('Choose image…');
    await waitFor(`document.querySelectorAll('.icon-image-grid button').length === 2`);
    await pick('icon-fixture.png · no background');
    await pick('red icon color');
    await waitFor(`!!document.querySelector('${icon} img')`);
    assert.equal(await run(`document.querySelector('${icon}').style.color`), '', 'Images retain their own colors');
    await fs.unlink(imageFile);
    await close();
  } finally { dialog.showOpenDialog = savedDialog; }
  await win.webContents.reload();
  await waitFor(`document.querySelectorAll('.note-card').length === 6 && !!document.querySelector('${icon} img')`);
  assert.equal(await run(`document.querySelector('[data-note-id="${first.id}"] .note-type .node-icon').dataset.icon`), 'lucide:music');
  for (const themeId of ['default', 'cxtasks-glass']) {
    for (const theme of ['light', 'dark']) {
      await store.setSettings({ themeId, theme });
      await waitFor(`document.documentElement.dataset.theme === '${theme}' && document.documentElement.dataset.material === '${themeId === 'default' ? 'default' : 'glass'}'`);
      assert.ok(await run(`getComputedStyle(document.querySelector('${icon}')).display !== 'none' && document.querySelector('${icon}').getBoundingClientRect().width >= 14`), 'The chosen section icon must remain visible in every theme');
      assert.ok(await run(`document.querySelector('${icon} img').naturalWidth === 64`));
      await screenshot(`margin-icons-${themeId}-${theme}.png`);
    }
  }
  await store.setSettings({ themeId: 'default', theme: 'light' });
  await waitFor(`document.documentElement.dataset.theme === 'light'`);
  // Changing appearance in the editor saves without closing or losing typing.
  await run(`document.querySelector('[data-note-id="${first.id}"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await waitFor(`!!document.querySelector('.editor')`);
  await click('Note icon and color'); await waitFor(`!!document.querySelector('.icon-picker')`);
  await pick('Use book open icon'); await pick('orange icon color'); await close();
  assert.ok(await run(`!!document.querySelector('.editor')`));
  await click('Done editing');
  await waitFor(`!document.querySelector('.editor')`);
  assert.equal((await store.get(first.id)).icon, 'lucide:book-open');
  assert.equal((await store.get(first.id)).body, first.body);
  // Leave the existing smoke suite's demo content and appearance unchanged.
  await store.update(first.id, { icon: null, iconColor: null });
  await store.setSectionAppearance('work', { icon: null, iconColor: null });
  await waitFor(`document.querySelector('[data-note-id="${first.id}"] .note-type .node-icon').dataset.icon === 'default'`);
}
