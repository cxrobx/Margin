import { Extension, InputRule } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { safeAppHref } from '../shared/app-links.mjs';
import { formattingActions } from './rich-shortcuts.mjs';
import { attachmentUrl, imageAttachmentId } from '../shared/attachments.mjs';

const FormattingShortcuts = Extension.create({
  name: 'marginFormattingShortcuts',
  priority: 1000,
  addOptions() { return { editLink: () => false }; },
  addKeyboardShortcuts() {
    const shortcuts = {
      ...Object.fromEntries(Object.values(formattingActions).filter(action => action.command).map(({ shortcut, command }) => [shortcut, () => command(this.editor.chain()).run()])),
      [formattingActions.link.shortcut]: () => this.options.editLink()
    };
    // Handle capital letter events too, including Shift combinations and Caps Lock.
    return Object.fromEntries(Object.entries(shortcuts).flatMap(([key, command]) => [[key, command], [key.replace(/[a-z]$/, letter => letter.toUpperCase()), command]]));
  }
});

// These two inline HTML tags travel with Markdown through MCP and render safely
// in the reading view. No private editor JSON is needed to preserve formatting.
const MarkdownUnderline = Underline.extend({
  renderMarkdown: (node, helpers) => `<u>${helpers.renderChildren(node)}</u>`
});
const MarkdownHighlight = Highlight.extend({
  renderMarkdown: (node, helpers) => `<mark>${helpers.renderChildren(node)}</mark>`
});
// Preserve image Markdown without fetching remote images while editing.
const LocalImage = Image.extend({
  renderHTML: ({ node }) => imageAttachmentId(node.attrs.src)
    ? ['img', { src: node.attrs.src, alt: node.attrs.alt || '', title: node.attrs.title, class: 'note-inline-image' }]
    : ['span', { class: 'remote-image', 'data-remote-src': node.attrs.src }, `${node.attrs.alt || 'Image'} · Attach images locally to preview them`]
});
const ImagePaste = Extension.create({
  name: 'marginImagePaste',
  priority: 1100,
  addOptions() { return { pasteImage: null }; },
  addProseMirrorPlugins() {
    const editor = this.editor, pasteImage = this.options.pasteImage;
    const bookmarks = new Map();
    return [new Plugin({
      state: { init: () => null, apply: transaction => {
        for (const [key, bookmark] of bookmarks) bookmarks.set(key, bookmark.map(transaction.mapping));
        return null;
      } },
      props: { handlePaste(view, event) {
        if (!pasteImage) return false;
        const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        for (const file of files) {
          const key = Symbol(); bookmarks.set(key, view.state.selection.getBookmark());
          Promise.resolve(pasteImage(file, attachment => {
            if (editor.isDestroyed) return;
            const selection = bookmarks.get(key).resolve(editor.state.doc);
            bookmarks.delete(key);
            editor.commands.insertContentAt({ from: selection.from, to: selection.to }, [
              { type: 'image', attrs: { src: attachmentUrl(attachment.id), alt: attachment.name } },
              { type: 'paragraph' }
            ]);
          })).finally(() => bookmarks.delete(key)).catch(() => {});
        }
        return true;
      } }
    })];
  }
});
// The bullet shortcut fires as soon as "- " is typed. Completing "[ ] "
// converts that item into a task instead of nesting a checklist inside a bullet.
const LiveTaskItem = TaskItem.extend({
  addInputRules() {
    return [new InputRule({
      find: /^\s*(?:[-*+]\s)?\[([ xX])?\]\s$/,
      handler: ({ range, match, chain }) => {
        const commands = chain().deleteRange(range);
        if (this.editor.isActive('bulletList') || this.editor.isActive('orderedList')) commands.liftListItem('listItem');
        if (!this.editor.isActive('taskList')) commands.toggleTaskList();
        commands.updateAttributes('taskItem', { checked: match[1]?.toLowerCase() === 'x' }).run();
      }
    })];
  }
});
// Plain Markdown pasted from an assistant or text file should render in the
// same editing surface. Rich HTML pastes keep the editor's normal handling.
const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({ props: { handlePaste(view, event) {
      const text = event.clipboardData?.getData('text/plain');
      if (!text || event.clipboardData.getData('text/html') || editor.isActive('codeBlock') || editor.isActive('code')) return false;
      if (!/(?:^|\n)\s*(?:#{1,6} |[-*+] |\d+\. |>|```|~~~|\|)|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\[[^\]]+\]\([^)]+\)/.test(text)) return false;
      return editor.commands.insertContent(text, { contentType: 'markdown' });
    } } })];
  }
});
export function richExtensions(placeholder, editLink, pasteImage) {
  return [
    StarterKit.configure({
      underline: false, trailingNode: false,
      link: { openOnClick: false, autolink: true, markdownLinks: true, defaultProtocol: 'https', protocols: ['http', 'https', 'mailto', 'margin', 'file', 'obsidian', 'cxtasks'], isAllowedUri: value => Boolean(safeAppHref(value)) },
      undoRedo: { depth: 200, newGroupDelay: 500 }
    }),
    FormattingShortcuts.configure({ editLink }), ImagePaste.configure({ pasteImage }), MarkdownPaste, MarkdownUnderline, MarkdownHighlight, TaskList, LiveTaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }),
    TableKit.configure({ table: { resizable: false } }), LocalImage,
    Placeholder.configure({ placeholder }), Markdown.configure({ markedOptions: { gfm: true } })
  ];
}
