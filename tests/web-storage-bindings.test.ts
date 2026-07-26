import { describe, it, expect } from 'vitest';
import { bindStorageAPIs, clearStorageCaches } from '../src/browser/js/web-storage-bindings';
import { Environment } from '../src/browser/js/values';
import { createObject, createNativeFunction, toString, toNumber } from '../src/browser/js/values';

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
});
