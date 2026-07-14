/**
 * @file html5/insert.ts
 * Element insertion, text node merging, attribute handling, and
 * comment/doctype insertion utilities for the HTML5 tree builder.
 *
 * These functions encapsulate the common "appropriate place for inserting a
 * node" logic described in WHATWG §13.2.6 and are called by the tree builder's
 * insertion mode handlers.
 */

import type { Token } from '../html5-tokenizer';
import type {
  HtmlElement,
  HtmlNode,
  MutableElement,
  MutableTextNode,
  MutableComment,
  MutableDoctype,
  MutableCdata,
  HtmlParentNode,
} from './dom';
import {
  NodeType,
  Namespace,
  createMutableElement,
  createMutableTextNode,
  createMutableComment,
  createMutableDoctype,
  createMutableCdata,
  appendChild,
  insertBefore,
} from './dom';
import { OpenElements } from './stack';
import { ActiveFormattingElements } from './formatting';
import {
  VOID_ELEMENTS,
  RAW_TEXT_ELEMENTS,
  FOSTER_PARENT_CONTEXT,
  Im,
  SVG_TAG_ADJUSTMENTS,
  SVG_ATTR_ADJUSTMENTS,
} from './constants';

// ─────────────────────────────────────────────────────────────────────────────
// INSERTION CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tree context needed for insertion operations. The tree builder provides
 * this object so insertion functions can operate without direct access to
 * the tree builder's internal state.
 */
