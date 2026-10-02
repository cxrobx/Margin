import test from 'node:test';
import assert from 'node:assert/strict';
import { createLaunchAtStartup } from '../app/launch-at-startup.mjs';

function fixture({ packaged = true, platform = 'darwin', env = {} } = {}) {
  let native = { openAtLogin: false, status: 'not-registered' };
  const writes = [];
  const app = {
    isPackaged: packaged,
    getLoginItemSettings: () => ({ ...native }),
    setLoginItemSettings: settings => {
      writes.push(settings);
      native = { openAtLogin: settings.openAtLogin, status: settings.openAtLogin ? 'enabled' : 'not-registered' };
    }
  };
  return { app, writes, controller: createLaunchAtStartup({ app, platform, env }), externalChange: value => { native = value; } };
}

test('reading startup settings never registers the app or changes an existing login item', () => {
  const f = fixture();
  assert.deepEqual(f.controller.getStatus(), { supported: true, enabled: false, requiresApproval: false });
  f.externalChange({ openAtLogin: true, status: 'enabled' });
  assert.equal(f.controller.getStatus().enabled, true);
  assert.deepEqual(f.writes, []);
});

test('enabling and disabling use the native login item and survive a new controller', () => {
  const f = fixture();
  assert.equal(f.controller.setEnabled(true).enabled, true);
  const reopened = createLaunchAtStartup({ app: f.app, platform: 'darwin', env: {} });
  assert.equal(reopened.getStatus().enabled, true);
  assert.equal(reopened.setEnabled(false).enabled, false);
  assert.deepEqual(f.writes, [{ openAtLogin: true }, { openAtLogin: false }]);
});

test('System Settings changes stay authoritative', () => {
  const f = fixture();
  f.controller.setEnabled(true);
  f.externalChange({ openAtLogin: false, status: 'not-registered' });
  assert.equal(f.controller.getStatus().enabled, false);
  assert.equal(f.writes.length, 1, 'Reading must not silently re-enable a disabled login item');
});

test('a login item awaiting macOS approval is represented as pending and can be removed', () => {
  const f = fixture();
  f.app.setLoginItemSettings = () => f.externalChange({ openAtLogin: false, status: 'requires-approval' });
  assert.deepEqual(f.controller.setEnabled(true), { supported: true, enabled: true, requiresApproval: true });
  f.app.setLoginItemSettings = () => f.externalChange({ openAtLogin: false, status: 'not-registered' });
  assert.deepEqual(f.controller.setEnabled(false), { supported: true, enabled: false, requiresApproval: false });
});

test('development, smoke tests, and unsupported platforms never access native login items', () => {
  for (const options of [{ packaged: false }, { env: { MARGIN_SMOKE_TEST: '1' } }, { platform: 'linux' }, { platform: 'win32' }]) {
    const f = fixture(options);
    f.app.getLoginItemSettings = f.app.setLoginItemSettings = () => { throw new Error('Native API must not be called'); };
    assert.deepEqual(f.controller.getStatus(), { supported: false, enabled: false, requiresApproval: false });
    assert.throws(() => f.controller.setEnabled(true), /installed Mac app/);
    assert.throws(() => f.controller.setEnabled(false), /installed Mac app/);
  }
});

test('only boolean startup choices can reach the native API', () => {
  const f = fixture();
  for (const value of ['true', 1, null, undefined, {}, []]) assert.throws(() => f.controller.setEnabled(value), /Choose whether/);
  assert.deepEqual(f.writes, []);
});

test('silent native failures are reported instead of claiming startup was changed', () => {
  const f = fixture();
  f.app.setLoginItemSettings = () => {};
  assert.throws(() => f.controller.setEnabled(true), /Could not change launch at startup/);
  assert.equal(f.controller.getStatus().enabled, false);
  f.externalChange({ openAtLogin: true, status: 'enabled' });
  assert.throws(() => f.controller.setEnabled(false), /Could not change launch at startup/);
});

test('native read and registration failures remain visible to the caller', () => {
  const f = fixture();
  f.app.setLoginItemSettings = () => { throw new Error('Login item registration failed'); };
  assert.throws(() => f.controller.setEnabled(true), /registration failed/);
  f.app.getLoginItemSettings = () => { throw new Error('Login item status unavailable'); };
  assert.throws(() => f.controller.getStatus(), /status unavailable/);
});
