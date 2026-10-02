import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NoteStore } from '../shared/store.mjs';
import { DEFAULT_THEME, parseVaultLook, vaultEndpoint, resolveAppearance, contrast, paletteTokens, GLASS_THEME, MONOKAI_SODA_THEME, vaultPaletteSchema, glassAlphas, parseVaultDecorations, parseComputedColour } from '../shared/themes.mjs';

// The token block Onyx serves for this vault's AnuPpuccin light appearance.
const CSS = ':root.vault-look{--bg-primary:253 246 227;--bg-sidebar:253 246 227;--bg-surface:241 234 210;--bg-elevated:253 246 227;--bg-input:244 237 214;--ink:0 43 54;--secondary:68 98 101;--muted:121 140 137;--faint:164 175 166;--accent:203 75 22;--accent-hover:152 67 30;--ui-font:"JetBrains Mono", Inter;color-scheme:light}';
const payload = css => ({ ok: true, available: true, mode: 'light', revision: '469ad111e7f682141d2c', css });
const light = parseVaultLook(payload(CSS));
const dark = { ...light, mode: 'dark', revision: 'abcdef', bgPrimary: [0, 43, 54], bgSurface: [7, 50, 60], bgElevated: [14, 57, 65], bgInput: [18, 58, 66], ink: [253, 246, 227], accent: [240, 173, 88] };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'margin-theme-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return new NoteStore(dir).init();
}

test('Onyx palette is interoperable, and remote CSS cannot become executable styles', () => {
  assert.deepEqual(light.bgPrimary, [253, 246, 227]);
  assert.equal(light.font, '"JetBrains Mono", Inter');
  // Other rules and properties are never worn by Margin.
  assert.deepEqual(parseVaultLook(payload(CSS + 'body{background:url(https://example.com/track)}')), light);
  assert.equal(parseVaultLook(payload(CSS.replace('--ink:0 43 54', '--ink:256 43 54'))), null);
  assert.equal(parseVaultLook(payload(CSS.replace('--ink:0 43 54', '--ink:url(https://example.com)'))), null);
  assert.equal(parseVaultLook(payload(CSS.replace('--ink:0 43 54;', ''))), null);
  assert.equal(parseVaultLook({ ...payload(CSS), mode: null }), null);
  assert.equal(parseVaultLook({ ...payload(CSS), available: false }), null);
  assert.equal(parseVaultLook(payload(CSS.replace('"JetBrains Mono", Inter', 'url(https://example.com/font)'))).font, '');
  const tokens = paletteTokens(light);
  assert.equal(tokens.bg, 'rgb(253 246 227)');
  const buttonInk = tokens['button-ink'].match(/\d+/g).map(Number);
  assert.ok(contrast(light.accent, buttonInk) >= 4.5);
});

test('vault connector accepts only loopback URLs and fixes the endpoint path', () => {
  assert.equal(vaultEndpoint('http://127.0.0.1:8899/other?x=1'), 'http://127.0.0.1:8899/api/vault-look');
  assert.equal(vaultEndpoint('http://[::1]:8899'), 'http://[::1]:8899/api/vault-look');
  assert.equal(vaultEndpoint('http://localhost:8899'), 'http://localhost:8899/api/vault-look');
  for (const address of ['https://example.com', 'http://192.168.1.2', 'http://127.0.0.1.example.com', 'file:///tmp/a', 'http://user:pass@localhost:8899']) assert.throws(() => vaultEndpoint(address));
});

test('existing notebooks gain Default without changing any notes or rewriting their file', async t => {
  const store = await fixture(t);
  const old = await store.read(); delete old.themes; delete old.vaultTheme; delete old.settings.themeId; delete old.settings.vaultAddress; delete old.settings.glassTransparency;
  const bytes = JSON.stringify(old); await fs.writeFile(store.file, bytes);
  const migrated = await (await new NoteStore(store.dir).init()).read();
  assert.deepEqual(migrated.notes, old.notes);
  assert.equal(migrated.settings.themeId, 'default');
  assert.equal(migrated.settings.theme, 'light');
  assert.equal(migrated.settings.glassTransparency, .38);
  assert.equal(await fs.readFile(store.file, 'utf8'), bytes, 'Reading an old notebook must not rewrite it');
  assert.deepEqual(resolveAppearance(migrated, false).tokens, DEFAULT_THEME.light);
  await store.setSettings({ theme: 'system' });
  assert.deepEqual(resolveAppearance(await store.read(), true).tokens, DEFAULT_THEME.dark);
  const backup = (await fs.readdir(path.join(store.dir, 'backups'))).at(-1);
  assert.equal(await fs.readFile(path.join(store.dir, 'backups', backup), 'utf8'), bytes);
});

