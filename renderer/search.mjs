export function searchParts(text, query) {
  if (!query.trim()) return [{ text, match: false }];
  const parts = []; const lower = text.toLowerCase(); const needle = query.trim().toLowerCase();
  let start = 0, index;
  while ((index = lower.indexOf(needle, start)) !== -1) {
    if (index > start) parts.push({ text: text.slice(start, index), match: false });
    parts.push({ text: text.slice(index, index + needle.length), match: true }); start = index + needle.length;
  }
  if (start < text.length) parts.push({ text: text.slice(start), match: false });
  return parts;
}
// Operate on sanitized text nodes; matches never become raw HTML or URL attributes.
export function rehypeSearch(options) {
  return tree => {
    const visit = node => {
      if (!node.children) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== 'text') { visit(child); return [child]; }
        return searchParts(child.value, options.query).map(part => part.match
          ? { type: 'element', tagName: 'mark', properties: { className: ['search-match'] }, children: [{ type: 'text', value: part.text }] }
          : { type: 'text', value: part.text });
      });
    };
    visit(tree);
  };
}
export function matchesNote(note, query) {
  return `${note.title}\n${note.body}\n${note.attachments.map(attachment => attachment.name).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase());
}
