import { z } from 'zod';

export const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const DEFAULT_THEME = {
  id: 'default', name: 'Default',
  light: { bg: '#f6f5f1', surface: '#fffefa', text: '#303b33', muted: '#8a9188', line: '#e5e7df', green: '#385747', soft: '#eaeee5', paper: '#fdfcf8', sage: '#eaf0e4', sand: '#f6efdc', rose: '#f5e7e1', lavender: '#eeebf4', sky: '#e7eef3' },
  dark: { bg: '#202723', surface: '#28302a', text: '#e2e6dc', muted: '#9ca69a', line: '#3b433c', green: '#a8c6ad', soft: '#343f34', paper: '#2c342e', sage: '#354536', sand: '#484532', rose: '#493a36', lavender: '#3d394b', sky: '#34424b' }
};

// CXTasks' built-in macOS palette and transparency curve. Keep the heading
// hues separate from text: labels stay legible while their icons carry colour.
export const GLASS_THEME = {
  id: 'cxtasks-glass', name: 'Glass', transparency: .38,
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif',
  dark: {
    bg: '#181818', surface: '#2d2d2d', text: '#ffffff', muted: '#afafaf', line: 'rgb(255 255 255 / .15)', green: '#3a83f7', soft: 'rgb(255 255 255 / .10)',
    paper: '#1c1c1c', sage: '#24362a', sand: '#373221', rose: '#382625', lavender: '#302637', sky: '#243139', 'button-ink': '#ffffff',
    'glass-pane-rgb': '24 24 24', 'glass-sidebar-rgb': '42 43 43', 'glass-card-rgb': '255 255 255', 'glass-card-alpha': '.02', 'glass-card-hover-alpha': '.04',
    'glass-rim': 'rgb(255 255 255 / .025)', 'glass-rim-hover': 'rgb(255 255 255 / .07)', 'glass-sheen': 'rgb(255 255 255 / .055)',
    'hue-blue': '#0a84ff', 'hue-red': '#ff453a', 'hue-green': '#30d158', 'hue-amber': '#ffd60a', 'hue-purple': '#bf5af2', 'hue-teal': '#40c8e0', 'hue-sand': '#ac8e68'
  },
  light: {
    bg: '#f8f7f5', surface: '#fbfaf8', text: '#1e190f', muted: '#646058', line: '#e1deda', green: '#0a84ff', soft: 'rgb(30 25 15 / .07)',
    paper: '#fffffe', sage: '#eaf1e8', sand: '#f6efdb', rose: '#f6e8e5', lavender: '#eeebf6', sky: '#e6f0f6', 'button-ink': '#ffffff',
    'glass-pane-rgb': '248 247 245', 'glass-sidebar-rgb': '243 242 240', 'glass-card-rgb': '255 255 254', 'glass-card-alpha': '.55', 'glass-card-hover-alpha': '.85',
    'glass-rim': 'rgb(44 31 14 / .08)', 'glass-rim-hover': 'rgb(44 31 14 / .14)', 'glass-sheen': 'rgb(255 255 255 / .5)',
    'hue-blue': '#007aff', 'hue-red': '#ff3b30', 'hue-green': '#1eb43c', 'hue-amber': '#e6a200', 'hue-purple': '#af52de', 'hue-teal': '#12a6c0', 'hue-sand': '#a2845e'
  }
};
// Monokai Soda is dark by design, so both appearance modes resolve to its one
// palette. It wears the vault material: coloured headings and section hues.
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const MONOKAI_SODA_THEME = {
  id: 'monokai-soda', name: 'Monokai Soda',
  palette: {
    mode: 'dark', revision: '', font: '',
    bgPrimary: hex('#1a1a1a'), bgSidebar: hex('#141414'), bgSurface: hex('#222222'), bgElevated: hex('#292929'), bgInput: hex('#343434'),
    ink: hex('#c4c5b5'), secondary: hex('#a8a996'), muted: hex('#9d9985'), faint: hex('#625e4c'), accent: hex('#f4005f'), accentHover: hex('#ff2a78'),
    decoration: { headings: ['#f4005f', '#fa8419', '#e0d561', '#98e024', '#58d1eb', '#9d65ff'].map(hex), link: hex('#58d1eb') }
  }
};
export const VAULT_COLOUR_KEYS = [...Array.from({ length: 6 }, (_, i) => `heading-${i + 1}`), 'vault-link', 'vault-sidebar'];
export const APPEARANCE_KEYS = [...new Set([...Object.keys(DEFAULT_THEME.light), ...Object.keys(GLASS_THEME.dark), 'button-ink', 'glass-pane-alpha', 'glass-sidebar-alpha', ...VAULT_COLOUR_KEYS])];
export function glassAlphas(transparency, mode, reducedTransparency = false) {
  const t = reducedTransparency || !Number.isFinite(transparency) ? 0 : Math.min(1, Math.max(0, transparency));
  const pane = 1 - t * (1 - (mode === 'dark' ? .25 : .82));
  const sidebar = mode === 'dark' ? 1 - Math.min(1, t * 1.9) * .9 : pane * (1 - t * .05);
  return { pane, sidebar, radius: t === 0 ? 0 : Math.round(10 + t * 38) };
}
export const folderHue = color => ({ paper: 'blue', sage: 'green', sand: 'amber', rose: 'red', lavender: 'purple', sky: 'teal' })[color] || 'blue';

