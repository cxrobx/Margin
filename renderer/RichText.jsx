import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Bold, Italic, Highlighter, Strikethrough, Underline, Link2, Code2, Braces, Eraser, Copy, ListTodo, List, ListOrdered, Type, Quote, Check, X } from 'lucide-react';
import { richExtensions } from './rich-extensions.mjs';
import { editableLink, parseAppLink } from '../shared/app-links.mjs';
import { TaskLinksContext } from './task-links-context.mjs';
import './rich-text.css';

function Tool({ label, active = false, children, ...props }) {
  return <button type="button" aria-label={label} title={label} aria-pressed={active} className={active ? 'selected' : ''} onMouseDown={e => e.preventDefault()} {...props}>{children}</button>;
}
const RichText = forwardRef(function RichText({ body, visible, onChange, onHistoryChange, copy, placeholder, focus }, ref) {
  const cxtasksLinks = React.useContext(TaskLinksContext);
  const initialBody = useRef(body);
  const initialFocus = useRef(focus);
  const focused = useRef(false);
  const container = useRef(null);
  const extensions = useMemo(() => richExtensions(placeholder), [placeholder]);
  const editorProps = useMemo(() => ({ attributes: { class: 'rich-body markdown', role: 'textbox', 'aria-label': 'Note body', 'aria-multiline': 'true', spellcheck: 'true' } }), []);
  const [scrollTarget, setScrollTarget] = useState(null);
  const options = useMemo(() => ({ strategy: 'fixed', placement: 'top', offset: 8, flip: { padding: 12 }, shift: { padding: 12 }, scrollTarget: scrollTarget || window }), [scrollTarget]);
  const appendTo = useCallback(() => document.querySelector('.app-shell') || document.body, []);
  const changeRef = useRef(onChange); changeRef.current = onChange;
  const visibleRef = useRef(visible); visibleRef.current = visible;
  const shouldShow = useCallback(({ editor: ed, view, state }) => visibleRef.current && ed.isEditable && !state.selection.empty && (view.hasFocus() || Boolean(document.activeElement?.closest('.format-bubble'))), []);
  const [menu, setMenu] = useState(null);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState('');
  const editor = useEditor({
    extensions, content: initialBody.current, contentType: 'markdown', editorProps,
    onUpdate: ({ editor }) => changeRef.current(editor.getMarkdown())
  });
  const flags = useEditorState({ editor, selector: ({ editor: ed }) => ed ? {
    bold: ed.isActive('bold'), italic: ed.isActive('italic'), highlight: ed.isActive('highlight'), strike: ed.isActive('strike'), underline: ed.isActive('underline'),
    link: ed.isActive('link'), code: ed.isActive('code'), codeBlock: ed.isActive('codeBlock'), heading: ed.isActive('heading'), quote: ed.isActive('blockquote'),
    list: ed.isActive('taskList') || ed.isActive('bulletList') || ed.isActive('orderedList'), undo: ed.can().undo(), redo: ed.can().redo()
  } : {} });
  useEffect(() => {
    if (!editor) return;
    const scroller = container.current?.closest('.note-body');
    setScrollTarget(scroller);
    if (initialFocus.current && !focused.current) {
      focused.current = true;
      if (scroller) scroller.scrollTop = initialFocus.current.scrollTop || 0;
      const { x, y } = initialFocus.current;
      const position = x || y ? editor.view.posAtCoords({ left: x, top: y })?.pos : undefined;
      editor.commands.focus(position ?? 'start', { scrollIntoView: false });
    }
    // The menu lives above the cards; follow both the body and notebook scroll.
    const notebook = container.current?.closest('.notes-scroll');
    const reposition = () => editor.commands.setMeta('margin-formatting', 'updatePosition');
    notebook?.addEventListener('scroll', reposition);
    return () => notebook?.removeEventListener('scroll', reposition);
  }, [editor]);
  // The editor owns the body for this session. Echoing autosave props back into
  // setContent can apply a stale React render over newer keystrokes. Reloading
  // a conflicting note starts a fresh session with its own initial content.
  useEffect(() => { onHistoryChange({ undo: Boolean(flags.undo), redo: Boolean(flags.redo) }); }, [flags.undo, flags.redo, onHistoryChange]);
  useEffect(() => { if (!visible) { setMenu(null); editor?.commands.setMeta('margin-formatting', 'hide'); } }, [visible, editor]);
  useEffect(() => { editor?.commands.setMeta('margin-formatting', 'updatePosition'); }, [menu, linkError, editor]);
  useImperativeHandle(ref, () => ({
    undo: () => editor?.commands.undo(), redo: () => editor?.commands.redo(),
    focus: () => editor?.commands.focus('start'),
    caretRect: () => editor?.isFocused && editor.state.selection.empty && !editor.view.composing ? editor.view.coordsAtPos(editor.state.selection.from) : null,
    checklist: () => editor?.chain().focus().toggleTaskList().run(),
    codeBlock: () => editor?.chain().focus().setCodeBlock().run(),
  }), [editor]);
  if (!editor) return null;
  const run = command => { command(editor.chain().focus()).run(); setMenu(null); };
  const toggleMenu = value => { setMenu(old => old === value ? null : value); };
  const openLink = () => { setLink(editor.getAttributes('link').href || ''); setLinkError(''); toggleMenu('link'); };
  const applyLink = e => {
    e.preventDefault();
    if (!link.trim()) { run(chain => chain.extendMarkRange('link').unsetLink()); return; }
    let href;
    try {
      href = editableLink(link);
      if (parseAppLink(href).kind === 'task' && !cxtasksLinks) throw new Error('Enable CXTasks links in Preferences to add a task link.');
    }
    catch (error) { setLinkError(error.message); return; }
    run(chain => chain.extendMarkRange('link').setLink({ href }));
  };
  const actions = [
    ['Bold', Bold, 'bold', chain => chain.toggleBold()], ['Italic', Italic, 'italic', chain => chain.toggleItalic()],
    ['Highlight', Highlighter, 'highlight', chain => chain.toggleHighlight()], ['Strikethrough', Strikethrough, 'strike', chain => chain.toggleStrike()],
    ['Underline', Underline, 'underline', chain => chain.toggleUnderline()]
  ];
  return <div ref={container} className="rich-editor-content" hidden={!visible}>
    <EditorContent editor={editor} />
    {scrollTarget && <BubbleMenu editor={editor} pluginKey="margin-formatting" updateDelay={50} appendTo={appendTo}
      shouldShow={shouldShow}
      options={options}
      className="format-bubble" role="toolbar" aria-label="Text formatting">
      <div className="bubble-tools">
        <Tool label="Copy selected text" onClick={() => copy(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n'))}><Copy size={14} /></Tool>
        <i className="tool-separator" />
        <Tool label="Lists" active={flags.list} onClick={() => toggleMenu('lists')}><ListTodo size={15} /></Tool>
        <Tool label="Text style" active={flags.heading} onClick={() => toggleMenu('style')}><Type size={15} /></Tool>
        <Tool label="Blockquote" active={flags.quote} onClick={() => run(chain => chain.toggleBlockquote())}><Quote size={15} /></Tool>
        <i className="tool-separator" />
        {actions.map(([label, Icon, flag, command]) => <Tool key={label} label={label} active={flags[flag]} onClick={() => run(command)}><Icon size={14} /></Tool>)}
        <Tool label="Edit link" active={flags.link} onClick={openLink}><Link2 size={15} /></Tool>
        <i className="tool-separator" />
        <Tool label="Inline code" active={flags.code} onClick={() => run(chain => chain.toggleCode())}><Code2 size={15} /></Tool>
        <Tool label="Code block" active={flags.codeBlock} onClick={() => run(chain => chain.toggleCodeBlock())}><Braces size={14} /></Tool>
        <Tool label="Clear formatting" onClick={() => run(chain => chain.unsetAllMarks().clearNodes())}><Eraser size={15} /></Tool>
      </div>
      {menu === 'lists' && <div className="bubble-submenu" role="group" aria-label="List styles">
        <Tool label="Bullet list" active={editor.isActive('bulletList')} onClick={() => run(chain => chain.toggleBulletList())}><List size={15} />Bullet list</Tool>
        <Tool label="Numbered list" active={editor.isActive('orderedList')} onClick={() => run(chain => chain.toggleOrderedList())}><ListOrdered size={15} />Numbered list</Tool>
        <Tool label="Checklist" active={editor.isActive('taskList')} onClick={() => run(chain => chain.toggleTaskList())}><ListTodo size={15} />Checklist</Tool>
      </div>}
      {menu === 'style' && <div className="bubble-submenu text-styles" role="group" aria-label="Text styles">
        <Tool label="Paragraph" active={editor.isActive('paragraph')} onClick={() => run(chain => chain.setParagraph())}>Text</Tool>
        {[1,2,3,4,5,6].map(level => <Tool key={level} label={`Heading ${level}`} active={editor.isActive('heading', {level})} onClick={() => run(chain => chain.toggleHeading({level}))}>H{level}</Tool>)}
      </div>}
      {menu === 'link' && <form className="bubble-link" onSubmit={applyLink}>
        <input autoFocus aria-label="Link URL" placeholder={cxtasksLinks ? "URL, document path, or T42" : "URL or document path"} value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null); editor.commands.focus(); } }} />
        <button type="submit" aria-label="Apply link" title="Apply link"><Check size={15} /></button>
        {flags.link && <Tool label="Remove link" onClick={() => run(chain => chain.extendMarkRange('link').unsetLink())}><X size={15} /></Tool>}
        {linkError && <small role="alert">{linkError}</small>}
      </form>}
    </BubbleMenu>}
  </div>;
});
export default RichText;
