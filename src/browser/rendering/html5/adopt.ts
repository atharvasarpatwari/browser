/**
 * @file html5/adopt.ts
 * Adoption Agency Algorithm (§13.2.6.4 step 4.1+).
 *
 * Handles misnested formatting like <b><i></b></i>.
 * The algorithm restructures both the stack of open elements and
 * the list of active formatting elements to produce the correct tree.
 */

import type { Token } from '../html5-tokenizer';
import type { HtmlElement, HtmlNode } from './dom';
import { cloneElement } from './dom';
import { OpenElements } from './stack';
import { ActiveFormattingElements } from './formatting';
import { SPECIAL_ELEMENTS, MARKER } from './constants';

type FormattingEntry = HtmlElement | typeof MARKER;

/**
 * Run the adoption agency algorithm for formatting end tags.
 * Steps follow the WHATWG spec exactly (steps 1–19).
 */
export function adoptionAgencyAlgorithm(
  token: Token,
  openElements: OpenElements,
  formattingElements: ActiveFormattingElements,
  currentNode: () => HtmlElement,
  parseError: (token: Token) => void,
): void {
  const subject = token.tagName!;

  // Step 2: If current node matches subject and is NOT in the active
  // formatting elements list, just pop it and return.
  const cn = currentNode();
  if (cn && cn.tagName === subject && !formattingElements.has(subject)) {
    openElements.pop();
    return;
  }

  // Step 3
  let outerLoopCounter = 0;

  // Step 4: Outer loop (up to 8 iterations)
  while (outerLoopCounter < 8) {
    outerLoopCounter++;

    // Step 4.3: Find the last formatting element with matching tag name
    let formattingElement: HtmlElement | null = null;
    let formattingIdx = -1;
    const fmtArray = formattingElements.array;
    for (let i = fmtArray.length - 1; i >= 0; i--) {
      const entry = fmtArray[i];
      if (entry === MARKER) break;
      if ((entry as HtmlElement).tagName === subject) {
        formattingElement = entry as HtmlElement;
        formattingIdx = i;
        break;
      }
    }

    // Step 4.4: If not found → parse error, return
    if (!formattingElement) {
      parseError(token);
      return;
    }

    // Step 4.5: If not in open elements → remove from formatting list,
    // parse error, return
    if (!openElements.containsElement(formattingElement)) {
      formattingElements.remove(formattingElement);
      parseError(token);
      return;
    }

    // Step 4.6: If not in scope → parse error, return
    if (!openElements.isInScope(subject)) {
      parseError(token);
      return;
    }

    // Step 4.7: If not current node → parse error (continue)
    if (currentNode() !== formattingElement) {
      parseError(token);
    }

    // Step 4.8: Find the furthest block — the topmost node in the stack
    // above formattingElement that is a special element
    const fmtStackIdx = openElements.indexOf(formattingElement);
    let furthestBlock: HtmlElement | null = null;
    let furthestBlockStackIdx = -1;
    for (let i = openElements.length - 1; i > fmtStackIdx; i--) {
      if (SPECIAL_ELEMENTS.has(openElements.elementAt(i).tagName)) {
        furthestBlock = openElements.elementAt(i);
        furthestBlockStackIdx = i;
        break;
      }
    }

    // Step 4.9: No furthest block — pop everything up to and including
    // formattingElement, remove from formatting list
    if (!furthestBlock) {
      openElements.popUntilElement(formattingElement);
      formattingElements.remove(formattingElement);
      return;
    }

    // Step 4.10: commonAncestor is the element immediately above formattingElement
    const commonAncestor =
      fmtStackIdx > 0 ? openElements.elementAt(fmtStackIdx - 1) : null;

    // Step 4.11: Bookmark the position of formattingElement in the formatting list
    let bookmark = formattingIdx;

    // Step 4.12: lastNode starts as furthestBlock
    let lastNode: HtmlElement = furthestBlock;

    // Step 4.13: Inner loop — walk down from furthestBlock toward formattingElement
    let innerLoopCounter = 0;
    let nodeStackIdx = furthestBlockStackIdx;
    const entries = fmtArray as FormattingEntry[];

    while (true) {
      innerLoopCounter++;

      // 4.13.2: Let node be the element immediately above the current position
      nodeStackIdx--;
      const node = openElements.elementAt(nodeStackIdx);

      // 4.13.3: If node is formattingElement, break the inner loop
      if (node === formattingElement) break;

      // 4.13.4: If innerLoopCounter > 3 and node is in formatting list, remove it
      if (innerLoopCounter > 3) {
        const idx = formattingElements.indexOf(node);
        if (idx >= 0) {
          formattingElements.remove(node);
          if (bookmark > idx) bookmark--;
        }
      }

      // 4.13.5: If node is not in the formatting list, remove from stack
      // and continue
      if (!formattingElements.hasElement(node)) {
        openElements.remove(node);
        continue;
      }

      // 4.13.6: Clone node, replace in both lists
      const clone = cloneElement(node) as unknown as HtmlElement;

      // Replace in stack (direct array access — internal module)
      const stackArr = openElements.array as HtmlElement[];
      stackArr[nodeStackIdx] = clone;

      // Replace in formatting list
      const fmtIdx = formattingElements.indexOf(node);
      if (fmtIdx >= 0) {
        entries[fmtIdx] = clone;
      }

      // 4.13.7: If lastNode was furthestBlock, move bookmark after the clone
      if (lastNode === furthestBlock) {
        const cloneFmtIdx = formattingElements.indexOf(clone);
        if (cloneFmtIdx >= 0) bookmark = cloneFmtIdx + 1;
      }

      // 4.13.8: Append lastNode as a child of node (the clone)
      (clone as any as HtmlElement).children;
      (clone as any).children = (clone as any).children ?? [];
      (clone.children as HtmlNode[]).push(lastNode);
      (lastNode as any).parent = clone;

      // 4.13.9: lastNode = node (the clone)
      lastNode = clone;
    }

    // Step 4.14: Insert lastNode into commonAncestor as a child
    if (commonAncestor && lastNode !== furthestBlock) {
      if (lastNode.parent) {
        const parentChildren = (lastNode.parent as any).children as HtmlNode[];
        const idx = parentChildren.indexOf(lastNode);
        if (idx >= 0) parentChildren.splice(idx, 1);
      }
      (commonAncestor as any).children.push(lastNode);
      (lastNode as any).parent = commonAncestor;
    }

    // Step 4.15: Create a new element (clone of formattingElement)
    const newElement = cloneElement(formattingElement) as unknown as HtmlElement;

    // Step 4.16: Move all children of furthestBlock to the new element
    const furthestChildren = [...(furthestBlock as any).children] as HtmlNode[];
    (furthestBlock as any).children.length = 0;
    for (const child of furthestChildren) {
      (child as any).parent = newElement;
      (newElement as any).children.push(child);
    }

    // Step 4.17: Append the new element to furthestBlock
    (furthestBlock as any).children.push(newElement);
    (newElement as any).parent = furthestBlock;

    // Step 4.18: Replace formattingElement with newElement in formatting list
    // at the bookmark position
    formattingElements.remove(formattingElement);
    const newBookmark = Math.min(bookmark, formattingElements.length);
    entries.splice(newBookmark, 0, newElement);

    // Step 4.19: Remove formattingElement from stack, insert newElement
    // immediately after furthestBlock
    openElements.remove(formattingElement);

    // Insert newElement after furthestBlock by popping down to furthestBlock,
    // pushing newElement, then restoring the popped elements.
    const poppedElements: HtmlElement[] = [];
    while (openElements.currentNode() !== furthestBlock) {
      poppedElements.push(openElements.pop()!);
    }
    openElements.push(newElement);
    for (let i = poppedElements.length - 1; i >= 0; i--) {
      openElements.push(poppedElements[i]);
    }
  }
}
