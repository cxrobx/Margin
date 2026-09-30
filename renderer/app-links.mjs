import { parseAppLink } from '../shared/app-links.mjs';

const reference = /(?:["'](?:\/|~\/)[^\n]+?\.(?:md|markdown|html?|txt|pdf)["']|(?:file|obsidian|cxtasks|margin):\/\/[^\s<>]+|(?:\/|~\/)[^\s<>]+\.(?:md|markdown|html?|txt|pdf)|\bT[1-9]\d{0,14}\b)/gi;
function target(value, cxtasksLinks) {
  try { const link = parseAppLink(value); return link.kind === 'web' || link.kind === 'task' && !cxtasksLinks ? null : link.href; } catch { return null; }
}
function link(value, href) { return { type: 'element', tagName: 'a', properties: { href }, children: [{ type: 'text', value }] }; }
function text(value) { return { type: 'text', value }; }
export function referenceNodes(value, { cxtasksLinks = false } = {}) {
  // A path on its own line may contain spaces. Inline paths can be quoted.
  return value.split(/(\n)/).flatMap(line => {
    const entire = target(line, cxtasksLinks);
    if (entire) {
      const start = line.length - line.trimStart().length;
      const end = line.trimEnd().length;
      return [text(line.slice(0, start)), link(line.slice(start, end), entire), text(line.slice(end))];
    }
    const result = []; let start = 0;
    for (const match of line.matchAll(reference)) {
      const index = match.index; let value = match[0];
      if (index && /[\p{L}\p{N}_/.-]/u.test(line[index - 1])) continue;
      if (/[\p{L}\p{N}_/-]/u.test(line[index + value.length] || '')) continue;
      // Sentence punctuation is not part of a copied URI.
      if (/^[a-z]+:\/\//i.test(value)) value = value.replace(/[.,;!?)]+$/, '');
      const href = target(value, cxtasksLinks);
      if (!href) continue;
      if (index > start) result.push(text(line.slice(start, index)));
      result.push(link(value, href)); start = index + value.length;
    }
    if (start < line.length) result.push(text(line.slice(start)));
    return result;
  });
}
// Reading only: pasted references remain ordinary Markdown in storage and code
// samples are never interpreted as task/document links.
export function rehypeAppLinks(options = {}) {
  return tree => {
    const visit = node => {
      if (!node.children || ['a', 'code', 'pre', 'script', 'style'].includes(node.tagName)) return;
      node.children = node.children.flatMap(child => {
        if (child.type === 'text') return referenceNodes(child.value, options);
        visit(child); return [child];
      });
    };
    visit(tree);
  };
}
