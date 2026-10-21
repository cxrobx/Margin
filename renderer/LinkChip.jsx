import React from 'react';
import { CheckSquare, FileText, LayoutDashboard, StickyNote } from 'lucide-react';
import { searchParts } from './search.mjs';
import { useLinkPreview } from './link-previews.mjs';

const statusNames = { inbox: 'Inbox', todo: 'To do', in_progress: 'In progress', in_review: 'In review', done: 'Done', archived: 'Archived', trashed: 'In Trash' };
function Highlighted({ text, query }) { return searchParts(text, query || '').map((part, index) => part.match ? <mark className="search-match" key={index}>{part.text}</mark> : part.text); }

// A document, task, board or txt note link drawn as a chip, like a Google Docs smart chip: the
// app's own icon and the target's title. A link written with its own label
// keeps that label; a bare path or T-number shows the real title instead.
export default function LinkChip({ link, label, bare, query, onClick, onContextMenu }) {
  const preview = useLinkPreview(link.href);
  const task = link.kind === 'task', board = link.kind === 'board', note = link.kind === 'txt';
  const title = preview?.title || (task || board || note ? null : link.path.split('/').at(-1).replace(/\.[^.]+$/, ''));
  const reference = preview?.reference || link.reference;
  const status = preview?.status;
  const state = preview?.missing ? 'missing' : status === 'done' ? 'done' : ['archived', 'trashed'].includes(status) ? 'away' : undefined;
  const Icon = task ? CheckSquare : board ? LayoutDashboard : note ? StickyNote : FileText;
  const tooltip = note
    ? (preview?.missing ? "This note isn't in txt" : [title, 'Open in txt'].filter(Boolean).join('\n'))
    : board
    ? (preview?.missing ? "This board isn't in CXBoards" : [title, status === 'trashed' ? 'In Trash' : null, 'Open in CXBoards'].filter(Boolean).join('\n'))
    : task
    ? (preview?.missing ? `${reference} isn't in CXTasks` : [[reference, title, statusNames[status]].filter(Boolean).join(' · '), 'Open in CXTasks'].join('\n'))
    : [title, link.path, preview?.missing ? 'This document has moved or is no longer available.' : 'Open in Onyx · Right-click to choose Onyx or Obsidian'].join('\n');
  return <a href={link.href} className="link-chip" data-link-kind={link.kind} data-state={state} title={tooltip} onClick={onClick} onContextMenu={onContextMenu}>
    {preview?.icon ? <img className="chip-icon" src={preview.icon} alt="" draggable={false} /> : <Icon className="chip-icon" size={14} aria-hidden="true" />}
    {bare && task && title && <span className="chip-ref"><Highlighted text={reference} query={query} /></span>}
    <span className="chip-label">{bare ? <Highlighted text={title || reference || (board ? 'Board' : note ? 'Note' : '')} query={query} /> : label}</span>
  </a>;
}
