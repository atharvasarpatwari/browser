import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMutableDocument,
  createMutableElement,
  createMutableTextNode,
  createMutableComment,
  appendChild,
  removeChild,
  insertBefore,
  replaceChild,
  elementSetAttribute,
  elementGetAttribute,
  getTextContent,
  setTextContent,
  NodeType,
  MutationObserver,
  cloneElement,
  type HtmlNode,
  type HtmlElement,
  type MutableElement,
} from '../src/browser/rendering/html5/dom';
import {
  attachShadow,
  getRootNode,
  isShadowRoot,
  findShadowRoot,
  assignSlots,
  getAssignedNodes,
  getSlotName,
  DEFAULT_SLOT_NAME,
  computeComposedPath,
  retarget,
  cloneShadowTree,
  attachInternals,
  type ShadowRoot,
  type ShadowRootMode,
  type MutableShadowRoot,
  type EventPathItem,
} from '../src/browser/rendering/html5/shadow';
import { deliverRecordsSync } from '../src/browser/rendering/html5/mutation-observer';

// ─────────────────────────────────────────────────────────────────────────────
// SHADOW ROOT CREATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Shadow DOM — attachShadow', () => {
  it('creates a shadow root in open mode', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });

    expect(shadow).toBeDefined();
    expect(shadow.mode).toBe('open');
    expect(shadow.host).toBe(host);
    expect(shadow.nodeType).toBe(NodeType.DocumentFragment);
    expect(host._shadowRoot).toBe(shadow);
  });

  it('creates a shadow root in closed mode', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'closed' });

    expect(shadow.mode).toBe('closed');
    expect(host._shadowRoot).toBe(shadow);
  });

  it('throws when attaching multiple shadow roots', () => {
    const host = createMutableElement('div');
    attachShadow(host, { mode: 'open' });

    expect(() => attachShadow(host, { mode: 'open' })).toThrow('Cannot attach multiple shadow roots');
  });

  it('throws for invalid mode', () => {
    const host = createMutableElement('div');
    expect(() => attachShadow(host, { mode: 'invalid' as any })).toThrow('Shadow root mode must be');
  });

  it('shadow root starts empty', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });

    expect(shadow.children.length).toBe(0);
    expect(shadow.childNodes.length).toBe(0);
    expect(shadow.firstChild).toBeNull();
    expect(shadow.lastChild).toBeNull();
    expect(shadow.childElementCount).toBe(0);
  });

  it('shadow root parent is always null', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });

    expect(shadow.parent).toBeNull();
    expect(shadow.nextSibling).toBeNull();
    expect(shadow.previousSibling).toBeNull();
    expect(shadow.namespaceURI).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isShadowRoot / findShadowRoot
// ─────────────────────────────────────────────────────────────────────────────

describe('Shadow DOM — isShadowRoot', () => {
  it('returns true for shadow roots', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });
    expect(isShadowRoot(shadow as unknown as HtmlNode)).toBe(true);
  });

  it('returns false for regular elements', () => {
    const el = createMutableElement('div');
    expect(isShadowRoot(el as unknown as HtmlNode)).toBe(false);
  });

  it('returns false for text nodes', () => {
    const text = createMutableTextNode('hello');
    expect(isShadowRoot(text as unknown as HtmlNode)).toBe(false);
  });
});

