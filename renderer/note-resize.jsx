import React, { useEffect, useRef, useState } from 'react';
import { MIN_NOTE_BODY_HEIGHT, MAX_NOTE_BODY_HEIGHT, constrainNoteBodyHeight } from '../shared/note-size.mjs';
import './note-resize.css';

export function useNoteResize(height, commit, expanded = true) {
  const body = useRef(null);
  const drag = useRef(null);
  const commitRef = useRef(commit); commitRef.current = commit;
  const [preview, setPreview] = useState(undefined);
  const [measured, setMeasured] = useState(MIN_NOTE_BODY_HEIGHT);
  const [resizing, setResizing] = useState(false);
  const saveNumber = useRef(0);
  const alive = useRef(true);
  const value = preview === undefined ? height : preview;
  const release = () => {
    const current = drag.current; drag.current = null;
    document.documentElement.classList.remove('is-resizing-note');
    setResizing(false);
    if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    return current;
  };
  const cancel = () => { if (!drag.current) return; release(); setPreview(undefined); };
  const persist = async next => {
    const request = ++saveNumber.current;
    setPreview(next);
    try { await commitRef.current(next); }
    finally { if (alive.current && request === saveNumber.current && !drag.current) setPreview(undefined); }
  };
  useEffect(() => {
    alive.current = true;
    const observer = new ResizeObserver(() => setMeasured(Math.round(body.current?.getBoundingClientRect().height || MIN_NOTE_BODY_HEIGHT)));
    if (body.current) observer.observe(body.current);
    const keyboard = event => {
      if (drag.current && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
    };
    document.addEventListener('keydown', keyboard, true);
    window.addEventListener('blur', cancel);
    return () => {
      alive.current = false; observer.disconnect();
      document.removeEventListener('keydown', keyboard, true); window.removeEventListener('blur', cancel);
      if (drag.current) {
        const current = drag.current; drag.current = null;
        document.documentElement.classList.remove('is-resizing-note');
        if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
      }
    };
  }, [expanded]);
  const start = event => {
    if (event.button !== 0 || !body.current || drag.current) return;
    event.preventDefault(); event.stopPropagation();
    const scroller = body.current.closest('.notes-scroll');
    const startHeight = body.current.getBoundingClientRect().height;
    drag.current = { pointerId: event.pointerId, handle: event.currentTarget, y: event.clientY, startHeight, height: startHeight, scroller, scroll: scroller?.scrollTop || 0, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.documentElement.classList.add('is-resizing-note'); setResizing(true);
  };
  const move = event => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const delta = event.clientY - current.y + (current.scroller?.scrollTop || 0) - current.scroll;
    if (!current.moved && Math.abs(delta) < 2) return;
    current.moved = true; current.height = constrainNoteBodyHeight(current.startHeight + delta);
    setPreview(current.height);
  };
  const finish = event => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    move(event);
    const current = release();
    if (current.moved && current.height !== Math.round(current.startHeight)) persist(current.height);
    else setPreview(undefined);
  };
  const keyboard = event => {
    if (event.key === 'Escape') return;
    const step = event.shiftKey ? 80 : 20;
    let next;
    if (event.key === 'ArrowUp') next = constrainNoteBodyHeight((value ?? measured) - step);
    else if (event.key === 'ArrowDown') next = constrainNoteBodyHeight((value ?? measured) + step);
    else if (event.key === 'Home') next = MIN_NOTE_BODY_HEIGHT;
    else if (event.key === 'End') next = MAX_NOTE_BODY_HEIGHT;
    else if (event.key === 'Enter') next = null;
    else return;
    event.preventDefault(); event.stopPropagation(); persist(next);
  };
  return { body, style: value == null ? undefined : { height: value, maxHeight: 'none' }, resizing, handle: {
    'aria-valuemin': MIN_NOTE_BODY_HEIGHT, 'aria-valuemax': MAX_NOTE_BODY_HEIGHT, 'aria-valuenow': value ?? measured,
    onPointerDown: start, onPointerMove: move, onPointerUp: finish, onPointerCancel: cancel, onLostPointerCapture: cancel,
    onKeyDown: keyboard, onDoubleClick: event => { event.preventDefault(); event.stopPropagation(); persist(null); },
    onClick: event => { event.preventDefault(); event.stopPropagation(); }
  } };
}

export function NoteResizeHandle({ resize, disabled = false }) {
  return <button type="button" role="separator" aria-orientation="horizontal" aria-label="Resize note" aria-keyshortcuts="ArrowUp ArrowDown Home End Enter" title="Drag up or down to resize · Double-click to fit content" className={`note-resize-handle ${resize.resizing ? 'resizing' : ''}`} draggable={false} disabled={disabled} {...resize.handle}><span /></button>;
}
