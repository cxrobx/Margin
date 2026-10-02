import { z } from 'zod';
import { MIN_NOTE_BODY_HEIGHT, MAX_NOTE_BODY_HEIGHT } from './note-size.mjs';
import { ICON_HUES, validImageIcon } from './icons.mjs';
import { savedThemeSchema, vaultThemeSchema, vaultEndpoint } from './themes.mjs';

export const colorSchema = z.enum(['paper', 'sage', 'sand', 'rose', 'lavender', 'sky']);
export const iconSchema = z.string().max(90_000).refine(value => /^lucide:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || validImageIcon(value), 'Choose a built-in icon or a small PNG image.').nullable();
export const iconColorSchema = z.enum(ICON_HUES).nullable();
export const appearanceSchema = z.object({ icon: iconSchema.default(null), iconColor: iconColorSchema.default(null) }).strict();
export const kindSchema = z.enum(['note', 'checklist', 'link', 'code']);
const name = z.string().trim().min(1).max(200);
// Notes may be untitled; a card then opens straight on its writing.
const title = z.string().trim().max(200);
const body = z.string().max(1_000_000);
const bodyHeight = z.number().int().min(MIN_NOTE_BODY_HEIGHT).max(MAX_NOTE_BODY_HEIGHT).nullable();
export const createNoteSchema = z.object({
  title: title.default(''), body: body.default(''),
  folderId: z.string().default('inbox'), color: colorSchema.default('paper'),
  icon: iconSchema.default(null), iconColor: iconColorSchema.default(null),
  kind: kindSchema.default('note'), pinned: z.boolean().default(false), bodyHeight: bodyHeight.default(null),
  source: z.string().trim().min(1).max(80).default('You')
}).strict();
export const updateNoteSchema = z.object({
  title: title.optional(), body: body.optional(), folderId: z.string().optional(),
  color: colorSchema.optional(), kind: kindSchema.optional(), pinned: z.boolean().optional(),
  icon: iconSchema.optional(), iconColor: iconColorSchema.optional(),
  bodyHeight: bodyHeight.optional(), collapsed: z.boolean().optional(), expectedRevision: z.number().int().positive().optional(),
  source: z.string().trim().min(1).max(80).optional()
}).strict();
// The saturation slider was retired; notebooks that saved it must still open.
const retiredSettings = value => {
  if (!value || typeof value !== 'object') return value;
  const { themeSaturation, ...settings } = value; return settings;
};
// What to call a note wherever a name is needed: its title, else its first line.
export const noteLabel = note => note.title?.trim() || (note.body || '').trim().split('\n')[0].replace(/^(?:[-#*>\s]|\[[ x]\])+/i, '').trim().slice(0, 80) || 'Untitled note';
export const settingsSchema = z.preprocess(retiredSettings, z.object({
  cxtasksLinks: z.boolean().default(false),
  autoUpdateCheck: z.boolean().default(true),
  alwaysOnTop: z.boolean(), hotEdge: z.boolean(), showEdgeTab: z.boolean().default(true), edge: z.enum(['left', 'right']),
  theme: z.enum(['light', 'dark', 'system']),
  themeId: z.union([z.enum(['default', 'vault', 'cxtasks-glass', 'monokai-soda']), z.string().uuid()]).default('default'),
  glassTransparency: z.number().min(0).max(1).default(.38),
  vaultAddress: z.string().max(500).refine(value => { try { vaultEndpoint(value); return true; } catch { return false; } }, 'Use a local Onyx address, such as http://127.0.0.1:8899.').default('http://127.0.0.1:8899')
}).strict());
export const dividerLabel = z.string().trim().max(80);
export const dividerSchema = z.object({ id: z.string().uuid(), view: z.string().min(1), label: dividerLabel }).strict();
export const attachmentSchema = z.object({
  id: z.string().uuid(), name: z.string(), filename: z.string(),
  mime: z.string(), size: z.number().nonnegative(), inline: z.boolean().optional()
});
export const noteSchema = createNoteSchema.extend({
  id: z.string().uuid(), collapsed: z.boolean(), revision: z.number().int().positive(),
  attachments: z.array(attachmentSchema), createdAt: z.string(), updatedAt: z.string(),
  deletedAt: z.string().nullable()
});
const notebookSchema = z.object({
  notebookId: z.string().min(1).max(80).default('main'),
  folders: z.array(z.object({ id: z.string(), name, color: colorSchema, parentId: z.string().nullable().default(null), ...appearanceSchema.shape })),
  // Section dividers: aesthetic lines placed among the notes of one view (a folder or All).
  dividers: z.array(dividerSchema).default([]),
  sectionAppearances: z.object({ all: appearanceSchema.optional(), pinned: appearanceSchema.optional(), trash: appearanceSchema.optional() }).strict().default({}),
  notes: z.array(noteSchema),
  noteOrder: z.array(z.string().uuid()).default([]),
  tabOrder: z.array(z.string()).default([]),
  activity: z.array(z.object({ id: z.string(), action: z.string(), title: z.string(), source: z.string(), at: z.string() }))
});
export const stateSchema = notebookSchema.extend({
  version: z.literal(1), revision: z.number().int().nonnegative(),
  settings: settingsSchema,
  demo: z.object({ startedAt: z.string(), normal: notebookSchema }).strict().nullable().default(null),
  themes: z.array(savedThemeSchema).max(50).default([]),
  vaultTheme: vaultThemeSchema.default({ palette: null, variants: { light: null, dark: null } })
});
