// Keep the original pinned/recent order until the first manual move.
export function orderNotes(notes, order = []) {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...notes].sort((a, b) => (positions.get(a.id) ?? order.length) - (positions.get(b.id) ?? order.length)
    || Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}

export function orderTabs(folders, order = []) {
  const tabs = [{ id: 'all', name: 'All' }, ...folders];
  const positions = new Map(order.map((id, index) => [id, index]));
  return tabs.sort((a, b) => (positions.get(a.id) ?? order.length) - (positions.get(b.id) ?? order.length));
}

export function moveItem(ids, id, targetId, placement) {
  if (!['before', 'after'].includes(placement)) throw new Error('Choose before or after the drop target.');
  if (!ids.includes(id) || !ids.includes(targetId)) throw new Error('The item was removed. Try dragging again.');
  if (id === targetId) return [...ids];
  const next = ids.filter(value => value !== id);
  next.splice(next.indexOf(targetId) + (placement === 'after' ? 1 : 0), 0, id);
  return next;
}
