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

// These two inline HTML tags travel with Markdown through MCP and render safely
// in the reading view. No private editor JSON is needed to preserve formatting.
const MarkdownUnderline = Underline.extend({
  renderMarkdown: (node, helpers) => `<u>${helpers.renderChildren(node)}</u>`
});
const MarkdownHighlight = Highlight.extend({
  renderMarkdown: (node, helpers) => `<mark>${helpers.renderChildren(node)}</mark>`
});
// Preserve image Markdown without fetching remote images while editing.
const LocalImagePlaceholder = Image.extend({
  renderHTML: ({ node }) => ['span', { class: 'remote-image', 'data-remote-src': node.attrs.src }, `${node.attrs.alt || 'Image'} · Attach images locally to preview them`]
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
export function richExtensions(placeholder) {
  return [
    StarterKit.configure({
      underline: false, trailingNode: false,
      link: { openOnClick: false, autolink: true, markdownLinks: true, defaultProtocol: 'https', protocols: ['http', 'https', 'mailto', 'margin', 'file', 'obsidian', 'cxtasks'], isAllowedUri: value => Boolean(safeAppHref(value)) },
      undoRedo: { depth: 200, newGroupDelay: 500 }
    }),
    MarkdownPaste, MarkdownUnderline, MarkdownHighlight, TaskList, LiveTaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }),
    TableKit.configure({ table: { resizable: false } }), LocalImagePlaceholder,
    Placeholder.configure({ placeholder }), Markdown.configure({ markedOptions: { gfm: true } })
  ];
}