const rgb = z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]);
export const fontSchema = z.string().max(512).regex(/^[\p{L}\p{N} "'_,?.-]*$/u);
const decorationSchema = z.object({
  headings: z.array(rgb.nullable()).length(6).optional(), link: rgb.nullable().optional(),
  folders: z.array(z.object({ name: z.string().trim().min(1).max(255), color: rgb }).strict()).max(256).optional()
}).strict();
export const vaultPaletteSchema = z.object({
  mode: z.enum(['light', 'dark']), revision: z.string().max(64).regex(/^[a-f0-9]*$/i),
  bgPrimary: rgb, bgSidebar: rgb, bgSurface: rgb, bgElevated: rgb, bgInput: rgb,
  ink: rgb, secondary: rgb, muted: rgb, faint: rgb, accent: rgb, accentHover: rgb,
  font: fontSchema.default(''), decoration: decorationSchema.optional()
}).strict();
export const variantsSchema = z.object({ light: vaultPaletteSchema.nullable(), dark: vaultPaletteSchema.nullable() }).strict()
  .refine(v => (!v.light || v.light.mode === 'light') && (!v.dark || v.dark.mode === 'dark'), 'Palette mode does not match its variant');
export const vaultThemeSchema = z.object({
  palette: vaultPaletteSchema.nullable(), variants: variantsSchema
}).strict();
export const savedThemeSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(80),
  palettes: variantsSchema.refine(v => v.light || v.dark, 'Capture a vault appearance first'), createdAt: z.string()
}).strict();

export function vaultEndpoint(address) {
  const url = new URL(address.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !(/^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\])$/i.test(url.hostname))) {
    throw new Error('Use a local Onyx address, such as http://127.0.0.1:8899.');
  }
  return new URL('/api/vault-look', url).href;
}

// Read only known tokens from Onyx's measured palette. Never load its stylesheet.
export function parseVaultLook(body) {
  if (body?.ok !== true || body.available !== true || !['light', 'dark'].includes(body.mode) || typeof body.css !== 'string' || body.css.length > 100_000) return null;
  const block = body.css.match(/:root\.vault-look\{([^}]*)\}/)?.[1];
  if (!block) return null;
  const declarations = new Map(block.split(';').map(decl => {
    const colon = decl.indexOf(':'); return [decl.slice(0, colon).trim(), decl.slice(colon + 1).trim()];
  }));
  const palette = { mode: body.mode, revision: /^[a-f0-9]{0,64}$/i.test(body.revision || '') ? body.revision || '' : '', font: '' };
  for (const key of ['bgPrimary', 'bgSidebar', 'bgSurface', 'bgElevated', 'bgInput', 'ink', 'secondary', 'muted', 'faint', 'accent', 'accentHover']) {
    const value = declarations.get('--' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()));
    if (!value || !/^\d{1,3} \d{1,3} \d{1,3}$/.test(value)) return null;
    palette[key] = value.split(' ').map(Number);
  }
  const font = fontSchema.safeParse(declarations.get('--ui-font') || '');
  if (font.success) palette.font = font.data;
  const parsed = vaultPaletteSchema.safeParse(palette);
  return parsed.success ? parsed.data : null;
}

