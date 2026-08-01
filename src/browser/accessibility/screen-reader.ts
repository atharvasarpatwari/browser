import type { IDisposable } from '../../app/dependency-container';

export type AriaRole =
  | 'button' | 'link' | 'heading' | 'textbox' | 'img'
  | 'list' | 'listitem' | 'region' | 'navigation' | 'search'
  | 'main' | 'complementary' | 'banner' | 'contentinfo'
  | 'form' | 'table' | 'grid' | 'dialog' | 'alert'
  | 'status' | 'timer' | 'progressbar' | 'slider' | 'tab'
  | 'tabpanel' | 'tablist' | 'tree' | 'treeitem' | 'combobox'
  | 'listbox' | 'option' | 'menu' | 'menuitem' | 'menubar'
  | 'none' | 'presentation' | 'application' | 'article'
  | 'figure' | 'checkbox' | 'radio' | 'switch' | 'tooltip';

export type A11yState =
  | 'disabled' | 'focused' | 'expanded' | 'collapsed'
  | 'selected' | 'checked' | 'unchecked' | 'pressed'
  | 'busy' | 'invalid' | 'required' | 'readonly'
  | 'multiline' | 'hidden' | 'visited';

export interface AccessibleNode {
  id: string;
  role: AriaRole;
  name: string;
  description: string;
  value: string;
  states: Set<A11yState>;
  children: AccessibleNode[];
  parent: AccessibleNode | null;
  tagName: string;
  hidden: boolean;
}

export interface A11yEvent {
  readonly kind: 'focusChanged' | 'announcement' | 'treeUpdated' | 'stateChanged';
  readonly elementId?: string;
  readonly role?: AriaRole;
  readonly text?: string;
  readonly priority?: 'polite' | 'assertive';
}

export type A11yEventHandler = (event: A11yEvent) => void;

export interface IScreenReaderManager extends IDisposable {
  isEnabled(): boolean;
  enable(): void;
  disable(): void;
  announce(text: string, priority?: 'polite' | 'assertive'): void;
  setFocus(elementId: string): void;
  getFocus(): string | undefined;
  buildTree(root: A11yDomNode): AccessibleNode;
  getNode(elementId: string): AccessibleNode | undefined;
  onEvent(handler: A11yEventHandler): () => void;
  getIdForElement(el: A11yDomElement): string;
}

export interface A11yDomNode {
  domId: string;
  nodeType: string;
  parent: A11yDomNode | null;
  children: A11yDomNode[];
}

export interface A11yDomElement extends A11yDomNode {
  nodeType: 'element';
  tagName: string;
  attributes: ReadonlyMap<string, string>;
}

export function isA11yElement(n: A11yDomNode): n is A11yDomElement {
  return n.nodeType === 'element' && 'tagName' in n && 'attributes' in n;
}

export const TAG_ROLE_MAP: Record<string, AriaRole> = Object.freeze({
  a: 'link',
  button: 'button',
  input: 'textbox',
  textarea: 'textbox',
  select: 'listbox',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  img: 'img',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  nav: 'navigation',
  main: 'main',
  aside: 'complementary',
  header: 'banner',
  footer: 'contentinfo',
  form: 'form',
  table: 'table',
  dialog: 'dialog',
  menu: 'menu',
  article: 'article',
  figure: 'figure',
  section: 'region',
  search: 'search',
});

export function implicitRole(tagName: string): AriaRole {
  return TAG_ROLE_MAP[tagName.toLowerCase()] ?? 'none';
}

export function explicitRole(attributes: ReadonlyMap<string, string>): AriaRole | null {
  const role = attributes.get('role');
  if (!role) return null;
  const VALID_ROLES: Set<string> = new Set([
    'button', 'link', 'heading', 'textbox', 'img',
    'list', 'listitem', 'region', 'navigation', 'search',
    'main', 'complementary', 'banner', 'contentinfo',
    'form', 'table', 'grid', 'dialog', 'alert',
    'status', 'timer', 'progressbar', 'slider', 'tab',
    'tabpanel', 'tablist', 'tree', 'treeitem', 'combobox',
    'listbox', 'option', 'menu', 'menuitem', 'menubar',
    'none', 'presentation', 'application', 'article',
    'figure', 'checkbox', 'radio', 'switch', 'tooltip',
  ]);
  const r = role.trim().toLowerCase();
  return VALID_ROLES.has(r) ? (r as AriaRole) : null;
}

export function resolvedRole(attributes: ReadonlyMap<string, string>, tagName: string): AriaRole {
  return explicitRole(attributes) ?? implicitRole(tagName);
}

function getAttr(attributes: ReadonlyMap<string, string> | undefined, name: string): string | undefined {
  return attributes?.get(name) ?? undefined;
}

export function computeAccessibleName(
  attributes: ReadonlyMap<string, string>,
): string {
  return getAttr(attributes, 'aria-label')
    ?? getAttr(attributes, 'aria-labelledby')
    ?? getAttr(attributes, 'title')
    ?? getAttr(attributes, 'alt')
    ?? '';
}

export function computeAccessibleDescription(
  attributes: ReadonlyMap<string, string>,
): string {
  return getAttr(attributes, 'aria-description')
    ?? getAttr(attributes, 'aria-describedby')
    ?? '';
}

