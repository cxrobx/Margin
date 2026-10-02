import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ipcMain } from 'electron';
import { createLaunchAtStartup } from '../app/launch-at-startup.mjs';

// Exercise the real renderer and IPC without registering this test app at login.
export async function runSmoke(win, store, panel) {
  const run = code => win.webContents.executeJavaScript(`{ ${code} }`, true);
  const wait = async code => { for (let i = 0; i < 100; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timed out: ${code}`); };
  const click = label => run(`document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`);
  await wait(`Boolean(document.querySelector('[aria-label="Preferences"]'))`);
  assert.equal(win.isVisible(), false, 'Startup leaves the panel hidden');
  panel.show();
  await click('Preferences');
  await wait(`document.querySelector('#startup-caption')?.textContent.includes('installed Mac app')`);
  assert.equal(await run(`document.querySelector('[aria-label="Launch at startup"]').disabled`), true);
  assert.equal((await run(`window.margin.setLaunchAtStartup(true)`)).ok, false, 'The smoke app cannot register itself');
  await click('Back to notes');

  const before = await store.read();
  let native = { openAtLogin: false, status: 'not-registered' }, failure = false, readFailure = false, pending = false, delayedRead, heldRead = false;
  const writes = [];
  const controller = createLaunchAtStartup({
    platform: 'darwin', env: {}, app: {
      isPackaged: true,
      getLoginItemSettings: () => { if (readFailure) throw new Error('Login item status unavailable'); return { ...native }; },
      setLoginItemSettings: settings => {
        if (failure) throw new Error('Login item registration failed');
        writes.push(settings);
        native = { openAtLogin: settings.openAtLogin && !pending, status: settings.openAtLogin ? pending ? 'requires-approval' : 'enabled' : 'not-registered' };
      }
    }
  });
  for (const [channel, method] of [['startup:get', 'getStatus'], ['startup:set', 'setEnabled']]) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, ...args) => {
      assert.equal(event.sender, win.webContents);
      assert.equal(event.senderFrame, win.webContents.mainFrame);
      try {
        const value = controller[method](...args);
        if (channel === 'startup:get' && delayedRead) { const delay = delayedRead; delayedRead = null; heldRead = true; await delay; }
        return { ok: true, value };
      }
      catch (error) { return { ok: false, error: error.message }; }
    });
  }
  await click('Preferences');
  await wait(`document.querySelector('[aria-label="Launch at startup"]')?.disabled === false`);
  assert.equal(await run(`document.querySelector('[aria-label="Launch at startup"]').checked`), false);
  assert.equal((await run(`window.margin.setLaunchAtStartup('yes')`)).ok, false);
  assert.deepEqual(writes, []);
  let resumeRead;
  delayedRead = new Promise(resolve => { resumeRead = resolve; });
  await run(`window.dispatchEvent(new Event('focus'))`);
  for (let i = 0; i < 100 && !heldRead; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(heldRead, true);
  await click('Launch at startup');
  await wait(`document.querySelector('[aria-label="Launch at startup"]').checked && !document.querySelector('[aria-label="Launch at startup"]').disabled`);
  resumeRead();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await run(`document.querySelector('[aria-label="Launch at startup"]').checked`), true, 'A stale focus refresh must not undo a newer toggle');
  assert.deepEqual(writes, [{ openAtLogin: true }]);
  const output = process.env.MARGIN_ARTIFACTS_DIR || path.join(store.dir, 'artifacts');
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'margin-launch-at-startup.png'), (await win.webContents.capturePage()).toPNG());
  win.webContents.reload();
  await wait(`Boolean(document.querySelector('.panel-tools [aria-label="Preferences"]'))`);
  await click('Preferences');
  await wait(`document.querySelector('[aria-label="Launch at startup"]')?.checked`);

  native = { openAtLogin: false, status: 'not-registered' };
  await run(`window.dispatchEvent(new Event('focus'))`);
  await wait(`!document.querySelector('[aria-label="Launch at startup"]').checked`);
  assert.equal(writes.length, 1, 'Refreshing must respect changes made in System Settings');
  failure = true;
  await click('Launch at startup');
  await wait(`document.querySelector('[role="alert"]')?.textContent.includes('registration failed')`);
  assert.equal(await run(`document.querySelector('[aria-label="Launch at startup"]').checked`), false);
  assert.equal(await run(`document.querySelector('[aria-label="Launch at startup"]').disabled`), false);
  failure = false; pending = true;
  await click('Launch at startup');
  await wait(`document.querySelector('#startup-caption').textContent.includes('Allow Margin in System Settings')`);
  assert.equal(await run(`document.querySelector('[aria-label="Launch at startup"]').checked`), true);
  assert.equal(await run(`Boolean(document.querySelector('[role="alert"]'))`), false);
  await click('Launch at startup');
  await wait(`!document.querySelector('[aria-label="Launch at startup"]').checked && !document.querySelector('[aria-label="Launch at startup"]').disabled`);
  assert.deepEqual(writes.at(-1), { openAtLogin: false });
  await click('Back to notes'); readFailure = true;
  await click('Preferences');
  await wait(`document.querySelector('[role="alert"]')?.textContent.includes('status unavailable')`);
  assert.equal(await run(`document.querySelector('[aria-label="Launch at startup"]').disabled`), true);
  assert.equal(await run(`document.querySelector('#startup-caption').textContent`), 'Startup settings are unavailable');
  readFailure = false;
  await run(`window.dispatchEvent(new Event('focus'))`);
  await wait(`!document.querySelector('[aria-label="Launch at startup"]').disabled && !document.querySelector('[role="alert"]')`);
  assert.deepEqual(await store.read(), before, 'Startup preferences must not modify the notebook');
  console.log('Startup smoke passed: toggle, reload, System Settings changes, approval, and errors.');
}