test('notebooks that saved the retired saturation setting still open and save', async t => {
  const store = await fixture(t);
  const old = await store.read(); old.settings.themeSaturation = 2.5;
  await fs.writeFile(store.file, JSON.stringify(old));
  const reopened = await new NoteStore(store.dir).init();
  const state = await reopened.read();
  assert.equal('themeSaturation' in state.settings, false);
  assert.deepEqual(state.notes, old.notes);
  await reopened.setSettings({ theme: 'dark' });
  assert.equal('themeSaturation' in JSON.parse(await fs.readFile(store.file, 'utf8')).settings, false, 'The next save drops the retired key');
});

test('vault copies preserve captured palettes across edits, offline use, and restarts', async t => {
  const store = await fixture(t), address = (await store.read()).settings.vaultAddress;
  await assert.rejects(() => store.saveVaultTheme('My vault'), /Connect/);
  await store.cacheVaultTheme(light, address);
  const revision = (await store.read()).revision;
  await store.cacheVaultTheme(light, address);
  assert.equal((await store.read()).revision, revision, 'Unchanged polls must not create writes or backups');
  const theme = await store.saveVaultTheme('Solarized vault');
  await store.cacheVaultTheme(dark, address);
  let state = await store.read();
  assert.equal(state.themes[0].palettes.dark, null, 'A saved copy must not follow live changes');
  await store.setSettings({ themeId: 'vault' });
  assert.equal(resolveAppearance(await store.read(), false).mode, 'dark', 'Live theme follows vault mode');
  await store.setSettings({ themeId: theme.id, theme: 'dark' });
  assert.equal(resolveAppearance(await store.read(), false).fallback, true);
  await store.saveVaultTheme(theme.name, theme.id);
  await store.setSettings({ theme: 'system' });
  state = await (await new NoteStore(store.dir).init()).read();
  assert.equal(state.themes.length, 1);
  assert.deepEqual(resolveAppearance(state, false).tokens, paletteTokens(light));
  assert.deepEqual(resolveAppearance(state, true).tokens, paletteTokens(dark));
  const note = await store.create({ title: 'Still editable from MCP', source: 'Codex' });
  await store.append(note.id, 'Theme selection is independent of notes', 'Claude');
  assert.equal((await store.read()).settings.themeId, theme.id);
  await assert.rejects(() => store.deleteTheme('default'), /Only a saved/);
  await store.deleteTheme(theme.id);
  assert.equal((await store.read()).settings.themeId, 'default');
  await store.setSettings({ vaultAddress: 'http://localhost:9999' });
  await store.cacheVaultTheme(light, address);
  assert.equal((await store.read()).vaultTheme.palette, null, 'A response from an old connector must be discarded');
});

