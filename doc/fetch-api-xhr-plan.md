# Fetch API & XMLHttpRequest Implementation Plan

**Date:** 2026-07-19
**Session:** Fetch API + XMLHttpRequest for JS engine
**Status:** Planned

---

## Overview

Add `fetch()`, `Headers`, `Response`, `Request`, `AbortController`, and `XMLHttpRequest` to the Nova JS engine. Both APIs delegate to the platform's native `fetch()` under the hood. The implementation follows the existing `createNativeFunction` / `JSObject` pattern and integrates with the existing Promise and EventLoop systems.

## Key Design Decisions

### 1. Constructor Pattern: Callable JSObject with `new` support

The interpreter's `evalNew` (interpreter.ts:762) handles three cases:
- **Class constructors** (`type: 'class'`)
- **Native function constructors** (`isNative` JSFunction)
- **Callable JSObject with nativeFn** (`callable: true`)

For `Headers`, `Response`, `Request`, `AbortController`, and `XMLHttpRequest`, we use the **Callable JSObject with nativeFn** pattern (same as `Promise`). This allows both `new Headers(...)` and `Headers()` to work, while letting us attach prototype methods and static methods via `.properties`.

**Rationale:** This matches the existing `Promise` pattern (promise.ts:350-377), is the most flexible, and requires no changes to the interpreter.

### 2. Body Methods as Async

`json()`, `text()`, `blob()`, `arrayBuffer()` on `Response` and `Request` must return Promises. Since `fetch()` already returns a Promise, and the body is always available synchronously in our implementation (the native `fetch` reads the full body as a string), these methods will:
1. Return a Promise that resolves immediately via `Promise.resolve()` (using the event loop reference)
2. Parse the body string as needed (JSON.parse for `.json()`, identity for `.text()`)

### 3. XHR Event Firing via Microtasks

Per the spec, XHR fires events asynchronously. We fire events via `eventLoop.enqueueMicrotask()` to keep them consistent with browser behavior. The `dispatchEvent()` method calls listeners synchronously (per DOM spec), but we wrap the initial trigger in a microtask.

### 4. Headers Internal Storage

`Headers` stores data as `Map<string, string>` internally (lowercase keys per spec). This matches the `HttpResponseSpec.headers` type (`ReadonlyMap<string, string>`) already used in the networking stack.

### 5. Global Registration

Both `fetch` and `XMLHttpRequest` are registered in `createGlobalEnv()` in `src/browser/js/index.ts`. `Response`, `Headers`, `Request`, `AbortController` are registered as globals too (matching browser behavior where these are on `window`).

---

## File-by-File Implementation

### File 1: `src/browser/js/fetch-api.ts` (NEW)

**Purpose:** Headers, Response, Request, AbortController, and the `fetch()` function.

#### Exports
- `createHeadersClass(eventLoop)` → JSObject (constructor)
- `createResponseClass(eventLoop)` → JSObject (constructor)
- `createRequestClass(eventLoop)` → JSObject (constructor)
- `createAbortControllerClass(eventLoop)` → JSObject (constructor)
- `createFetchFn(eventLoop)` → JSFunction (the `fetch()` global)

#### Internal Architecture

Each class is a `JSObject` with `callable: true`, `nativeFn`, and a `.prototype` object carrying instance methods. Instances are plain `JSObject` values with internal state stored in a module-level `WeakMap`.

```
WeakMap<JSObject, HeadersState>   — headersState
WeakMap<JSObject, ResponseState>  — responseState
WeakMap<JSObject, RequestState>   — requestState
WeakMap<JSObject, AbortSignalState> — signalState
```

**Why WeakMap?** Same pattern as `promiseStates` in promise.ts:26. Allows GC of JS objects while keeping internal state private.

#### Headers Class

**State:** `{ map: Map<string, string> }`

