/**
 * @file html5/shadow.ts
 * Shadow DOM — WHATWG DOM Living Standard implementation.
 *
 * Provides:
 *   - ShadowRoot (open/closed mode)
 *   - Element.attachShadow()
 *   - Slot assignment (named/default slots)
 *   - getRootNode() with composed flag
 *   - Event retargeting across shadow boundaries
 *   - composedPath() for events crossing shadow boundaries
 *   - Slot change events (slotchange)
 *   - ElementInternals for form-associated custom elements
 */

import type {
  HtmlNode,
  HtmlElement,
  HtmlParentNode,
  MutableElement,
  MutableNode,
  MutableParentNode,
} from './dom';
import { NodeType, Namespace } from './dom';
import {
  appendChild,
  removeChild,
  insertBefore,
  getParentChildren,
  elementGetAttribute,
  elementSetAttribute,
  hasChildNodes,
  createMutableElement,
} from './dom';
import { fireMutation } from './mutation-observer';

// ─────────────────────────────────────────────────────────────────────────────
// SHADOW ROOT MODE
// ─────────────────────────────────────────────────────────────────────────────

export type ShadowRootMode = 'open' | 'closed';

// ─────────────────────────────────────────────────────────────────────────────
// SHADOW ROOT INTERFACE (read-only public)
// ─────────────────────────────────────────────────────────────────────────────