interface InsertContext {
  openElements: OpenElements;
  formattingElements: ActiveFormattingElements;
  insertionMode: Im;
  currentNode(): HtmlElement | null;
  shouldFosterParent(): boolean;
  fosterParent(node: HtmlNode): void;
  getAttributeFromToken(token: Token, name: string): string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT INSERTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert an HTML element from a token.
 * Handles namespace assignment, attribute copying, foster parenting,
 * pushing to open elements stack, and setting void/rawText flags.
 */
export function insertHTMLElement(
  ctx: InsertContext,
  token: Token,
  ns: Namespace = Namespace.HTML,
): HtmlElement {
  const tag  = token.tagName!;
  const attrs = token.attrs ?? new Map<string, string>();

  const el = createMutableElement(tag, attrs, token.offset);
  el.namespaceURI = ns;
  setElementFlags(el);

  if (ctx.shouldFosterParent()) {
    ctx.fosterParent(el as unknown as HtmlNode);
  } else {
    appendToCurrentNode(ctx.openElements, el as unknown as HtmlNode);
  }

  ctx.openElements.push(el as unknown as HtmlElement);
  return el as unknown as HtmlElement;
}

/**
 * Insert a foreign element (SVG/MathML) from a token.
 * Same as insertHTMLElement but applies SVG tag name and attribute
 * adjustments and uses the explicit namespace.
 */
export function insertForeignElement(
  ctx: InsertContext,
  token: Token,
  ns: Namespace,
): HtmlElement {
  const tag  = token.tagName!;
  const attrs = token.attrs ?? new Map<string, string>();

  const el = createMutableElement(tag, attrs, token.offset);
  el.namespaceURI = ns;

  if (ns === Namespace.SVG) {
    const adjusted = SVG_TAG_ADJUSTMENTS.get(el.tagName);
    if (adjusted) el.tagName = adjusted;
  }

  setElementFlags(el);
  adjustAttributes(token, ns);

  if (ctx.shouldFosterParent()) {
    ctx.fosterParent(el as unknown as HtmlNode);
  } else {
    appendToCurrentNode(ctx.openElements, el as unknown as HtmlNode);
  }

  ctx.openElements.push(el as unknown as HtmlElement);
  return el as unknown as HtmlElement;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXT INSERTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert or merge a text node from a token.
 * If the last child of the current node is a text node, merge text into it.
 * Otherwise create a new text node.
 * Handles foster parenting for text in table context.
 */
export function insertText(ctx: InsertContext, token: Token): void {
  const text = token.data ?? '';
  if (!text) return;

  const current = ctx.currentNode();
  if (!current) return;

  if (ctx.shouldFosterParent()) {
    const textNode = createMutableTextNode(text, token.offset);
    ctx.fosterParent(textNode as unknown as HtmlNode);
    return;
  }

  const lastChild = current.children.length > 0
    ? current.children[current.children.length - 1]
    : null;

  if (lastChild && lastChild.nodeType === NodeType.Text) {
    (lastChild as unknown as { text: string }).text += text;
  } else {
    const textNode = createMutableTextNode(text, token.offset);
    appendChild(current as unknown as HtmlParentNode, textNode as unknown as HtmlNode);
  }
}

/**
 * Insert raw text directly (not from a token).
 * Same merging behavior as insertText but accepts a plain string.
 */
export function insertCharacter(ctx: InsertContext, text: string): void {
  if (!text) return;

  const current = ctx.currentNode();
  if (!current) return;

  if (ctx.shouldFosterParent()) {
    const textNode = createMutableTextNode(text);
    ctx.fosterParent(textNode as unknown as HtmlNode);
    return;
  }

  const lastChild = current.children.length > 0
    ? current.children[current.children.length - 1]
    : null;

  if (lastChild && lastChild.nodeType === NodeType.Text) {
    (lastChild as unknown as { text: string }).text += text;
  } else {
    const textNode = createMutableTextNode(text);
    appendChild(current as unknown as HtmlParentNode, textNode as unknown as HtmlNode);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMENT INSERTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert a comment node.
 * Handles foster parenting for comments in table context.
 */
export function insertComment(ctx: InsertContext, token: Token): void {
  const comment = createMutableComment(token.data ?? '', token.offset);

  if (ctx.shouldFosterParent()) {
    ctx.fosterParent(comment as unknown as HtmlNode);
  } else {
    appendToCurrentNode(ctx.openElements, comment as unknown as HtmlNode);
  }
}

/**
 * Insert a comment before the last template or table in the open elements
 * stack. Used in inTableBody, inRow, inCell modes when foster-parent-like
 * placement is needed for a comment.
 */
export function insertCommentBeforeOpenElements(
  ctx: InsertContext,
  token: Token,
): void {
  const comment = createMutableComment(token.data ?? '', token.offset);

  // Find last template
  let lastTemplate: HtmlElement | null = null;
  let lastTemplateIdx = -1;
  for (let i = ctx.openElements.length - 1; i >= 0; i--) {
    const el = ctx.openElements.elementAt(i);
    if (el.tagName === 'template') {
      lastTemplate = el;
      lastTemplateIdx = i;
      break;
    }
  }

  // Find last table
  let lastTable: HtmlElement | null = null;
  let lastTableIdx = -1;
  for (let i = ctx.openElements.length - 1; i >= 0; i--) {
    const el = ctx.openElements.elementAt(i);
    if (el.tagName === 'table') {
      lastTable = el;
      lastTableIdx = i;
      break;
    }
  }

  // If template is higher than table (or there's no table), insert in template
  if (lastTemplate && (!lastTable || lastTemplateIdx > lastTableIdx)) {
    appendChild(
      lastTemplate as unknown as HtmlParentNode,
      comment as unknown as HtmlNode,
    );
    return;
  }

  // No table in stack — insert inside the html element
  if (!lastTable) {
    const html = ctx.openElements.elementAt(0);
    if (html) {
      appendChild(html as unknown as HtmlParentNode, comment as unknown as HtmlNode);
    }
    return;
  }

  // Table has a parent — insert BEFORE the table
  if (lastTable.parent) {
    insertBefore(
      lastTable.parent as HtmlParentNode,
      comment as unknown as HtmlNode,
      lastTable as unknown as HtmlNode,
    );
    return;
  }

  // Table has no parent — insert inside the element above it in the stack
  if (lastTableIdx > 0) {
    const above = ctx.openElements.elementAt(lastTableIdx - 1);
    appendChild(above as unknown as HtmlParentNode, comment as unknown as HtmlNode);
    return;
  }

  // Fallback: insert in the first element on the stack
  const first = ctx.openElements.elementAt(0);
  if (first) {
    appendChild(first as unknown as HtmlParentNode, comment as unknown as HtmlNode);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCTYPE / CDATA INSERTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert a doctype node.
 */
export function insertDoctype(ctx: InsertContext, token: Token): void {
  const doctype = createMutableDoctype(
    (token.tagName ?? 'html').toLowerCase(),
    token.data?.split(/\s+/)[1] ?? '',
    token.data?.split(/\s+/)[2] ?? '',
    token.offset,
  );

  const current = ctx.currentNode();
  if (current) {
    appendChild(
      current as unknown as HtmlParentNode,
      doctype as unknown as HtmlNode,
    );
  }
}

/**
 * Insert a CDATA section node.
 */
export function insertCdata(ctx: InsertContext, token: Token): void {
  const cdata = createMutableCdata(token.data ?? '', token.offset);

  const current = ctx.currentNode();
  if (current) {
    appendChild(
      current as unknown as HtmlParentNode,
      cdata as unknown as HtmlNode,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT CREATION (without tree insertion)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an element for a token without inserting into the tree.
 * The caller is responsible for appending to the current node and pushing
 * onto the open elements stack.
 */
export function createElementForToken(
  token: Token,
  ns: Namespace = Namespace.HTML,
): MutableElement {
  const tag   = token.tagName!;
  const attrs = token.attrs ?? new Map<string, string>();

  const el = createMutableElement(tag, attrs, token.offset);
  el.namespaceURI = ns;

  if (ns === Namespace.SVG) {
    const adjusted = SVG_TAG_ADJUSTMENTS.get(el.tagName);
    if (adjusted) el.tagName = adjusted;
  }

  setElementFlags(el);
  return el;
}

// ─────────────────────────────────────────────────────────────────────────────
// APPEND / FLAGS / ATTRIBUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append a node to the current node on the open elements stack.
 */
export function appendToCurrentNode(
  openElements: OpenElements,
  node: HtmlNode,
): void {
  const current = openElements.currentNode();
  if (current) {
    appendChild(current as unknown as HtmlParentNode, node);
  }
}

/**
 * Set element flags based on tag name (isVoid, isRawText).
 */
export function setElementFlags(el: MutableElement): void {
  el.isVoid    = VOID_ELEMENTS.has(el.tagName);
  el.isRawText = RAW_TEXT_ELEMENTS.has(el.tagName);
}

/**
 * Lowercase and adjust attribute names for the given namespace.
 * For SVG elements, applies the SVG attribute name adjustments defined in
 * the WHATWG spec (e.g., `viewbox` → `viewBox`).
 * Modifies the token's attrs map in place.
 */
export function adjustAttributes(token: Token, ns: Namespace): void {
  if (ns !== Namespace.SVG) return;

  const attrs = token.attrs;
  if (!attrs) return;

  const adjusted = new Map<string, string>();
  attrs.forEach((value, name) => {
    const adjustedName = SVG_ATTR_ADJUSTMENTS.get(name) ?? name;
    adjusted.set(adjustedName, value);
  });
  token.attrs = adjusted;
}
