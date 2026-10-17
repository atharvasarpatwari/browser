function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mark(text: string): HTMLElement {
  const b = document.createElement('b');
  b.className = 'nova-dropdown-match';
  b.textContent = text;
  return b;
}

/** Appends `text` to `parent` as text nodes, wrapping case-insensitive matches of `words` in <b>. Never parses HTML. */
function appendHighlighted(parent: HTMLElement, text: string, words: readonly string[]): void {
  const usable = words.filter((w) => w.length >= 2);
  if (usable.length === 0) { parent.textContent = text; return; }
  const re = new RegExp(`(${[...usable].sort((a, b) => b.length - a.length).map(escapeRegex).join('|')})`, 'gi');
  text.split(re).forEach((part, i) => {
    if (i % 2 === 1) parent.appendChild(mark(part));
    else if (part) parent.appendChild(document.createTextNode(part));
  });
}

/** Wraps the given `[start, end)` ranges of `text` in <b>. Overlapping or out-of-range ranges are skipped. */
function appendRanges(parent: HTMLElement, text: string, ranges: ReadonlyArray<readonly [number, number]>): void {
  let pos = 0;
  for (const [s, e] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (s < pos || e > text.length || e <= s) continue;
    if (s > pos) parent.appendChild(document.createTextNode(text.slice(pos, s)));
    parent.appendChild(mark(text.slice(s, e)));
    pos = e;
  }
  if (pos < text.length) parent.appendChild(document.createTextNode(text.slice(pos)));
}

export { appendHighlighted, appendRanges };
