/**
 * @file html5/foreign.ts
 * Namespace support + Foreign Content (§13.2.6).
 *
 * Handles tokens when the tree builder is processing content inside
 * MathML or SVG foreign elements. Includes tag/attribute name adjustments
 * for SVG and integration point checks for MathML.
 */

import type { Token } from '../html5-tokenizer';
import type { HtmlElement } from './dom';
import { Namespace } from './dom';
import {
  SPECIAL_ELEMENTS,
  MATHML_TEXT_INTEGRATION_POINTS,
  HTML_INTEGRATION_POINTS,
  SVG_TAG_ADJUSTMENTS,
  SVG_ATTR_ADJUSTMENTS,
  Im,
} from './constants';
import { OpenElements } from './stack';

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callbacks that the tree builder provides so that foreign content
 * processing can interact with the parser state.
 */
export interface ForeignContentContext {
  openElements: OpenElements;
  currentNode: () => HtmlElement;
  popCurrentNode: () => HtmlElement;
  insertElement: (token: Token) => HtmlElement;
  insertForeignElement: (token: Token, namespace: Namespace) => HtmlElement;
  insertCharacter: (text: string, offset: number) => void;
  reprocessInBody: (token: Token) => void;
  parseError: (token: Token) => void;
  resetInsertionMode: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT-LEVEL CHECKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if the current node is in the MathML or SVG namespace
 * (i.e., is a "foreign content" element).
 */
export function isForeignContent(el: HtmlElement): boolean {
  return (
    el.namespaceURI === Namespace.SVG ||
    el.namespaceURI === Namespace.MathML
  );
}

/**
 * Check if an element is a MathML text integration point.
 * Per spec: mi, mo, mn, ms, mtext
 */
export function isMathMLTextIntegrationPoint(el: HtmlElement): boolean {
  return (
    el.namespaceURI === Namespace.MathML &&
    MATHML_TEXT_INTEGRATION_POINTS.has(el.tagName)
  );
}

/**
 * Check if an element is an HTML integration point (inside MathML/SVG).
 * Per spec: annotation-xml with encoding=text/html or application/xhtml+xml,
 * or any MathML/SVG element that is an HTML integration point.
 */
export function isHTMLIntegrationPoint(el: HtmlElement): boolean {
  if (el.namespaceURI === Namespace.SVG || el.namespaceURI === Namespace.MathML) {
    if (HTML_INTEGRATION_POINTS.has(el.tagName)) {
      // For annotation-xml, check encoding attribute
      if (el.tagName === 'annotation-xml') {
        const encoding = el.getAttribute('encoding') ?? '';
        const lower = encoding.toLowerCase();
        return lower === 'text/html' || lower === 'application/xhtml+xml';
      }
      return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG ADJUSTMENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adjust tag name for SVG elements.
 * Converts lowercase names to their proper camelCase SVG equivalents.
 */
export function adjustSVGTagName(tagName: string): string {
  return SVG_TAG_ADJUSTMENTS.get(tagName) ?? tagName;
}

/**
 * Adjust attribute names for SVG elements.
 * Converts lowercase names to their proper camelCase SVG equivalents.
 */
export function adjustSVGAttributeName(attrName: string): string {
  return SVG_ATTR_ADJUSTMENTS.get(attrName) ?? attrName;
}

// ─────────────────────────────────────────────────────────────────────────────
// FOREIGN CONTENT TOKEN PROCESSING  (§13.2.6)
// ─────────────────────────────────────────────────────────────────────────────

/** Tags that, in foreign content, get treated as if they were HTML. */
const HTML_INFOREIGN_TAGS: ReadonlySet<string> = new Set<string>([
  'b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div',
  'dl', 'dt', 'em', 'embed', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head',
  'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol', 'p',
  'pre', 'ruby', 's', 'small', 'span', 'strike', 'strong', 'sub', 'sup',
  'table', 'u', 'ul', 'var',
]);

/** End tags that are parse errors and ignored in foreign content. */
const IGNORED_END_TAGS: ReadonlySet<string> = new Set<string>([
  'body', 'caption', 'col', 'colgroup', 'html', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr',
]);

/**
 * Process a token when in foreign content (§13.2.6).
 * Handles namespace-appropriate processing of start/end tags
 * and text within SVG/MathML.
 */
export function processInForeignContent(
  token: Token,
  ctx: ForeignContentContext,
): void {
  switch (token.kind) {
    case 'open':
      processForeignStartTag(token, ctx);
      break;
    case 'close':
      processForeignEndTag(token, ctx);
      break;
    case 'text':
      processForeignCharacter(token, ctx);
      break;
    case 'comment':
      // Comments are always inserted into the current node regardless of namespace.
      break;
    default:
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// START TAG IN FOREIGN CONTENT
// ─────────────────────────────────────────────────────────────────────────────

function processForeignStartTag(
  token: Token,
  ctx: ForeignContentContext,
): void {
  const cn = ctx.currentNode();
  const tag = token.tagName!;

  // Rule 1: Current node is MathML and tag is a MathML text integration point
  if (
    cn.namespaceURI === Namespace.MathML &&
    MATHML_TEXT_INTEGRATION_POINTS.has(tag)
  ) {
    ctx.reprocessInBody(token);
    return;
  }

  // Rule 2: Current node is MathML and tag is mglyph or malignmark
  if (
    cn.namespaceURI === Namespace.MathML &&
    (tag === 'mglyph' || tag === 'malignmark')
  ) {
    ctx.reprocessInBody(token);
    return;
  }

  // Rule 3: Current node is an HTML integration point
  if (isHTMLIntegrationPoint(cn)) {
    ctx.reprocessInBody(token);
    return;
  }

  // Rule 4: Tag is one of the HTML-like tags → adjust SVG, insert foreign element
  if (HTML_INFOREIGN_TAGS.has(tag)) {
    if (cn.namespaceURI === Namespace.SVG) {
      adjustTokenForSVG(token);
    }
    ctx.insertForeignElement(token, cn.namespaceURI!);
    return;
  }

  // Rule 5: Any other start tag → insert a foreign element
  if (cn.namespaceURI === Namespace.SVG) {
    adjustTokenForSVG(token);
  }
  ctx.insertForeignElement(token, cn.namespaceURI!);
}

// ─────────────────────────────────────────────────────────────────────────────
// END TAG IN FOREIGN CONTENT
// ─────────────────────────────────────────────────────────────────────────────

function processForeignEndTag(
  token: Token,
  ctx: ForeignContentContext,
): void {
  const cn = ctx.currentNode();
  const tag = token.tagName!;

  // Rule 1: If current node matches tag name and is not in HTML namespace →
  // pop elements until we leave foreign content, then reprocess.
  if (cn.tagName === tag && cn.namespaceURI !== Namespace.HTML) {
    ctx.popCurrentNode();
    while (
      ctx.currentNode() &&
      isForeignContent(ctx.currentNode())
    ) {
      ctx.popCurrentNode();
    }
    ctx.resetInsertionMode();
    // The caller will reprocess the token with the new insertion mode.
    return;
  }

  // Rule 2: Certain end tags are parse errors and ignored
  if (IGNORED_END_TAGS.has(tag)) {
    ctx.parseError(token);
    return;
  }

  // Rule 3: Any other end tag → pop elements until a foreign element
  // boundary is found, then reprocess
  let current = ctx.currentNode();
  while (current && isForeignContent(current)) {
    if (current.tagName === tag) {
      ctx.popCurrentNode();
      while (ctx.currentNode() && isForeignContent(ctx.currentNode())) {
        ctx.popCurrentNode();
      }
      ctx.resetInsertionMode();
      return;
    }
    ctx.popCurrentNode();
    current = ctx.currentNode();
  }
  // Reprocess in the appropriate (now non-foreign) insertion mode
}

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTER TOKEN IN FOREIGN CONTENT
// ─────────────────────────────────────────────────────────────────────────────

function processForeignCharacter(
  token: Token,
  ctx: ForeignContentContext,
): void {
  const cn = ctx.currentNode();

  // If current node is a MathML text integration point or HTML integration
  // point → process using in-body rules
  if (isMathMLTextIntegrationPoint(cn) || isHTMLIntegrationPoint(cn)) {
    ctx.reprocessInBody(token);
    return;
  }

  // Otherwise → insert the character, replacing any U+0000 NULL with U+FFFD
  let text = token.data ?? '';
  if (text.indexOf('\0') >= 0) {
    text = text.replace(/\0/g, '\uFFFD');
  }
  if (text) {
    ctx.insertCharacter(text, token.offset);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG TOKEN ADJUSTMENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adjust a token's tag name and attributes for SVG namespace.
 * Adjusts tag name and all attribute names per the SVG adjustment tables.
 */
function adjustTokenForSVG(token: Token): void {
  if (token.tagName) {
    token.tagName = adjustSVGTagName(token.tagName);
  }
  if (token.attrs) {
    const adjusted = new Map<string, string>();
    token.attrs.forEach((value, key) => {
      adjusted.set(adjustSVGAttributeName(key), value);
    });
    token.attrs = adjusted;
  }
}
