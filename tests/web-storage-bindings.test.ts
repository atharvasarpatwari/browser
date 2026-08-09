import { describe, it, expect, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { bindStorageAPIs, clearStorageCaches } from '../src/browser/js/web-storage-bindings';
import { Environment } from '../src/browser/js/values';
import { createObject, createNativeFunction, toString, toNumber } from '../src/browser/js/values';

function invoke(env: Environment, binding: string, method: string, args: unknown[]): unknown {
  const obj = env.get(binding) as any;
  const fn = obj.properties.get(method).value;
  return fn.nativeFn(null, args);
}

describe('Web Storage Bindings', () => {
  describe('bindStorageAPIs', () => {
    it('should bind localStorage to the environment', () => {
      const env = new Environment(null);
      bindStorageAPIs(env, { origin: 'https://test.com' });
      const ls = env.get('localStorage');
      expect(ls).toBeDefined();
      expect(typeof ls).toBe('object');
    });

    it('should bind sessionStorage to the environment', () => {
      const env = new Environment(null);
      bindStorageAPIs(env, { origin: 'https://test.com' });
      const ss = env.get('sessionStorage');
      expect(ss).toBeDefined();
    });

    it('should bind indexedDB to the environment', () => {
      const env = new Environment(null);
      bindStorageAPIs(env, { origin: 'https://test.com' });
      const idb = env.get('indexedDB');
      expect(idb).toBeDefined();
    });

    it('should bind IDBKeyRange to the environment', () => {
      const env = new Environment(null);
      bindStorageAPIs(env, { origin: 'https://test.com' });
      const krange = env.get('IDBKeyRange');
      expect(krange).toBeDefined();
    });
  });

  describe('localStorage via bindings', () => {
    it('should provide getItem/setItem/removeItem methods', () => {
      const env = new Environment(null);
      bindStorageAPIs(env, { origin: 'https://test.com' });
      const ls = env.get('localStorage') as any;

      expect(ls.properties.has('getItem')).toBe(true);
      expect(ls.properties.has('setItem')).toBe(true);
      expect(ls.properties.has('removeItem')).toBe(true);
      expect(ls.properties.has('clear')).toBe(true);
      expect(ls.properties.has('key')).toBe(true);
      expect(ls.properties.has('length')).toBe(true);
    });
  });

  describe('indexedDB via bindings', () => {
    it('should provide open/deleteDatabase/databases/cmp methods', () => {
      const env = new Environment(null);
      bindStorageAPIs(env, { origin: 'https://test.com' });
      const idb = env.get('indexedDB') as any;

      expect(idb.properties.has('open')).toBe(true);
      expect(idb.properties.has('deleteDatabase')).toBe(true);
      expect(idb.properties.has('databases')).toBe(true);
      expect(idb.properties.has('cmp')).toBe(true);
    });
  });

  describe('clearStorageCaches', () => {
    it('should clear cached instances', () => {
      const env1 = new Environment(null);
      bindStorageAPIs(env1, { origin: 'https://cached.com' });
      clearStorageCaches();

      // After clearing, new instances should be created.
      const env2 = new Environment(null);
      bindStorageAPIs(env2, { origin: 'https://cached.com' });
      const ls1 = env1.get('localStorage');
      const ls2 = env2.get('localStorage');
      // They should be different instances now.
      expect(ls1).not.toBe(ls2);
    });
  });

  describe('diskPath persistence', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-webstorage-'));
    const diskPath = path.join(tmpRoot, 'web-storage');

    afterAll(() => {
      clearStorageCaches();
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        /* cleanup best-effort */
      }
    });

    it('persists localStorage across a simulated restart', () => {
      clearStorageCaches();
      const origin = 'https://persist.com';

      const env1 = new Environment(null);
      bindStorageAPIs(env1, { origin, diskPath });
      invoke(env1, 'localStorage', 'setItem', ['theme', 'dark']);
      invoke(env1, 'localStorage', 'setItem', ['count', '42']);

      // Simulate a fresh app boot: caches dropped, disk files remain.
      clearStorageCaches();
      const env2 = new Environment(null);
      bindStorageAPIs(env2, { origin, diskPath });

      expect(invoke(env2, 'localStorage', 'getItem', ['theme'])).toBe('dark');
      expect(invoke(env2, 'localStorage', 'getItem', ['count'])).toBe('42');
      expect(invoke(env2, 'localStorage', 'getItem', ['missing'])).toBeUndefined();
    });

    it('does not share storage across origins even on the same disk path', () => {
      clearStorageCaches();
      const diskPath2 = path.join(tmpRoot, 'web-storage');

      const envA = new Environment(null);
      bindStorageAPIs(envA, { origin: 'https://origin-a.com', diskPath: diskPath2 });
      invoke(envA, 'localStorage', 'setItem', ['k', 'a']);

      clearStorageCaches();
      const envB = new Environment(null);
      bindStorageAPIs(envB, { origin: 'https://origin-b.com', diskPath: diskPath2 });
      expect(invoke(envB, 'localStorage', 'getItem', ['k'])).toBeUndefined();
    });
  });
});
