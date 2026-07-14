/**
 * @file html5/stack.ts
 * Stack of Open Elements (§13.2.6.1)
 *
 * The stack is used to determine where newly parsed elements are inserted
 * and for scope/ button-scope / table-scope / list-item-scope checks.
 */

import type { HtmlElement, HtmlNode, MutableElement } from './dom';
import {
  SCOPING_ELEMENTS,
  SPECIAL_ELEMENTS,
} from './constants';

export class OpenElements {
  private elements: HtmlElement[] = [];

  push(el: HtmlElement): void {
    this.elements.push(el);
  }

  pop(): HtmlElement {
    return this.elements.pop()!;
  }

  currentNode(): HtmlElement | null {
    return this.elements.length > 0
      ? this.elements[this.elements.length - 1]
      : null;
  }

  /** Returns the element at the given index. */
  elementAt(index: number): HtmlElement {
    return this.elements[index];
  }

  contains(tagName: string): boolean {
    const lower = tagName.toLowerCase();
    for (let i = this.elements.length - 1; i >= 0; i--) {
      if (this.elements[i].tagName === lower) return true;
    }
    return false;
  }

  containsElement(el: HtmlElement): boolean {
    return this.elements.indexOf(el) >= 0;
  }

  indexOf(el: HtmlElement): number {
    return this.elements.indexOf(el);
  }

  remove(el: HtmlElement): void {
    const idx = this.elements.indexOf(el);
    if (idx >= 0) this.elements.splice(idx, 1);
  }

  clear(): void {
    this.elements.length = 0;
  }

  popUntil(tagName: string): void {
    const lower = tagName.toLowerCase();
    while (this.elements.length > 0) {
      const el = this.elements[this.elements.length - 1];
      this.elements.pop();
      if (el.tagName === lower) break;
    }
  }

  popUntilElement(el: HtmlElement): void {
    while (this.elements.length > 0) {
      const top = this.elements[this.elements.length - 1];
      this.elements.pop();
      if (top === el) break;
    }
  }

  get length(): number {
    return this.elements.length;
  }

  /** Returns a shallow copy of the elements array. */
  get array(): readonly HtmlElement[] {
    return this.elements;
  }

  // ─────────────────────────────────────────────────────────────────────
  // SCOPE ALGORITHMS  (§13.2.6.1)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Has an element in scope.
   * Walks backwards; stops at scoping elements, html, table, template.
   */
  isInScope(tagName: string): boolean {
    const lower = tagName.toLowerCase();
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (el.tagName === lower) return true;
      if (
        SCOPING_ELEMENTS.has(el.tagName) ||
        el.tagName === 'html' ||
        el.tagName === 'table' ||
        el.tagName === 'template'
      ) {
        return false;
      }
    }
    return false;
  }

  /**
   * Has an element in button scope.
   * Like isInScope but also stops at 'button'.
   */
  isInButtonScope(tagName: string): boolean {
    const lower = tagName.toLowerCase();
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (el.tagName === lower) return true;
      if (
        SCOPING_ELEMENTS.has(el.tagName) ||
        el.tagName === 'button' ||
        el.tagName === 'html' ||
        el.tagName === 'table' ||
        el.tagName === 'template'
      ) {
        return false;
      }
    }
    return false;
  }

  /**
   * Has an element in list item scope.
   * Like isInScope but also stops at 'ol' and 'ul'.
   */
  isInListItemScope(tagName: string): boolean {
    const lower = tagName.toLowerCase();
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (el.tagName === lower) return true;
      if (
        SCOPING_ELEMENTS.has(el.tagName) ||
        el.tagName === 'ol' ||
        el.tagName === 'ul' ||
        el.tagName === 'html' ||
        el.tagName === 'table' ||
        el.tagName === 'template'
      ) {
        return false;
      }
    }
    return false;
  }

  /**
   * Has an element in table scope.
   * Only stops at html, template, table.
   */
  isInTableScope(tagName: string): boolean {
    const lower = tagName.toLowerCase();
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (el.tagName === lower) return true;
      if (
        el.tagName === 'html' ||
        el.tagName === 'template' ||
        el.tagName === 'table'
      ) {
        return false;
      }
    }
    return false;
  }

  /**
   * Has an element in select scope.
   * Only stops at html, template, select.
   */
  isInSelectScope(tagName: string): boolean {
    const lower = tagName.toLowerCase();
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (el.tagName === lower) return true;
      if (
        el.tagName === 'html' ||
        el.tagName === 'template' ||
        el.tagName === 'select'
      ) {
        return false;
      }
    }
    return false;
  }

  /**
   * Has an element in template scope.
   * Only stops at html, template.
   */
  isInTemplateScope(tagName: string): boolean {
    const lower = tagName.toLowerCase();
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (el.tagName === lower) return true;
      if (el.tagName === 'html' || el.tagName === 'template') {
        return false;
      }
    }
    return false;
  }
}
