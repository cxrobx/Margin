import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import IconPicker from './IconPicker.jsx';
import NodeIcon from './NodeIcon.jsx';
import RichText from './RichText.jsx';
import LinkChip from './LinkChip.jsx';
import NoteCaret from './NoteCaret.jsx';
import LaunchAtStartup from './LaunchAtStartup.jsx';
import { useNoteResize, NoteResizeHandle } from './note-resize.jsx';
import { NoteAutosave } from './note-autosave.mjs';
import { imageAttachmentId, separateAttachments } from '../shared/attachments.mjs';
import { noteLabel } from '../shared/schema.mjs';
import { Undo2, Redo2 } from 'lucide-react';
import { ArrowLeft, ArrowRight, Check, CheckSquare, ChevronDown, ChevronRight, Code2, Copy, Download, FileText, Folder, FolderPlus, GripVertical, Inbox, Link2, Minus, MoreHorizontal, Paperclip, Pin, Plus, Search, Settings, Sparkles, Trash2, X } from 'lucide-react';
import './style.css';
import './panel.css';
import Themes, { applyAppearance } from './Themes.jsx';
import { Palette } from 'lucide-react';
import './glass.css';
import './vault.css';
import './icons.css';
import { GLASS_THEME, folderHue, resolveAppearance } from '../shared/themes.mjs';
import { installPanelMotion } from './panel-motion.mjs';
import { orderNotes, orderTabs, withDividers } from '../shared/order.mjs';
import { MAX_FOLDER_DEPTH, canPlace, childrenOf, descendantIds, folderDepth, folderLabel, folderPath, folderTree, rememberSelection, resolveSelection } from '../shared/folders.mjs';
import SectionDivider, { ContextMenu } from './SectionDivider.jsx';
import { useReorder } from './reorder.jsx';
import { NoteHistory, BackupTools } from './NotebookTools.jsx';
import { rehypeSearch, searchParts, matchesNote } from './search.mjs';
import { parseAppLink, safeAppHref } from '../shared/app-links.mjs';
import { rehypeAppLinks } from './app-links.mjs';
import { DocumentChipsContext, TaskLinksContext } from './task-links-context.mjs';
import './notebook-tools.css';
import './link-chip.css';

const readingSchema = { ...defaultSchema, tagNames: [...defaultSchema.tagNames, 'u', 'mark'], protocols: { ...defaultSchema.protocols, src: [...defaultSchema.protocols.src, 'margin'], href: [...defaultSchema.protocols.href, 'margin', 'file', 'obsidian', 'cxtasks'] } };
const api = window.margin;
installPanelMotion(api);
const colors = ['paper', 'sage', 'sand', 'rose', 'lavender', 'sky'];
const kindIcons = { note: FileText, checklist: CheckSquare, link: Link2, code: Code2 };
const kindNames = { note: 'Note', checklist: 'Checklist', link: 'Link', code: 'Code' };
const draftPrefix = 'margin-note-draft';
const dateLabel = date => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(date));
const freshDraft = folderId => ({ title: '', body: '', color: 'paper', folderId: folderId && !['all', 'pinned', 'trash'].includes(folderId) ? folderId : 'inbox', kind: 'note', pinned: false, icon: null, iconColor: null, bodyHeight: null });
function IconButton({ label, children, ...props }) { return <button className="icon-button" aria-label={label} title={label} {...props}>{children}</button>; }

function Highlighted({ text, query }) { return searchParts(text, query || '').map((part, index) => part.match ? <mark className="search-match" key={index}>{part.text}</mark> : part.text); }

const textOf = node => node.type === 'text' ? node.value : (node.children || []).map(textOf).join('');
// A pasted path or T-number links to itself; anything else is a label the author chose.
function isBareReference(node, link) { try { return parseAppLink(textOf(node)).href === link.href; } catch { return false; } }
function Markdown({ body, note, act, query = '' }) {
  const cxtasksLinks = React.useContext(TaskLinksContext);
  const documentChips = React.useContext(DocumentChipsContext);
  return <ReactMarkdown urlTransform={(value, key) => key === 'src' && imageAttachmentId(value) ? value : safeAppHref(value)} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, readingSchema], [rehypeAppLinks, { cxtasksLinks }], [rehypeSearch, { query }]]} components={{
    a: ({ node, href, children }) => {
      let link; try { link = parseAppLink(href); } catch {}
      const kind = link?.kind;
      if (!href || !kind || kind === 'task' && !cxtasksLinks) return <span>{children}</span>;
      const onClick = e => { e.preventDefault(); e.stopPropagation(); act(api.openLink(href)); };
      const onContextMenu = kind === 'document' ? e => { e.preventDefault(); e.stopPropagation(); act(api.linkMenu(href)); } : undefined;
      // Task links exist only with CXTasks installed and enabled, so they are always chips.
      if (kind === 'document' && documentChips || kind === 'task') return <LinkChip link={link} label={children} bare={isBareReference(node, link)} query={query} onClick={onClick} onContextMenu={onContextMenu} />;
      return <a href={href} data-link-kind={kind} title={kind === 'document' ? 'Open document · Right-click to choose Onyx or Obsidian' : kind === 'obsidian' ? 'Open in Obsidian' : undefined} onClick={onClick} onContextMenu={onContextMenu}>{children}<ArrowRight size={12} /></a>;
    },
    img: ({ src, alt }) => imageAttachmentId(src)
      ? <button className="note-image-button" title={`Open ${alt || 'image'}`} onClick={e => { e.stopPropagation(); act(api.openAttachment(imageAttachmentId(src))); }}><img className="note-inline-image" src={src} alt={alt || 'Pasted image'} /></button>
      : <span className="remote-image">{alt || 'Image'} · Attach images locally to preview them</span>,
    li: ({ node, children, className }) => {
      const task = className?.includes('task-list-item');
      const line = (node?.position?.start?.line || 1) - 1;
      const done = /^\s*[-*+] \[[xX]\]/.test(body.split('\n')[line] || '');
      return <li className={`${className || ''} ${done ? 'task-done' : ''}`}>
        {task && <button className={`task-check ${done ? 'checked' : ''}`} disabled={!note} aria-label={`${done ? 'Reopen' : 'Complete'} task on line ${line + 1}`} onClick={e => { e.stopPropagation(); act(api.toggleTask(note.id, line, !done, note.revision)); }}>{done && <Check size={12} strokeWidth={3} />}</button>}
        {children}
      </li>;
    },
    input: () => null
  }}>{body}</ReactMarkdown>;
}

