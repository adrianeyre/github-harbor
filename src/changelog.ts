/** A run of text within a line: plain, bold, or a link. */
export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

export type Block =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly content: readonly Inline[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly Inline[])[] }
  | { readonly kind: 'paragraph'; readonly content: readonly Inline[] };

const HEADING = /^(#{1,3})\s+(.*)$/;
const LIST_ITEM = /^[*-]\s+(.*)$/;
const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/**
 * Reads the Markdown semantic-release writes to CHANGELOG.md: a heading per
 * version and per kind of change, lists of changes with their scope in bold
 * and links to issues and commits, and paragraphs such as breaking-change notes.
 */
export function parseChangelog(markdown: string): readonly Block[] {
  const blocks: Block[] = [];
  let items: (readonly Inline[])[] | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const item = LIST_ITEM.exec(line);
    if (item) {
      if (items === undefined) {
        items = [];
        blocks.push({ kind: 'list', items });
      }
      items.push(parseInline(item[1] ?? ''));
      continue;
    }
    items = undefined;
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length as 1 | 2 | 3, content: parseInline(heading[2] ?? '') });
    } else if (line.trim() !== '') {
      blocks.push({ kind: 'paragraph', content: parseInline(line.trim()) });
    }
  }
  return blocks;
}

function parseInline(line: string): readonly Inline[] {
  const content: Inline[] = [];
  let at = 0;
  for (const match of line.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > at) content.push({ kind: 'text', text: line.slice(at, index) });
    const [whole, strong, text, href] = match;
    if (strong !== undefined) content.push({ kind: 'strong', text: strong });
    // Only a web address becomes a link; anything else stays as written.
    else if (text !== undefined && href !== undefined && /^https?:\/\//.test(href)) content.push({ kind: 'link', text, href });
    else content.push({ kind: 'text', text: whole });
    at = index + whole.length;
  }
  if (at < line.length) content.push({ kind: 'text', text: line.slice(at) });
  return content;
}

function renderInline(parent: HTMLElement, content: readonly Inline[]): void {
  for (const part of content) {
    if (part.kind === 'text') parent.append(part.text);
    else if (part.kind === 'strong') parent.append(Object.assign(document.createElement('strong'), { textContent: part.text }));
    else parent.append(Object.assign(document.createElement('a'), { textContent: part.text, href: part.href }));
  }
}

/**
 * The changelog as DOM, built with text nodes only so nothing in the file can inject markup.
 * Under the dialog's own <h2>, each version is an <h3> and each kind of change an <h4>.
 */
export function renderChangelog(markdown: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'changelog';
  const blocks = parseChangelog(markdown);
  if (blocks.length === 0) {
    root.append(Object.assign(document.createElement('p'), {
      textContent: 'No version has been released yet. Each release will be listed here, with what changed in it.',
    }));
    return root;
  }
  root.append(Object.assign(document.createElement('p'), {
    className: 'policy-updated',
    textContent: 'What changed in each version, newest first. Each change links to its commit on GitHub.',
  }));
  for (const block of blocks) {
    if (block.kind === 'heading') {
      const el = document.createElement(block.level === 3 ? 'h4' : 'h3');
      renderInline(el, block.content);
      root.append(el);
    } else if (block.kind === 'list') {
      const ul = document.createElement('ul');
      for (const item of block.items) {
        const li = document.createElement('li');
        renderInline(li, item);
        ul.append(li);
      }
      root.append(ul);
    } else {
      const p = document.createElement('p');
      renderInline(p, block.content);
      root.append(p);
    }
  }
  return root;
}
