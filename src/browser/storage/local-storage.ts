/**
 * @file src/browser/storage/local-storage.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * WHATWG Web Storage API (§ 9) — per-origin, persistent key-value storage.
 * https://html.spec.whatwg.org/multipage/webstorage.html
 *
 * • localStorage is shared across all tabs with the same origin.
 * • Data persists across browser sessions (backed by disk).
 * • Maximum 5 MiB per origin.
 * • Keys and values are always strings.
 * • Storage events fire on other tabs/windows when this storage changes.
 *
 * OOP PRINCIPLES
 * ──────────────
 *  Abstraction      IStorageBackend hides the disk persistence mechanism.
 *  Encapsulation    Origin data is private; only the public Storage API is exposed.
 *  Single-Resp.     This file implements only localStorage.
 *  Open / Closed    New backends (IndexedDB, etc.) are separate implementations.
 *  Dependency-Inv.  Constructor accepts an IStorageBackend (testable with in-memory).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

/** Backend abstraction for persisting key-value data. */
export interface IStorageBackend {
  /** Load all key-value pairs for an origin. */
  load(origin: string): Map<string, string>;
  /** Save all key-value pairs for an origin. */
  save(origin: string, data: Map<string, string>): void;
  /** Delete all data for an origin. */
  clear(origin: string): void;
}

/** The standard DOM Storage interface (WHATWG Web Storage § 9.1.1). */
export interface IStorage {
  readonly length: number;
  clear(): void;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum storage size per origin in bytes (5 MiB). */
const MAX_STORAGE_BYTES = 5 * 1024 * 1024;

/** Maximum key length in characters. */
const MAX_KEY_LENGTH = 1024;

/** Maximum value length in characters. */
const MAX_VALUE_LENGTH = 4 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY BACKEND (for tests and when no disk backend is provided)
// ─────────────────────────────────────────────────────────────────────────────

export class InMemoryStorageBackend implements IStorageBackend {
  private readonly store = new Map<string, Map<string, string>>();

  load(origin: string): Map<string, string> {
    const data = this.store.get(origin);
    return data ? new Map(data) : new Map();
  }

  save(origin: string, data: Map<string, string>): void {
    this.store.set(origin, new Map(data));
  }

  clear(origin: string): void {
    this.store.delete(origin);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DISK BACKEND (JSON file persistence)
// ─────────────────────────────────────────────────────────────────────────────

export class DiskStorageBackend implements IStorageBackend {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  load(origin: string): Map<string, string> {
    const data = new Map<string, string>();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('node:path') as typeof import('node:path');
      const filePath = path.join(this.basePath, `localStorage-${this.sanitizeOrigin(origin)}.json`);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const obj = JSON.parse(raw);
        for (const [k, v] of Object.entries(obj)) {
          data.set(k, String(v));
        }
      }
    } catch {
      // File read failure → empty storage
    }
    return data;
  }

  save(origin: string, data: Map<string, string>): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('node:path') as typeof import('node:path');
      const dir = this.basePath;
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const filePath = path.join(dir, `localStorage-${this.sanitizeOrigin(origin)}.json`);
      const obj: Record<string, string> = {};
      for (const [k, v] of data) {
        obj[k] = v;
      }
      fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch {
      // File write failure → silent (browser handles gracefully)
    }
  }

  clear(origin: string): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('node:path') as typeof import('node:path');
      const filePath = path.join(this.basePath, `localStorage-${this.sanitizeOrigin(origin)}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Silent
    }
  }

  private sanitizeOrigin(origin: string): string {
    return origin.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

export interface StorageEvent {
  readonly key: string | null;
  readonly oldValue: string | null;
  readonly newValue: string | null;
  readonly url: string;
  readonly storageArea: 'local' | 'session';
}

export type StorageEventListener = (event: StorageEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL STORAGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implementation of the `localStorage` global.
 * Per WHATWG Web Storage § 9.1 — a separate instance per origin.
 */
export class NovaLocalStorage implements IStorage, IDisposable {
  private data: Map<string, string>;
  private readonly origin: string;
  private readonly backend: IStorageBackend;
  private static readonly listeners = new Map<string, Set<StorageEventListener>>();

  constructor(origin: string, backend: IStorageBackend) {
    this.origin = origin;
    this.backend = backend;
    this.data = backend.load(origin);
  }

  // ── WHATWG Web Storage § 9.1.1 — length attribute ──────────────────

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
    const oldValue = this.data.get(key) ?? null;
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

    // Estimate size impact.
    const oldSize = oldValue !== null ? this.measureEntry(key, oldValue) : 0;
    const newSize = this.measureEntry(key, stringValue);
    const currentSize = this.estimateSize() - oldSize + newSize;

    if (currentSize > MAX_STORAGE_BYTES) {
      throw new DOMException(
        'QuotaExceededError: storage limit reached',
        'QuotaExceededError',
      );
    }

    this.data.set(key, stringValue);
    this.backend.save(this.origin, this.data);

    if (oldValue !== stringValue) {
      this.fireEvent({
        key,
        oldValue,
        newValue: stringValue,
        url: this.origin,
        storageArea: 'local',
      });
    }
  }

  // ── WHATWG Web Storage § 9.1.5 — removeItem() ──────────────────────

  removeItem(key: string): void {
    if (!this.data.has(key)) return;
    const oldValue = this.data.get(key)!;
    this.data.delete(key);
    this.backend.save(this.origin, this.data);

    this.fireEvent({
      key,
      oldValue,
      newValue: null,
      url: this.origin,
      storageArea: 'local',
    });
  }

  // ── WHATWG Web Storage § 9.1.6 — clear() ───────────────────────────

  clear(): void {
    if (this.data.size === 0) return;
    this.data.clear();
    this.backend.clear(this.origin);

    this.fireEvent({
      key: null,
      oldValue: null,
      newValue: null,
      url: this.origin,
      storageArea: 'local',
    });
  }

  // ── Event listener API ─────────────────────────────────────────────

  /** Add a listener for StorageEvents on this origin. */
  addEventListener(listener: StorageEventListener): void {
    let listeners = NovaLocalStorage.listeners.get(this.origin);
    if (!listeners) {
      listeners = new Set();
      NovaLocalStorage.listeners.set(this.origin, listeners);
    }
    listeners.add(listener);
  }

  /** Remove a listener for StorageEvents on this origin. */
  removeEventListener(listener: StorageEventListener): void {
    NovaLocalStorage.listeners.get(this.origin)?.delete(listener);
  }

  // ── IDisposable ─────────────────────────────────────────────────────

  dispose(): void {
    NovaLocalStorage.listeners.delete(this.origin);
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
    // UTF-16: 2 bytes per character.
    return (key.length + value.length) * 2;
  }

  private fireEvent(event: StorageEvent): void {
    const listeners = NovaLocalStorage.listeners.get(this.origin);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // Storage event handlers must not crash.
      }
    }
  }
}