test('Glass persists separately from vault copies and honours appearance and accessibility', async t => {
  const store = await fixture(t);
  const notes = (await store.read()).notes;
  await store.setSettings({ themeId: GLASS_THEME.id, theme: 'system', glassTransparency: .52 });
  let state = await (await new NoteStore(store.dir).init()).read();
  assert.deepEqual(state.notes, notes);
  assert.equal(state.settings.glassTransparency, .52);
  assert.equal(state.themes.length, 0, 'Built-in presets are available without a vault');
  for (const [systemDark, mode] of [[false, 'light'], [true, 'dark']]) {
    const appearance = resolveAppearance(state, systemDark);
    assert.equal(appearance.mode, mode);
    assert.equal(appearance.material, 'glass');
    assert.equal(appearance.tokens.green, GLASS_THEME[mode].green);
    assert.ok(appearance.glass.radius > 0);
    const accessible = resolveAppearance(state, systemDark, true);
    assert.equal(accessible.glass.pane, 1);
    assert.equal(accessible.glass.sidebar, 1);
    assert.equal(accessible.glass.radius, 0);
  }
  assert.equal(state.settings.glassTransparency, .52, 'Accessibility must not erase the preference');
  await store.setSettings({ glassTransparency: 0 });
  const opaque = resolveAppearance(await store.read(), true);
  assert.equal(opaque.glass.radius, 0);
  assert.equal(opaque.glass.sidebar, 1);
  await assert.rejects(() => store.setSettings({ glassTransparency: 1.1 }));
  await assert.rejects(() => store.setSettings({ glassTransparency: NaN }));
  await assert.rejects(() => store.deleteTheme(GLASS_THEME.id), /Only a saved/);
  await store.setSettings({ themeId: 'default' });
  state = await store.read();
  assert.deepEqual(resolveAppearance(state, true).tokens, DEFAULT_THEME.dark);
  assert.equal(resolveAppearance(state, true).material, 'default');
});

test('light glass keeps muted labels readable against a black desktop across the slider', () => {
  for (let n = 0; n <= 100; n++) {
    const { pane, sidebar } = glassAlphas(n / 100, 'light');
    const content = [248, 247, 245].map(v => Math.round(v * pane));
    const chrome = [243, 242, 240].map(v => Math.round(v * sidebar));
    assert.ok(contrast([100, 96, 88], content) >= 3);
    assert.ok(contrast([100, 96, 88], chrome) >= 3);
    assert.ok(contrast([30, 25, 15], content) >= 4.5);
  }
  for (const corrupt of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(glassAlphas(corrupt, 'dark'), { pane: 1, sidebar: 1, radius: 0 });
  }
});

const readingSnapshot = (mode = 'dark') => ({ ok: true, available: true, enabled: true, css:
  `body[data-askw-document-kind="markdown"]{color-scheme:${mode}}
` +
  [[240,120,160],[230,195,125],[130,235,130],[114,224,214],[154,141,247],[197,146,222]].map((c,i) => `body[data-askw-document-kind="markdown"] > main h${i+1}{color:rgb(${c.join(', ')})}`).join('\n') +
  '\nbody[data-askw-document-kind="markdown"] > main a{color:rgb(88, 209, 235)}' });
const treeSnapshot = { ok:true, available:true, enabled:true, css:'body.obsidian-tree aside{color-scheme:dark}', folders:[{name:'Inbox',color:'rgb(230, 195, 125)'},{name:'Work',color:'rgb(130, 235, 130)'}] };

test('Onyx decoration snapshots accept only computed colours in the current mode', () => {
  const result = parseVaultDecorations(readingSnapshot(), treeSnapshot, 'dark');
  assert.deepEqual(result.headings[0], [240,120,160]);
  assert.deepEqual(result.link, [88,209,235]);
  assert.deepEqual(result.folders[0], { name:'Inbox', color:[230,195,125] });
  assert.equal(parseVaultDecorations(readingSnapshot(), treeSnapshot, 'light'), undefined, 'Do not mix snapshots from different appearance modes');
  for (const value of ['rgb(256, 0, 0)', 'url(https://example.com)', 'var(--red)', 'rgb(1 2 3);background:url(https://example.com)', 'rgb(1.5, 2, 3)']) assert.equal(parseComputedColour(value), null);
  const hostile = { ...readingSnapshot(), css: readingSnapshot().css.replace('color:rgb(240, 120, 160)', 'color:url(https://example.com)') + '\nbody{background:url(https://example.com)}' };
  assert.equal(parseVaultDecorations(hostile, { ...treeSnapshot, folders:[{name:'Injected',color:'var(--bad)'}] }, 'dark').headings[0], null);
});