describe('Shadow DOM — findShadowRoot', () => {
  it('finds the shadow root containing an element', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });
    const inner = createMutableElement('span');
    appendChild(shadow as any, inner);

    expect(findShadowRoot(inner)).toBe(shadow);
  });

  it('returns null for elements not in a shadow tree', () => {
    const el = createMutableElement('div');
    expect(findShadowRoot(el)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getRootNode
// ─────────────────────────────────────────────────────────────────────────────

describe('Shadow DOM — getRootNode', () => {
  it('returns the shadow root for elements inside a shadow tree (non-composed)', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });
    const inner = createMutableElement('span');
    appendChild(shadow as any, inner);

    const root = getRootNode(inner as unknown as HtmlNode, false);
    expect(root).toBe(shadow);
  });

  it('returns the document root for elements outside shadow trees', () => {
    const doc = createMutableDocument();
    const div = createMutableElement('div');
    appendChild(doc, div);

    const root = getRootNode(div as unknown as HtmlNode, false);
    expect(root).toBe(doc);
  });

  it('composed=true walks through shadow roots to outermost root', () => {
    const doc = createMutableDocument();
    const host = createMutableElement('div');
    appendChild(doc, host);

    const shadow = attachShadow(host, { mode: 'open' });
    const inner = createMutableElement('span');
    appendChild(shadow as any, inner);

    // Composed should walk through the shadow boundary
    const root = getRootNode(inner as unknown as HtmlNode, true);
    expect(root).toBe(doc);
  });

  it('nested shadow roots — composed walks all boundaries', () => {
    const doc = createMutableDocument();
    const host1 = createMutableElement('div');
    appendChild(doc, host1);

    const shadow1 = attachShadow(host1, { mode: 'open' });
    const host2 = createMutableElement('span');
    appendChild(shadow1 as any, host2);

    const shadow2 = attachShadow(host2, { mode: 'open' });
    const inner = createMutableElement('b');
    appendChild(shadow2 as any, inner);

    const root = getRootNode(inner as unknown as HtmlNode, false);
    expect(root).toBe(shadow2);

    const composedRoot = getRootNode(inner as unknown as HtmlNode, true);
    expect(composedRoot).toBe(doc);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SLOT ASSIGNMENT
// ─────────────────────────────────────────────────────────────────────────────

describe('Shadow DOM — getSlotName', () => {
  it('returns empty string for unnamed slot', () => {
    const slot = createMutableElement('slot');
    expect(getSlotName(slot)).toBe('');
  });

  it('returns name attribute value for named slot', () => {
    const slot = createMutableElement('slot');
    elementSetAttribute(slot, 'name', 'header');
    expect(getSlotName(slot)).toBe('header');
  });
});

describe('Shadow DOM — assignSlots', () => {
  it('assigns light DOM children to the default slot', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });
    const slot = createMutableElement('slot');
    appendChild(shadow as any, slot);

    const child1 = createMutableTextNode('Hello');
    const child2 = createMutableTextNode(' World');
    appendChild(host, child1);
    appendChild(host, child2);

    assignSlots(shadow as MutableShadowRoot);

    const assigned = getAssignedNodes(slot);
    expect(assigned.length).toBe(2);
    expect(assigned[0]).toBe(child1);
    expect(assigned[1]).toBe(child2);
  });

  it('assigns named children to named slots', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });

    const headerSlot = createMutableElement('slot');
    elementSetAttribute(headerSlot, 'name', 'header');
    appendChild(shadow as any, headerSlot);

    const defaultSlot = createMutableElement('slot');
    appendChild(shadow as any, defaultSlot);

    const header = createMutableElement('h1');
    elementSetAttribute(header, 'slot', 'header');
    const body = createMutableElement('p');
    appendChild(host, header);
    appendChild(host, body);

    assignSlots(shadow as MutableShadowRoot);

    const headerAssigned = getAssignedNodes(headerSlot);
    expect(headerAssigned.length).toBe(1);
    expect(headerAssigned[0]).toBe(header);

    const defaultAssigned = getAssignedNodes(defaultSlot);
    expect(defaultAssigned.length).toBe(1);
    expect(defaultAssigned[0]).toBe(body);
  });

  it('unnamed children go to the default slot when no named slot matches', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });

    const namedSlot = createMutableElement('slot');
    elementSetAttribute(namedSlot, 'name', 'header');
    appendChild(shadow as any, namedSlot);

    const defaultSlot = createMutableElement('slot');
    appendChild(shadow as any, defaultSlot);

    // Child with no slot attribute
    const child = createMutableElement('p');
    appendChild(host, child);

    assignSlots(shadow as MutableShadowRoot);

    const namedAssigned = getAssignedNodes(namedSlot);
    expect(namedAssigned.length).toBe(0);

    const defaultAssigned = getAssignedNodes(defaultSlot);
    expect(defaultAssigned.length).toBe(1);
    expect(defaultAssigned[0]).toBe(child);
  });

  it('updates assignedSlot reference on elements', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });
    const slot = createMutableElement('slot');
    appendChild(shadow as any, slot);

    const child = createMutableElement('p');
    appendChild(host, child);

    assignSlots(shadow as MutableShadowRoot);

    expect((child as MutableElement)._assignedSlot).toBe(slot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAssignedNodes
// ─────────────────────────────────────────────────────────────────────────────

describe('Shadow DOM — getAssignedNodes', () => {
  it('returns empty array when not in a shadow tree', () => {
    const slot = createMutableElement('slot');
    expect(getAssignedNodes(slot)).toEqual([]);
  });

  it('returns assigned nodes after slot assignment', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });
    const slot = createMutableElement('slot');
    appendChild(shadow as any, slot);

    const child = createMutableElement('p');
    appendChild(host, child);

    assignSlots(shadow as MutableShadowRoot);
    expect(getAssignedNodes(slot).length).toBe(1);
  });

  it('flatten option recursively collects from nested slots', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });

    const outerSlot = createMutableElement('slot');
    appendChild(shadow as any, outerSlot);

    const innerSlot = createMutableElement('slot');
    appendChild(outerSlot, innerSlot);

    const child = createMutableElement('p');
    appendChild(host, child);

    assignSlots(shadow as MutableShadowRoot);

    // The child goes to the default slot (outerSlot)
    const flat = getAssignedNodes(outerSlot, { flatten: true });
    expect(flat.length).toBe(1);
    expect(flat[0]).toBe(child);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENT RETARGETING