| Method | Behavior |
|--------|----------|
| `get(name)` | Return `map.get(name.toLowerCase())` or `null` |
| `set(name, value)` | `map.set(name.toLowerCase(), toString(value))` |
| `has(name)` | `map.has(name.toLowerCase())` |
| `append(name, value)` | Get existing, append with `, ` separator, set |
| `delete(name)` | `map.delete(name.toLowerCase())` |
| `entries()` | Returns `createArray` of `[key, value]` pairs |
| `keys()` | Returns `createArray` of keys |
| `values()` | Returns `createArray` of values |
| `[Symbol.iterator]` | Same as `entries()` (we don't have real Symbols, store under `'__iterator'` key) |

**Constructor:** Accepts either `undefined`, a plain object (JSObject), or another Headers instance. Iterates properties to populate the internal map.

#### Response Class

**State:**
```typescript
{
  body: string;           // response body text
  status: number;         // HTTP status code
  statusText: string;     // HTTP status text
  headers: HeadersState;  // internal Headers state
  url: string;            // final URL
  redirected: boolean;    // whether redirected
  ok: boolean;            // status 200-299
  type: string;           // 'default' | 'error'
  bodyUsed: boolean;      // whether body has been consumed
}
```

| Getter/Method | Behavior |
|---------------|----------|
| `ok` (getter) | `status >= 200 && status < 300` |
| `status` (getter) | Returns state.status |
| `statusText` (getter) | Returns state.statusText |
| `headers` (getter) | Returns Headers JSObject |
| `url` (getter) | Returns state.url |
| `redirected` (getter) | Returns state.redirected |
| `type` (getter) | Returns 'default' |
| `bodyUsed` (getter) | Returns state.bodyUsed |
| `json()` | Returns Promise resolving to parsed JSON of body |
| `text()` | Returns Promise resolving to body string |
| `blob()` | Returns Promise resolving to body string (simplified — no real Blob) |
| `arrayBuffer()` | Returns Promise resolving to body string (simplified) |
| `clone()` | Returns new Response with same state |

**Constructor:** `new Response(body?, init?)` where `body` is a string and `init` is an optional object with `status`, `statusText`, `headers` properties.

#### Request Class

**State:**
```typescript
{
  url: string;
  method: string;          // default 'GET'
  headers: HeadersState;
  body: string | null;
  signal: AbortSignal | null;
  bodyUsed: boolean;
}
```

| Property/Method | Behavior |
|-----------------|----------|
| `url` (getter) | Returns state.url |
| `method` (getter) | Returns state.method (uppercase) |
| `headers` (getter) | Returns Headers JSObject |
| `body` (getter) | Returns state.body |
| `signal` (getter) | Returns signal JSObject or null |
| `json()` | Same as Response body mixin |
| `text()` | Same as Response body mixin |
| `clone()` | Returns new Request with same state |

**Constructor:** `new Request(url, init?)` where `init` is an optional object with `method`, `headers`, `body`, `signal`.

#### AbortController Class

**State:** `{ aborted: boolean; reason: JSValue; signal: JSObject | null }`

| Method | Behavior |
|--------|----------|
| `abort()` | Sets `aborted = true`, resolves signal, fires abort event |
| `signal` (getter) | Returns the associated AbortSignal JSObject |

**AbortSignal JSObject:** Created when AbortController is constructed.

| Property | Behavior |
|----------|----------|
| `aborted` (getter) | Returns state.aborted |
| `reason` (getter) | Returns state.reason |
| `throwIfAborted()` | Throws if aborted |

#### fetch() Function

```typescript
fetchFn = (_this, args) => {
  const urlOrRequest = args[0];
  const init = args[1];

  // Normalize to Request object or extract url/init
  // Build HttpRequestSpec-compatible object
  // Call platform fetch() with AbortSignal
  // Wrap HttpResponseSpec into Response JSObject
  // Return Promise<Response>
}
```

**Platform bridge:** Uses the platform `fetch()` directly (not the `IHttpClient` interface), since we're implementing the web-standard `fetch()` API. The platform `fetch()` is the same one `FetchHttpClient` uses.

**Error handling:** Network errors → reject with `TypeError`. Abort → reject with `DOMException` (simplified: plain error with name `'AbortError'`).

**Redirect handling:** Platform `fetch()` with `redirect: 'follow'` (default).

---

### File 2: `src/browser/js/xhr-bindings.ts` (NEW)

**Purpose:** EventTarget-like mixin for XHR. Provides `addEventListener`, `removeEventListener`, `dispatchEvent` as reusable functions.

#### Exports
- `createEventDispatcher(jsObject)` — Attaches event methods to a JSObject
- `fireEvent(jsObject, type, eventObj)` — Triggers event dispatch

#### Internal State

```
WeakMap<JSObject, Map<string, Set<JSFunction>>>  — eventListeners
```

Each XHR instance gets its own listener map. `dispatchEvent` calls all listeners for a given event type, then calls the `on<event>` property if set.

#### dispatchEvent Behavior

1. Look up listeners for `event.type`
2. Call each listener with the event object
3. Call `xhrObj.properties.get('on' + event.type)?.value` if present, invoke with event
4. Return `true` (not cancelled)

---

### File 3: `src/browser/js/xhr.ts` (NEW)

**Purpose:** XMLHttpRequest implementation.

#### Export
- `createXMLHttpRequestClass(eventLoop)` → JSObject (constructor)

#### ReadyState Constants (static on constructor)

```
UNSENT:           0
OPENED:           1
HEADERS_RECEIVED: 2
LOADING:          3
DONE:             4
```

#### XHR State (WeakMap)

```typescript
{
  readyState: number;         // 0-4
  status: number;             // HTTP status
  statusText: string;
  responseText: string;
  response: string;           // same as responseText for now
  responseType: string;       // '' | 'text' | 'json'
  timeout: number;            // 0 = no timeout
  withCredentials: boolean;   // false
  method: string;
  url: string;
  requestHeaders: Map<string, string>;
  responseHeaders: Map<string, string>;
  aborted: boolean;
}
```

#### Methods

| Method | Behavior |
|--------|----------|
| `open(method, url, async?)` | Set state to OPENED, store method/url. `async` defaults to `true`. |
| `send(body?)` | Fire loadstart → make fetch call → on response: set HEADERS_RECEIVED, LOADING, DONE, fire onloadstart, onreadystatechange, onload, onloadend. On error: fire onerror, onloadend. On abort: fire onabort, onloadend. |
| `abort()` | Set aborted flag, reset state to UNSENT, fire onabort. |
| `setRequestHeader(name, value)` | Store in requestHeaders map. Only allowed in OPENED state. |
| `getResponseHeader(name)` | Return responseHeaders.get(name.toLowerCase()) or null |
| `getAllResponseHeaders()` | Return all headers as formatted string |
| `overrideMimeType(mime)` | Store MIME type (stub) |

#### Event Properties

All `on*` properties (`onreadystatechange`, `onload`, `onerror`, `onabort`, `onloadstart`, `onloadend`) are writable JSFunction properties. Set via normal property assignment.

#### send() Flow (async)

```
1. Validate state === OPENED
2. Fire 'readystatechange' event (readyState = OPENED)
3. Build fetch init: { method, headers, body }
4. Enqueue microtask:
   a. Try {
      response = await platformFetch(url, init)
      readyState = HEADERS_RECEIVED → fire readystatechange
      readyState = LOADING → fire readystatechange
      readyState = DONE → fire readystatechange
      status = response.statusCode
      statusText = response.statusText
      responseHeaders = response.headers
      responseText = response.body
      response = response.body
      fire 'load'
      fire 'loadend'
   } catch (err) {
      if (aborted) {
         fire 'abort'
         fire 'loadend'
      } else {
         status = 0
         fire 'error'
         fire 'loadend'
      }
   }
```

**Note:** Since the platform `fetch()` is async, we must wrap the entire send flow in an async function called from a microtask. The `EventLoop.enqueueMicrotask()` takes a synchronous callback, so we use a pattern like:

```typescript
eventLoop.enqueueMicrotask(async () => {
  try {
    const response = await platformFetch(url, init);
    // ... fire events
  } catch { ... }
});
```

Wait — `enqueueMicrotask` expects `() => void`, not `() => Promise<void>`. The async function returns a Promise which is silently dropped. That's fine — the microtask queue is drained synchronously, and the async continuation happens after the current drain. We need to ensure the event loop drains again after the async resolution.

**Better approach:** Use `eventLoop.schedule(() => { ... }, 0)` for the actual fetch call. This ensures the async fetch completes and the callback runs in a new task, not a microtask. Then fire events synchronously within that callback.

**Even better:** Since we're inside the JS engine and `drainMicrotasks()` is called after each task, we should:
1. Start the async fetch
2. When it resolves, schedule a microtask to fire the events
3. The microtask fires the XHR events synchronously (calling listeners, updating state)

```typescript
sendFn = (_this, args) => {
  const body = args[0];
  const xhrObj = _this as JSObject;
  const state = xhrStates.get(xhrObj)!;
  
  // Set readyState = OPENED, fire readystatechange
  
  eventLoop.enqueueMicrotask(async () => {
    // Make the fetch call
    const response = await platformFetch(state.url, { ... });
    
    // Fire events synchronously via another microtask
    eventLoop.enqueueMicrotask(() => {
      state.readyState = HEADERS_RECEIVED;
      fireEvent(xhrObj, 'readystatechange');
      // ... etc
    });
  });
};
```

Actually, looking at the event loop more carefully: `drainMicrotasks()` runs all queued microtasks synchronously. If we queue a microtask that's async, it will start, return a Promise, and the rest of the microtask queue continues. The Promise resolution will be picked up in the next drain cycle.

For XHR events, the cleanest approach is:

```typescript
eventLoop.enqueueMicrotask(async () => {
  try {
    const res = await platformFetch(url, fetchInit);
    // Store response data in state
    // Queue microtask for each state change event
    eventLoop.enqueueMicrotask(() => {
      state.readyState = HEADERS_RECEIVED;
      fireEvent(xhrObj, 'readystatechange');
      state.readyState = LOADING;
      fireEvent(xhrObj, 'readystatechange');
      state.readyState = DONE;
      fireEvent(xhrObj, 'readystatechange');
      fireEvent(xhrObj, 'load');
      fireEvent(xhrObj, 'loadend');
    });
  } catch (err) {
    eventLoop.enqueueMicrotask(() => {
      if (state.aborted) {
        fireEvent(xhrObj, 'abort');
      } else {
        fireEvent(xhrObj, 'error');
      }
      fireEvent(xhrObj, 'loadend');
    });
  }
});
```

This works because:
1. First microtask: starts the async fetch, returns immediately
2. Platform fetch resolves (in a future microtask drain or task)
3. The `.then` handler queues a new microtask with the state changes
4. Next `drainMicrotasks()` call picks it up and fires events synchronously

**Actually there's a subtlety:** The async function's continuation (after `await`) is itself a microtask. So after `await platformFetch(...)`, the code after the await runs as a microtask. Then it queues *another* microtask for the events. This means there are two levels of async indirection. The events will fire in a later drain cycle, which is correct browser behavior (events should fire asynchronously relative to `send()`).

#### getResponseHeader / getAllResponseHeaders

```typescript
getResponseHeader: (xhrObj, name) => {
  const state = xhrStates.get(xhrObj)!;
  if (state.readyState < HEADERS_RECEIVED) return null;
  return state.responseHeaders.get(name.toLowerCase()) ?? null;
}

getAllResponseHeaders: (xhrObj) => {
  const state = xhrStates.get(xhrObj)!;
  if (state.readyState < HEADERS_RECEIVED) return '';
  const lines: string[] = [];
  for (const [key, value] of state.responseHeaders) {
    lines.push(`${key}: ${value}`);
  }
  return lines.sort().join('\r\n');
}
```

---

### File 4: `src/browser/js/index.ts` (MODIFY)

**Changes to `createGlobalEnv()`:**

1. Import the new classes from `./fetch-api` and `./xhr`
2. Create `Headers` constructor, `Response` constructor, `Request` constructor, `AbortController` constructor
3. Register all four as globals: `env.setLocal('Headers', headersCtor)`
4. Register `fetch` function: `env.setLocal('fetch', fetchFn)`
5. Register `XMLHttpRequest` constructor: `env.setLocal('XMLHttpRequest', xhrCtor)`

**Order:** After the `Promise` registration (if any) and before `IntersectionObserver`. Actually, `Promise` is registered in the interpreter's own `createGlobalEnv`, not in `index.ts`'s `createGlobalEnv`. We register in `index.ts` since that's the production path.

**EventLoop dependency:** `createGlobalEnv` in `index.ts` receives `eventLoop` as a parameter, so we pass it to each class factory.

**Platform fetch reference:** We pass `globalThis.fetch` (or the `FetchHttpClient`'s fetch) to the fetch module. In the browser context, `globalThis.fetch` is available. For testing, we mock it.

**New imports to add:**
```typescript
import { createHeadersClass, createResponseClass, createRequestClass, createAbortControllerClass, createFetchFn } from './fetch-api';
import { createXMLHttpRequestClass } from './xhr';
```

**Registration block (add after existing globals, before IntersectionObserver):**
```typescript
// Fetch API
const HeadersCtor = createHeadersClass(eventLoop);
env.setLocal('Headers', HeadersCtor);

const ResponseCtor = createResponseClass(eventLoop);
env.setLocal('Response', ResponseCtor);

const RequestCtor = createRequestClass(eventLoop);
env.setLocal('Request', RequestCtor);

const AbortControllerCtor = createAbortControllerClass(eventLoop);
env.setLocal('AbortController', AbortControllerCtor);

env.setLocal('fetch', createFetchFn(eventLoop));

// XMLHttpRequest
env.setLocal('XMLHttpRequest', createXMLHttpRequestClass(eventLoop));
```

---

### File 5: `tests/fetch-api.test.ts` (NEW)

**Test helper:** Same pattern as `promise.test.ts` — create Interpreter + Lexer + Parser, inject platform `fetch` mock.

**How to mock `fetch`:** The `fetch()` function inside `fetch-api.ts` uses `globalThis.fetch` (or a reference passed at construction). For tests, we set `globalThis.fetch = vi.fn()` before each test.

Actually, looking at how `createGlobalEnv` works in `index.ts`, the `fetch` implementation needs access to the platform `fetch`. The cleanest approach: `createFetchFn(eventLoop, platformFetch?)` where `platformFetch` defaults to `globalThis.fetch`. Tests can pass a mock.

**Test Cases:**

```
describe('Headers')
  - should create empty Headers
  - should create Headers from object
  - should get/set/has/delete headers (case-insensitive)
  - should append headers with comma separator
  - should iterate entries/keys/values

describe('Response')
  - should create Response with body and status
  - should default to 200 OK
  - should have correct ok getter
  - should parse JSON via json()
  - should return text via text()
  - should clone Response
  - should expose headers
  - should track bodyUsed

describe('Request')
  - should create Request with URL
  - should default method to GET
  - should accept init with method/headers/body
  - should clone Request

describe('AbortController')
  - should create AbortController
  - should have signal with aborted=false
  - should set aborted=true on abort()
  - should throw on signal.throwIfAborted() after abort

describe('fetch()')
  - should call platform fetch with correct URL
  - should send GET by default
  - should send POST with body
  - should send custom headers
  - should return Response object on success
  - should reject on network error
  - should handle JSON responses
  - should handle abort via AbortController
  - should follow redirects (platform behavior)
  - should reject on invalid URL
```

---

### File 6: `tests/xhr.test.ts` (NEW)

**Test helper:** Same pattern. Mock `globalThis.fetch`.

**Test Cases:**

```
describe('XMLHttpRequest')
  describe('constructor')
    - should create XHR with readyState UNSENT
    - should have default property values

  describe('readyState constants')
    - should have UNSENT=0, OPENED=1, HEADERS_RECEIVED=2, LOADING=3, DONE=4

  describe('open()')
    - should set readyState to OPENED
    - should store method and URL
    - should default to GET
    - should throw if called twice without send

  describe('setRequestHeader()')
    - should store headers
    - should throw if readyState < OPENED

  describe('send()')
    - should fire readystatechange events in correct order
    - should fire onload on success
    - should fire onloadend after load/error/abort
    - should set status/statusText from response
    - should set responseText from response body
    - should fire onerror on network failure
    - should fire onabort after abort()

  describe('getResponseHeader()')
    - should return header value (case-insensitive)
    - should return null for missing header
    - should return null before HEADERS_RECEIVED

  describe('getAllResponseHeaders()')
    - should return formatted header string
    - should return empty string before HEADERS_RECEIVED

  describe('abort()')
    - should reset to UNSENT
    - should fire onabort event
    - should fire onloadend after onabort
    - should set aborted flag preventing further events

  describe('addEventListener/removeEventListener')
    - should add and fire event listeners
    - should remove event listeners
    - should support multiple listeners per event type
    - should call on* properties

  describe('timeout/withCredentials/responseType')
    - should allow setting timeout
    - should allow setting withCredentials
    - should allow setting responseType
```

---

## Implementation Order

| Step | File | Depends On | Effort |
|------|------|------------|--------|
| 1 | `src/browser/js/fetch-api.ts` | values.ts, promise.ts, event-loop.ts | Large (~400 lines) |
| 2 | `src/browser/js/xhr-bindings.ts` | values.ts | Small (~80 lines) |
| 3 | `src/browser/js/xhr.ts` | values.ts, xhr-bindings.ts, event-loop.ts | Medium (~300 lines) |
| 4 | `src/browser/js/index.ts` (modify) | Steps 1-3 | Small (20 lines added) |
| 5 | `tests/fetch-api.test.ts` | Steps 1, 4 | Medium (~200 lines) |
| 6 | `tests/xhr.test.ts` | Steps 2-4 | Medium (~250 lines) |

**Why this order:** `fetch-api.ts` is self-contained and can be built first. `xhr-bindings.ts` is a small helper that `xhr.ts` depends on. `index.ts` wiring happens after all pieces exist. Tests come last.

---

## Potential Pitfalls

### 1. Async Event Firing in XHR

The `send()` method must fire events asynchronously. If we fire them synchronously inside `send()`, tests will see events before `send()` returns — wrong behavior. Solution: wrap the entire fetch + event firing in an `enqueueMicrotask` that contains an async function.

### 2. Headers Case Sensitivity

HTTP headers are case-insensitive per spec. All internal storage must lowercase keys. This is critical for `getResponseHeader()` which is case-insensitive.

### 3. Body Consumption

Per spec, a Response body can only be consumed once. After calling `.json()` or `.text()`, `bodyUsed` becomes `true` and subsequent calls should throw. However, since we store the body as a string, we can simplify: `clone()` creates a deep copy, and we track `bodyUsed` per-instance.

### 4. Promise Integration for fetch()

`createFetchFn` needs the `EventLoop` reference to create Promises. The Promise constructor from `promise.ts` requires `eventLoop` as a parameter. We create the Promise via the same pattern as `createPromiseObj` — but that's not exported.

**Solution:** Export `createPromiseObj` and `fulfillPromise`/`rejectPromise` from `promise.ts`, OR use the `Promise` constructor that's already on the global env. Since we're building a native function, we can call `callJSFunction` on the `Promise` constructor.

**Better solution:** Add a helper `createPromiseWithEventLoop(eventLoop, executor)` to `promise.ts` that's equivalent to `new Promise(executor)` but callable from native code. This avoids circular dependencies.

### 5. Platform `fetch` Reference

In Node.js test environment, `globalThis.fetch` is available (Node 18+). But we should be explicit: `createFetchFn` accepts an optional `platformFetch` parameter.

### 6. Prototype Chain for `new Response()`

The interpreter's `evalNew` for callable JSObjects (line 822-827) calls `obj.nativeFn!(createObject(null), args)` and returns the result if it's an object. This means our constructor receives `createObject(null)` as `this` (which we ignore) and must return a fully formed JSObject. The returned object won't automatically get the prototype methods.

**Fix:** Set `__proto__` on the returned object to point to the prototype, OR attach all instance methods directly in the constructor (not on prototype). For simplicity and performance, attach methods directly on each instance via a helper function. This avoids prototype chain issues.

Actually, re-reading the code: `evalNew` line 825 passes `createObject(null)` as `this`, and line 826 returns `result` if it's an object. So our constructor can create and return a new JSObject with all methods attached. We don't need prototype at all — each instance gets its own methods. This is slightly wasteful but safe.

**Alternative:** Store methods on a shared prototype object and set `instance.prototype = sharedProto`. Then the interpreter's property lookup (which walks the prototype chain) will find them. Let me check how property access works...

Looking at `interpreter.ts`, property access uses `getProperty` which does walk the prototype chain. So setting `instance.prototype = methodHolder` would work. But for simplicity and to avoid edge cases, we attach methods directly on instances. The overhead is minimal since these objects are created infrequently.

### 7. Circular Imports

`fetch-api.ts` needs `createPromiseObj` from `promise.ts`. `promise.ts` doesn't import anything from `fetch-api.ts`. So no circular dependency issue — just a one-way import.

---

## Summary of Modifications

| File | Action | Lines Added (est.) |
|------|--------|-------------------|
| `src/browser/js/fetch-api.ts` | CREATE | ~400 |
| `src/browser/js/xhr-bindings.ts` | CREATE | ~80 |
| `src/browser/js/xhr.ts` | CREATE | ~300 |
| `src/browser/js/index.ts` | MODIFY | +20 |
| `src/browser/js/promise.ts` | MODIFY | +15 (export helpers) |
| `tests/fetch-api.test.ts` | CREATE | ~200 |
| `tests/xhr.test.ts` | CREATE | ~250 |

**Estimated total:** ~1,265 new lines, ~35 modified lines.