test('vault heading and folder colours survive saved copies, restarts and partial outages', async t => {
  const store = await fixture(t), address=(await store.read()).settings.vaultAddress;
  const palette = { ...dark, bgPrimary:[26,26,26], bgSidebar:[26,26,26], bgSurface:[24,24,24], bgElevated:[34,35,34], ink:[196,197,181], decoration:parseVaultDecorations(readingSnapshot(), treeSnapshot, 'dark') };
  await store.cacheVaultTheme(palette, address);
  const saved=await store.saveVaultTheme('Quiet vault');
  await store.setSettings({ themeId:saved.id, theme:'dark' });
  const appearance=resolveAppearance(await (await new NoteStore(store.dir).init()).read(),true);
  assert.equal(appearance.material, 'vault');
  assert.equal(appearance.tokens['heading-1'], 'rgb(240 120 160)');
  assert.equal(appearance.folderColours[0].color, 'rgb(230 195 125)');
  const revision=(await store.read()).revision;
  const {decoration,...base}=palette;
  await store.cacheVaultTheme(base,address);
  assert.equal((await store.read()).revision,revision, 'A partial outage must preserve captured colours without creating a backup');
  await store.cacheVaultTheme({...base,revision:'fedcba'},address);
  assert.equal((await store.read()).vaultTheme.palette.decoration,undefined, 'Changed base palettes must not carry stale snapshot colours');
});

test('light vault colours are worn exactly as Obsidian renders them', () => {
  // Solarized light, as Onyx measures it: these hues sit below 4.5:1 on cream.
  const solarized = [[220,50,47],[203,75,22],[133,153,0],[42,161,152],[139,143,222],[108,113,196]];
  const palette = { ...light, decoration: { headings: solarized, link: [203,75,22], folders: [{ name:'Meetings', color:[181,137,0] }] } };
  const tokens = paletteTokens(palette);
  solarized.forEach((c, i) => assert.equal(tokens['heading-'+(i+1)], `rgb(${c.join(' ')})`));
  assert.equal(tokens['vault-link'], 'rgb(203 75 22)');
  assert.equal(tokens['hue-amber'], 'rgb(181 137 0)');
  const appearance = resolveAppearance({ settings: { theme:'light', themeId:'vault' }, vaultTheme: { palette }, themes: [] }, false);
  assert.equal(appearance.folderColours[0].color, 'rgb(181 137 0)');
  assert.ok(contrast([181,137,0], light.bgPrimary) < 4.5, 'The fixture would have been darkened by the old clamp');
});

test('Monokai Soda is a built-in dark preset that stays readable and persists', async t => {
  const p = vaultPaletteSchema.parse(MONOKAI_SODA_THEME.palette);
  const store = await fixture(t);
  await store.setSettings({ themeId: MONOKAI_SODA_THEME.id, theme: 'light' });
  const state = await (await new NoteStore(store.dir).init()).read();
  assert.equal(state.themes.length, 0, 'Built-in presets are available without a vault');
  for (const systemDark of [false, true]) {
    const appearance = resolveAppearance(state, systemDark);
    assert.equal(appearance.mode, 'dark', 'A dark-only theme ignores the light setting');
    assert.equal(appearance.material, 'vault');
    assert.equal(appearance.fallback, false);
    assert.equal(appearance.tokens.bg, 'rgb(26 26 26)');
  }
  const rgbOf = v => v.match(/\d+/g).map(Number);
  const tokens = paletteTokens(p);
  for (const background of [p.bgPrimary, p.bgSidebar, p.bgSurface, p.bgElevated]) {
    assert.ok(contrast(p.ink, background) >= 7);
    assert.ok(contrast(p.muted, background) >= 4.5);
    // Headings are large text, so WCAG AA asks 3:1; they keep Monokai's own neon.
    for (let i = 1; i <= 6; i++) assert.ok(contrast(rgbOf(tokens['heading-' + i]), background) >= 3);
  }
  p.decoration.headings.forEach((c, i) => assert.equal(tokens['heading-' + (i + 1)], `rgb(${c.join(' ')})`));
  assert.ok(contrast(p.accent, rgbOf(tokens['button-ink'])) >= 4.5);
  await assert.rejects(() => store.deleteTheme(MONOKAI_SODA_THEME.id), /Only a saved/);
});