// ─────────────────────────────────────────────────────────────────────────────

describe('Shadow DOM — retarget', () => {
  it('returns the node itself if in the same tree scope', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });
    const inner = createMutableElement('span');
    appendChild(shadow as any, inner);

    const result = retarget(host as unknown as HtmlNode, shadow as MutableShadowRoot);
    expect(result).toBe(host);
  });

  it('retargets child to host when child is in shadow tree', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });
    const inner = createMutableElement('span');
    appendChild(shadow as any, inner);

    const result = retarget(inner as unknown as HtmlNode, shadow as MutableShadowRoot);
    expect(result).toBe(host);
  });
});

describe('Shadow DOM — computeComposedPath', () => {
  it('returns single-item path for root-level event', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });

    const path = computeComposedPath(host as unknown as HtmlNode);
    expect(path.length).toBe(1);
    expect(path[0].target).toBe(host);
    expect(path[0].currentTarget).toBe(host);
  });

  it('retargets across one shadow boundary', () => {
    const doc = createMutableDocument();
    const host = createMutableElement('div');
    appendChild(doc, host);

    const shadow = attachShadow(host, { mode: 'open' });
    const inner = createMutableElement('span');
    appendChild(shadow as any, inner);

    const path = computeComposedPath(inner as unknown as HtmlNode);
    // Should have at least 2 entries: inner, then retargeted to host
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path[0].target).toBe(inner);
    expect(path[1].target).toBe(host);
  });

  it('retargets through nested shadow boundaries', () => {
    const doc = createMutableDocument();
    const host1 = createMutableElement('div');
    appendChild(doc, host1);

    const shadow1 = attachShadow(host1, { mode: 'open' });
    const host2 = createMutableElement('span');
    appendChild(shadow1 as any, host2);

    const shadow2 = attachShadow(host2, { mode: 'open' });
    const inner = createMutableElement('b');
    appendChild(shadow2 as any, inner);

    const path = computeComposedPath(inner as unknown as HtmlNode);
    // inner -> host2 (retarget through shadow2) -> host1 (retarget through shadow1)
    expect(path.length).toBeGreaterThanOrEqual(3);
    expect(path[0].target).toBe(inner);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SHADOW TREE CLONING
// ─────────────────────────────────────────────────────────────────────────────

describe('Shadow DOM — cloneShadowTree', () => {
  it('clones shadow tree from one host to another', () => {
    const source = createMutableElement('div');
    const sourceShadow = attachShadow(source, { mode: 'open' });
    const child1 = createMutableElement('span');
    const child2 = createMutableTextNode('text');
    appendChild(sourceShadow as any, child1);
    appendChild(sourceShadow as any, child2);

    const target = createMutableElement('div');
    cloneShadowTree(source, target);

    expect(target._shadowRoot).toBeDefined();
    expect(target._shadowRoot).not.toBeNull();
    expect(target._shadowRoot.mode).toBe('open');
    expect(target._shadowRoot.children.length).toBe(2);
  });

  it('preserves mode when cloning closed shadow tree', () => {
    const source = createMutableElement('div');
    attachShadow(source, { mode: 'closed' });
    const sourceShadow = source._shadowRoot;
    const child = createMutableElement('p');
    appendChild(sourceShadow as any, child);

    const target = createMutableElement('div');
    cloneShadowTree(source, target);

    expect(target._shadowRoot.mode).toBe('closed');
  });

  it('does nothing if source has no shadow root', () => {
    const source = createMutableElement('div');
    const target = createMutableElement('div');
    cloneShadowTree(source, target);

    expect(target._shadowRoot).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT INTERNALS
// ─────────────────────────────────────────────────────────────────────────────

describe('Shadow DOM — attachInternals', () => {
  it('attaches form-associated internals to an element', () => {
    const host = createMutableElement('custom-el');
    const internals = attachInternals(host);

    expect(internals).toBeDefined();
    expect(internals.shadowRoot).toBeNull();
    expect(internals.form).toBeNull();
    expect(internals.willValidate).toBe(false);
    expect(internals.constraintValidation).toBe(false);
    expect(host._internals).toBe(internals);
  });

  it('throws when attaching internals twice', () => {
    const host = createMutableElement('custom-el');
    attachInternals(host);
    expect(() => attachInternals(host)).toThrow('Element already has attached internals');
  });

  it('includes shadow root reference if present', () => {
    const host = createMutableElement('custom-el');
    const shadow = attachShadow(host, { mode: 'open' });
    const internals = attachInternals(host);

    expect(internals.shadowRoot).toBe(shadow);
  });

  it('checkValidity returns true by default', () => {
    const host = createMutableElement('custom-el');
    const internals = attachInternals(host);
    expect(internals.checkValidity()).toBe(true);
  });

  it('reportValidity returns true by default', () => {
    const host = createMutableElement('custom-el');
    const internals = attachInternals(host);
    expect(internals.reportValidity()).toBe(true);
  });

  it('validity object starts all-false', () => {
    const host = createMutableElement('custom-el');
    const internals = attachInternals(host);
    expect(internals.validity.valueMissing).toBe(false);
    expect(internals.validity.typeMismatch).toBe(false);
    expect(internals.validity.patternMismatch).toBe(false);
    expect(internals.validity.tooLong).toBe(false);
    expect(internals.validity.tooShort).toBe(false);
    expect(internals.validity.rangeUnderflow).toBe(false);
    expect(internals.validity.rangeOverflow).toBe(false);
    expect(internals.validity.stepMismatch).toBe(false);
    expect(internals.validity.customError).toBe(false);
    expect(internals.validity.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SHADOW DOM INTEGRATION WITH DOM
// ─────────────────────────────────────────────────────────────────────────────

describe('Shadow DOM — integration with DOM API', () => {
  it('shadow root is accessible from host._shadowRoot', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });
    expect(host._shadowRoot).toBe(shadow);
  });

  it('closed mode shadow root is still stored on host', () => {
    const host = createMutableElement('div');
    attachShadow(host, { mode: 'closed' });
    expect(host._shadowRoot).toBeDefined();
    expect(host._shadowRoot.mode).toBe('closed');
  });

  it('light DOM children are separate from shadow tree', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });

    const lightChild = createMutableElement('p');
    const shadowChild = createMutableElement('span');
    appendChild(host, lightChild);
    appendChild(shadow as any, shadowChild);

    expect(host.children.length).toBe(1);
    expect(host.children[0]).toBe(lightChild);

    expect(shadow.children.length).toBe(1);
    expect(shadow.children[0]).toBe(shadowChild);
  });

  it('mutations on shadow tree fire on shadow root, not host', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });

    let records: any[] = [];
    const obs = new MutationObserver((r: any[]) => { records = records.concat(r); });
    obs.observe(shadow as any, { childList: true });

    const child = createMutableElement('p');
    appendChild(shadow as any, child);
    deliverRecordsSync();

    expect(records.length).toBe(1);
    expect(records[0].addedNodes[0]).toBe(child);
    obs.disconnect();
  });

  it('cloneElement preserves shadow root reference', () => {
    const host = createMutableElement('div');
    attachShadow(host, { mode: 'open' });

    const clone = cloneElement(host as unknown as HtmlElement, false);
    expect(clone._shadowRoot).toBe(host._shadowRoot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SLOT CHANGE EVENTS
// ─────────────────────────────────────────────────────────────────────────────

describe('Shadow DOM — slot change tracking', () => {
  it('assignSlots is called when shadow tree is queried', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });
    const slot = createMutableElement('slot');
    appendChild(shadow as any, slot);

    const child = createMutableElement('p');
    appendChild(host, child);

    // getAssignedNodes should trigger slot assignment
    const assigned = getAssignedNodes(slot);
    expect(assigned.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPLEX SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

describe('Shadow DOM — complex scenarios', () => {
  it('multiple named slots with mixed content', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });

    const headerSlot = createMutableElement('slot');
    elementSetAttribute(headerSlot, 'name', 'header');
    const footerSlot = createMutableElement('slot');
    elementSetAttribute(footerSlot, 'name', 'footer');
    const defaultSlot = createMutableElement('slot');
    appendChild(shadow as any, headerSlot);
    appendChild(shadow as any, defaultSlot);
    appendChild(shadow as any, footerSlot);

    const header = createMutableElement('h1');
    elementSetAttribute(header, 'slot', 'header');
    const footer = createMutableElement('footer');
    elementSetAttribute(footer, 'slot', 'footer');
    const body1 = createMutableElement('p');
    const body2 = createMutableElement('p');

    appendChild(host, body1);
    appendChild(host, header);
    appendChild(host, body2);
    appendChild(host, footer);

    assignSlots(shadow as MutableShadowRoot);

    expect(getAssignedNodes(headerSlot).length).toBe(1);
    expect(getAssignedNodes(headerSlot)[0]).toBe(header);

    expect(getAssignedNodes(defaultSlot).length).toBe(2);
    expect(getAssignedNodes(defaultSlot)[0]).toBe(body1);
    expect(getAssignedNodes(defaultSlot)[1]).toBe(body2);

    expect(getAssignedNodes(footerSlot).length).toBe(1);
    expect(getAssignedNodes(footerSlot)[0]).toBe(footer);
  });

  it('empty host with shadow root', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });
    const slot = createMutableElement('slot');
    appendChild(shadow as any, slot);

    assignSlots(shadow as MutableShadowRoot);
    expect(getAssignedNodes(slot).length).toBe(0);
  });

  it('host with children but no slots in shadow tree', () => {
    const host = createMutableElement('div');
    const shadow = attachShadow(host, { mode: 'open' });
    const div = createMutableElement('div');
    appendChild(shadow as any, div);

    const child = createMutableElement('p');
    appendChild(host, child);

    assignSlots(shadow as MutableShadowRoot);
    // No slot elements, so default slot map is created but no nodes assigned
    expect(shadow._slotMap.has(DEFAULT_SLOT_NAME)).toBe(true);
  });

  it('deeply nested shadow trees work independently', () => {
    const outer = createMutableElement('outer');
    const outerShadow = attachShadow(outer, { mode: 'open' });
    const outerSlot = createMutableElement('slot');
    appendChild(outerShadow as any, outerSlot);

    const inner = createMutableElement('inner');
    appendChild(outerShadow as any, inner);
    const innerShadow = attachShadow(inner, { mode: 'open' });
    const innerSlot = createMutableElement('slot');
    appendChild(innerShadow as any, innerSlot);

    // Outer light DOM
    const outerChild = createMutableElement('p');
    appendChild(outer, outerChild);

    // Inner light DOM
    const innerChild = createMutableElement('span');
    appendChild(inner, innerChild);

    assignSlots(outerShadow as MutableShadowRoot);
    assignSlots(innerShadow as MutableShadowRoot);

    expect(getAssignedNodes(outerSlot).length).toBe(1);
    expect(getAssignedNodes(outerSlot)[0]).toBe(outerChild);

    expect(getAssignedNodes(innerSlot).length).toBe(1);
    expect(getAssignedNodes(innerSlot)[0]).toBe(innerChild);
  });
});
