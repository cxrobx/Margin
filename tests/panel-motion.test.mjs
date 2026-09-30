import test from 'node:test';
import assert from 'node:assert/strict';
import { PanelMotion } from '../app/panel-motion.mjs';
import { WindowMaterial } from '../app/window-material.mjs';
import { GLASS_THEME, glassAlphas } from '../shared/themes.mjs';

function fixture({ available = true, reducedTransparency = false, reducedMotion = false, failBlur = false } = {}) {
  const calls = [], messages = [];
  let visible = false, material;
  const win = {
    isDestroyed: () => false, isVisible: () => visible,
    show: () => { visible = true; calls.push(['show']); },
    hide: () => { visible = false; calls.push(['hide']); }, focus() {},
    setHasShadow() {}, setVibrancy: type => calls.push(['vibrancy', type]),
    getNativeWindowHandle: () => Buffer.alloc(8),
    webContents: {
      setBackgroundThrottling() {},
      send: (channel, payload) => messages.push({ channel, payload, material: { ...material.status } })
    }
  };
  const bridge = {
    available: () => available,
    configure: (_handle, radius) => { calls.push(['blur', radius, visible]); return visible && !failBlur ? 0 : -1; }
  };
  material = new WindowMaterial(win, { shouldUseDarkColors: true, prefersReducedTransparency: reducedTransparency }, { platform: 'darwin', bridge });
  material.update({ themeId: GLASS_THEME.id, glassTransparency: .38 });
  const motion = new PanelMotion(win, { material, reducedMotion: () => reducedMotion, hidden: () => calls.push(['hidden']) });
  const start = (visible, edge = 'right') => { motion.request(visible, edge); motion.ready(motion.id); };
  const settle = () => motion.finish(motion.id);
  const effectCount = () => calls.filter(([kind]) => kind === 'blur' || kind === 'vibrancy').length;
  return { win, material, motion, calls, messages, start, settle, effectCount };
}

for (const edge of ['left', 'right']) {
  test(`${edge}-edge glass is active before animation and never resets on arrival or dismissal`, t => {
    const f = fixture(); t.after(() => f.motion.dispose());
    f.start(true, edge);
    const opening = f.messages.find(message => message.channel === 'panel:motion-start');
    assert.equal(opening.material.backend, 'desktop-blur');
    const radius = opening.material.radius;
    assert.ok(radius > 0);
    assert.equal(f.calls.at(-1)[0], 'blur');
    assert.deepEqual(f.calls.at(-1), ['blur', radius, true], 'First-show blur must be configured after the native window is shown');
    const afterStart = f.effectCount();
    f.settle();
    assert.equal(f.effectCount(), afterStart, 'Settling must not clear or reapply an already active blur');
    f.motion.request(false, edge);
    assert.equal(f.material.status.backend, 'desktop-blur', 'Preparing dismissal must keep glass active');
    f.motion.ready(f.motion.id);
    assert.equal(f.messages.at(-1).material.radius, radius);
    assert.equal(f.effectCount(), afterStart, 'Closing must not reconfigure blur while visible');
    f.settle();
    assert.equal(f.material.status.backend, 'none');
    const hide = f.calls.findIndex(call => call[0] === 'hide');
    const clear = f.calls.findIndex((call, index) => index > hide && call[0] === 'blur' && call[1] === 0);
    assert.ok(hide >= 0 && clear > hide, 'Disable blur only after the panel is hidden');
  });
}

test('rapid reversals and stale completion messages preserve glass', t => {
  const f = fixture(); t.after(() => f.motion.dispose());
  f.start(true); const openingId = f.motion.id;
  const activeCalls = f.effectCount();
  f.start(false); const closingId = f.motion.id;
  f.start(true);
  f.motion.finish(openingId); f.motion.finish(closingId); f.motion.ready(closingId);
  assert.equal(f.motion.phase, 'opening');
  assert.equal(f.material.status.backend, 'desktop-blur');
  assert.equal(f.effectCount(), activeCalls);
  f.settle();
  assert.equal(f.effectCount(), activeCalls);
  assert.equal(f.motion.phase, 'open');
});

test('opacity and accessibility changes take effect during the slide', t => {
  const f = fixture(); t.after(() => f.motion.dispose());
  f.start(true);
  f.material.update({ themeId: GLASS_THEME.id, glassTransparency: .72 });
  assert.equal(f.material.status.radius, glassAlphas(.72, 'dark').radius);
  const updatedCalls = f.effectCount();
  f.settle(); assert.equal(f.effectCount(), updatedCalls);
  f.start(false);
  f.material.nativeTheme.prefersReducedTransparency = true; f.material.render();
  assert.equal(f.material.status.backend, 'none');
  assert.equal(f.material.status.reducedTransparency, true);
  f.settle();
  f.start(true); f.settle();
  assert.equal(f.material.status.backend, 'none');
  assert.equal(f.material.settings.glassTransparency, .72);
  f.material.nativeTheme.prefersReducedTransparency = false;
  f.material.update({ themeId: GLASS_THEME.id, glassTransparency: 0 });
  assert.equal(f.material.status.backend, 'none');
});

test('Reduce Motion and the interrupted-animation fallback settle with glass active', t => {
  const f = fixture({ reducedMotion: true }); t.after(() => f.motion.dispose());
  f.start(true);
  assert.equal(f.messages.find(message => message.channel === 'panel:motion-prepare').payload.duration, 0);
  f.settle(); assert.equal(f.material.status.backend, 'desktop-blur');
  f.start(false); f.settle();
  f.motion.request(true, 'right');
  // The watchdog uses finish even if the renderer never acknowledges prepare.
  f.settle();
  assert.equal(f.win.isVisible(), true);
  assert.equal(f.material.status.backend, 'desktop-blur');
});

for (const options of [{ available: false }, { failBlur: true }]) {
  test(`vibrancy fallback stays within the panel (${JSON.stringify(options)})`, t => {
    const f = fixture(options); t.after(() => f.motion.dispose());
    f.start(true); assert.equal(f.material.status.backend, 'none');
    f.settle(); assert.equal(f.material.status.backend, 'vibrancy');
    f.start(false); assert.equal(f.material.status.backend, 'none');
    f.settle(); assert.equal(f.material.status.backend, 'none');
  });
}
