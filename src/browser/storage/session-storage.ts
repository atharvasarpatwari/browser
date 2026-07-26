/**
 * @file src/browser/storage/session-storage.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * WHATWG Web Storage API (§ 10) — per-tab, per-origin key-value storage.
 * https://html.spec.whatwg.org/multipage/webstorage.html#session-storage
 *
 * • sessionStorage is scoped to a single tab / browsing context.
 * • Data does NOT persist across sessions (in-memory only).
 * • Cloned on navigation: same-origin page loads inherit the data.
 * • Maximum 5 MiB per origin (same limit as localStorage).
 * • Keys and values are always strings.
 * • No StorageEvent (only fires on other contexts for localStorage).
 *
 * OOP PRINCIPLES
 * ──────────────
 *  Abstraction      Same IStorage interface as localStorage.
 *  Encapsulation    Tab ID + origin are private; only the public API is exposed.
 *  Single-Resp.     This file implements only sessionStorage.
 *  Open / Closed    New storage types are separate implementations.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IStorage } from './local-storage';
import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MAX_STORAGE_BYTES = 5 * 1024 * 1024;
const MAX_KEY_LENGTH = 1024;
const MAX_VALUE_LENGTH = 4 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// SESSION STORAGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implementation of the `sessionStorage` global.
 * Per WHATWG Web Storage § 10 — scoped to a browsing context (tab).
 */
export class NovaSessionStorage implements IStorage, IDisposable {
  private data = new Map<string, string>();
  private readonly origin: string;
  private readonly tabId: string;

  constructor(origin: string, tabId?: string) {
    this.origin = origin;
    this.tabId = tabId ?? `tab-${Math.random().toString(36).slice(2, 10)}`;
  }

  /** Get the unique tab ID this storage is scoped to. */
  getTabId(): string {
    return this.tabId;
  }

  // ── WHATWG Web Storage § 9.1.1 — length ────────────────────────────

  get length(): number {
    return this.data.size;
  }

  // ── WHATWG Web Storage § 9.1.2 — key() ─────────────────────────────

  key(index: number): string | null {
    if (index < 0 || index >= this.data.size) return null;
    const keys = [...this.data.keys()];
    return keys[index] ?? null;
  }

  // ── WHATWG Web Storage § 9.1.3 — getItem() ─────────────────────────

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  // ── WHATWG Web Storage § 9.1.4 — setItem() ─────────────────────────

  setItem(key: string, value: string): void {
    const stringValue = String(value);

    if (key.length > MAX_KEY_LENGTH) {
      throw new DOMException(
        `Key length exceeds maximum of ${MAX_KEY_LENGTH} characters`,
        'QuotaExceededError',
      );
    }

    if (stringValue.length > MAX_VALUE_LENGTH) {
      throw new DOMException(
        `Value length exceeds maximum of ${MAX_VALUE_LENGTH} characters`,
        'QuotaExceededError',
      );
    }

    const oldSize = this.data.has(key) ? this.measureEntry(key, this.data.get(key)!) : 0;
    const newSize = this.measureEntry(key, stringValue);
    const currentSize = this.estimateSize() - oldSize + newSize;

    if (currentSize > MAX_STORAGE_BYTES) {
      throw new DOMException(
        'QuotaExceededError: storage limit reached',
        'QuotaExceededError',
      );
    }

    this.data.set(key, stringValue);
  }

  // ── WHATWG Web Storage § 9.1.5 — removeItem() ──────────────────────

  removeItem(key: string): void {
    this.data.delete(key);
  }

  // ── WHATWG Web Storage § 9.1.6 — clear() ───────────────────────────

  clear(): void {
    this.data.clear();
  }

  // ── Clone for navigation (WHATWG § 10.2 step 5) ───────────────────

  /** Clone all data to a new SessionStorage for a same-origin navigation. */
  clone(): NovaSessionStorage {
    const cloned = new NovaSessionStorage(this.origin, this.tabId);
    for (const [k, v] of this.data) {
      cloned.data.set(k, v);
    }
    return cloned;
  }

  // ── IDisposable ─────────────────────────────────────────────────────

  dispose(): void {
    this.data.clear();
  }

  // ── Private helpers ────────────────────────────────────────────────

  private estimateSize(): number {
    let bytes = 0;
    for (const [k, v] of this.data) {
      bytes += this.measureEntry(k, v);
    }
    return bytes;
  }

  private measureEntry(key: string, value: string): number {
    return (key.length + value.length) * 2;
  }
}
