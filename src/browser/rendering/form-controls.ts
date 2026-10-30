/**
 * @file form-controls.ts
 * Web page form controls (input, textarea, select, button): their UA look, default sizes, painted
 * content, live value, and the data a form submits. Nova paints pages into one bitmap, so these
 * controls were invisible and inert: an <input> was an empty, borderless box.
 *
 * Typing happens in a real HTML field the page UI lays over the painted control (browser-window);
 * the typed text is stored on the element (`formValue`) and painted from here.
 */
import type { DomElement, DomNode, LayoutBox } from './dom-tree';
import type { PaintCommand } from './paint-engine';

export type ControlKind = 'text' | 'password' | 'textarea' | 'checkbox' | 'radio' | 'select' | 'button' | 'hidden';

const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'color', 'range', 'file']);
const BUTTON_TYPES = new Set(['submit', 'reset', 'button', 'image']);

const tagOf = (el: DomElement): string => (typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '');
const typeOf = (el: DomElement): string => (el.attributes.get('type') ?? '').trim().toLowerCase();

/** What kind of form control an element is, or null. */
export function controlKind(el: DomElement): ControlKind | null {
  const tag = tagOf(el);
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  if (tag === 'button') return 'button';
  if (tag !== 'input') return null;
  const type = typeOf(el);
  if (type === 'hidden') return 'hidden';
  if (type === 'password') return 'password';
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (BUTTON_TYPES.has(type)) return 'button';
  return TEXT_TYPES.has(type) ? 'text' : 'text';
}

/** Controls typed into through the keyboard overlay. */
export function isTextEditable(el: DomElement): boolean {
  const kind = controlKind(el);
  return (kind === 'text' || kind === 'password' || kind === 'textarea') && !isDisabled(el) && !el.attributes.has('readonly');
}

export function isDisabled(el: DomElement): boolean {
  return el.attributes.has('disabled');
}

/** textarea/select children (their text, <option>s) are the control's data, not page text. */
export function skipsChildLayout(el: DomElement): boolean {
  const tag = tagOf(el);
  // An <svg>'s children are its picture (inline-svg.ts), not boxes: laid out, a <path> each made it a line taller.
  return tag === 'textarea' || tag === 'select' || tag === 'input' || tag === 'svg';
}

const textOf = (node: DomNode): string =>
  node.nodeType === 'text' ? ((node as { text?: string }).text ?? '') : (node.children ?? []).map(textOf).join('');

function options(select: DomElement): DomElement[] {
  const out: DomElement[] = [];
  const walk = (n: DomNode): void => {
    if (n.nodeType !== 'element') return;
    if (tagOf(n as DomElement) === 'option') out.push(n as DomElement);
    for (const c of n.children ?? []) walk(c);
  };
  for (const c of select.children) walk(c);
  return out;
}

function selectedOption(select: DomElement): DomElement | null {
  const opts = options(select);
  if (select.formValue != null) return opts.find((o) => optionValue(o) === select.formValue) ?? opts[0] ?? null;
  return opts.find((o) => o.attributes.has('selected')) ?? opts[0] ?? null;
}

const optionValue = (o: DomElement): string => o.attributes.get('value') ?? textOf(o).trim();

/** The control's current value: what was typed, else its initial value. */
export function controlValue(el: DomElement): string {
  if (el.formValue != null && tagOf(el) !== 'select') return el.formValue;
  const kind = controlKind(el);
  if (kind === 'textarea') return textOf(el);
  if (kind === 'select') { const o = selectedOption(el); return o ? optionValue(o) : ''; }
  if (kind === 'checkbox' || kind === 'radio') return el.attributes.get('value') ?? 'on';
  return el.attributes.get('value') ?? '';
}

export function setControlValue(el: DomElement, value: string): void {
  el.formValue = value;
}

export function controlChecked(el: DomElement): boolean {
  return el.formChecked ?? el.attributes.has('checked');
}

/**
 * Ticks a checkbox, or picks a radio (unticking the others in its name group within the form).
 * Returns every control whose state changed, so the caller repaints them all: the radio it
 * unticked used to keep looking selected because only the tapped one was redrawn.
 */
export function toggleControl(el: DomElement): DomElement[] {
  const kind = controlKind(el);
  if (kind === 'checkbox') { el.formChecked = !controlChecked(el); return [el]; }
  if (kind === 'radio') {
    const changed: DomElement[] = [el];
    const name = el.attributes.get('name');
    if (name) {
      const scope = formOf(el) ?? rootOf(el);
      for (const other of descendants(scope)) {
        if (other !== el && controlKind(other) === 'radio' && other.attributes.get('name') === name && controlChecked(other)) {
          other.formChecked = false;
          changed.push(other);
        }
      }
    }
    el.formChecked = true;
    return changed;
  }
  return [];
}