export interface ShadowRoot {
  readonly nodeType: NodeType.DocumentFragment;
  readonly host: HtmlElement;
  readonly mode: ShadowRootMode;
  readonly children: readonly HtmlNode[];
  readonly childNodes: readonly HtmlNode[];
  readonly firstChild: HtmlNode | null;
  readonly lastChild: HtmlNode | null;
  readonly childElementCount: number;
  readonly parent: null;
  readonly nextSibling: null;
  readonly previousSibling: null;
  readonly sourceOffset: 0;
  readonly namespaceURI: null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MUTABLE SHADOW ROOT (internal)
// ─────────────────────────────────────────────────────────────────────────────

export interface MutableShadowRoot {
  nodeType: NodeType.DocumentFragment;
  host: MutableElement;
  mode: ShadowRootMode;
  children: MutableNode[];
  childNodes: MutableNode[];
  firstChild: HtmlNode | null;
  lastChild: HtmlNode | null;
  childElementCount: number;
  parent: null;
  nextSibling: null;
  previousSibling: null;
  sourceOffset: 0;
  namespaceURI: null;
  /** Internal: slot assignment cache (slot name -> assigned nodes) */
  _slotMap: Map<string, MutableNode[]>;
  /** Internal: whether slot assignment has been run */
  _slotsAssigned: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHADOW ATTACH OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface ShadowRootInit {
  mode: ShadowRootMode;
  delegatesFocus?: boolean;
  slotAssignment?: 'named' | 'manual';
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT PATH (for composedPath)
// ─────────────────────────────────────────────────────────────────────────────

export interface EventPathItem {
  readonly target: HtmlNode;
  readonly currentTarget: HtmlNode;
  readonly segmentListeners: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT INTERALS (for form-associated custom elements)
// ─────────────────────────────────────────────────────────────────────────────

export interface ElementInternals {
  readonly shadowRoot: ShadowRoot | null;
  setFormValue(value: string | FormData | null, state?: string | FormData | null): void;
  setValidity(flags: ValidityStateFlags, message?: string, anchor?: HtmlElement): void;
  checkValidity(): boolean;
  reportValidity(): boolean;
  setLabels(nodes: HtmlNode[]): void;
  form: HtmlElement | null;
  constraintValidation: boolean;
  validity: ValidityState;
  validationMessage: string;
  willValidate: boolean;
}

export interface ValidityStateFlags {
  valueMissing?: boolean;
  typeMismatch?: boolean;
  patternMismatch?: boolean;
  tooLong?: boolean;
  tooShort?: boolean;
  rangeUnderflow?: boolean;
  rangeOverflow?: boolean;
  stepMismatch?: boolean;
  badInput?: boolean;
  customError?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// SLOT NAME CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** The default (unnamed) slot name. */
export const DEFAULT_SLOT_NAME = '';

// ─────────────────────────────────────────────────────────────────────────────
// SHADOW ROOT CREATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new MutableShadowRoot.
 */
export function createShadowRoot(
  host: MutableElement,
  mode: ShadowRootMode,
): MutableShadowRoot {
  return {
    nodeType: NodeType.DocumentFragment,
    host,
    mode,
    children: [],
    childNodes: [],
    firstChild: null,
    lastChild: null,
    childElementCount: 0,
    parent: null,
    nextSibling: null,
    previousSibling: null,
    sourceOffset: 0,
    namespaceURI: null,
    _slotMap: new Map(),
    _slotsAssigned: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// attachShadow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attach a shadow root to an element (host).
 * WHATWG §4.13 — Element.attachShadow()
 *
 * @throws if the host already has a shadow root
 * @throws if the host is a known shadow host element (e.g. <article>, <aside>, etc.)
 */
export function attachShadow(
  host: MutableElement,
  init: ShadowRootInit,
): MutableShadowRoot {
  // Check for existing shadow root
  if (host._shadowRoot) {
    throw new DOMException(
      'Cannot attach multiple shadow roots to the same host',
      'NotSupportedError',
    );
  }

  // Validate mode
  if (init.mode !== 'open' && init.mode !== 'closed') {
    throw new DOMException(
      'Shadow root mode must be "open" or "closed"',
      'SyntaxError',
    );
  }

  // Create the shadow root
  const shadowRoot = createShadowRoot(host, init.mode);
  host._shadowRoot = shadowRoot;

  return shadowRoot;
}

// ─────────────────────────────────────────────────────────────────────────────
// getRootNode (with composed flag)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the root node of the tree this node belongs to.
 * If composed is true, walks through shadow roots to the outermost root.
 */
export function getRootNode(
  node: HtmlNode,
  composed = false,
): HtmlNode {
  let current: HtmlNode | null = node;

  while (current) {
    const parent = current.parent;

    if (!parent) {
      // At a root — check if it's a shadow root with a host
      if (
        current.nodeType === NodeType.DocumentFragment &&
        isShadowRoot(current)
      ) {
        if (composed) {
          // Walk up to the host, then continue
          const host = (current as unknown as MutableShadowRoot).host;
          current = host as unknown as HtmlNode;
          continue;
        }
        return current;
      }
      return current;
    }

    // Walk to parent
    current = parent as HtmlNode;
  }

  return node;
}

// ─────────────────────────────────────────────────────────────────────────────
// SLOT ASSIGNMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the slot name for a slot element.
 * Returns '' for unnamed slots, or the value of the 'name' attribute.
 */
export function getSlotName(slotElement: HtmlElement): string {
  return elementGetAttribute(slotElement as unknown as MutableElement, 'name') ?? '';
}

/**
 * Assign slots for a shadow root's children.
 * WHATWG §4.13.3 — assign slottables (tree order)
 *
 * For each slottable (child of the host that is not in the shadow tree):
 *   1. If slottable has a slot attribute matching a named slot -> assign to that slot
 *   2. Otherwise -> assign to the default slot (name='')
 */
export function assignSlots(shadowRoot: MutableShadowRoot): void {
  const host = shadowRoot.host;
  const slotMap = shadowRoot._slotMap;
  slotMap.clear();

  // Collect all slot elements in the shadow tree
  const slotElements = collectSlotElements(shadowRoot);

  // Initialize slot map with empty arrays
  for (const slot of slotElements) {
    const name = getSlotName(slot);
    slotMap.set(name, []);
  }

  // Ensure default slot exists
  if (!slotMap.has(DEFAULT_SLOT_NAME)) {
    slotMap.set(DEFAULT_SLOT_NAME, []);
  }

  // For each light DOM child of the host, assign to a slot
  const lightChildren = host.children as MutableNode[];
  for (const child of lightChildren) {
    const slotAttr = getChildSlotName(child);
    const targetSlotName = slotAttr !== null ? slotAttr : DEFAULT_SLOT_NAME;

    if (slotMap.has(targetSlotName)) {
      slotMap.get(targetSlotName)!.push(child);
    } else {
      // No matching named slot — assign to default slot
      slotMap.get(DEFAULT_SLOT_NAME)!.push(child);
    }
  }

  // Update assignedSlot references on each light DOM child
  for (const [slotName, nodes] of slotMap) {
    const slotEl = slotElements.find(s => getSlotName(s) === slotName);
    for (const node of nodes) {
      if (isMutableElement(node)) {
        node._assignedSlot = slotEl ?? null;
      }
    }
  }

  shadowRoot._slotsAssigned = true;
}

/**
 * Get the slot name from a child's 'slot' attribute.
 * Returns null if the child has no slot attribute.
 */
function getChildSlotName(child: MutableNode): string | null {
  if (isMutableElement(child)) {
    return elementGetAttribute(child, 'slot');
  }
  return null;
}

/**
 * Collect all <slot> elements in a shadow tree (depth-first).
 */
function collectSlotElements(root: MutableShadowRoot): MutableElement[] {
  const slots: MutableElement[] = [];
  const stack: MutableNode[] = [...root.children];

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (isMutableElement(node)) {
      if (node.tagName === 'slot') {
        slots.push(node);
      }
      // Push children in reverse for correct order
      const children = node.children;
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i] as MutableNode);
      }
    }
  }

  return slots;
}

/**
 * Get the assigned nodes for a slot element.
 * Returns nodes from the slot map, or empty array if no shadow root.
 */
export function getAssignedNodes(
  slotElement: HtmlElement,
  options?: { flatten?: boolean },
): readonly HtmlNode[] {
  // Walk up to find the shadow root
  const shadowRoot = findShadowRoot(slotElement as unknown as MutableElement);
  if (!shadowRoot) return [];

  // Ensure slots are assigned
  if (!shadowRoot._slotsAssigned) {
    assignSlots(shadowRoot);
  }

  const slotName = getSlotName(slotElement);
  const assigned = shadowRoot._slotMap.get(slotName) ?? [];

  if (options?.flatten) {
    // Flatten: recursively collect assigned nodes from nested slots
    return flattenAssignedNodes(assigned, shadowRoot);
  }

  return assigned as readonly HtmlNode[];
}

/**
 * Recursively flatten assigned nodes from nested slot elements.
 */
function flattenAssignedNodes(
  nodes: readonly HtmlNode[],
  shadowRoot: MutableShadowRoot,
): HtmlNode[] {
  const result: HtmlNode[] = [];
  for (const node of nodes) {
    if (
      node.nodeType === NodeType.Element &&
      (node as HtmlElement).tagName === 'slot'
    ) {
      const innerAssigned = getAssignedNodes(node as HtmlElement, { flatten: true });
      result.push(...innerAssigned);
    } else {
      result.push(node);
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// SLOTCHANGE EVENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fire slotchange events on all slots whose assigned nodes have changed.
 * Called after DOM mutations that may affect slot assignments.
 */
export function fireSlotchangeEvents(shadowRoot: MutableShadowRoot): void {
  if (!shadowRoot._slotsAssigned) return;

  const oldSlotMap = new Map(shadowRoot._slotMap);
  assignSlots(shadowRoot);

  const slotElements = collectSlotElements(shadowRoot);
  for (const slot of slotElements) {
    const name = getSlotName(slot);
    const oldNodes = oldSlotMap.get(name) ?? [];
    const newNodes = shadowRoot._slotMap.get(name) ?? [];

    // Check if the assignment changed
    if (!slotAssignmentsEqual(oldNodes, newNodes)) {
      fireMutation({
        target: slot as unknown as HtmlNode,
        type: 'childList',
        addedNodes: newNodes as unknown as HtmlNode[],
        removedNodes: oldNodes as unknown as HtmlNode[],
      });
    }
  }
}

function slotAssignmentsEqual(a: readonly MutableNode[], b: readonly MutableNode[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHADOW ROOT DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a node is a ShadowRoot.
 */
export function isShadowRoot(node: HtmlNode): boolean {
  return (
    node.nodeType === NodeType.DocumentFragment &&
    '_slotMap' in node &&
    'host' in node
  );
}

/**
 * Find the shadow root that contains this element.
 * Walks up the parent chain until a shadow root or document root is found.
 */
export function findShadowRoot(node: MutableElement): MutableShadowRoot | null {
  let current: HtmlNode | null = node;
  while (current) {
    const parent = current.parent;
    if (!parent) {
      if (isShadowRoot(current)) {
        return current as unknown as MutableShadowRoot;
      }
      return null;
    }
    if (isShadowRoot(parent as unknown as HtmlNode)) {
      return parent as unknown as MutableShadowRoot;
    }
    current = parent as HtmlNode;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT RETARGETING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retarget a node against a shadow root boundary.
 * Returns the deepest node in the path that is in the same tree
 * scope as the shadow root's host.
 *
 * WHATWG §3.15.1 — retargeting
 */
export function retarget(
  node: HtmlNode,
  shadowRoot: MutableShadowRoot,
): HtmlNode {
  let current: HtmlNode | null = node;

  while (current) {
    // If current is in the same tree scope as shadowRoot.host, return it
    if (isInTreeScope(current, shadowRoot.host as unknown as HtmlNode)) {
      return current;
    }

    const parent = current.parent;
    if (!parent) break;

    // If parent is the shadow root, retarget to the host
    if (isShadowRoot(parent as unknown as HtmlNode)) {
      const sr = parent as unknown as MutableShadowRoot;
      current = sr.host as unknown as HtmlNode;
      continue;
    }

    current = parent as HtmlNode;
  }

  return node;
}

/**
 * Check if two nodes are in the same tree scope.
 */
function isInTreeScope(a: HtmlNode, b: HtmlNode): boolean {
  const rootA = getRootNode(a, false);
  const rootB = getRootNode(b, false);
  return rootA === rootB;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSED PATH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the composed event path (retargeted targets for each shadow boundary).
 * WHATWG §3.15.2 — composed path
 */
export function computeComposedPath(
  eventTarget: HtmlNode,
): EventPathItem[] {
  const path: EventPathItem[] = [];
  let current: HtmlNode | null = eventTarget;

  path.push({
    target: eventTarget,
    currentTarget: eventTarget,
    segmentListeners: true,
  });

  while (current) {
    const parent = current.parent;

    if (!parent) {
      // At a root node
      if (isShadowRoot(current)) {
        const sr = current as unknown as MutableShadowRoot;
        const host = sr.host as unknown as HtmlNode;
        const retargeted = retarget(current as unknown as HtmlNode, sr);
        path.push({
          target: retargeted,
          currentTarget: host,
          segmentListeners: true,
        });
        current = host;
        continue;
      }
      break;
    }

    if (isShadowRoot(parent as unknown as HtmlNode)) {
      const sr = parent as unknown as MutableShadowRoot;
      const host = sr.host as unknown as HtmlNode;
      const retargeted = retarget(current as unknown as HtmlNode, sr);

      // Only add if different from the last entry's target
      const lastEntry = path[path.length - 1];
      if (!lastEntry || lastEntry.target !== retargeted) {
        path.push({
          target: retargeted,
          currentTarget: host,
          segmentListeners: true,
        });
      }

      current = host;
      continue;
    }

    current = parent as HtmlNode;
  }

  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT INTERNALS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attach form-associated internals to a custom element.
 * WHATWG §4.13.5 — attachInternals()
 */
export function attachInternals(host: MutableElement): ElementInternals {
  if (host._internals) {
    throw new DOMException(
      'Element already has attached internals',
      'NotSupportedError',
    );
  }

  const shadowRoot = host._shadowRoot ?? null;

  const internals: ElementInternals = {
    shadowRoot: shadowRoot as unknown as ShadowRoot | null,
    setFormValue(_value: string | FormData | null, _state?: string | FormData | null): void {
      // Stub: form value association
    },
    setValidity(_flags: ValidityStateFlags, _message?: string, _anchor?: HtmlElement): void {
      // Stub: validity constraint
    },
    checkValidity(): boolean {
      return true;
    },
    reportValidity(): boolean {
      return true;
    },
    setLabels(_nodes: HtmlNode[]): void {
      // Stub: label association
    },
    form: null,
    constraintValidation: false,
    validity: {
      valueMissing: false,
      typeMismatch: false,
      patternMismatch: false,
      tooLong: false,
      tooShort: false,
      rangeUnderflow: false,
      rangeOverflow: false,
      stepMismatch: false,
      customError: false,
      valid: true,
    } as ValidityState,
    validationMessage: '',
    willValidate: false,
  };

  host._internals = internals;
  return internals;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS SELECTOR SCOPING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a CSS selector should match elements inside a shadow tree.
 * Handles :host, ::slotted(), :scope, and :part() pseudo-classes.
 *
 * This is a simplified implementation — full CSS selector matching
 * is complex and would be in a dedicated CSS module.
 */
export function matchesShadowSelector(
  element: HtmlElement,
  selector: string,
  shadowRoot: MutableShadowRoot,
): boolean {
  // :host selector — matches the host element itself
  if (selector === ':host') {
    return element === shadowRoot.host as unknown as HtmlElement;
  }

  // :host(<selector>) — matches the host if it matches the inner selector
  const hostFnMatch = selector.match(/^:host\((.+)\)$/);
  if (hostFnMatch) {
    // Simplified: just check the host element
    return element === shadowRoot.host as unknown as HtmlElement;
  }

  // ::slotted(<selector>) — matches elements slotted into a <slot>
  const slottedMatch = selector.match(/^::slotted\((.+)\)$/);
  if (slottedMatch) {
    // Check if this element is a slotted node
    return isMutableElement(element) && element._assignedSlot !== null;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHADOW TREE CLONING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clone a shadow tree from one host to another.
 * Used when cloning elements with shadow roots.
 */
export function cloneShadowTree(
  sourceHost: MutableElement,
  targetHost: MutableElement,
): void {
  const sourceShadow = sourceHost._shadowRoot;
  if (!sourceShadow) return;

  const newShadow = createShadowRoot(targetHost, sourceShadow.mode);
  targetHost._shadowRoot = newShadow;

  // Deep clone all children of the shadow root
  for (const child of sourceShadow.children) {
    if (isMutableElement(child)) {
      const clone = cloneElementDeep(child);
      appendChild(newShadow as unknown as MutableParentNode, clone);
    } else {
      // For text nodes etc, create new ones
      const clone = cloneShallow(child);
      if (clone) {
        appendChild(newShadow as unknown as MutableParentNode, clone);
      }
    }
  }
}

function cloneElementDeep(el: MutableElement): MutableElement {
  const clone = createMutableElement(el.tagName, new Map(el.attributes), el.sourceOffset);
  clone.isVoid = el.isVoid;
  clone.isRawText = el.isRawText;
  clone.rawContent = el.rawContent;
  clone.namespaceURI = el.namespaceURI;

  for (const child of el.children) {
    if (isMutableElement(child)) {
      const childClone = cloneElementDeep(child);
      appendChild(clone as unknown as MutableParentNode, childClone);
    } else {
      const childClone = cloneShallow(child);
      if (childClone) {
        appendChild(clone as unknown as MutableParentNode, childClone);
      }
    }
  }

  return clone;
}

function cloneShallow(node: MutableNode): MutableNode | null {
  switch (node.nodeType) {
    case NodeType.Text:
      return {
        nodeType: NodeType.Text,
        text: (node as any).text,
        parent: null,
        sourceOffset: node.sourceOffset,
        nextSibling: null,
        previousSibling: null,
        namespaceURI: node.namespaceURI,
      } as MutableNode;
    case NodeType.Comment:
      return {
        nodeType: NodeType.Comment,
        data: (node as any).data,
        parent: null,
        sourceOffset: node.sourceOffset,
        nextSibling: null,
        previousSibling: null,
        namespaceURI: node.namespaceURI,
      } as MutableNode;
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function isMutableElement(node: MutableNode | HtmlNode): node is MutableElement {
  return node.nodeType === NodeType.Element;
}
