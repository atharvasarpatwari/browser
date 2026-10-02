// ─────────────────────────────────────────────────────────────────────────────
// CACHE API — window.caches (CacheStorage) + the Cache objects it opens
// ─────────────────────────────────────────────────────────────────────────────
//
// Reuses the real Response/Request representation from fetch-api.ts (via the
// exported getResponseInternal/getRequestInternal/buildResponseInstance)
// rather than inventing a second one — a cached entry is just a cloned
// ResponseInternal, and match()/matchAll() reconstruct a real Response from
// it exactly the way a live fetch() would.
//
// Cache storage is created fresh per call to createCacheStorage() (one per
// page/tab environment) rather than held in a module-level map — Cache
// Storage is per-origin in real browsers, and a shared module-level map
// would leak cached responses across different pages/tabs sharing this
// process.

import type { JSValue, JSObject } from './values';
import { createObject, createArray, createNativeFunction, toString } from './values';
import type { EventLoop } from './event-loop';
import { createWiredPromise, fulfillPromise, rejectPromise } from './promise';
import { getResponseInternal, getRequestInternal, buildResponseInstance, type ResponseInternal } from './fetch-api';

type PlatformFetch = (url: string, init?: Record<string, unknown>) => Promise<globalThis.Response>;

function requestToUrl(reqOrUrl: JSValue): string {
  return getRequestInternal(reqOrUrl)?.url ?? toString(reqOrUrl);
}

/** A fresh, independent copy so a later mutation to the live response can't corrupt the cached entry (or vice versa). */
function cloneInternal(internal: ResponseInternal): ResponseInternal {
  return { ...internal, headers: { map: new Map(internal.headers.map) }, bodyUsed: false };
}

interface CacheStore {
  entries: Map<string, ResponseInternal>;
}

function createCacheObject(eventLoop: EventLoop, store: CacheStore, platformFetch: PlatformFetch): JSObject {
  const cache = createObject(null);
  const def = (name: string, fn: (args: JSValue[]) => JSValue): void => {
    cache.properties.set(name, { value: createNativeFunction(name, (_this, args) => fn(args)), writable: true, enumerable: true, configurable: true });
  };

  def('match', (args) => {
    const p = createWiredPromise(eventLoop);
    const hit = store.entries.get(requestToUrl(args[0]));
    fulfillPromise(p, hit ? buildResponseInstance(eventLoop, cloneInternal(hit)) : undefined);
    return p;
  });

  def('matchAll', (args) => {
    const p = createWiredPromise(eventLoop);
    if (args.length === 0 || args[0] === undefined) {
      fulfillPromise(p, createArray([...store.entries.values()].map(v => buildResponseInstance(eventLoop, cloneInternal(v)))));
    } else {
      const hit = store.entries.get(requestToUrl(args[0]));
      fulfillPromise(p, createArray(hit ? [buildResponseInstance(eventLoop, cloneInternal(hit))] : []));
    }
    return p;
  });

  def('put', (args) => {
    const p = createWiredPromise(eventLoop);
    const url = requestToUrl(args[0]);
    const respInternal = getResponseInternal(args[1]);
    if (!respInternal) {
      rejectPromise(p, 'TypeError: Failed to execute \'put\' on \'Cache\': second argument must be a Response');
      return p;
    }
    store.entries.set(url, cloneInternal(respInternal));
    fulfillPromise(p, undefined);
    return p;
  });

  def('delete', (args) => {
    const p = createWiredPromise(eventLoop);
    fulfillPromise(p, store.entries.delete(requestToUrl(args[0])));
    return p;
  });

  def('keys', () => {
    const p = createWiredPromise(eventLoop);
    // Simplification: only the URL is retained as the cache key, so keys()
    // returns plain {url} objects rather than full reconstructed Request
    // instances (method/headers of the original request aren't stored).
    fulfillPromise(p, createArray([...store.entries.keys()].map((url) => {
      const obj = createObject(null);
      obj.properties.set('url', { value: url, writable: false, enumerable: true, configurable: true });
      return obj;
    })));
    return p;
  });

  const fetchAndStore = (url: string): Promise<void> =>
    Promise.resolve(platformFetch(url)).then(async (res) => {
      if (!res.ok) throw new Error(`Request for ${url} failed with status ${res.status}`);
      const body = await res.text();
      const headerMap = new Map<string, string>();
      res.headers.forEach((v: string, k: string) => headerMap.set(k, v));
      store.entries.set(url, {
        body, status: res.status, statusText: res.statusText, headers: { map: headerMap },
        url: res.url || url, redirected: res.redirected, type: res.type, bodyUsed: false,
      });
    });

  def('add', (args) => {
    const p = createWiredPromise(eventLoop);
    fetchAndStore(requestToUrl(args[0])).then(
      () => fulfillPromise(p, undefined),
      (err) => rejectPromise(p, 'TypeError: ' + (err instanceof Error ? err.message : String(err))),
    );
    return p;
  });

  def('addAll', (args) => {
    const p = createWiredPromise(eventLoop);
    const arr = args[0];
    const urls: string[] = [];
    if (typeof arr === 'object' && arr !== null && (arr as JSObject).type === 'array') {
      const len = Number((arr as JSObject).properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) urls.push(requestToUrl((arr as JSObject).properties.get(String(i))?.value as JSValue));
    }
    Promise.all(urls.map(fetchAndStore)).then(
      () => fulfillPromise(p, undefined),
      (err) => rejectPromise(p, 'TypeError: ' + (err instanceof Error ? err.message : String(err))),
    );
    return p;
  });

  return cache;
}

export function createCacheStorage(eventLoop: EventLoop, platformFetch?: PlatformFetch): JSObject {
  const fetchFn = platformFetch ?? (globalThis.fetch.bind(globalThis) as PlatformFetch);
  const namedCaches = new Map<string, CacheStore>();
  const storage = createObject(null);
  const def = (name: string, fn: (args: JSValue[]) => JSValue): void => {
    storage.properties.set(name, { value: createNativeFunction(name, (_this, args) => fn(args)), writable: true, enumerable: true, configurable: true });
  };

  def('open', (args) => {
    const name = toString(args[0]);
    const p = createWiredPromise(eventLoop);
    if (!namedCaches.has(name)) namedCaches.set(name, { entries: new Map() });
    fulfillPromise(p, createCacheObject(eventLoop, namedCaches.get(name)!, fetchFn));
    return p;
  });

  def('has', (args) => {
    const p = createWiredPromise(eventLoop);
    fulfillPromise(p, namedCaches.has(toString(args[0])));
    return p;
  });

  def('delete', (args) => {
    const p = createWiredPromise(eventLoop);
    fulfillPromise(p, namedCaches.delete(toString(args[0])));
    return p;
  });

  def('keys', () => {
    const p = createWiredPromise(eventLoop);
    fulfillPromise(p, createArray([...namedCaches.keys()]));
    return p;
  });

  def('match', (args) => {
    const p = createWiredPromise(eventLoop);
    const url = requestToUrl(args[0]);
    for (const store of namedCaches.values()) {
      const hit = store.entries.get(url);
      if (hit) { fulfillPromise(p, buildResponseInstance(eventLoop, cloneInternal(hit))); return p; }
    }
    fulfillPromise(p, undefined);
    return p;
  });

  return storage;
}