const rootOf = (el: DomElement): DomElement => {
  let n: DomElement = el;
  while (n.parent && n.parent.nodeType === 'element') n = n.parent as DomElement;
  return n;
};

function descendants(root: DomElement): DomElement[] {
  const out: DomElement[] = [];
  const walk = (n: DomNode): void => {
    if (n.nodeType !== 'element') return;
    out.push(n as DomElement);
    for (const c of n.children ?? []) walk(c);
  };
  for (const c of root.children) walk(c);
  return out;
}

/** The form an element belongs to (its nearest <form> ancestor). */
export function formOf(el: DomElement): DomElement | null {
  for (let n: DomNode | null = el.parent; n; n = n.parent) {
    if (n.nodeType === 'element' && tagOf(n as DomElement) === 'form') return n as DomElement;
  }
  return null;
}

/** Whether activating this element submits its form (submit inputs, <button> without type=button/reset). */
export function isSubmitButton(el: DomElement): boolean {
  const tag = tagOf(el);
  const type = typeOf(el);
  if (tag === 'input') return type === 'submit' || type === 'image';
  if (tag === 'button') return type === '' || type === 'submit';
  return false;
}

/**
 * The form data set (HTML §4.10.21.4): named, enabled controls; checked boxes and radios only; the
 * chosen option; the submitter only if it was the one used. ponytail: no file inputs.
 */
export function formDataEntries(form: DomElement, submitter: DomElement | null): [string, string][] {
  const entries: [string, string][] = [];
  for (const el of descendants(form)) {
    const kind = controlKind(el);
    const name = el.attributes.get('name');
    if (!kind || !name || isDisabled(el)) continue;
    if (kind === 'button') { if (el === submitter) entries.push([name, el.attributes.get('value') ?? '']); continue; }
    if ((kind === 'checkbox' || kind === 'radio') && !controlChecked(el)) continue;
    entries.push([name, controlValue(el)]);
  }
  return entries;
}

/** Controls with `required` and no value; submission stops at the first. */
export function firstMissingRequired(form: DomElement): DomElement | null {
  for (const el of descendants(form)) {
    const kind = controlKind(el);
    if (!kind || kind === 'button' || kind === 'hidden' || isDisabled(el) || !el.attributes.has('required')) continue;
    if (kind === 'checkbox' || kind === 'radio' ? !controlChecked(el) : controlValue(el) === '') return el;
  }
  return null;
}

// ── UA look and default sizes ──────────────────────────────────────────────

/** UA stylesheet declarations for a form control (HTML §15.5.x, Chromium's look). */
export function controlUaDefaults(tag: string, type: string): Record<string, string> | null {
  const box = {
    display: 'inline-block', 'font-size': '13.333px', 'line-height': 'normal', color: '#000000',
    'border-top-style': 'solid', 'border-right-style': 'solid', 'border-bottom-style': 'solid', 'border-left-style': 'solid',
    'border-top-width': '1px', 'border-right-width': '1px', 'border-bottom-width': '1px', 'border-left-width': '1px',
    'border-top-color': '#767676', 'border-right-color': '#767676', 'border-bottom-color': '#767676', 'border-left-color': '#767676',
    'border-radius': '2px', 'box-sizing': 'content-box',
  };
  if (tag === 'input' && type === 'hidden') return { display: 'none' };
  if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
    return { ...box, 'background-color': '#ffffff', 'margin-top': '3px', 'margin-right': '3px', 'margin-bottom': '3px', 'margin-left': '4px',
      'padding-top': '0px', 'padding-right': '0px', 'padding-bottom': '0px', 'padding-left': '0px', ...(type === 'radio' ? { 'border-radius': '50%' } : {}) };
  }
  if (tag === 'button' || (tag === 'input' && BUTTON_TYPES.has(type))) {
    return { ...box, 'background-color': '#efefef', 'padding-top': '1px', 'padding-right': '6px', 'padding-bottom': '1px', 'padding-left': '6px', 'text-align': 'center' };
  }
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return { ...box, 'background-color': '#ffffff', 'padding-top': '1px', 'padding-right': '2px', 'padding-bottom': '1px', 'padding-left': '2px',
      ...(tag === 'textarea' ? { 'font-family': 'monospace' } : {}) };
  }
  return null;
}

/**
 * Default content size (HTML §15.5.x): a text input is about `size` (20) characters wide, a
 * textarea `cols` x `rows`, a checkbox 13x13. Null for anything that isn't a sized control.
 */
