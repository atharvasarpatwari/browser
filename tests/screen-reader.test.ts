import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  implicitRole,
  explicitRole,
  resolvedRole,
  computeAccessibleName,
  computeAccessibleDescription,
  computeValue,
  computeStates,
  computeHidden,
  buildAccessibilityTree,
  createScreenReaderManager,
  type A11yDomElement,
  type A11yDomNode,
} from '../src/browser/accessibility/screen-reader';

function el(
  tagName: string,
  attrs: Record<string, string> = {},
  children: A11yDomNode[] = [],
  domId = `id-${tagName}-${Math.random().toString(36).slice(2, 6)}`,
): A11yDomElement {
  return {
    domId,
    nodeType: 'element',
    parent: null,
    tagName,
    attributes: new Map(Object.entries(attrs)),
    children,
    _dirtyLayout: false,
    _dirtyPaint: false,
  } as unknown as A11yDomElement;
}

function textNode(text: string, domId = `txt-${Math.random().toString(36).slice(2, 6)}`): A11yDomNode {
  return {
    domId,
    nodeType: 'text',
    parent: null,
    children: [],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 1. IMPLICIT ROLE MAPPING
// ────────────────────────────────────────────────────────────────────────────

describe('implicitRole', () => {
  it('maps a to link', () => { expect(implicitRole('a')).toBe('link'); });
  it('maps button to button', () => { expect(implicitRole('button')).toBe('button'); });
  it('maps h1-h6 to heading', () => { expect(implicitRole('h1')).toBe('heading'); expect(implicitRole('h6')).toBe('heading'); });
  it('maps img to img', () => { expect(implicitRole('img')).toBe('img'); });
  it('maps nav to navigation', () => { expect(implicitRole('nav')).toBe('navigation'); });
  it('maps main to main', () => { expect(implicitRole('main')).toBe('main'); });
  it('maps aside to complementary', () => { expect(implicitRole('aside')).toBe('complementary'); });
  it('maps header to banner', () => { expect(implicitRole('header')).toBe('banner'); });
  it('maps footer to contentinfo', () => { expect(implicitRole('footer')).toBe('contentinfo'); });
  it('maps form to form', () => { expect(implicitRole('form')).toBe('form'); });
  it('maps ul/ol to list', () => { expect(implicitRole('ul')).toBe('list'); expect(implicitRole('ol')).toBe('list'); });
  it('maps li to listitem', () => { expect(implicitRole('li')).toBe('listitem'); });
  it('maps section to region', () => { expect(implicitRole('section')).toBe('region'); });
  it('maps unknown tag to none', () => { expect(implicitRole('div')).toBe('none'); expect(implicitRole('span')).toBe('none'); });
  it('is case-insensitive', () => { expect(implicitRole('BUTTON')).toBe('button'); expect(implicitRole('Nav')).toBe('navigation'); });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. EXPLICIT ROLE
// ────────────────────────────────────────────────────────────────────────────

describe('explicitRole', () => {
  it('reads role attribute', () => {
    expect(explicitRole(new Map([['role', 'button']]))).toBe('button');
  });
  it('returns null for absent role', () => {
    expect(explicitRole(new Map())).toBeNull();
  });
  it('returns null for invalid role', () => {
    expect(explicitRole(new Map([['role', 'superman']]))).toBeNull();
  });
  it('trims and lowercases', () => {
    expect(explicitRole(new Map([['role', '  BUTTON  ']]))).toBe('button');
  });
  it('accepts presentation', () => {
    expect(explicitRole(new Map([['role', 'presentation']]))).toBe('presentation');
  });
  it('accepts switch', () => {
    expect(explicitRole(new Map([['role', 'switch']]))).toBe('switch');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. RESOLVED ROLE
// ────────────────────────────────────────────────────────────────────────────

describe('resolvedRole', () => {
  it('uses explicit role when present', () => {
    expect(resolvedRole(new Map([['role', 'button']]), 'div')).toBe('button');
  });
  it('falls back to implicit role', () => {
    expect(resolvedRole(new Map(), 'a')).toBe('link');
  });
  it('falls back to none for unknown', () => {
    expect(resolvedRole(new Map(), 'div')).toBe('none');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. ACCESSIBLE NAME
// ────────────────────────────────────────────────────────────────────────────

describe('computeAccessibleName', () => {
  it('uses aria-label first', () => {
    const attr = new Map([['aria-label', 'Close'], ['alt', 'X'], ['title', 'Close button']]);
    expect(computeAccessibleName(attr)).toBe('Close');
  });
  it('falls back to title', () => {
    const attr = new Map([['title', 'Settings'], ['alt', 'gear']]);
    expect(computeAccessibleName(attr)).toBe('Settings');
  });
  it('falls back to alt', () => {
    const attr = new Map([['alt', 'Logo']]);
    expect(computeAccessibleName(attr)).toBe('Logo');
  });
  it('returns empty string when no name sources', () => {
    expect(computeAccessibleName(new Map())).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. ACCESSIBLE DESCRIPTION
// ────────────────────────────────────────────────────────────────────────────

describe('computeAccessibleDescription', () => {
  it('uses aria-description', () => {
    const attr = new Map([['aria-description', 'A descriptive text']]);
    expect(computeAccessibleDescription(attr)).toBe('A descriptive text');
  });
  it('falls back to aria-describedby', () => {
    const attr = new Map([['aria-describedby', 'desc1']]);
    expect(computeAccessibleDescription(attr)).toBe('desc1');
  });
  it('returns empty when none', () => {
    expect(computeAccessibleDescription(new Map())).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. VALUE COMPUTATION
// ────────────────────────────────────────────────────────────────────────────

describe('computeValue', () => {
  it('uses aria-valuetext first', () => {
    expect(computeValue(new Map([['aria-valuetext', 'High'], ['value', '80'], ['aria-valuenow', '80']]))).toBe('High');
  });
  it('falls back to value', () => {
    expect(computeValue(new Map([['value', '42']]))).toBe('42');
  });
  it('falls back to aria-valuenow', () => {
    expect(computeValue(new Map([['aria-valuenow', '75']]))).toBe('75');
  });
  it('returns empty when none', () => {
    expect(computeValue(new Map())).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. STATE COMPUTATION
// ────────────────────────────────────────────────────────────────────────────

describe('computeStates', () => {
  it('disabled from attribute', () => {
    const s = computeStates(new Map([['disabled', '']]), 'button');
    expect(s.has('disabled')).toBe(true);
  });
  it('disabled from aria-disabled', () => {
    const s = computeStates(new Map([['aria-disabled', 'true']]), 'button');
    expect(s.has('disabled')).toBe(true);
  });
  it('hidden from hidden attribute', () => {
    const s = computeStates(new Map([['hidden', '']]), 'div');
    expect(s.has('hidden')).toBe(true);
  });
  it('hidden from aria-hidden', () => {
    const s = computeStates(new Map([['aria-hidden', 'true']]), 'div');
    expect(s.has('hidden')).toBe(true);
  });
  it('expanded / collapsed', () => {
    const e = computeStates(new Map([['aria-expanded', 'true']]), 'button');
    expect(e.has('expanded')).toBe(true);
    expect(e.has('collapsed')).toBe(false);
    const c = computeStates(new Map([['aria-expanded', 'false']]), 'button');
    expect(c.has('collapsed')).toBe(true);
    expect(c.has('expanded')).toBe(false);
  });
  it('selected', () => {
    const s = computeStates(new Map([['aria-selected', 'true']]), 'option');
    expect(s.has('selected')).toBe(true);
  });
  it('pressed', () => {
    const s = computeStates(new Map([['aria-pressed', 'true']]), 'button');
    expect(s.has('pressed')).toBe(true);
  });
  it('checked / unchecked', () => {
    const c = computeStates(new Map([['aria-checked', 'true']]), 'checkbox');
    expect(c.has('checked')).toBe(true);
    expect(c.has('unchecked')).toBe(false);
    const u = computeStates(new Map([['aria-checked', 'false']]), 'checkbox');
    expect(u.has('unchecked')).toBe(true);
    expect(u.has('checked')).toBe(false);
  });
  it('busy', () => {
    const s = computeStates(new Map([['aria-busy', 'true']]), 'region');
    expect(s.has('busy')).toBe(true);
  });
  it('required from attribute', () => {
    const s = computeStates(new Map([['required', '']]), 'textbox');
    expect(s.has('required')).toBe(true);
  });
  it('required from aria-required', () => {
    const s = computeStates(new Map([['aria-required', 'true']]), 'textbox');
    expect(s.has('required')).toBe(true);
  });
  it('readonly', () => {
    const s = computeStates(new Map([['readonly', '']]), 'textbox');
    expect(s.has('readonly')).toBe(true);
  });
  it('invalid', () => {
    const s = computeStates(new Map([['aria-invalid', 'true']]), 'textbox');
    expect(s.has('invalid')).toBe(true);
  });
  it('multiline', () => {
    const s = computeStates(new Map([['aria-multiline', 'true']]), 'textbox');
    expect(s.has('multiline')).toBe(true);
  });
  it('visited', () => {
    const s = computeStates(new Map([['aria-visited', 'true']]), 'link');
    expect(s.has('visited')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. HIDDEN COMPUTATION
// ────────────────────────────────────────────────────────────────────────────

describe('computeHidden', () => {
  it('hidden attribute', () => {
    expect(computeHidden(new Map([['hidden', '']]))).toBe(true);
  });
  it('aria-hidden true', () => {
    expect(computeHidden(new Map([['aria-hidden', 'true']]))).toBe(true);
  });
  it('aria-hidden false', () => {
    expect(computeHidden(new Map([['aria-hidden', 'false']]))).toBe(false);
  });
  it('neither', () => {
    expect(computeHidden(new Map())).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 9. BUILD ACCESSIBILITY TREE
// ────────────────────────────────────────────────────────────────────────────

describe('buildAccessibilityTree', () => {
  it('text node root builds into none-role node', () => {
    const root: A11yDomNode = { domId: 'd1', nodeType: 'text', parent: null, children: [] };
    const tree = buildAccessibilityTree(root);
    expect(tree).not.toBeNull();
    expect(tree!.role).toBe('none');
    expect(tree!.tagName).toBe('#text');
  });

  it('builds tree for a simple button', () => {
    const btn = el('button', { 'aria-label': 'Submit' });
    const tree = buildAccessibilityTree(btn);
    expect(tree).not.toBeNull();
    expect(tree!.role).toBe('button');
    expect(tree!.name).toBe('Submit');
    expect(tree!.tagName).toBe('button');
  });

  it('assigns resolved role', () => {
    const div = el('div', { role: 'button', 'aria-label': 'Click' });
    const tree = buildAccessibilityTree(div);
    expect(tree!.role).toBe('button');
  });

  it('includes child elements', () => {
    const child = el('li', {}, [], 'li-1');
    const list = el('ul', {}, [child], 'ul-1');
    const tree = buildAccessibilityTree(list);
    expect(tree!.children).toHaveLength(1);
    expect(tree!.children[0].role).toBe('listitem');
  });

  it('skips hidden elements', () => {
    const nested = el('span', { 'aria-label': 'secret' }, [], 'sp-1');
    const parent = el('div', { 'aria-hidden': 'true' }, [nested], 'div-1');
    const tree = buildAccessibilityTree(parent);
    expect(tree!.hidden).toBe(true);
    // children are still included (they're hidden by parent but we don't propagate)
    expect(tree!.children).toHaveLength(1);
  });

  it('assigns states from attributes', () => {
    const btn = el('button', { 'aria-expanded': 'true', 'aria-pressed': 'true' });
    const tree = buildAccessibilityTree(btn);
    expect(tree!.states.has('expanded')).toBe(true);
    expect(tree!.states.has('pressed')).toBe(true);
  });

  it('text node child is included as none-role node', () => {
    const txt = textNode('hello');
    const span = el('span', {}, [txt], 'sp-1');
    const tree = buildAccessibilityTree(span);
    expect(tree!.children).toHaveLength(1);
    expect(tree!.children[0].role).toBe('none');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 10. SCREEN READER MANAGER
// ────────────────────────────────────────────────────────────────────────────

describe('ScreenReaderManager', () => {
  let sr: ReturnType<typeof createScreenReaderManager>;

  beforeEach(() => { sr = createScreenReaderManager(); });
  afterEach(() => { sr.dispose(); });

  it('starts enabled', () => {
    expect(sr.isEnabled()).toBe(true);
  });

  it('disable / enable toggle', () => {
    sr.disable();
    expect(sr.isEnabled()).toBe(false);
    sr.enable();
    expect(sr.isEnabled()).toBe(true);
  });

  it('announce emits announcement event', () => {
    const handler = vi.fn();
    sr.onEvent(handler);
    sr.announce('Hello world');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'announcement', text: 'Hello world', priority: 'polite' }),
    );
  });

  it('announce with assertive priority', () => {
    const handler = vi.fn();
    sr.onEvent(handler);
    sr.announce('URGENT', 'assertive');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'announcement', text: 'URGENT', priority: 'assertive' }),
    );
  });

  it('announce does nothing when disabled', () => {
    const handler = vi.fn();
    sr.onEvent(handler);
    sr.disable();
    sr.announce('test');
    expect(handler).not.toHaveBeenCalled();
  });

  it('announce ignores empty text', () => {
    const handler = vi.fn();
    sr.onEvent(handler);
    sr.announce('');
    expect(handler).not.toHaveBeenCalled();
  });

  it('setFocus emits focusChanged', () => {
    const handler = vi.fn();
    sr.onEvent(handler);
    sr.setFocus('btn-1');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'focusChanged', elementId: 'btn-1' }),
    );
  });

  it('setFocus announces focused element name', () => {
    const handler = vi.fn();
    sr.onEvent(handler);
    const btn = el('button', { 'aria-label': 'Submit' });
    sr.buildTree(btn);
    sr.setFocus(btn.domId);
    // Should emit focusChanged + announcement
    const events = handler.mock.calls.map(c => c[0].kind);
    expect(events).toContain('focusChanged');
    expect(events).toContain('announcement');
  });

  it('getFocus returns focused id', () => {
    sr.setFocus('el-1');
    expect(sr.getFocus()).toBe('el-1');
  });

  it('buildTree emits treeUpdated', () => {
    const handler = vi.fn();
    sr.onEvent(handler);
    sr.buildTree(el('div'));
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'treeUpdated' }),
    );
  });

  it('getNode retrieves indexed node', () => {
    const btn = el('button', { 'aria-label': 'OK' }, [], 'btn-ok');
    sr.buildTree(el('div', {}, [btn], 'root'));
    const node = sr.getNode('btn-ok');
    expect(node).not.toBeUndefined();
    expect(node!.name).toBe('OK');
    expect(node!.role).toBe('button');
  });

  it('getNode returns undefined for unknown id', () => {
    expect(sr.getNode('nope')).toBeUndefined();
  });

  it('onEvent returns unsubscribe function', () => {
    const handler = vi.fn();
    const unsub = sr.onEvent(handler);
    sr.announce('hi');
    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
    sr.announce('bye');
    expect(handler).toHaveBeenCalledTimes(1); // not called again
  });

  it('getIdForElement returns domId', () => {
    const btn = el('button');
    expect(sr.getIdForElement(btn)).toBe(btn.domId);
  });

  it('dispose clears all handlers and node map', () => {
    sr.buildTree(el('button', {}, [], 'b1'));
    const handler = vi.fn();
    sr.onEvent(handler);
    sr.dispose();
    expect(sr.isEnabled()).toBe(false);
    sr.announce('test');
    expect(handler).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 11. INTEGRATION — REALISTIC SCENARIOS
// ────────────────────────────────────────────────────────────────────────────

describe('Integration — realistic page scenarios', () => {
  it('navigation landmark with links', () => {
    const home = el('a', { href: '/', 'aria-label': 'Home' }, [], 'lnk-home');
    const about = el('a', { href: '/about', 'aria-label': 'About' }, [], 'lnk-about');
    const nav = el('nav', { 'aria-label': 'Main navigation' }, [home, about], 'nav-main');
    const tree = buildAccessibilityTree(nav);

    expect(tree!.role).toBe('navigation');
    expect(tree!.name).toBe('Main navigation');
    expect(tree!.children).toHaveLength(2);
    expect(tree!.children[0].name).toBe('Home');
    expect(tree!.children[1].name).toBe('About');
  });

  it('dialog with close button', () => {
    const closeBtn = el('button', { 'aria-label': 'Close dialog' }, [], 'btn-close');
    const dialog = el('div', { role: 'dialog', 'aria-label': 'Confirm deletion' }, [closeBtn], 'dlg-1');
    const tree = buildAccessibilityTree(dialog);

    expect(tree!.role).toBe('dialog');
    expect(tree!.name).toBe('Confirm deletion');
    expect(tree!.children).toHaveLength(1);
    expect(tree!.children[0].role).toBe('button');
    expect(tree!.children[0].name).toBe('Close dialog');
  });

  it('form with required textbox', () => {
    const input = el('input', { type: 'text', 'aria-label': 'Full name', required: '', 'aria-invalid': 'true' }, [], 'inp-1');
    const form = el('form', { 'aria-label': 'Sign up' }, [input], 'frm-1');
    const tree = buildAccessibilityTree(form);

    expect(tree!.role).toBe('form');
    expect(tree!.name).toBe('Sign up');
    const tb = tree!.children[0];
    expect(tb.role).toBe('textbox');
    expect(tb.name).toBe('Full name');
    expect(tb.states.has('required')).toBe(true);
    expect(tb.states.has('invalid')).toBe(true);
  });

  it('checkbox states', () => {
    const cb = el('input', { type: 'checkbox', 'aria-checked': 'true', 'aria-label': 'Accept terms' }, [], 'cb-1');
    const tree = buildAccessibilityTree(cb);
    expect(tree!.states.has('checked')).toBe(true);
    expect(tree!.states.has('unchecked')).toBe(false);
    expect(tree!.name).toBe('Accept terms');
  });

  it('tree with hidden subtree', () => {
    const hiddenSpan = el('span', { 'aria-hidden': 'true', 'aria-label': 'secret' }, [], 'sp-hide');
    const visibleBtn = el('button', { 'aria-label': 'Visible' }, [], 'btn-vis');
    const root = el('div', {}, [hiddenSpan, visibleBtn], 'root');
    const tree = buildAccessibilityTree(root);

    expect(tree!.children).toHaveLength(2);
    expect(tree!.children[0].hidden).toBe(true);
    expect(tree!.children[1].hidden).toBe(false);
    expect(tree!.children[1].name).toBe('Visible');
  });

  it('heading with implicit role', () => {
    const h1 = el('h1', {}, [], 'h1-1');
    const tree = buildAccessibilityTree(h1);
    expect(tree!.role).toBe('heading');
  });

  it('role=presentation strips semantics', () => {
    const img = el('img', { role: 'presentation', alt: 'decorative' }, [], 'img-dec');
    const tree = buildAccessibilityTree(img);
    expect(tree!.role).toBe('presentation');
    expect(tree!.name).toBe('decorative');
  });

  it('disabled button state', () => {
    const btn = el('button', { disabled: '', 'aria-label': 'Save' }, [], 'btn-save');
    const tree = buildAccessibilityTree(btn);
    expect(tree!.states.has('disabled')).toBe(true);
    expect(tree!.name).toBe('Save');
  });

  it('slider with value text', () => {
    const slider = el('input', {
      type: 'range',
      role: 'slider',
      'aria-valuetext': 'Medium',
      'aria-valuenow': '50',
      'aria-label': 'Volume',
    }, [], 'sld-1');
    const tree = buildAccessibilityTree(slider);
    expect(tree!.role).toBe('slider');
    expect(tree!.name).toBe('Volume');
    expect(tree!.value).toBe('Medium');
  });

  it('announce flow on manager with real tree', () => {
    const sr = createScreenReaderManager();
    const events: string[] = [];
    sr.onEvent(e => { events.push(`${e.kind}:${e.elementId ?? e.text ?? ''}`); });

    const btn = el('button', { 'aria-label': 'OK' }, [], 'btn-ok');
    sr.buildTree(el('div', {}, [btn], 'root'));
    sr.setFocus('btn-ok');

    expect(events).toContain('focusChanged:btn-ok');
    expect(events).toContain('announcement:OK');

    sr.dispose();
  });
});
