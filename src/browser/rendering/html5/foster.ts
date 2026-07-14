/**
 * @file html5/foster.ts
 * Foster Parenting (§13.2.6 — "appropriate place for inserting").
 *
 * When content appears inside table context elements where it doesn't
 * belong, it must be "foster parented" — inserted before/after the table
 * rather than inside the table structure.
 *
 * The spec defines a fallback chain:
 *   1. Last template in stack  → insert inside template contents
 *   2. No table in stack       → insert inside first element (html)
 *   3. Table has a parent      → insert BEFORE the table
 *   4. Table has no parent     → insert inside the element above table
 */

import type { HtmlElement, HtmlNode } from './dom';
import { FOSTER_PARENT_CONTEXT, Im } from './constants';
import { OpenElements } from './stack';

/**
 * Determine if foster parenting is currently active.
 * Only active when insertion mode is IN_TABLE or IN_TABLE_TEXT
 * and the current node is in FOSTER_PARENT_CONTEXT.
 */
export function shouldFosterParent(
  openElements: OpenElements,
  insertionMode: Im,
): boolean {
  if (insertionMode !== Im.IN_TABLE && insertionMode !== Im.IN_TABLE_TEXT) {
    return false;
  }
  const cn = openElements.currentNode();
  if (!cn) return false;
  return FOSTER_PARENT_CONTEXT.has(cn.tagName);
}

/**
 * Find the foster parent target (parent element + optional "before" node).
 * Fallback chain per spec:
 * 1. Last template in stack → insert inside template contents
 * 2. No table in stack → insert inside first element (html)
 * 3. Table has a parent → insert BEFORE the table
 * 4. Table has no parent → insert inside the element above table
 */
export function getFosterParentTarget(
  openElements: OpenElements,
): { parent: HtmlElement; before: HtmlNode | null } | null {
  const stack = openElements.array;

  // Find last template in the stack
  let lastTemplate: HtmlElement | null = null;
  let lastTemplateIdx = -1;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].tagName === 'template') {
      lastTemplate = stack[i];
      lastTemplateIdx = i;
      break;
    }
  }

  // Find last table in the stack
  let lastTable: HtmlElement | null = null;
  let lastTableIdx = -1;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].tagName === 'table') {
      lastTable = stack[i];
      lastTableIdx = i;
      break;
    }
  }

  // Fallback 1: If there's a template and it's above (or there's no) table,
  // insert inside the template's template contents
  if (lastTemplate && (!lastTable || lastTemplateIdx > lastTableIdx)) {
    return { parent: lastTemplate, before: null };
  }

  // Fallback 2: No table in stack — insert inside the html element
  if (!lastTable) {
    const html = stack[0];
    if (html) return { parent: html, before: null };
    return null;
  }

  // Fallback 3: Table has a parent — insert BEFORE the table
  if (lastTable.parent) {
    const parent = lastTable.parent as HtmlElement;
    return { parent, before: lastTable };
  }

  // Fallback 4: Table has no parent — insert inside the element above table
  if (lastTableIdx > 0) {
    return { parent: stack[lastTableIdx - 1], before: null };
  }

  // Last resort: insert inside the first element
  return { parent: stack[0], before: null };
}

/**
 * Foster parent a node — insert it at the foster parent location.
 * Handles both before-insert and append modes.
 */
export function fosterParent(
  node: HtmlNode,
  openElements: OpenElements,
): void {
  const target = getFosterParentTarget(openElements);
  if (!target) return;

  const parentEl = target.parent;
  const children = (parentEl as any).children as HtmlNode[];

  if (target.before) {
    const idx = children.indexOf(target.before);
    if (idx >= 0) {
      children.splice(idx, 0, node);
    } else {
      children.push(node);
    }
  } else {
    children.push(node);
  }

  (node as any).parent = parentEl;
}
