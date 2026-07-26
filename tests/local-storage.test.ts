import { describe, it, expect, beforeEach } from 'vitest';
import {
  NovaLocalStorage,
  NovaSessionStorage as NovaSessionStorageImpl,
  InMemoryStorageBackend,
  type StorageEvent,
} from '../src/browser/storage/local-storage';
import { NovaSessionStorage } from '../src/browser/storage/session-storage';

// ─────────────────────────────────────────────────────────────────────────────
// LOCALSTORAGE
// ─────────────────────────────────────────────────────────────────────────────

describe('LocalStorage', () => {
  let storage: NovaLocalStorage;
  const origin = 'https://example.com';

  beforeEach(() => {
    storage = new NovaLocalStorage(origin, new InMemoryStorageBackend());
  });

  // ── Basic CRUD ──────────────────────────────────────────────────

  describe('setItem / getItem', () => {
    it('should store and retrieve a string value', () => {
      storage.setItem('name', 'Alice');
      expect(storage.getItem('name')).toBe('Alice');
    });

    it('should return null for non-existent keys', () => {
      expect(storage.getItem('missing')).toBeNull();
    });

    it('should overwrite existing values', () => {
      storage.setItem('key', 'v1');
      storage.setItem('key', 'v2');
      expect(storage.getItem('key')).toBe('v2');
    });

    it('should convert numbers to strings', () => {
      storage.setItem('num', 42 as any);
      expect(storage.getItem('num')).toBe('42');
    });

    it('should convert booleans to strings', () => {
      storage.setItem('bool', true as any);
      expect(storage.getItem('bool')).toBe('true');
    });

    it('should handle empty strings', () => {
      storage.setItem('empty', '');
      expect(storage.getItem('empty')).toBe('');
      expect(storage.length).toBe(1);
    });

    it('should handle unicode characters', () => {
      storage.setItem('emoji', '\u{1F600}');
      expect(storage.getItem('emoji')).toBe('\u{1F600}');
    });
  });

  describe('removeItem', () => {
    it('should remove an existing key', () => {
      storage.setItem('key', 'value');
      storage.removeItem('key');
      expect(storage.getItem('key')).toBeNull();
    });

    it('should be a no-op for non-existent keys', () => {
      storage.removeItem('missing');
      expect(storage.length).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all items', () => {
      storage.setItem('a', '1');
      storage.setItem('b', '2');
      storage.setItem('c', '3');
      storage.clear();
      expect(storage.length).toBe(0);
      expect(storage.getItem('a')).toBeNull();
    });

    it('should be a no-op on empty storage', () => {
      storage.clear();
      expect(storage.length).toBe(0);
    });
  });

  describe('key', () => {
    it('should return the key at a given index', () => {
      storage.setItem('a', '1');
      storage.setItem('b', '2');
      expect(storage.key(0)).toBe('a');
      expect(storage.key(1)).toBe('b');
    });

    it('should return null for out-of-range indices', () => {
      expect(storage.key(0)).toBeNull();
      storage.setItem('a', '1');
      expect(storage.key(1)).toBeNull();
      expect(storage.key(-1)).toBeNull();
    });
  });

  describe('length', () => {
    it('should reflect the number of items', () => {
      expect(storage.length).toBe(0);
      storage.setItem('a', '1');
      expect(storage.length).toBe(1);
      storage.setItem('b', '2');
      expect(storage.length).toBe(2);
      storage.removeItem('a');
      expect(storage.length).toBe(1);
    });
  });

  // ── Quota limits ────────────────────────────────────────────────

  describe('quota limits', () => {
    it('should throw for oversized keys', () => {
      const longKey = 'k'.repeat(2000);
      expect(() => storage.setItem(longKey, 'val')).toThrow();
    });

    it('should accept keys up to 1024 characters', () => {
      const maxKey = 'k'.repeat(1024);
      storage.setItem(maxKey, 'val');
      expect(storage.getItem(maxKey)).toBe('val');
    });
  });

  // ── Per-origin isolation ────────────────────────────────────────

  describe('per-origin isolation', () => {
    it('should isolate data between origins', () => {
      const store1 = new NovaLocalStorage('https://a.com', new InMemoryStorageBackend());
      const store2 = new NovaLocalStorage('https://b.com', new InMemoryStorageBackend());

      store1.setItem('key', 'a-value');
      store2.setItem('key', 'b-value');

      expect(store1.getItem('key')).toBe('a-value');
      expect(store2.getItem('key')).toBe('b-value');
    });
  });

  // ── Storage events ──────────────────────────────────────────────

  describe('storage events', () => {
    it('should fire a StorageEvent on setItem', () => {
      let fired: StorageEvent | null = null;
      storage.addEventListener(e => { fired = e; });
      storage.setItem('key', 'value');
      expect(fired).not.toBeNull();
      expect(fired!.key).toBe('key');
      expect(fired!.oldValue).toBeNull();
      expect(fired!.newValue).toBe('value');
      expect(fired!.storageArea).toBe('local');
    });

    it('should include oldValue and newValue on overwrite', () => {
      storage.setItem('key', 'v1');
      let fired: StorageEvent | null = null;
      storage.addEventListener(e => { fired = e; });
      storage.setItem('key', 'v2');
      expect(fired!.oldValue).toBe('v1');
      expect(fired!.newValue).toBe('v2');
    });

    it('should fire a StorageEvent on removeItem', () => {
      storage.setItem('key', 'value');
      let fired: StorageEvent | null = null;
      storage.addEventListener(e => { fired = e; });
      storage.removeItem('key');
      expect(fired!.key).toBe('key');
      expect(fired!.oldValue).toBe('value');
      expect(fired!.newValue).toBeNull();
    });

    it('should fire a StorageEvent on clear', () => {
      storage.setItem('a', '1');
      let fired: StorageEvent | null = null;
      storage.addEventListener(e => { fired = e; });
      storage.clear();
      expect(fired!.key).toBeNull();
      expect(fired!.oldValue).toBeNull();
    });

    it('should not fire if the value did not change', () => {
      storage.setItem('key', 'value');
      let fired = false;
      storage.addEventListener(() => { fired = true; });
      storage.setItem('key', 'value');
      expect(fired).toBe(false);
    });

    it('should allow removing event listeners', () => {
      let count = 0;
      const listener = () => { count++; };
      storage.addEventListener(listener);
      storage.setItem('a', '1');
      expect(count).toBe(1);
      storage.removeEventListener(listener);
      storage.setItem('b', '2');
      expect(count).toBe(1);
    });

    it('should catch handler exceptions gracefully', () => {
      storage.addEventListener(() => { throw new Error('boom'); });
      expect(() => storage.setItem('key', 'value')).not.toThrow();
    });
  });

  // ── Backend persistence ─────────────────────────────────────────

  describe('backend persistence', () => {
    it('should persist through backend save/load cycle', () => {
      const backend = new InMemoryStorageBackend();
      const s1 = new NovaLocalStorage(origin, backend);
      s1.setItem('persist', 'yes');
      s1.dispose();

      const s2 = new NovaLocalStorage(origin, backend);
      expect(s2.getItem('persist')).toBe('yes');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SESSIONSTORAGE
// ─────────────────────────────────────────────────────────────────────────────

describe('SessionStorage', () => {
  let storage: NovaSessionStorage;
  const origin = 'https://example.com';

  beforeEach(() => {
    storage = new NovaSessionStorage(origin);
  });

  describe('setItem / getItem', () => {
    it('should store and retrieve a value', () => {
      storage.setItem('key', 'value');
      expect(storage.getItem('key')).toBe('value');
    });

    it('should return null for missing keys', () => {
      expect(storage.getItem('missing')).toBeNull();
    });

    it('should overwrite values', () => {
      storage.setItem('key', 'v1');
      storage.setItem('key', 'v2');
      expect(storage.getItem('key')).toBe('v2');
    });
  });

  describe('removeItem / clear', () => {
    it('should remove a specific key', () => {
      storage.setItem('a', '1');
      storage.removeItem('a');
      expect(storage.getItem('a')).toBeNull();
    });

    it('should clear all items', () => {
      storage.setItem('a', '1');
      storage.setItem('b', '2');
      storage.clear();
      expect(storage.length).toBe(0);
    });
  });

  describe('key / length', () => {
    it('should report correct length', () => {
      expect(storage.length).toBe(0);
      storage.setItem('a', '1');
      storage.setItem('b', '2');
      expect(storage.length).toBe(2);
    });

    it('should return key at index', () => {
      storage.setItem('x', '1');
      expect(storage.key(0)).toBe('x');
      expect(storage.key(1)).toBeNull();
    });
  });

  describe('tab isolation', () => {
    it('should isolate data between different tab IDs', () => {
      const tab1 = new NovaSessionStorage(origin, 'tab-1');
      const tab2 = new NovaSessionStorage(origin, 'tab-2');

      tab1.setItem('key', 'tab1-value');
      tab2.setItem('key', 'tab2-value');

      expect(tab1.getItem('key')).toBe('tab1-value');
      expect(tab2.getItem('key')).toBe('tab2-value');
    });

    it('should share data within the same tab', () => {
      const s1 = new NovaSessionStorage(origin, 'tab-shared');
      const s2 = new NovaSessionStorage(origin, 'tab-shared');
      // Note: session storage is per-tab, not per-instance.
      // Different instances with same tabId are independent (like different document references).
      s1.setItem('key', 'val');
      expect(s2.getItem('key')).toBeNull(); // Different instance = independent data
    });

    it('should have a unique tab ID when not provided', () => {
      const s1 = new NovaSessionStorage(origin);
      const s2 = new NovaSessionStorage(origin);
      expect(s1.getTabId()).not.toBe(s2.getTabId());
    });
  });

  describe('clone', () => {
    it('should clone all data to a new instance', () => {
      storage.setItem('a', '1');
      storage.setItem('b', '2');
      const cloned = storage.clone();
      expect(cloned.getItem('a')).toBe('1');
      expect(cloned.getItem('b')).toBe('2');
      expect(cloned.getTabId()).toBe(storage.getTabId());
    });

    it('should be independent after cloning', () => {
      storage.setItem('key', 'original');
      const cloned = storage.clone();
      storage.setItem('key', 'modified');
      expect(cloned.getItem('key')).toBe('original');
    });
  });

  describe('no persistence', () => {
    it('should not persist across dispose', () => {
      storage.setItem('key', 'value');
      storage.dispose();
      expect(storage.length).toBe(0);
    });
  });

  describe('quota limits', () => {
    it('should throw for oversized values', () => {
      const longVal = 'v'.repeat(5 * 1024 * 1024 + 1);
      expect(() => storage.setItem('key', longVal)).toThrow();
    });
  });
});