export function controlIntrinsicSize(el: DomElement, fontSize: number): { width: number; height: number } | null {
  const kind = controlKind(el);
  const charW = fontSize * 0.55;
  const lineH = Math.round(fontSize * 1.2);
  const num = (name: string, fallback: number): number => {
    const n = parseInt(el.attributes.get(name) ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  switch (kind) {
    case 'text':
    case 'password': return { width: Math.round(num('size', 20) * charW), height: lineH };
    case 'textarea': return { width: Math.round(num('cols', 20) * charW), height: num('rows', 2) * lineH };
    case 'checkbox':
    case 'radio': return { width: 11, height: 11 };
    case 'select': {
      const longest = options(el).reduce((m, o) => Math.max(m, textOf(o).trim().length), 0);
      return { width: Math.round(Math.max(4, longest) * charW + 20), height: lineH };
    }
    case 'button':
      // <button> sizes to its children; input buttons to their label.
      if (tagOf(el) === 'button') return null;
      return { width: Math.round(buttonLabel(el).length * charW), height: lineH };
    default: return null;
  }
}

function buttonLabel(el: DomElement): string {
  const v = el.attributes.get('value');
  if (v != null) return v;
  const type = typeOf(el);
  return type === 'reset' ? 'Reset' : type === 'submit' ? 'Submit' : '';
}

// ── Painting ───────────────────────────────────────────────────────────────

/** Paint commands for a control's content (value or placeholder, tick, chosen option), inside its box. */
export function paintControlContent(el: DomElement, box: LayoutBox, style: ReadonlyMap<string, string>): PaintCommand[] {
  const kind = controlKind(el);
  if (!kind || kind === 'hidden' || (kind === 'button' && tagOf(el) === 'button')) return [];
  const x = box.x + box.borderLeft + box.paddingLeft;
  const y = box.y + box.borderTop + box.paddingTop;
  const w = box.width - box.borderLeft - box.borderRight - box.paddingLeft - box.paddingRight;
  const h = box.height - box.borderTop - box.borderBottom - box.paddingTop - box.paddingBottom;
  if (w <= 0 || h <= 0) return [];
  const fontSize = parseFloat(style.get('font-size') ?? '13.333') || 13.333;
  const font = `${style.get('font-weight') ?? 'normal'} ${fontSize}px ${style.get('font-family') ?? 'sans-serif'}`;
  const color = style.get('color') ?? '#000000';
  const cmds: PaintCommand[] = [];

  if (kind === 'checkbox' || kind === 'radio') {
    if (!controlChecked(el)) return [];
    const ink = isDisabled(el) ? '#8a8a8a' : '#1a73e8';
    cmds.push({ type: 'setFillStyle', params: [ink] });
    if (kind === 'radio') {
      // A round dot (it was a small square).
      const d = Math.max(2, Math.round(Math.min(w, h) / 2));
      const dx = x + (w - d) / 2, dy = y + (h - d) / 2, rr = { w: d / 2, h: d / 2 };
      cmds.push({ type: 'setBorderRadius', params: [{ topLeft: rr, topRight: rr, bottomRight: rr, bottomLeft: rr }, dx, dy, d, d] });
      cmds.push({ type: 'fillRect', params: [dx, dy, d, d] });
      cmds.push({ type: 'setBorderRadius', params: [null, 0, 0, 0, 0] });
    } else {
      cmds.push({ type: 'fillRect', params: [x, y, w, h] });
      cmds.push({ type: 'setFillStyle', params: ['#ffffff'] });
      cmds.push({ type: 'setFont', params: [`bold ${Math.max(8, h)}px sans-serif`] });
      cmds.push({ type: 'fillText', params: ['✓', x + w * 0.1, y + h * 0.85] });
    }
    return cmds;
  }

  let text: string;
  let ink = color;
  if (kind === 'select') {
    const o = selectedOption(el);
    text = o ? textOf(o).trim() : '';
  } else if (kind === 'button') {
    text = buttonLabel(el);
  } else {
    text = controlValue(el);
    if (kind === 'password') text = '•'.repeat(text.length);
    if (!text) { text = el.attributes.get('placeholder') ?? ''; ink = '#757575'; }
  }
  if (isDisabled(el)) ink = '#8a8a8a';

  cmds.push({ type: 'save', params: [] });
  cmds.push({ type: 'clip', params: [x, y, w, h] });
  cmds.push({ type: 'setFillStyle', params: [ink] });
  cmds.push({ type: 'setFont', params: [font] });
  const lineH = fontSize * 1.2;
  const lines = kind === 'textarea' ? text.split('\n') : [text.replace(/\n/g, ' ')];
  lines.forEach((line, i) => {
    if (!line) return;
    const baseline = y + (kind === 'textarea' ? i * lineH + fontSize : (h + fontSize * 0.7) / 2);
    const tx = kind === 'button' ? x + Math.max(0, (w - line.length * fontSize * 0.55) / 2) : x;
    cmds.push({ type: 'fillText', params: [line, tx, baseline] });
  });
  if (kind === 'select') {
    cmds.push({ type: 'setFillStyle', params: ['#555555'] });
    cmds.push({ type: 'fillText', params: ['▾', x + w - fontSize * 0.8, (y * 2 + h + fontSize * 0.7) / 2] });
  }
  cmds.push({ type: 'restore', params: [] });
  return cmds;
}