function NoteCard({ note, folder, edit, act, trashView, reorder, noteIds, folderTint, chooseIcon, query, showHistory }) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  const blockDrag = useRef(false);
  const cardRef = useRef(null); const matchIndex = useRef(0);
  useEffect(() => { matchIndex.current = 0; }, [query]);
  const expanded = !note.collapsed || Boolean(query);
  const nextMatch = () => {
    const marks = [...cardRef.current.querySelectorAll('.search-match')];
    if (!marks.length) { cardRef.current.querySelector('.attachments')?.scrollIntoView({ block: 'center' }); return; }
    marks.forEach(mark => mark.classList.remove('current-match'));
    const mark = marks[matchIndex.current++ % marks.length];
    mark.classList.add('current-match'); mark.scrollIntoView({ block: 'center', inline: 'nearest' });
  };
  const resize = useNoteResize(note.bodyHeight, height => act(api.update(note.id, { bodyHeight: height })), expanded);
  const KindIcon = kindIcons[note.kind];
  const tasks = [...note.body.matchAll(/^\s*[-*+] \[([ xX])\] /gm)];
  useEffect(() => {
    if (!menu) return;
    const close = e => { if (!menuRef.current?.contains(e.target)) setMenu(false); };
    document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  const drop = e => {
    if (!trashView && reorder.drop(e, 'note', note.id)) return;
    e.preventDefault();
    if (e.dataTransfer.files.length && !trashView) act(api.dropFiles(note.id, Array.from(e.dataTransfer.files)));
  };
  return <article ref={cardRef} className={`note-card color-${note.color} ${!expanded ? 'folded' : ''} ${reorder.className('note', note.id)}`} data-note-id={note.id}
    draggable={!trashView} tabIndex={trashView ? undefined : 0} aria-label={noteLabel(note)} aria-keyshortcuts={trashView ? undefined : 'Enter Alt+ArrowUp Alt+ArrowDown'}
    onPointerDownCapture={e => { blockDrag.current = Boolean(e.target.closest('button:not(.card-title), a, input, textarea, select, .note-body, .attachments')); e.currentTarget.draggable = !trashView && !blockDrag.current; }}
    onDragStart={e => { if (trashView || blockDrag.current) { e.preventDefault(); return; } reorder.start(e, 'note', note.id, note.folderId); }}
    onDragEnd={reorder.end} onDragLeave={e => reorder.leave(e, 'note', note.id)}
    onDragOver={e => { if (!trashView && reorder.over(e, 'note', note.id)) return; if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={drop}
    onDoubleClick={e => {
      if (trashView || e.target.closest('button:not(.card-title), a, input, textarea, select, .attachments')) return;
      edit(note, { target: e.target.closest('.card-title') ? 'title' : 'body', x: e.clientX, y: e.clientY, scrollTop: e.currentTarget.querySelector('.note-body')?.scrollTop || 0 });
    }}
    onKeyDown={e => {
      if (trashView) return;
      if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); edit(note); }
      else reorder.keyboard(e, 'note', note.id, noteIds);
    }}>
    <header className="card-header">
      <span className={`note-type hue-${({ note: 'teal', checklist: 'green', link: 'blue', code: 'purple' })[note.kind]} ${trashView ? '' : 'note-drag-handle'}`} title={trashView ? undefined : 'Drag to reorder or move into a folder · Option ↑/↓ when the card is focused'}>{!trashView && <GripVertical size={12} className="drag-grip" />}<NodeIcon icon={note.icon} iconColor={note.iconColor} fallback={KindIcon} size={13} />{kindNames[note.kind]}</span>
      <div className="card-actions">
        {note.pinned && <Pin size={13} className="pinned-icon" fill="currentColor" />}
        <IconButton label={note.collapsed ? 'Expand note' : 'Fold note'} onClick={() => act(api.update(note.id, { collapsed: !note.collapsed }))}>{note.collapsed ? <ChevronDown size={15} /> : <Minus size={15} />}</IconButton>
        <div className="menu-wrap" ref={menuRef}>
          <IconButton label={`Actions for ${noteLabel(note)}`} onClick={() => setMenu(!menu)}><MoreHorizontal size={17} /></IconButton>
          {menu && <div className="popup-menu">
            {trashView ? <button onClick={() => { act(api.restore(note.id), 'Note restored'); setMenu(false); }}><ArrowLeft size={14} />Restore note</button> : <>
              <button onClick={() => { edit(note); setMenu(false); }}><FileText size={14} />Edit note</button>
              <button onClick={() => { chooseIcon(note); setMenu(false); }}><Palette size={14} />Icon &amp; color…</button>
              <button onClick={() => { act(api.update(note.id, { pinned: !note.pinned })); setMenu(false); }}><Pin size={14} />{note.pinned ? 'Unpin' : 'Pin to top'}</button>
              <button onClick={() => { act(api.attach(note.id)); setMenu(false); }}><Paperclip size={14} />Attach a file</button>
              <button onClick={() => { act(api.copy(note.title ? `${note.title}\n\n${note.body}` : note.body), 'Copied note'); setMenu(false); }}><Copy size={14} />Copy note</button>
              <button onClick={async () => { const copy = await act(api.duplicate(note.id), 'Note duplicated'); setMenu(false); if (copy) edit(copy); }}><Copy size={14} />Duplicate note</button>
              <button onClick={() => { act(api.copyLink(note.id), 'Note link copied'); setMenu(false); }}><Link2 size={14} />Copy link to note</button>
              <button onClick={() => { showHistory(note); setMenu(false); }}><Undo2 size={14} />Note history…</button>
              <button onClick={() => { act(api.exportMarkdown({ noteId: note.id }), 'Markdown exported'); setMenu(false); }}><Download size={14} />Export as Markdown…</button>
              <button className="danger" onClick={() => { act(api.trash(note.id), 'Moved to Trash'); setMenu(false); }}><Trash2 size={14} />Move to Trash</button>
            </>}
          </div>}
        </div>
      </div>
    </header>
    {/* An untitled card opens on its writing; folded, its first line stands in. */}
    {(note.title || !expanded) && <button className={`card-title ${note.title ? '' : 'untitled'}`} title={trashView ? undefined : 'Double-click to edit'} onClick={e => { if (e.detail === 0 && !trashView) edit(note); }}><Highlighted text={note.title || noteLabel(note)} query={query} /></button>}
    {expanded && <div ref={resize.body} style={resize.style} className="markdown note-body"><Markdown body={note.body} note={trashView ? null : note} act={act} query={query} />
    {separateAttachments(note).length > 0 && <div className="attachments">{separateAttachments(note).map(a => <button key={a.id} onClick={() => act(api.openAttachment(a.id))} title={`Open ${a.name}`}>
      {a.mime.startsWith('image/') ? <img src={`margin://attachment/${a.id}`} alt={a.name} /> : <span><Paperclip size={14} />{a.name}</span>}
    </button>)}</div>}</div>}
    {query && <button className="jump-match" onClick={nextMatch}>Jump to next match<ArrowRight size={12} /></button>}
    <footer className="card-footer">
      <span className="card-location" style={folderTint}><i className={`folder-dot color-${folder?.color || 'paper'}`} />{folder?.name || 'Inbox'}<span className="separator-dot">·</span>{dateLabel(note.updatedAt)}</span>
      {tasks.length > 0 ? <span className="task-progress">{tasks.filter(t => t[1].toLowerCase() === 'x').length}/{tasks.length}</span> : note.source !== 'You' && <span className="note-source"><Sparkles size={10} />{note.source}</span>}
    </footer>
    {expanded && !trashView && <NoteResizeHandle resize={resize} />}
  </article>;
}

const Editor = React.forwardRef(function Editor({ initial, focus, folders, close, act, draftKey, onIdentityChange, folderTint, chooseIcon, suspended }, ref) {
  const [, refresh] = useState(0);
  const autosaveRef = useRef(null);
  const identityRef = useRef(onIdentityChange); identityRef.current = onIdentityChange;
  if (!autosaveRef.current) autosaveRef.current = new NoteAutosave(initial, api, {
    changed: () => { refresh(value => value + 1); identityRef.current(autosaveRef.current.draft.id); },
    retain: draft => localStorage.setItem(draftKey, JSON.stringify(draft)),
    clear: () => localStorage.removeItem(draftKey)
  });
  const autosave = autosaveRef.current;
  const draft = autosave.draft;
  const saving = Boolean(autosave.pending || autosave.imagePending || autosave.paused);
  const { error, conflict } = autosave;
  const [options, setOptions] = useState(false);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [richVersion, setRichVersion] = useState(0);
  const rich = useRef(null);
  const card = useRef(null);
  const title = useRef(null);
  const optionsRef = useRef(null);
  const closing = useRef(false);
  const change = patch => autosave.update(patch);
  const resize = useNoteResize(draft.bodyHeight, height => change({ bodyHeight: height }));
  const requestClose = async () => {
    if (closing.current || autosave.paused) return;
    closing.current = true;
    try { if (await autosave.save()) { localStorage.removeItem(draftKey); close(); } }
    finally { closing.current = false; }
  };
  React.useImperativeHandle(ref, () => ({ save: () => autosave.save() }), [autosave]);
  useEffect(() => {
    if (focus?.target !== 'body') { title.current?.focus(); title.current?.setSelectionRange(draft.title.length, draft.title.length); }
    if (!initial.id) card.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  useEffect(() => {
    autosave.schedule();
    const flush = () => autosave.save();
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    const requested = event => { event.detail.pending = autosave.save(); };
    window.addEventListener('margin:flush-note', requested);
    window.addEventListener('blur', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('margin:flush-note', requested);
      window.removeEventListener('blur', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      autosave.dispose();
    };
  }, [autosave]);
  useEffect(() => {
    const pointer = e => {
      if (suspended) return;
      if (card.current?.contains(e.target) || e.target.closest('.format-bubble')) {
        if (!optionsRef.current?.contains(e.target)) setOptions(false);
        return;
      }
      requestClose();
    };
    const keyboard = e => {
      if (suspended || !e.target.closest('.editor, .format-bubble') || e.target.closest('.bubble-link')) return;
      if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
        e.preventDefault(); e.stopPropagation();
        if (options) setOptions(false); else requestClose();
      }
    };
    document.addEventListener('pointerdown', pointer);
    // Dismiss editing before ProseMirror or the panel handles Escape.
    document.addEventListener('keydown', keyboard, true);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', keyboard, true); };
  });
  const editCommand = action => {
    const focused = document.activeElement;
    if (focused?.matches('input, textarea') && !focused.closest('.rich-body')) { api.nativeEdit(action); return; }
    if (focused?.closest('.editor, .format-bubble')) rich.current?.[action]();
    else api.nativeEdit(action);
  };
  useEffect(() => {
    const unsubscribe = api.onEditCommand(editCommand);
    const listener = e => {
      if (!e.defaultPrevented && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && e.target.closest('.rich-body, .format-bubble') && !e.target.matches('input, textarea')) {
        e.preventDefault(); rich.current?.[e.shiftKey ? 'redo' : 'undo']();
      }
    };
    document.addEventListener('keydown', listener);
    return () => { unsubscribe(); document.removeEventListener('keydown', listener); };
  });
  const reload = async () => {
    const result = await api.snapshot();
    if (!result.ok) { autosave.fail(result); return; }
    const note = result.value.notes.find(n => n.id === draft.id && !n.deletedAt);
    if (!note) { autosave.fail({ conflict: true, error: 'This note has been moved to Trash. Save your draft as a new note.' }); return; }
    autosave.reset(note); setRichVersion(v => v + 1);
  };
  const folder = folders.find(f => f.id === draft.folderId);
  const KindIcon = kindIcons[draft.kind];
  return <article ref={card} className={`note-card color-${draft.color} editor inline-editor`} data-note-id={draft.id} aria-label={draft.id ? `Editing ${noteLabel(draft)}` : 'New note'}>
    <NoteCaret card={card} bodyCaret={() => rich.current?.caretRect()} suspended={suspended} />
    <header className="card-header">
      <span className={`note-type hue-${({ note: 'teal', checklist: 'green', link: 'blue', code: 'purple' })[draft.kind]}`}><GripVertical size={12} className="drag-grip" /><button className="inline-note-icon" aria-label="Note icon and color" title="Icon & color" onClick={() => chooseIcon({ ...draft, name: noteLabel(draft), fallback: KindIcon, save: async patch => { change(patch); const ok = await autosave.save(); return { ok, value: autosave.draft, error: autosave.error }; } })}><NodeIcon icon={draft.icon} iconColor={draft.iconColor} fallback={KindIcon} size={13} /></button>{kindNames[draft.kind]}</span>
      <div className="card-actions">
        <IconButton label="Undo" aria-keyshortcuts="Meta+Z" disabled={!history.undo} onMouseDown={e => e.preventDefault()} onClick={() => rich.current?.undo()}><Undo2 size={14} /></IconButton>
        <IconButton label="Redo" aria-keyshortcuts="Meta+Shift+Z" disabled={!history.redo} onMouseDown={e => e.preventDefault()} onClick={() => rich.current?.redo()}><Redo2 size={14} /></IconButton>
        <div className="menu-wrap" ref={optionsRef}>
          <IconButton label="Note settings" onClick={() => setOptions(!options)}><Settings size={14} /></IconButton>
          {options && <div className="popup-menu inline-note-options" aria-label="Note settings options">
            <div className="inline-kind-options">{Object.entries(kindIcons).map(([kind, Icon]) => <button key={kind} aria-label={`${kindNames[kind]} type`} aria-pressed={draft.kind === kind} className={draft.kind === kind ? 'selected' : ''} onClick={() => { change({ kind }); if (kind === 'checklist' && !draft.body) rich.current?.checklist(); if (kind === 'code' && !draft.body) rich.current?.codeBlock(); }}><Icon size={14} />{kindNames[kind]}</button>)}</div>
            <label className="inline-folder-option"><Folder size={13} /><select aria-label="Note folder" value={draft.folderId} onChange={e => change({ folderId: e.target.value })}>{folderTree(folders).map(({ folder: f }) => <option key={f.id} value={f.id}>{folderLabel(folders, f.id)}</option>)}</select></label>
            <button aria-label={draft.pinned ? 'Unpin note' : 'Pin note'} onClick={() => change({ pinned: !draft.pinned })}><Pin size={14} />{draft.pinned ? 'Unpin note' : 'Pin note'}</button>
            <button aria-label="Attach a file or image" disabled={!autosave.canSave || saving || conflict} onClick={() => autosave.attach()}><Paperclip size={14} />Attach a file or image</button>
            <div className="inline-color-options">{colors.map(color => <button key={color} className={`swatch color-${color} ${draft.color === color ? 'selected' : ''}`} aria-label={`${color} note color`} onClick={() => change({ color })}>{draft.color === color && <Check size={13} />}</button>)}</div>
          </div>}
        </div>
        <IconButton label="Done editing" aria-keyshortcuts="Escape Meta+Enter" onClick={requestClose}><Check size={15} /></IconButton>
      </div>
    </header>
    <input ref={title} className="card-title editor-title" placeholder="Untitled thought" aria-label="Note title" value={draft.title} maxLength={200} onChange={e => change({ title: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); rich.current?.focus(); } }} />
    <div ref={resize.body} style={resize.style} className="note-body editor-scroll"><RichText key={richVersion} ref={rich} body={draft.body} visible onChange={body => change({ body })} onHistoryChange={setHistory} onPasteImage={(file, insert) => autosave.pasteImage(file, insert)} copy={text => act(api.copy(text), 'Selection copied')} placeholder="What’s on your mind?" focus={focus?.target === 'body' ? focus : undefined} />
    {separateAttachments(draft).length > 0 && <div className="attachments">{separateAttachments(draft).map(a => <button key={a.id} onClick={() => act(api.openAttachment(a.id))} title={`Open ${a.name}`}>
      {a.mime.startsWith('image/') ? <img src={`margin://attachment/${a.id}`} alt={a.name} /> : <span><Paperclip size={14} />{a.name}</span>}
    </button>)}</div>}</div>
    <footer className="card-footer">
      <span className="card-location" style={folderTint(folder)}><i className={`folder-dot color-${folder?.color || 'paper'}`} />{folder?.name || 'Inbox'}{draft.updatedAt && <><span className="separator-dot">·</span>{dateLabel(draft.updatedAt)}</>}</span>
      <span className={`editor-save-status ${error ? 'error' : ''}`} role="status" aria-live="polite">{autosave.status}{autosave.status === 'Saved' && <Check size={12} />}</span>
    </footer>
    <NoteResizeHandle resize={resize} disabled={suspended} />
    {error && <div className="editor-error" role="alert">{error}<div>{conflict ? <><button onClick={reload}>Reload latest</button><button onClick={() => autosave.saveAsNew()}>Save draft as new</button></> : <button onClick={() => autosave.save()}>Retry saving</button>}<button onClick={close}>Close and keep draft</button></div></div>}
  </article>;
});

function Connections({ back, act }) {
  const [info, setInfo] = useState(null);
  const [tab, setTab] = useState('codex');
  const [copied, setCopied] = useState(false);
  useEffect(() => { api.connections().then(result => result.ok && setInfo(result.value)); }, []);
  const labels = { codex: 'Codex', claude: 'Claude Code', claudeDesktop: 'Claude Desktop' };
  return <section className="overlay connection-overlay" role="dialog" aria-modal="true" aria-label="Connect assistants">
    <div className="overlay-top"><IconButton label="Back to preferences" onClick={back}><ArrowLeft size={19} /></IconButton><span>Connect assistants</span><span className="local-badge"><i />Local MCP</span></div>
    <div className="connection-content"><div className="connection-emblem"><Sparkles size={29} strokeWidth={1.5} /></div><h1>Good thoughts.<br />Better together.</h1><p>Give your assistant a place to leave notes, links, tasks, and the things worth keeping.</p>
      <div className="connection-tabs">{Object.entries(labels).map(([value, label]) => <button key={value} className={tab === value ? 'selected' : ''} onClick={() => { setTab(value); setCopied(false); }}>{label}</button>)}</div>
      <div className="setup-step"><span className="step-number">1</span><div><h3>{tab === 'claudeDesktop' ? 'Add to your MCP configuration' : 'Run this once in Terminal'}</h3><p>{tab === 'claudeDesktop' ? <>Merge the <code>margin</code> entry into <code>claude_desktop_config.json</code>, under <code>mcpServers</code>.</> : `Registers Margin with ${labels[tab]} using the same notebook as this app.`}</p></div></div>
      <div className="config-box"><pre>{info?.[tab] || 'Preparing connection…'}</pre><button disabled={!info} onClick={async () => { const result = await act(api.copy(info[tab])); setCopied(result !== undefined); }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : tab === 'claudeDesktop' ? 'Copy configuration' : 'Copy command'}</button></div>
      <div className="setup-step"><span className="step-number">2</span><div><h3>Restart your assistant</h3><p>Open a fresh conversation so the Margin tools are available.</p></div></div>
      <div className="setup-step"><span className="step-number">3</span><div><h3>Leave something in the margin</h3><blockquote>“Add a note to Margin with the key decisions from this conversation.”</blockquote></div></div>
      <div className="privacy-note"><Folder size={16} /><div><strong>Your Mac. Your notes.</strong><p>No cloud service or API key needed. Assistants access this notebook through a local process.</p></div></div>
      <details className="advanced"><summary>Advanced: Codex TOML configuration</summary><pre>{info?.codexToml}</pre><button onClick={() => act(api.copy(info.codexToml), 'Configuration copied')}>Copy TOML</button></details>
    </div>
  </section>;
}

function Preferences({ state, hasCXTasks, close, act, showActivity, showThemes, showConnections, showBackups, changeDemo, resetNotebook }) {
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(null);
  useEffect(() => { if (confirmReset) document.querySelector('[aria-label="Confirm reset notebook"]')?.focus(); }, [confirmReset]);
  const toggleDemo = async () => { setBusy(true); await changeDemo(!state.demo); setBusy(false); };
  const reset = async () => { setBusy(true); const ok = await resetNotebook(confirmReset.revision); setBusy(false); if (!ok) setConfirmReset(null); };
  const setting = patch => act(api.settings(patch));
  return <section className="overlay" role="dialog" aria-modal="true" aria-label="Preferences">
    <div className="overlay-top"><IconButton label="Back to notes" onClick={close}><ArrowLeft size={19} /></IconButton><span>Make it yours</span><span /></div>
    <div className="preferences-content"><h1>A little more<br />your style.</h1><div className="pref-group"><h3>Your workspace</h3>
      <LaunchAtStartup api={api} />
      <label className="pref-row"><div><strong>Stay within reach</strong><small>Keep Margin above other windows</small></div><input type="checkbox" checked={state.settings.alwaysOnTop} onChange={e => setting({ alwaysOnTop: e.target.checked })} /></label>
      <label className="pref-row"><div><strong>Show screen-edge tab</strong><small>Turn off to use the shortcut or menu bar</small></div><input aria-label="Show screen-edge tab" type="checkbox" checked={state.settings.showEdgeTab} onChange={e => setting({ showEdgeTab: e.target.checked })} /></label>
      <label className="pref-row"><div><strong>Open from the edge</strong><small>Pause your pointer at the screen edge</small></div><input type="checkbox" checked={state.settings.hotEdge} onChange={e => setting({ hotEdge: e.target.checked })} /></label>
      <label className="pref-row"><div><strong>Screen edge</strong><small>Where Margin feels at home</small></div><select value={state.settings.edge} onChange={e => setting({ edge: e.target.value })}><option value="right">Right</option><option value="left">Left</option></select></label>
      <button className="pref-action theme-pref" aria-label="Themes" onClick={showThemes}><Palette size={17} /><span><strong>Themes</strong><small>{state.settings.themeId === 'vault' ? 'Match vault' : (state.settings.themeId === GLASS_THEME.id ? GLASS_THEME.name : state.themes.find(t => t.id === state.settings.themeId)?.name || 'Default')} · {state.settings.themeId === 'vault' ? 'Follows Obsidian' : state.settings.theme}</small></span><ChevronRight size={15} /></button>
    </div><div className="pref-group"><h3>Your notebook</h3><button className="pref-action" onClick={() => act(api.export(), 'Backup exported')}><Download size={17} />Export notes and attachments<ChevronRight size={15} /></button><button className="pref-action" onClick={showBackups}><Undo2 size={17} />Backups &amp; import<ChevronRight size={15} /></button><button className="pref-action" onClick={() => act(api.importMarkdown('inbox'), 'Markdown imported')}><FileText size={17} />Import Markdown files…<ChevronRight size={15} /></button><button className="pref-action" onClick={() => act(api.importMarkdown('inbox', true), 'Markdown imported')}><FolderPlus size={17} />Import Markdown folder…<ChevronRight size={15} /></button><button className="pref-action" onClick={() => act(api.exportMarkdown(), 'Markdown exported')}><Download size={17} />Export notebook as Markdown…<ChevronRight size={15} /></button><button className="pref-action" onClick={() => act(api.showData())}><Folder size={17} />Open local data folder<ChevronRight size={15} /></button><button className="pref-action" onClick={showActivity}><Sparkles size={17} />Recent activity<ChevronRight size={15} /></button><p className="pref-caption">Margin keeps the last 40 saved versions in your data folder’s backups directory. Export includes your attachments.</p></div>
    <div className="pref-group"><h3>Integrations</h3>
      <button className="pref-action notebook-pref" aria-label="Assistants" onClick={showConnections}><Sparkles size={17} /><span><strong>Assistants</strong><small>Connect Codex or Claude to your notes</small></span><ChevronRight size={15} /></button>
      {hasCXTasks && <label className="pref-row"><div><strong>Enable CXTasks links</strong><small>Open T42 references in CXTasks</small></div><input aria-label="Enable CXTasks links" type="checkbox" checked={state.settings.cxtasksLinks} onChange={e => setting({ cxtasksLinks: e.target.checked })} /></label>}
    </div>
    <div className="pref-group"><h3>Demo & reset</h3>
      <button className="pref-action notebook-pref" aria-label={state.demo ? 'Exit demo mode' : 'Start demo mode'} disabled={busy} onClick={toggleDemo}><Sparkles size={17} /><span><strong>{state.demo ? 'Exit demo mode' : 'Start demo mode'}</strong><small>{state.demo ? 'Discard demo content and return to your notebook' : 'Explore Margin with sample notes'}</small></span><ChevronRight size={15} /></button>
      <button className="pref-action notebook-pref" aria-label="Reset to default" disabled={busy || Boolean(state.demo)} onClick={() => setConfirmReset({ revision: state.revision, count: state.notes.length })}><Trash2 size={17} /><span><strong>Reset to default</strong><small>Start over with an empty notebook</small></span><ChevronRight size={15} /></button>
      <p className="pref-caption">{state.demo ? 'Your regular notebook is saved. Leave demo mode to reset it.' : 'Demo mode keeps your regular notes separate. Reset clears notes, Trash, folders, and activity; your theme and preferences stay. A backup is saved first.'}</p>
    </div>
    <div className="shortcut-card"><kbd>⌘</kbd><kbd>⇧</kbd><kbd>Space</kbd><p>A small shortcut.<br />Your thoughts, always close.</p></div><p className="version-label">Margin Notes · 0.1.0<br />Made to leave you a little space.</p></div>
    {confirmReset && <div className="reset-confirmation-backdrop"><div className="confirm-sheet" role="alertdialog" aria-label="Reset notebook confirmation"><h3>Start with a blank notebook?</h3><p>This clears {confirmReset.count} note{confirmReset.count === 1 ? '' : 's'}, including Trash, and restores the default folders. Your theme and preferences stay. A local backup is saved first.</p><button className="primary" aria-label="Confirm reset notebook" disabled={busy} onClick={reset}>{busy ? 'Resetting…' : 'Reset notebook'}</button><button disabled={busy} onClick={() => setConfirmReset(null)}>Cancel</button></div></div>}
  </section>;
}

function FolderDialog({ initial, parentId: initialParent = null, folders, close, act, select }) {
  const [name, setName] = useState(initial?.name || '');
  const [color, setColor] = useState('sage');
  const [parentId, setParentId] = useState(initial ? initial.parentId ?? null : initialParent);
  const [error, setError] = useState('');
  // Never inside itself or a descendant, and never deeper than three levels.
  const places = folderTree(folders).filter(({ folder }) => canPlace(folders, initial?.id ?? null, folder.id));
  const submit = async e => {
    e.preventDefault();
    const result = await (initial ? api.updateFolder(initial.id, name, parentId) : api.createFolder(name, color, parentId));
    if (!result.ok) { setError(result.error); return; }
    select(result.value.id); close();
  };
  const parent = folders.find(f => f.id === parentId);
  return <div className="modal-backdrop"><form className="folder-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-label={initial ? 'Rename folder' : 'New folder'}><IconButton label="Close" onClick={close} type="button"><X size={17} /></IconButton><FolderPlus size={25} /><h2>{initial ? 'A fresh name' : 'A place for something'}</h2><p>{initial ? 'Rename this folder or move it.' : parent ? `A new corner inside ${parent.name}.` : 'Give a project or a collection its own corner.'}</p><input autoFocus aria-label="Folder name" placeholder="Folder name" value={name} maxLength={200} onChange={e => setName(e.target.value)} required />
    <label className="folder-parent"><span>Inside</span><select aria-label="Folder location" value={parentId ?? ''} onChange={e => setParentId(e.target.value || null)}><option value="">Top level</option>{places.map(({ folder }) => <option key={folder.id} value={folder.id}>{folderLabel(folders, folder.id)}</option>)}</select></label>
    {!initial && <div className="folder-colors">{colors.map(c => <button type="button" key={c} aria-label={`${c} folder color`} className={`swatch color-${c} ${c === color ? 'selected' : ''}`} onClick={() => setColor(c)}>{c === color && <Check size={13} />}</button>)}</div>}{error && <p className="error">{error}</p>}<button className="primary" type="submit">{initial ? 'Save folder' : 'Create folder'}<ArrowRight size={15} /></button></form></div>;
}

function App() {
  const [state, setState] = useState(null);
  const [linkApps, setLinkApps] = useState({ cxtasks: false, onyx: false });
  const [reducedTransparency, setReducedTransparency] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [searchScope, setSearchScope] = useState('all');
  const [historyNote, setHistoryNote] = useState(null);
  const [pendingOpen, setPendingOpen] = useState(null);
  const [overlay, setOverlay] = useState(null);
  const refreshLinkApps = React.useCallback(() => api.linkApps().then(result => { if (result.ok) setLinkApps(result.value); }).catch(() => setLinkApps({ cxtasks: false, onyx: false })), []);
  useEffect(() => {
    refreshLinkApps();
    window.addEventListener('focus', refreshLinkApps);
    return () => window.removeEventListener('focus', refreshLinkApps);
  }, [refreshLinkApps]);
  useEffect(() => { if (overlay === 'settings') refreshLinkApps(); }, [overlay, refreshLinkApps]);
  const [editor, setEditor] = useState(null);
  const [editorId, setEditorId] = useState(null);
  const editingSession = useRef(null);
  const editorKey = useRef(null);
  const [folderDialog, setFolderDialog] = useState(null);
  const [iconTarget, setIconTarget] = useState(null);
  const [folderMenu, setFolderMenu] = useState(false);
  const [folderMemory, setFolderMemory] = useState({});
  const [editingDivider, setEditingDivider] = useState(null);
  const [paneMenu, setPaneMenu] = useState(null);
  const [toast, setToast] = useState('');
  const [fatal, setFatal] = useState('');
  const [draftExists, setDraftExists] = useState(false);
  const draftKey = !state || state.notebookId === 'main' ? draftPrefix : `${draftPrefix}:${state.notebookId}`;
  const searchRef = useRef(null);
  const reorder = useReorder(
    (kind, id, targetId, placement) => act(kind === 'note' ? api.reorderNote(id, targetId, placement) : api.reorderTab(id, targetId, placement)),
    (id, folderId) => act(api.update(id, { folderId }), 'Note moved'),
    { folders: state?.folders || [], moveFolder: (id, parentId, targetId, placement) => act(api.moveFolder(id, parentId, targetId, placement), 'Folder moved') }
  );
  const showToast = text => { setToast(text); };
  async function act(promise, success) {
    try { const result = await promise; if (!result.ok) { showToast(result.error); return undefined; } if (success && result.value !== null) showToast(success); return result.value ?? true; }
    catch (e) { showToast(e.message); return undefined; }
  }
  const changeDemo = enabled => act(api.demo(enabled), enabled ? 'Demo mode started' : 'Demo mode ended');
  const resetNotebook = expectedRevision => act(api.resetNotebook(expectedRevision), 'Notebook reset');
  // Each parent folder remembers the sub-tab chosen last, per notebook and across restarts.
  const memoryKey = state ? `margin-folder-memory:${state.notebookId}` : null;
  const selectionPath = state ? folderPath(state.folders, filter).map(folder => folder.id).join('/') : '';
  useEffect(() => {
    if (!memoryKey) return;
    try { const saved = JSON.parse(localStorage.getItem(memoryKey) || '{}'); setFolderMemory(saved && typeof saved === 'object' ? saved : {}); }
    catch { setFolderMemory({}); }
  }, [memoryKey]);
  useEffect(() => {
    if (!state) return;
    setFolderMemory(previous => {
      const next = rememberSelection(previous, state.folders, filter);
      if (next !== previous) try { localStorage.setItem(memoryKey, JSON.stringify(next)); } catch { /* Memory is a convenience. */ }
      return next;
    });
  }, [filter, memoryKey, selectionPath]);
  const selectFolder = id => { setFilter(resolveSelection(folderMemory, state.folders, id)); setFolderMenu(false); };
  useEffect(() => {
    if (!state) return;
    setFilter('all'); setQuery(''); setOverlay(null); setEditor(null); setEditorId(null); setFolderDialog(null); setFolderMenu(false); setIconTarget(null);
    setDraftExists(Boolean(localStorage.getItem(draftKey)));
  }, [state?.notebookId]);
  const openEditor = async (note, focus) => {
    if (editor && note && (note.id === editor.initial.id || note.id === editorId)) return;
    if (editingSession.current && !await editingSession.current.save()) return;
    const saved = localStorage.getItem(draftKey);
    let draft;
    try { draft = saved ? { ...JSON.parse(saved), __recovered: true } : note || freshDraft(filter); }
    catch { localStorage.removeItem(draftKey); draft = note || freshDraft(filter); }
    if (saved && note && draft.id !== note.id) showToast('Finish your unfinished thought before editing another note.');
    if (saved || !note) { setQuery(''); if (saved || ['pinned', 'trash'].includes(filter)) setFilter('all'); }
    const key = crypto.randomUUID(); editorKey.current = key;
    setEditor({ initial: draft, key, focus: focus || { target: draft.id ? 'body' : 'title' } });
    setEditorId(draft.id || null); setDraftExists(false);
  };
  const finishEditor = key => { if (editorKey.current !== key) return; editorKey.current = null; setEditor(null); setEditorId(null); setDraftExists(Boolean(localStorage.getItem(draftKey))); };

  const chooseNoteIcon = note => setIconTarget({ ...note, kind: 'note', name: note.name || noteLabel(note), fallback: note.fallback || kindIcons[note.kind], save: note.save || ((patch, revision) => api.update(note.id, { ...patch, expectedRevision: revision })) });
  const chooseSectionIcon = (id, name, fallback) => {
    const appearance = state.folders.find(folder => folder.id === id) || state.sectionAppearances[id] || {};
    setFolderMenu(false); setIconTarget({ ...appearance, kind: 'section', id, name, fallback, save: patch => api.sectionAppearance(id, patch) });
  };
  const addNote = () => { if (!folderDialog && !iconTarget) { setOverlay(null); openEditor(); } };
  const close = () => { setHistoryNote(null); setIconTarget(null); setOverlay(null); setDraftExists(Boolean(localStorage.getItem(draftKey))); };
  useEffect(() => {
    if (!api) { setFatal('Open Margin with npm start to use your local notebook.'); return; }
    api.snapshot().then(result => result.ok ? setState(result.value) : setFatal(result.error)).catch(e => setFatal(e.message));
    const unsubscribe = api.onChange(setState);
    api.appearancePreferences().then(p => setReducedTransparency(p.reducedTransparency));
    const unsubscribePrefs = api.onAppearancePreferences(p => setReducedTransparency(p.reducedTransparency));
    return () => { unsubscribe(); unsubscribePrefs(); };
  }, []);
  useEffect(() => { if (!api) return; return api.onOpenNote(async id => { const result = await api.snapshot(); if (result.ok) { setState(result.value); setPendingOpen(id); } }); }, []);
  useEffect(() => {
    if (!pendingOpen || !state) return;
    let active = true;
    const reveal = async () => {
      if (editingSession.current && !await editingSession.current.save()) { showToast('Finish your current edit before opening this note.'); setPendingOpen(null); return; }
      if (!active) return;
      const note = state.notes.find(note => note.id === pendingOpen);
      if (!note) { showToast('This note is unavailable.'); setPendingOpen(null); return; }
      setEditor(null); setEditorId(null); setOverlay(null); setHistoryNote(null); setQuery(''); setFilter(note.deletedAt ? 'trash' : 'all');
      requestAnimationFrame(() => requestAnimationFrame(() => { const card = document.querySelector(`[data-note-id="${pendingOpen}"]`); card?.scrollIntoView({ block: 'center' }); card?.focus(); }));
      setPendingOpen(null);
    };
    void reveal(); return () => { active = false; };
  }, [pendingOpen, state?.notebookId]);
  useEffect(() => { if (!api) return; return api.onNew(addNote); }, [filter, overlay, folderDialog, iconTarget, editor, editorId]);
  useEffect(() => {
    if (!api || editor) return;
    return api.onEditCommand(action => api.nativeEdit(action));
  }, [editor]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!state) return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const listener = () => applyAppearance(state, media.matches, reducedTransparency);
    listener();
    media.addEventListener('change', listener); return () => media.removeEventListener('change', listener);
  }, [state?.settings.theme, state?.settings.themeId, state?.settings.glassTransparency, state?.themes, state?.vaultTheme, reducedTransparency]);
  useEffect(() => {
    const listener = e => {
      if (iconTarget || e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); if (!overlay) searchRef.current?.focus(); }
      if (e.key === 'Escape' && !e.defaultPrevented && overlay) { if (overlay === 'connections') setOverlay('settings'); else close(); }
      else if (e.key === 'Escape' && !e.defaultPrevented && !overlay && !folderDialog && !editor) api?.hide();
      if (e.key === 'Tab' && (overlay || folderDialog)) {
        const container = document.querySelector('[role=alertdialog]') || document.querySelector('.folder-dialog') || document.querySelector('.overlay');
        const nodes = [...container.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea,select,summary,a[href],[contenteditable=true]')].filter(el => el.getClientRects().length);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', listener); return () => document.removeEventListener('keydown', listener);
  });
  if (fatal) return <div className="fatal"><h1>Your notebook is safe.</h1><p>{fatal}</p></div>;
  if (!state) return <div className="loading"><div className="brand">Margin<span>✳</span></div><p>Opening your notebook…</p></div>;
  const appearance = resolveAppearance(state, matchMedia('(prefers-color-scheme: dark)').matches, reducedTransparency);
  const folderTint = folder => {
    const tint = appearance.folderColours?.find(f => f.name.toLocaleLowerCase() === folder?.name.toLocaleLowerCase());
    return tint ? { '--vault-folder-color': tint.color } : undefined;
  };
  const activeFolder = state.folders.find(f => f.id === filter);
  const inFolder = activeFolder ? descendantIds(state.folders, activeFolder.id) : null;
  const notes = orderNotes(state.notes, state.noteOrder).filter(n => n.id === editor?.initial.id || (Boolean(n.deletedAt) === (filter === 'trash') && ((query.trim() && searchScope === 'all') || ((!inFolder || inFolder.has(n.folderId)) && (filter !== 'pinned' || n.pinned))) && matchesNote(n, query)));
  // Keep one stable editor at the original card position as autosave assigns an
  // ID or Save draft as new changes it. Typing never remounts the editor.
  const cards = notes.filter(n => n.id !== editorId || n.id === editor?.initial.id).map(n => n.id === editor?.initial.id ? { ...n, editing: true } : n);
  if (editor && !cards.some(n => n.editing)) cards.unshift({ id: editor.initial.id, editing: true });

  // Sections belong to the view they were added in, and step aside for search, Pinned and Trash.
  const showDividers = !query.trim() && !['pinned', 'trash'].includes(filter);
  const listItems = withDividers(cards, showDividers ? state.dividers.filter(divider => divider.view === filter) : [], state.noteOrder);
  const noteIds = listItems.filter(item => item.id && !item.editing).map(item => item.id);
  const selectedPath = folderPath(state.folders, filter);
  const topId = selectedPath[0]?.id ?? filter;
  const tabs = orderTabs(childrenOf(state.folders, null), state.tabOrder);
  // One row of sub-tabs per selected level that has folders inside it.
  const subRows = selectedPath.map((parent, index) => ({ parent, selected: selectedPath[index + 1]?.id ?? parent.id, children: orderTabs(childrenOf(state.folders, parent.id), state.tabOrder).filter(tab => tab.id !== 'all') })).filter(row => row.children.length);
  const addSection = async ({ targetId, placement }) => {
    setPaneMenu(null);
    const divider = await act(api.createDivider(filter, '', targetId, placement));
    if (divider) setEditingDivider(divider.id);
  };
  const paneContextMenu = event => {
    if (!showDividers || event.target.closest('.note-card, .note-divider, .editor, input, textarea, [contenteditable=true]')) return;
    event.preventDefault();
    const rows = [...event.currentTarget.querySelectorAll(':scope > [data-note-id], :scope > [data-divider-id]')].filter(el => noteIds.includes(el.dataset.noteId || el.dataset.dividerId));
    const below = rows.find(el => { const box = el.getBoundingClientRect(); return event.clientY < box.top + box.height / 2; });
    const anchor = below || rows.at(-1);
    setPaneMenu({ x: event.clientX, y: event.clientY, items: [{ label: 'Add section here', icon: Minus, run: () => addSection({ targetId: anchor ? anchor.dataset.noteId || anchor.dataset.dividerId : null, placement: below ? 'before' : 'after' }) }] });
  };
  const dividerMenu = (event, divider) => setPaneMenu({ x: event.clientX, y: event.clientY, items: [
    { label: divider.label ? 'Rename section' : 'Name section', icon: FileText, run: () => { setPaneMenu(null); setEditingDivider(divider.id); } },
    { label: 'Remove section', icon: Trash2, danger: true, run: () => { setPaneMenu(null); act(api.deleteDivider(divider.id), 'Section removed'); } }
  ] });
  const heading = query ? 'Search results' : activeFolder?.name || ({ all: 'All notes', pinned: 'Pinned notes', trash: 'Trash' })[filter];
  const headingHue = query ? 'blue' : activeFolder ? (activeFolder.id === 'inbox' ? 'blue' : folderHue(activeFolder.color)) : ({ all: 'teal', pinned: 'amber', trash: 'red' })[filter];
  const sectionAppearance = activeFolder || state.sectionAppearances[filter] || {};
  const HeadingIcon = query ? Search : activeFolder ? (activeFolder.id === 'inbox' ? Inbox : Folder) : ({ all: FileText, pinned: Pin, trash: Trash2 })[filter] || FileText;
  return <TaskLinksContext.Provider value={Boolean(state.settings.cxtasksLinks && linkApps.cxtasks)}><DocumentChipsContext.Provider value={Boolean(linkApps.onyx)}><main className="app-shell">
    <div className="panel-chrome">
    <header className="main-header"><div className="brand">Margin{state.demo && <span className="demo-badge">Demo</span>}</div><div className="panel-header-actions"><IconButton label="Focus search" onClick={() => searchRef.current?.focus()}><Search size={19} strokeWidth={1.7} /></IconButton><IconButton label="New note" onClick={addNote}><Plus size={22} strokeWidth={1.7} /></IconButton><IconButton label="Hide Margin" onClick={() => api.hide()}>{state.settings.edge === 'right' ? <ChevronRight size={18} /> : <ArrowLeft size={18} />}</IconButton></div></header>
    <div className="search-box"><Search size={16} strokeWidth={1.8} /><input ref={searchRef} aria-label="Search notes" placeholder="Find a thought…" value={query} onChange={e => { if (!query.trim() && e.target.value.trim()) setSearchScope('all'); setQuery(e.target.value); }} />{query ? <IconButton label="Clear search" onClick={() => setQuery('')}><X size={13} /></IconButton> : <kbd>⌘ F</kbd>}</div>
    {query.trim() && <div className="search-scope" role="group" aria-label="Search scope"><button aria-pressed={searchScope === 'all'} onClick={() => setSearchScope('all')}>{filter === 'trash' ? 'All Trash' : 'All notes'}</button><button aria-pressed={searchScope === 'section'} disabled={filter === 'all'} onClick={() => setSearchScope('section')}>{activeFolder ? `In ${activeFolder.name}` : 'This section'}</button></div>}
    <nav className="folders" aria-label="Folders">{tabs.map(f => <button key={f.id} data-folder-id={f.id} style={folderTint(f)} className={`folder-tab hue-${f.id === 'all' ? 'teal' : f.id === 'inbox' ? 'blue' : folderHue(f.color)} ${topId === f.id ? 'selected' : ''} ${reorder.className('tab', f.id)}`} draggable title={f.id === 'all' ? 'Drop a subfolder here to make it top-level · Drag to reorder · Option ←/→' : 'Drop in the middle to move inside · Drop at an edge to place beside · Option ←/→'} aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
      onDragStart={e => reorder.start(e, 'tab', f.id)} onDragEnd={reorder.end} onDragOver={e => reorder.over(e, 'tab', f.id, 'x')} onDrop={e => reorder.drop(e, 'tab', f.id, 'x')} onDragLeave={e => reorder.leave(e, 'tab', f.id)} onKeyDown={e => reorder.keyboard(e, 'tab', f.id, tabs.map(tab => tab.id), 'x')}
      onContextMenu={e => { e.preventDefault(); chooseSectionIcon(f.id, f.id === 'all' ? 'All notes' : f.name, f.id === 'all' ? FileText : f.id === 'inbox' ? Inbox : Folder); }}
      onClick={() => selectFolder(f.id)}><NodeIcon icon={(f.id === 'all' ? state.sectionAppearances.all : f)?.icon} iconColor={(f.id === 'all' ? state.sectionAppearances.all : f)?.iconColor} fallback={f.id === 'all' ? FileText : f.id === 'inbox' ? Inbox : Folder} className="folder-glyph" size={14} />{f.name}</button>)}<IconButton label="New folder" onClick={() => setFolderDialog({})}><Plus size={15} /></IconButton></nav>
    {subRows.map(({ parent, selected, children }) => <nav key={parent.id} className="subfolders" aria-label={`Folders in ${parent.name}`} data-parent-id={parent.id}>
      <button className={`subfolder-tab ${selected === parent.id ? 'selected' : ''} ${reorder.className('folder', parent.id)}`} data-subfolder-all={parent.id} aria-label={`All of ${parent.name}`} title={`Drop here to move into ${parent.name}`} onClick={() => { setFilter(parent.id); setFolderMenu(false); }}
        onDragOver={e => reorder.over(e, 'folder', parent.id, 'x')} onDrop={e => reorder.drop(e, 'folder', parent.id, 'x')} onDragLeave={e => reorder.leave(e, 'folder', parent.id)}>All</button>
      {children.map(f => <button key={f.id} data-folder-id={f.id} style={folderTint(f)} className={`subfolder-tab hue-${folderHue(f.color)} ${selected === f.id ? 'selected' : ''} ${reorder.className('tab', f.id)}`} draggable title="Drop in the middle to move inside · Drop at an edge to place beside · Option ←/→" aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
        onDragStart={e => reorder.start(e, 'tab', f.id)} onDragEnd={reorder.end} onDragOver={e => reorder.over(e, 'tab', f.id, 'x')} onDrop={e => reorder.drop(e, 'tab', f.id, 'x')} onDragLeave={e => reorder.leave(e, 'tab', f.id)} onKeyDown={e => reorder.keyboard(e, 'tab', f.id, children.map(tab => tab.id), 'x')}
        onContextMenu={e => { e.preventDefault(); chooseSectionIcon(f.id, f.name, Folder); }}
        onClick={() => selectFolder(f.id)}><NodeIcon icon={f.icon} iconColor={f.iconColor} fallback={Folder} className="folder-glyph" size={12} />{f.name}</button>)}
      {folderDepth(state.folders, parent.id) < MAX_FOLDER_DEPTH && <IconButton label={`New folder in ${parent.name}`} onClick={() => setFolderDialog({ parentId: parent.id })}><Plus size={13} /></IconButton>}
    </nav>)}
    <div className={`section-heading hue-${headingHue}`} style={folderTint(activeFolder)}><div><NodeIcon icon={query ? null : sectionAppearance.icon} iconColor={query ? null : sectionAppearance.iconColor} fallback={HeadingIcon} className="heading-glyph" size={15} /><h2>{heading}</h2><span className="count">{cards.length}</span></div><div className="section-tools"><IconButton label={filter === 'pinned' ? 'Show all notes' : 'Show pinned notes'} className={`icon-button ${filter === 'pinned' ? 'active' : ''}`} onClick={() => setFilter(filter === 'pinned' ? 'all' : 'pinned')}><Pin size={14} /></IconButton><div className="menu-wrap"><IconButton label="Notebook options" onClick={() => setFolderMenu(!folderMenu)}><MoreHorizontal size={17} /></IconButton>{folderMenu && <div className="popup-menu notebook-menu">{!query && <button onClick={() => chooseSectionIcon(filter, heading, HeadingIcon)}><Palette size={14} />Icon &amp; color…</button>}<button onClick={() => { setFilter(filter === 'trash' ? 'all' : 'trash'); setFolderMenu(false); }}><Trash2 size={14} />{filter === 'trash' ? 'All notes' : 'View Trash'}</button>{activeFolder && <><button onClick={() => { act(api.importMarkdown(activeFolder.id), 'Markdown imported'); setFolderMenu(false); }}><FileText size={14} />Import Markdown here…</button><button onClick={() => { act(api.exportMarkdown({ folderId: activeFolder.id }), 'Markdown exported'); setFolderMenu(false); }}><Download size={14} />Export folder as Markdown…</button></>}{activeFolder && folderDepth(state.folders, activeFolder.id) < MAX_FOLDER_DEPTH && <button onClick={() => { setFolderDialog({ parentId: activeFolder.id }); setFolderMenu(false); }}><FolderPlus size={14} />New folder inside…</button>}{activeFolder && activeFolder.id !== 'inbox' && <><button onClick={() => { setFolderDialog({ initial: activeFolder }); setFolderMenu(false); }}><Folder size={14} />Rename or move folder…</button><button onClick={async () => { const parent = state.folders.find(f => f.id === activeFolder.parentId); const result = await act(api.deleteFolder(activeFolder.id), `Notes moved to ${parent?.name || 'Inbox'}`); if (result) setFilter(result.movedTo); setFolderMenu(false); }}><Inbox size={14} />Remove folder · keep notes</button></>}</div>}</div></div></div>
    </div>
    {state.demo && <div className="demo-banner" role="status"><span>Demo notebook</span><button aria-label="Leave demo notebook" onClick={() => changeDemo(false)}>Exit demo<ArrowLeft size={12} /></button></div>}
    <div className="notes-scroll" onContextMenu={paneContextMenu} onScroll={() => setPaneMenu(null)} onDragOver={event => { if (event.dataTransfer.types.includes('Files') && !event.target.closest('.note-card')) event.preventDefault(); }} onDrop={event => {
      if (event.target.closest('.note-card')) return;
      event.preventDefault(); const files = Array.from(event.dataTransfer.files);
      if (files.length) act(api.dropMarkdown(files, activeFolder?.id || 'inbox'), 'Markdown imported');
    }}>
      {draftExists && !editor && <button className="draft-notice" onClick={() => openEditor()}>You have an unfinished thought.<span>Continue <ArrowRight size={12} /></span></button>}
      {filter === 'trash' && <p className="trash-caption">Deleted notes stay here until you restore them.</p>}
      {listItems.length ? listItems.map(note => note.divider ? <SectionDivider key={note.id} divider={note} act={act} api={api} reorder={reorder} noteIds={noteIds} editing={editingDivider === note.id} setEditing={setEditingDivider} openMenu={dividerMenu} /> : note.editing ? <Editor key={editor.key} ref={editingSession} initial={editor.initial} focus={editor.focus} folders={state.folders} close={() => finishEditor(editor.key)} act={act} draftKey={draftKey} onIdentityChange={id => setEditorId(id || null)} folderTint={folderTint} chooseIcon={chooseNoteIcon} suspended={Boolean(iconTarget || overlay || folderDialog)} /> : <NoteCard key={note.id} note={note} folder={state.folders.find(f => f.id === note.folderId)} edit={openEditor} act={act} trashView={filter === 'trash'} reorder={reorder} noteIds={noteIds} chooseIcon={chooseNoteIcon} query={query.trim()} showHistory={note => { setHistoryNote(note); setOverlay('history'); }} folderTint={folderTint(state.folders.find(f => f.id === note.folderId))} />) : <div className="empty-state"><span><FileText size={26} strokeWidth={1} /></span><h3>{query ? 'A thought yet to be found.' : filter === 'trash' ? 'A clean little corner.' : filter === 'pinned' ? 'Keep the good things close.' : 'Room for a new thought.'}</h3><p>{query ? 'Try another word or look in all notes.' : filter === 'pinned' ? 'Pin a note from its menu to find it here.' : filter === 'trash' ? 'Notes you remove will appear here.' : 'A blank page is a lovely place to start.'}</p>{!query && !['trash', 'pinned'].includes(filter) && <button onClick={addNote}>Write a note<ArrowRight size={14} /></button>}</div>}
    </div>
    <div className="bottom-area"><button className="new-note" onClick={addNote}><span><Plus size={17} />Jot something down</span><kbd>⌘ N</kbd></button><footer className="panel-tools"><IconButton label="Recent activity" onClick={() => setOverlay('activity')}><MoreHorizontal size={17} /></IconButton><IconButton label="Preferences" onClick={() => setOverlay('settings')}><Settings size={17} strokeWidth={1.6} /></IconButton></footer></div>
    {overlay === 'connections' && <Connections back={() => setOverlay('settings')} act={act} />}
    {overlay === 'settings' && <Preferences state={state} hasCXTasks={linkApps.cxtasks} close={close} act={act} showActivity={() => setOverlay('activity')} showThemes={() => setOverlay('themes')} showConnections={() => setOverlay('connections')} showBackups={() => setOverlay('backups')} changeDemo={changeDemo} resetNotebook={resetNotebook} />}
    {overlay === 'history' && historyNote && <NoteHistory note={historyNote} api={api} act={act} close={close} Markdown={Markdown} />}
    {overlay === 'backups' && <BackupTools api={api} act={act} close={close} demo={Boolean(state.demo)} Markdown={Markdown} />}
    {overlay === 'themes' && <Themes state={state} api={api} act={act} reducedTransparency={reducedTransparency} back={() => setOverlay('settings')} />}
    {overlay === 'activity' && <section className="overlay" role="dialog" aria-modal="true" aria-label="Recent activity"><div className="overlay-top"><IconButton label="Back to notes" onClick={close}><ArrowLeft size={19} /></IconButton><span>Recent activity</span><span /></div><div className="activity-content"><h1>A few little changes.</h1><p className="subtle">Notes added by you and your assistants.</p>{state.activity.length ? state.activity.map(a => <div className="activity-row" key={a.id}><span className="activity-icon">{a.source === 'You' ? <FileText size={16} /> : <Sparkles size={16} />}</span><div><strong>{a.title}</strong><span>{a.source} {a.action}</span><small>{new Date(a.at).toLocaleString()}</small></div></div>) : <div className="empty-state"><p>Your next thought starts the story.</p></div>}</div></section>}
    {folderDialog && <FolderDialog initial={folderDialog.initial} parentId={folderDialog.parentId} folders={state.folders} close={() => setFolderDialog(null)} act={act} select={setFilter} />}
    {paneMenu && <ContextMenu menu={paneMenu} close={() => setPaneMenu(null)} />}
    {iconTarget && <IconPicker key={`${iconTarget.kind}:${iconTarget.id || 'draft'}`} target={iconTarget} close={() => setIconTarget(null)} api={api} />}
    {toast && <div className="toast" role="status"><Check size={14} /><span>{toast}</span><IconButton label="Dismiss message" onClick={() => setToast('')}><X size={13} /></IconButton></div>}
  </main></DocumentChipsContext.Provider></TaskLinksContext.Provider>;
}

createRoot(document.getElementById('root')).render(<App />);
