import React, { useEffect, useRef, useState } from 'react';

// A labelled line among the notes. It reorders like a note: drag it, or focus
// it and press Option ↑/↓. Double-click or Enter names it.
export default function SectionDivider({ divider, act, api, reorder, noteIds, editing, setEditing, openMenu }) {
  const [label, setLabel] = useState(divider.label);
  const cancelled = useRef(false);
  useEffect(() => { if (!editing) setLabel(divider.label); }, [divider.label, editing]);
  const save = () => {
    const next = label.trim();
    setEditing(null);
    if (cancelled.current) { cancelled.current = false; return; }
    if (next !== divider.label) act(api.renameDivider(divider.id, next));
  };
  return <div className={`note-divider ${divider.label ? '' : 'unlabelled'} ${reorder.className('note', divider.id)}`} data-divider-id={divider.id}
    role="separator" aria-label={divider.label ? `Section ${divider.label}` : 'Section divider'} tabIndex={0} draggable={!editing}
    title={editing ? undefined : 'Drag to reorder · Double-click to name · Right-click for options'}
    onDragStart={e => reorder.start(e, 'note', divider.id)} onDragEnd={reorder.end}
    onDragOver={e => reorder.over(e, 'note', divider.id)} onDrop={e => reorder.drop(e, 'note', divider.id)} onDragLeave={e => reorder.leave(e, 'note', divider.id)}
    onDoubleClick={() => setEditing(divider.id)}
    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openMenu(e, divider); }}
    onKeyDown={e => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter') { e.preventDefault(); setEditing(divider.id); }
      else reorder.keyboard(e, 'note', divider.id, noteIds);
    }}>
    {editing
      ? <input autoFocus aria-label="Section name" placeholder="Name this section" maxLength={80} value={label} onChange={e => setLabel(e.target.value)} onBlur={save}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancelled.current = true; setLabel(divider.label); e.currentTarget.blur(); }
          }} />
      : divider.label && <span className="note-divider-label">{divider.label}</span>}
  </div>;
}

// A small menu at the pointer, for right-clicks in the notes pane.
export function ContextMenu({ menu, close }) {
  const ref = useRef(null);
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const outside = e => { if (!ref.current?.contains(e.target)) closeRef.current(); };
    const escape = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(); } };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true);
    ref.current?.querySelector('button')?.focus();
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); };
  }, []);
  // Keep the menu inside the panel near the right and bottom edges.
  const left = Math.min(menu.x, window.innerWidth - 200), top = Math.min(menu.y, window.innerHeight - 24 - menu.items.length * 36);
  return <div ref={ref} className="popup-menu context-menu" role="menu" style={{ left, top }}>
    {menu.items.map(item => { const Icon = item.icon; return <button key={item.label} role="menuitem" className={item.danger ? 'danger' : ''} onClick={item.run}>{Icon && <Icon size={14} />}{item.label}</button>; })}
  </div>;
}
