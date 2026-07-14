/**
 * @file html5/implied.ts
 * Implied end tags (§13.2.6.3).
 *
 * When certain end tags are missing, the parser implicitly closes
 * elements that cannot legally contain the new content.
 */

import { IMPLIED_END_TAG_ELEMENTS, THOROUGH_IMPLIED_END_TAG_ELEMENTS } from './constants';
import { OpenElements } from './stack';

/**
 * Generate implied end tags (§13.2.6.3).
 * Closes dd, dt, li, optgroup, option, p, rb, rp, rt, rtc elements
 * that are on top of the stack, stopping when the except tag is found.
 */
export function generateImpliedEndTags(
  openElements: OpenElements,
  except?: string,
): void {
  while (
    openElements.currentNode() &&
    IMPLIED_END_TAG_ELEMENTS.has(openElements.currentNode()!.tagName) &&
    openElements.currentNode()!.tagName !== except
  ) {
    openElements.pop();
  }
}

/**
 * Generate implied end tags thoroughly (for template content).
 * Also closes caption, colgroup, tbody, td, tfoot, th, thead, tr.
 */
export function generateImpliedEndTagsThoroughly(
  openElements: OpenElements,
  except?: string,
): void {
  while (
    openElements.currentNode() &&
    THOROUGH_IMPLIED_END_TAG_ELEMENTS.has(openElements.currentNode()!.tagName) &&
    openElements.currentNode()!.tagName !== except
  ) {
    openElements.pop();
  }
}
