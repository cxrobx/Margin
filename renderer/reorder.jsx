import { useRef, useState } from 'react';
import { resolveFolderDrop } from './folder-drop.mjs';

export function useReorder(move, moveToFolder, { folders = [], moveFolder } = {}) {
  const sourceRef = useRef(null);
  const [source, setSource] = useState(null);
  const [target, setTarget] = useState(null);
  const end = () => { sourceRef.current = null; setSource(null); setTarget(null); };
  const placementAt = (event, axis) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return (axis === 'x' ? event.clientX < bounds.left + bounds.width / 2 : event.clientY < bounds.top + bounds.height / 2) ? 'before' : 'after';
  };
  const matches = kind => sourceRef.current?.kind === kind;
  const resolveDrop = (event, kind, id, axis) => {
    const dragged = sourceRef.current;
    if (!dragged) return null;
    if (kind === 'folder' || kind === 'tab') {
      // A divider has no folderId and only reorders among notes.
      if (matches('note')) return dragged.folderId && id !== 'all' && dragged.folderId !== id ? { action: 'move-note', placement: 'folder' } : null;
      if (!matches('tab')) return null;
      const bounds = event.currentTarget.getBoundingClientRect();
      const ratio = (event.clientX - bounds.left) / bounds.width;
      const rootReorder = ['all', 'inbox'].includes(dragged.id) || id === 'all' && !folders.find(folder => folder.id === dragged.id)?.parentId;
      const placement = kind === 'folder' ? 'inside' : rootReorder ? placementAt(event, 'x') : ratio < .3 ? 'before' : ratio > .7 ? 'after' : 'inside';
      return resolveFolderDrop(folders, dragged.id, id, placement);
    }
    return matches(kind) ? { action: 'reorder', placement: placementAt(event, axis) } : null;
  };
  const start = (event, kind, id, folderId) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(`application/x-margin-${kind}`, id);
    sourceRef.current = { kind, id, folderId }; setSource({ kind, id }); setTarget(null);
  };
  const over = (event, kind, id, axis = 'y') => {
    const destination = resolveDrop(event, kind, id, axis);
    if (!destination) { setTarget(previous => previous ? null : previous); return false; }
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const next = sourceRef.current.id === id ? null : { kind, id, placement: destination.placement };
    setTarget(previous => previous?.kind === next?.kind && previous?.id === next?.id && previous?.placement === next?.placement ? previous : next);
    // Native dragover keeps firing at the edge, even while the pointer rests.
    const scroller = event.currentTarget.closest(axis === 'x' ? '.folders, .subfolders' : '.notes-scroll');
    if (scroller) {
      const bounds = scroller.getBoundingClientRect();
      const pointer = axis === 'x' ? event.clientX : event.clientY;
      const start = axis === 'x' ? bounds.left : bounds.top;
      const finish = axis === 'x' ? bounds.right : bounds.bottom;
      const step = pointer < start + 30 ? -14 : pointer > finish - 30 ? 14 : 0;
      scroller.scrollBy(axis === 'x' ? { left: step } : { top: step });
    }
    return true;
  };
  const drop = (event, kind, id, axis = 'y') => {
    const destination = resolveDrop(event, kind, id, axis);
    if (!destination) return false;
    event.preventDefault(); event.stopPropagation();
    const dragged = sourceRef.current;
    end();
    if (destination.action === 'move-note') moveToFolder(dragged.id, id);
    else if (destination.action === 'move-folder') moveFolder(dragged.id, destination.parentId, destination.targetId, destination.placement);
    else if (dragged.id !== id) move(kind, dragged.id, id, destination.placement);
    return true;
  };
  const leave = (event, kind, id) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setTarget(previous => previous?.kind === kind && previous.id === id ? null : previous);
  };
  const keyboard = (event, kind, id, ids, axis = 'y') => {
    if (!event.altKey || event.target !== event.currentTarget) return;
    const direction = event.key === (axis === 'x' ? 'ArrowLeft' : 'ArrowUp') ? -1 : event.key === (axis === 'x' ? 'ArrowRight' : 'ArrowDown') ? 1 : 0;
    if (!direction) return;
    event.preventDefault(); event.stopPropagation();
    const targetId = ids[ids.indexOf(id) + direction];
    if (targetId) move(kind, id, targetId, direction < 0 ? 'before' : 'after');
  };
  const className = (kind, id) => `${source?.kind === kind && source.id === id ? 'is-dragging' : ''} ${target?.kind === kind && target.id === id ? `drop-${target.placement}` : ''}`;
  return { start, over, drop, leave, end, keyboard, className };
}
