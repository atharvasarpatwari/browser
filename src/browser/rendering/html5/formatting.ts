/**
 * @file html5/formatting.ts
 * Active Formatting Elements list (§13.2.6.4)
 *
 * Maintains the list of active formatting elements (<a>, <b>, <i>, etc.)
 * used by the adoption agency algorithm and reconstruction.
 */

import type { HtmlElement, MutableElement } from './dom';
import { cloneElement, appendChild } from './dom';
import { MARKER, FORMATTING_ELEMENTS } from './constants';

type FormattingEntry = HtmlElement | typeof MARKER;

export class ActiveFormattingElements {
  private entries: FormattingEntry[] = [];

  /**
   * Push a formatting element onto the list.
   * If the last 3 entries (before this one) have the same tag name and
   * identical attributes, remove the oldest to enforce the "at most 3"
   * rule (§13.2.6.4 step 4).
   */
  push(el: HtmlElement): void {
    const count = this.entries.length;
    if (count >= 3) {
      let same = 0;
      for (let i = count - 1; i >= count - 3; i--) {
        const entry = this.entries[i];
        if (
          entry !== MARKER &&
          (entry as HtmlElement).tagName === el.tagName &&
          attrsEqual((entry as HtmlElement).attributes, el.attributes)
        ) {
          same++;
        } else {
          break;
        }
      }
      if (same === 3) {
        // Remove the oldest of the matching three
        const removeIdx = count - 3;
        this.entries.splice(removeIdx, 1);
      }
    }
    this.entries.push(el);
  }

  remove(el: HtmlElement): void {
    const idx = this.entries.indexOf(el);
    if (idx >= 0) this.entries.splice(idx, 1);
  }

  /** Remove the last entry with the given tag name (stopping at markers). */
  removeLast(tagName: string): void {
    const lower = tagName.toLowerCase();
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry === MARKER) break;
      if ((entry as HtmlElement).tagName === lower) {
        this.entries.splice(i, 1);
        return;
      }
    }
  }

  /** Check if a tag name exists in the list (stopping at markers). */
  has(tagName: string): boolean {
    const lower = tagName.toLowerCase();
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry === MARKER) return false;
      if ((entry as HtmlElement).tagName === lower) return true;
    }
    return false;
  }

  /** Check if a specific element is in the list (stopping at markers). */
  hasElement(el: HtmlElement): boolean {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry === MARKER) return false;
      if (entry === el) return true;
    }
    return false;
  }

  indexOf(el: HtmlElement): number {
    return this.entries.indexOf(el);
  }

  /** Pop all entries from the end until (and including) the last marker. */
  clearUpToMarker(): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      this.entries.pop();
      if (entry === MARKER) break;
    }
  }

  clear(): void {
    this.entries.length = 0;
  }

  pushMarker(): void {
    this.entries.push(MARKER);
  }

  get length(): number {
    return this.entries.length;
  }

  get last(): HtmlElement | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry !== MARKER) return entry as HtmlElement;
    }
    return null;
  }

  /** Get the raw entries array (for iteration). */
  get array(): readonly FormattingEntry[] {
    return this.entries;
  }

  /**
   * Reconstruct the active formatting elements (§13.2.6.4).
   *
   * Walks backwards from the end to find the first entry that is either:
   *   - a marker, or
   *   - an element in the stack of open elements
   *
   * Then walks forward from that point, cloning each element and pushing
   * both the clone and a fresh open element onto their respective structures.
   */
  reconstruct(
    openElementsContains: (el: HtmlElement) => boolean,
    createAndInsert: (el: HtmlElement) => HtmlElement,
  ): void {
    if (this.entries.length === 0) return;

    // Find the first entry that doesn't need reconstruction
    let entry: FormattingEntry | undefined;
    let needReconstruction = false;

    for (let i = this.entries.length - 1; i >= 0; i--) {
      entry = this.entries[i];
      if (entry === MARKER) {
        needReconstruction = true;
        break;
      }
      if (!openElementsContains(entry as HtmlElement)) {
        needReconstruction = true;
        break;
      }
      // Entry is in the stack, no reconstruction needed
      return;
    }

    if (!needReconstruction) return;

    // Start from the entry after the marker/not-in-stack entry
    const startIdx = entry === MARKER
      ? this.entries.length - 1
      : this.entries.indexOf(entry!) + 1;

    for (let i = startIdx; i < this.entries.length; i++) {
      const entry2 = this.entries[i];
      if (entry2 === MARKER) continue;
      const original = entry2 as HtmlElement;
      const clone = cloneElement(original) as unknown as HtmlElement;
      this.entries[i] = clone;
      const newEl = createAndInsert(clone);
      this.entries[i] = newEl;
    }
  }
}

/** Compare two ReadonlyMaps for equality. */
function attrsEqual(
  a: ReadonlyMap<string, string>,
  b: ReadonlyMap<string, string>,
): boolean {
  if (a.size !== b.size) return false;
  let equal = true;
  a.forEach((val, key) => {
    if (equal && b.get(key) !== val) equal = false;
  });
  return equal;
}