// Extract plain computed RGB only. Snapshot stylesheets never enter the DOM.
export function parseComputedColour(value) {
  if (typeof value !== 'string' || value.length > 100) return null;
  const match = value.trim().match(/^rgb\(\s*(\d{1,3})\s*(?:,\s*|\s+)(\d{1,3})\s*(?:,\s*|\s+)(\d{1,3})\s*\)$/i);
  if (!match) return null;
  const result = rgb.safeParse(match.slice(1).map(Number));
  return result.success ? result.data : null;
}
function snapshotRules(body, mode) {
  if (body?.ok !== true || body.available !== true || body.enabled === false || typeof body.css !== 'string' || body.css.length > 100_000) return null;
  const rules = [...body.css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, declarations]) => ({
    selector: selector.trim(), declarations: new Map(declarations.split(';').map(decl => {
      const colon = decl.indexOf(':'); return [decl.slice(0, colon).trim(), decl.slice(colon + 1).trim()];
    }))
  }));
  if (!rules.some(rule => rule.declarations.get('color-scheme') === mode)) return null;
  return rules;
}
export function parseVaultDecorations(markdown, sidebar, mode) {
  const reading = snapshotRules(markdown, mode), tree = snapshotRules(sidebar, mode);
  const result = {};
  if (reading) {
    const colour = element => {
      const rule = reading.find(r => r.selector.endsWith(' > main ' + element));
      return parseComputedColour(rule?.declarations.get('color'));
    };
    result.headings = Array.from({ length: 6 }, (_, i) => colour('h' + (i + 1)));
    result.link = colour('a');
  }
  if (tree && Array.isArray(sidebar.folders) && sidebar.folders.length <= 256) {
    result.folders = sidebar.folders.flatMap(folder => {
      const color = parseComputedColour(folder?.color);
      return color && typeof folder.name === 'string' && folder.name.trim() && folder.name.length <= 255 && !/[\x00-\x1f]/.test(folder.name) ? [{ name: folder.name.trim(), color }] : [];
    });
  }
  return Object.keys(result).length ? decorationSchema.parse(result) : undefined;
}

const mix = (a, b, t) => a.map((n, i) => Math.round(n + (b[i] - n) * t));
const cssColor = c => `rgb(${c.join(' ')})`;
const luminance = c => c.map(n => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((v, n, i) => v + n * [.2126, .7152, .0722][i], 0);
export function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }

