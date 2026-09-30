// Folders nest up to three levels. A folder shows its own notes and every
// descendant's; each parent remembers which of its sub-tabs was chosen last.
export const MAX_FOLDER_DEPTH = 3;

export const childrenOf = (folders, parentId) => folders.filter(folder => (folder.parentId ?? null) === parentId);
export const siblingsOf = (folders, folder) => childrenOf(folders, folder.parentId ?? null).filter(value => value.id !== folder.id);

// The folders from the top level down to id, or [] for All, Pinned and Trash.
export function folderPath(folders, id) {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const path = [];
  for (let folder = byId.get(id); folder && path.length <= folders.length; folder = byId.get(folder.parentId)) path.unshift(folder);
  return path;
}
export const folderDepth = (folders, id) => folderPath(folders, id).length;
export const folderLabel = (folders, id) => folderPath(folders, id).map(folder => folder.name).join(' / ');

export function descendantIds(folders, id) {
  const ids = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const folder of folders) if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); grew = true; }
  }
  return ids;
}
// Levels below id, counting id itself: a leaf is 1.
export function subtreeHeight(folders, id) {
  const children = childrenOf(folders, id);
  return 1 + (children.length ? Math.max(...children.map(child => subtreeHeight(folders, child.id))) : 0);
}
// Where id may move: never into itself or a descendant, never past the depth cap.
export function canPlace(folders, id, parentId) {
  if (parentId === null) return true;
  if (!folders.some(folder => folder.id === parentId)) return false;
  if (id && descendantIds(folders, id).has(parentId)) return false;
  return folderDepth(folders, parentId) + (id ? subtreeHeight(folders, id) : 1) <= MAX_FOLDER_DEPTH;
}
export function validateFolderTree(folders) {
  const ids = new Set(folders.map(folder => folder.id));
  for (const folder of folders) {
    const parentId = folder.parentId ?? null;
    if (parentId !== null && !ids.has(parentId)) throw new Error(`The folder “${folder.name}” refers to a missing parent folder.`);
    if (folder.id === 'inbox' && parentId !== null) throw new Error('The Inbox must stay at the top level.');
    const seen = new Set();
    for (let current = folder; current?.parentId; current = folders.find(value => value.id === current.parentId)) {
      if (seen.has(current.id)) throw new Error(`The folder “${folder.name}” is inside itself.`);
      seen.add(current.id);
    }
    if (folderDepth(folders, folder.id) > MAX_FOLDER_DEPTH) throw new Error(`Folders nest up to ${MAX_FOLDER_DEPTH} levels deep.`);
  }
}
// A name no sibling already uses, for folders that move up when a parent is removed.
export function uniqueName(siblings, name, suffix) {
  const taken = new Set(siblings.map(folder => folder.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let index = 1; ; index++) {
    const candidate = `${name.slice(0, 180)} (${suffix}${index > 1 ? ` ${index}` : ''})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
// Every folder in tab order, parents before their children.
export function folderTree(folders) {
  const out = [];
  const visit = (parentId, depth) => { for (const folder of childrenOf(folders, parentId)) { out.push({ folder, depth }); visit(folder.id, depth + 1); } };
  visit(null, 1);
  return out;
}

// memory maps a parent to the sub-tab chosen last: a child's id, or its own id for All.
export function rememberSelection(memory, folders, id) {
  const path = folderPath(folders, id);
  if (!path.length) return memory;
  const next = { ...memory };
  path.forEach((folder, index) => { next[folder.id] = path[index + 1]?.id ?? folder.id; });
  return next;
}
export function resolveSelection(memory, folders, id) {
  let current = id;
  for (let step = 0; step < MAX_FOLDER_DEPTH; step++) {
    const remembered = memory?.[current];
    if (!remembered || remembered === current || !folders.some(folder => folder.id === remembered && folder.parentId === current)) break;
    current = remembered;
  }
  return current;
}
