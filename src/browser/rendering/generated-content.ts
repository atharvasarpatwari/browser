/**
 * CSS generated content: the ::before / ::after boxes (CSS 2.2 §12.1).
 *
 * A box is made when a rule gives the pseudo-element a `content` other than none/normal. It hangs
 * off its host as `pseudoBefore` / `pseudoAfter`, outside `children`, so scripts, textContent and
 * selectors never see it, while layout and paint walk it through `boxChildren()`.
 * ponytail: strings, attr(), quotes; counter()/counters() and url() images give nothing yet.
 */
import type { DomElement, DomTextNode } from './dom-tree';

/** The text a `content` value generates, or null when it generates no box. */
export function contentText(content: string, host: DomElement): string | null {
  const v = content.trim();
  if (!v || v === 'none' || v === 'normal') return null;
  let out = '';
  let i = 0;
  while (i < v.length) {
    const ch = v[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n') { i++; continue; }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < v.length && v[j] !== ch) {
        if (v[j] === '\\') {
          const hex = /^[0-9a-fA-F]{1,6}/.exec(v.slice(j + 1))?.[0];
          if (hex) {
            out += String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd);
            j += 1 + hex.length;
            if (v[j] === ' ') j++; // one space ends a hex escape
          } else if (v[j + 1] === '\n') {
            j += 2; // escaped newline: a line continuation
          } else {
            out += v[j + 1] ?? '';
            j += 2;
          }
          continue;
        }
        out += v[j];
        j++;
      }
      i = j + 1;
      continue;
    }
    const fn = /^([a-z-]+)\(([^)]*)\)/i.exec(v.slice(i));
    if (fn) {
      if (fn[1]!.toLowerCase() === 'attr') out += host.attributes.get(fn[2]!.trim().split(/\s+/)[0]!.toLowerCase()) ?? '';
      i += fn[0].length; // counter(), counters(), url(), …: nothing yet
      continue;
    }
    const word = /^[a-z-]+/i.exec(v.slice(i))?.[0];
    if (!word) { i++; continue; }
    const w = word.toLowerCase();
    if (w === 'open-quote') out += '“';
    else if (w === 'close-quote') out += '”';
    else if (w !== 'no-open-quote' && w !== 'no-close-quote') return null; // an invalid value: no box
    i += word.length;
  }
  return out;
}

/** The generated box for `host`'s `pseudo`, styled by `style`; null when `content` makes none. */
export function makePseudoElement(host: DomElement, pseudo: 'before' | 'after', style: Map<string, string>): DomElement | null {
  const text = contentText(style.get('content') ?? '', host);
  if (text === null) return null;
  if (!style.has('display')) style.set('display', 'inline'); // the initial value
  const id = `${host.domId}::${pseudo}`;
  const el = {
    domId: id, nodeType: 'element', parent: host, children: [], tagName: `::${pseudo}`, attributes: new Map(),
    computedStyle: style, usedStyle: null, layoutBox: null, imageData: null, naturalWidth: 0, naturalHeight: 0,
    loadingState: 'none', willChange: null, _dirtyStyle: false, _dirtyLayout: true, _dirtyPaint: true,
  } as unknown as DomElement;
  if (text) {
    const node = { domId: `${id}#text`, nodeType: 'text', parent: el, children: [], text, _dirtyStyle: false, _dirtyLayout: true, _dirtyPaint: true } as unknown as DomTextNode;
    el.children.push(node);
  }
  return el;
}