const VAULT_FALLBACK_HEADINGS = {
  dark: [[240, 120, 160], [230, 195, 125], [130, 235, 130], [114, 224, 214], [154, 141, 247], [197, 146, 222]],
  light: [[163, 51, 97], [139, 94, 17], [43, 116, 49], [18, 116, 111], [101, 76, 178], [132, 68, 160]]
};
const HUE_TARGETS = { blue: 210, red: 0, green: 120, amber: 42, purple: 275, teal: 175, sand: 38 };
function hue(color) {
  const [r, g, b] = color.map(n => n / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (delta < .12 || (max && delta / max < .2)) return null;
  const angle = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (angle * 60 + 360) % 360;
}
function hueDistance(a, b) { const d = Math.abs(a - b); return Math.min(d, 360 - d); }
function vaultColours(p) {
  const headings = VAULT_FALLBACK_HEADINGS[p.mode].map((fallback, i) => p.decoration?.headings?.[i] || fallback);
  const candidates = [...(p.decoration?.folders || []).map(f => f.color), ...headings, p.accent].filter(c => hue(c) !== null);
  const colours = Object.fromEntries(headings.map((c, i) => ['heading-' + (i + 1), c]));
  for (const [name, target] of Object.entries(HUE_TARGETS)) {
    const closest = candidates.reduce((best, c) => !best || hueDistance(hue(c), target) < hueDistance(hue(best), target) ? c : best, null);
    const fallback = ({ red: p.mode === 'dark' ? [230, 102, 102] : [168, 50, 50], blue: p.accent, green: headings[2], amber: headings[1], purple: headings[5], teal: headings[3], sand: headings[1] })[name];
    colours['hue-' + name] = closest && hueDistance(hue(closest), target) < 40 ? closest : fallback;
  }
  colours['vault-link'] = p.decoration?.link || p.accent;
  // Worn exactly as Obsidian renders them: darkening light hues toward 4.5:1
  // contrast turned every icon and heading brown.
  return colours;
}

export function paletteTokens(p) {
  // Vault mode is opaque: this keeps measured text contrast independent of wallpaper.
  const buttonInk = contrast(p.accent, p.bgElevated) >= 4.5 ? p.bgElevated :
    contrast(p.accent, p.ink) >= 4.5 ? p.ink : contrast(p.accent, [0, 0, 0]) > contrast(p.accent, [255, 255, 255]) ? [0, 0, 0] : [255, 255, 255];
  const accents = vaultColours(p);
  // Dark notes need a more visible tint; use the vault's own measured hues.
  const tint = (hue, lightColour) => mix(p.bgSurface, p.mode === 'dark' ? accents['hue-' + hue] : lightColour, p.mode === 'dark' ? .18 : .09);
  const colors = {
    bg: p.bgPrimary, surface: p.bgElevated, text: p.ink, muted: p.muted,
    line: mix(p.bgPrimary, p.ink, .14), green: p.accent, soft: p.bgInput, paper: p.bgSurface,
    sage: tint('green', [109, 153, 95]), sand: tint('amber', [203, 164, 74]),
    rose: tint('red', [199, 111, 105]), lavender: tint('purple', [154, 125, 185]), sky: tint('blue', [106, 155, 194]),
    'button-ink': buttonInk, 'vault-sidebar': p.bgSidebar, ...accents
  };
  return Object.fromEntries(Object.entries(colors).map(([key, color]) => [key, cssColor(color)]));
}

export function resolveAppearance(state, systemDark, reducedTransparency = false) {
  const requestedMode = state.settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : state.settings.theme;
  const id = state.settings.themeId;
  if (id === GLASS_THEME.id) {
    const glass = glassAlphas(state.settings.glassTransparency ?? GLASS_THEME.transparency, requestedMode, reducedTransparency);
    return { mode: requestedMode, custom: true, fallback: false, material: 'glass', glass,
      tokens: { ...GLASS_THEME[requestedMode], 'glass-pane-alpha': String(glass.pane), 'glass-sidebar-alpha': String(glass.sidebar) }, font: GLASS_THEME.font };
  }
  const live = id === 'vault' ? state.vaultTheme.palette : id === MONOKAI_SODA_THEME.id ? MONOKAI_SODA_THEME.palette : null;
  const saved = state.themes.find(t => t.id === id);
  const palette = live || saved?.palettes[requestedMode];
  const mode = palette?.mode || requestedMode;
  return { mode, material: palette ? 'vault' : 'default', folderColours: (palette?.decoration?.folders || []).map(f => ({ name: f.name, color: cssColor(f.color) })), custom: Boolean(palette), fallback: Boolean(saved && !palette),
    tokens: palette ? paletteTokens(palette) : DEFAULT_THEME[mode], font: palette?.font || SYSTEM_FONT };
}