export function computeValue(attributes: ReadonlyMap<string, string>): string {
  return getAttr(attributes, 'aria-valuetext')
    ?? getAttr(attributes, 'value')
    ?? getAttr(attributes, 'aria-valuenow')
    ?? '';
}

export function computeStates(
  attributes: ReadonlyMap<string, string>,
  _role: AriaRole,
): Set<A11yState> {
  const states = new Set<A11yState>();

  if (attributes.get('disabled') !== undefined || attributes.get('aria-disabled') === 'true') {
    states.add('disabled');
  }
  if (attributes.get('hidden') !== undefined || attributes.get('aria-hidden') === 'true') {
    states.add('hidden');
  }

  const expanded = attributes.get('aria-expanded');
  if (expanded === 'true') states.add('expanded');
  else if (expanded === 'false') states.add('collapsed');

  if (attributes.get('aria-selected') === 'true') states.add('selected');

  const pressed = attributes.get('aria-pressed');
  if (pressed === 'true') states.add('pressed');

  const checked = attributes.get('aria-checked');
  if (checked === 'true') states.add('checked');
  else if (checked === 'false') states.add('unchecked');

  if (attributes.get('aria-busy') === 'true') states.add('busy');
  if (attributes.get('aria-invalid') === 'true') states.add('invalid');
  if (attributes.get('aria-required') === 'true' || attributes.get('required') !== undefined) {
    states.add('required');
  }
  if (attributes.get('aria-readonly') === 'true' || attributes.get('readonly') !== undefined) {
    states.add('readonly');
  }
  if (attributes.get('aria-multiline') === 'true') states.add('multiline');
  if (attributes.get('aria-visited') === 'true') states.add('visited');

  return states;
}

export function computeHidden(attributes: ReadonlyMap<string, string>): boolean {
  return attributes.get('hidden') !== undefined
    || attributes.get('aria-hidden') === 'true';
}

export function buildAccessibleNode(
  domNode: A11yDomNode,
  parent: AccessibleNode | null,
): AccessibleNode | null {
  if (!isA11yElement(domNode)) {
    if (domNode.nodeType === 'text') {
      return {
        id: domNode.domId,
        role: 'none',
        name: '',
        description: '',
        value: '',
        states: new Set(),
        children: [],
        parent,
        tagName: '#text',
        hidden: false,
      };
    }
    return null;
  }

  const el = domNode as A11yDomElement;
  const attr = el.attributes;
  const role = resolvedRole(attr, el.tagName);
  const name = computeAccessibleName(attr);
  const hidden = computeHidden(attr);

  const node: AccessibleNode = {
    id: el.domId,
    role,
    name,
    description: computeAccessibleDescription(attr),
    value: computeValue(attr),
    states: computeStates(attr, role),
    children: [],
    parent,
    tagName: el.tagName.toLowerCase(),
    hidden,
  };

  for (const child of el.children) {
    const childNode = buildAccessibleNode(child, node);
    if (childNode) {
      node.children.push(childNode);
    }
  }

  return node;
}

export function buildAccessibilityTree(root: A11yDomNode): AccessibleNode | null {
  return buildAccessibleNode(root, null);
}

export function createScreenReaderManager(): IScreenReaderManager {
  let enabled = true;
  let focusedElementId: string | undefined;
  const nodeMap = new Map<string, AccessibleNode>();
  const handlers = new Set<A11yEventHandler>();

  function emit(event: A11yEvent): void {
    for (const h of handlers) {
      try { h(event); } catch { }
    }
  }

  return {
    isEnabled(): boolean { return enabled; },

    enable(): void { enabled = true; },

    disable(): void { enabled = false; },

    announce(text: string, priority: 'polite' | 'assertive' = 'polite'): void {
      if (!enabled) return;
      if (!text) return;
      emit({ kind: 'announcement', text, priority });
    },

    setFocus(elementId: string): void {
      if (!enabled) return;
      const prev = focusedElementId;
      focusedElementId = elementId;
      emit({ kind: 'focusChanged', elementId });
      if (prev !== elementId) {
        const node = nodeMap.get(elementId);
        if (node) {
          this.announce(node.name || node.role || elementId, 'assertive');
        }
      }
    },

    getFocus(): string | undefined {
      return focusedElementId;
    },

    buildTree(root: A11yDomNode): AccessibleNode {
      nodeMap.clear();
      const tree = buildAccessibilityTree(root) ?? {
        id: root.domId,
        role: 'none' as AriaRole,
        name: '',
        description: '',
        value: '',
        states: new Set<A11yState>(),
        children: [],
        parent: null,
        tagName: '#document',
        hidden: false,
      };
      indexNodes(tree);
      emit({ kind: 'treeUpdated' });
      return tree;
    },

    getNode(elementId: string): AccessibleNode | undefined {
      return nodeMap.get(elementId);
    },

    onEvent(handler: A11yEventHandler): () => void {
      handlers.add(handler);
      return () => { handlers.delete(handler); };
    },

    getIdForElement(el: A11yDomElement): string {
      return el.domId;
    },

    dispose(): void {
      handlers.clear();
      nodeMap.clear();
      focusedElementId = undefined;
      enabled = false;
    },
  };

  function indexNodes(node: AccessibleNode): void {
    nodeMap.set(node.id, node);
    for (const child of node.children) {
      indexNodes(child);
    }
  }
}

export type { IDisposable };
