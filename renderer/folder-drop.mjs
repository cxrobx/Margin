import { canPlace, childrenOf } from '../shared/folders.mjs';

// A tab's middle nests a folder; its edges place it beside that tab.
// The top All tab represents the root, and a sub-row's All represents its parent.
export function resolveFolderDrop(folders, sourceId, targetId, placement) {
  if (sourceId === targetId || !['inside', 'before', 'after'].includes(placement)) return null;
  const source = folders.find(folder => folder.id === sourceId);
  const target = folders.find(folder => folder.id === targetId);
  if ((!source && sourceId !== 'all') || (!target && targetId !== 'all')) return null;
  const parentId = placement === 'inside' ? targetId === 'all' ? null : targetId : target?.parentId ?? null;
  const currentParent = source?.parentId ?? null;
  if (placement !== 'inside' && currentParent === parentId) return { action: 'reorder', targetId, placement };
  if (!source || source.id === 'inbox' || currentParent === parentId || !canPlace(folders, sourceId, parentId)) return null;
  if (childrenOf(folders, parentId).some(folder => folder.id !== sourceId && folder.name.toLowerCase() === source.name.toLowerCase())) return null;
  return { action: 'move-folder', parentId, targetId: placement === 'inside' ? null : targetId, placement: placement === 'inside' ? 'folder' : placement };
}
