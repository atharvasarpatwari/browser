/**
 * List item markers (CSS Lists 3 §3, "outside" position): the bullet or number painted left of a
 * display:list-item box's first line. Lists had no markers at all.
 * ponytail: painted only (no ::marker box): `inside` is drawn like `outside`, list-style-image is
 * ignored (the type is used), and nested lists don't switch disc → circle → square.
 */
import type { DomElement, DomNode, LayoutBox } from './dom-tree';
import { boxChildren } from './dom-tree';
import { getTextMeasurer } from './formatting/text-measure';
import type { PaintCommand } from './paint-engine';

const ROMAN: ReadonlyArray<[number, string]> = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}

function alpha(n: number, base: string): string {
  if (n <= 0) return String(n);
  let out = '';
  while (n > 0) { n--; out = base[n % 26]! + out; n = Math.floor(n / 26); }
  return out;
}

/** The marker text for `type` and ordinal `n`; null for `none`. */
export function markerText(type: string, n: number): string | null {
  const t = type.trim().toLowerCase();
  if (t === 'none' || t === '') return null;
  const quoted = /^["'](.*)["']$/.exec(type.trim());
  if (quoted) return quoted[1]!; // list-style-type: "– "
  switch (t) {
    case 'disc': return '•';
    case 'circle': return '◦';
    case 'square': return '▪';
    case 'disclosure-closed': return '▸';
    case 'disclosure-open': return '▾';
    case 'decimal': return `${n}.`;
    case 'decimal-leading-zero': return `${n < 10 && n >= 0 ? '0' : ''}${n}.`;
    case 'lower-alpha': case 'lower-latin': return `${alpha(n, 'abcdefghijklmnopqrstuvwxyz')}.`;
    case 'upper-alpha': case 'upper-latin': return `${alpha(n, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')}.`;
    case 'lower-roman': return `${roman(n)}.`;
    case 'upper-roman': return `${roman(n).toUpperCase()}.`;
    case 'lower-greek': return `${alpha(n, 'αβγδεζηθικλμνξοπρστυφχψω')}.`;
    default: return `${n}.`; // other counter styles: numbered
  }
}

const isListItem = (n: DomNode): n is DomElement =>
  n.nodeType === 'element' && (n as DomElement).computedStyle?.get('display') === 'list-item';

/** The item's ordinal in its list: <ol start>, reversed, <li value>. */
export function listOrdinal(li: DomElement): number {
  const list = li.parent?.nodeType === 'element' ? li.parent as DomElement : null;
  const items = list ? list.children.filter(isListItem) : [li];
  const reversed = !!list && list.tagName.toLowerCase() === 'ol' && list.attributes.has('reversed');
  const startAttr = list?.attributes.get('start');
  let n = startAttr !== undefined && /^-?\d+$/.test(startAttr.trim()) ? parseInt(startAttr, 10) : (reversed ? items.length : 1);
  for (const item of items) {
    const v = item.attributes.get('value');
    if (v !== undefined && /^-?\d+$/.test(v.trim())) n = parseInt(v, 10);
    if (item === li) return n;
    n += reversed ? -1 : 1;
  }
  return n;
}

/** HTML's <ol type="a|A|i|I|1"> as a list-style-type. */
function typeFromAttribute(li: DomElement): string | null {
  const list = li.parent?.nodeType === 'element' ? li.parent as DomElement : null;
  const t = li.attributes.get('type') ?? list?.attributes.get('type');
  switch (t) {
    case 'a': return 'lower-alpha';
    case 'A': return 'upper-alpha';
    case 'i': return 'lower-roman';
    case 'I': return 'upper-roman';
    case '1': return 'decimal';
    default: return null;
  }
}

/** Baseline of the first line of text in `el` (its own runs, else its first descendant's). */
function firstBaseline(el: DomElement): number | null {
  const runs = el.layoutBox?.textRuns;
  if (runs && runs.length > 0) return runs[0]!.y;
  for (const c of boxChildren(el)) {
    if (c.nodeType !== 'element') continue;
    const y = firstBaseline(c as DomElement);
    if (y !== null) return y;
  }
  return null;
}

/** Paint commands for a list item's marker, or none. */
export function listMarkerCommands(li: DomElement, box: LayoutBox, style: ReadonlyMap<string, string>): PaintCommand[] {
  let type = style.get('list-style-type') ?? 'disc';
  if (type === 'decimal' || type === 'disc') type = typeFromAttribute(li) ?? type;
  const text = markerText(type, listOrdinal(li));
  if (!text) return [];
  const fontSize = parseFloat(style.get('font-size') ?? '') || 16;
  const family = style.get('font-family') ?? 'sans-serif';
  const weight = style.get('font-weight') ?? 'normal';
  const width = getTextMeasurer().measure(text, fontSize, family, weight).width;
  const gap = fontSize * 0.5;
  const x = box.x + box.borderLeft + box.paddingLeft - gap - width;
  const y = firstBaseline(li) ?? box.y + box.borderTop + box.paddingTop + fontSize * 0.8;
  return [
    { type: 'setFillStyle', params: [style.get('color') ?? '#000000'] },
    { type: 'setFont', params: [`${weight} ${fontSize}px ${family}`] },
    { type: 'fillText', params: [text, x, y, width] },
  ] as PaintCommand[];
}
