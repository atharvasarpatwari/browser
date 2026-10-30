/**
 * CSS generated content: the ::before / ::after boxes (CSS 2.2 §12.1).
 *
 * A box is made when a rule gives the pseudo-element a `content` other than none/normal. It hangs
 * off its host as `pseudoBefore` / `pseudoAfter`, outside `children`, so scripts, textContent and
 * selectors never see it, while layout and paint walk it through `boxChildren()`.
 * ponytail: strings, attr(), quotes, counter(); counters are one flat set per page (counters()
 * gives the innermost value only) and url() images give nothing yet.
 */
import type { DomElement, DomTextNode } from './dom-tree';
import { markerText } from './list-markers';

/** CSS counters by name, updated in document order by counter-reset / counter-increment. */
export type Counters = Map<string, number>;

/** Applies a style's counter-reset, counter-set and counter-increment (CSS Lists 3 §4). */
export function applyCounterProperties(style: ReadonlyMap<string, string>, counters: Counters): void {
  const each = (prop: string, dflt: number, apply: (name: string, n: number) => void): void => {
    const v = (style.get(prop) ?? 'none').trim();
    if (!v || v === 'none') return;
    const parts = v.split(/\s+/);
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      if (!/^[a-z_-][\w-]*$/i.test(name)) continue;
      const next = parts[i + 1];
      const n = next !== undefined && /^-?\d+$/.test(next) ? (i++, parseInt(next, 10)) : dflt;
      apply(name, n);
    }
  };
  each('counter-reset', 0, (name, n) => counters.set(name, n));
  each('counter-set', 0, (name, n) => counters.set(name, n));
  each('counter-increment', 1, (name, n) => counters.set(name, (counters.get(name) ?? 0) + n));
}

/** The text a `content` value generates, or null when it generates no box. */
export function contentText(content: string, host: DomElement, counters?: Counters): string | null {
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
      const fname = fn[1]!.toLowerCase();
      const args = fn[2]!.split(',').map((a) => a.trim());
      if (fname === 'attr') out += host.attributes.get(args[0]!.split(/\s+/)[0]!.toLowerCase()) ?? '';
      else if ((fname === 'counter' || fname === 'counters') && counters) {
        // counter(name, style) / counters(name, "sep", style): the value in that counter style
        const styleArg = fname === 'counter' ? args[1] : args[2];
        const text = markerText(styleArg || 'decimal', counters.get(args[0]!) ?? 0);
        out += text ? text.replace(/\.$/, '') : '';
      }
      i += fn[0].length; // url(), …: nothing yet
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
export function makePseudoElement(host: DomElement, pseudo: 'before' | 'after', style: Map<string, string>, counters?: Counters): DomElement | null {
  const prev = pseudo === 'before' ? host.pseudoBefore : host.pseudoAfter;
  const content = style.get('content') ?? '';
  // An incremental restyle has no counter state: keep the text the full pass worked out.
  const reuse = !counters && /counters?\(/i.test(content) && prev?.computedStyle?.get('content') === content;
  const text = reuse ? textOf(prev!) : contentText(content, host, counters);
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

function textOf(el: DomElement): string {
  return el.children.map((c) => (c as { text?: string }).text ?? '').join('');
}
