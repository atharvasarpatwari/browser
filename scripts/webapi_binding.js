/**
 * webapi_binding_demo.js
 * A single-file simulation of how browsers "bind" native (C++) Web APIs
 * into the JS engine's global scope — for both sync and async APIs.
 *
 * Layers modeled:
 *   1. Native (C++-like) implementation      -> NativeDOM
 *   2. Binding layer (V8 glue code)          -> bindToGlobal()
 *   3. Event loop / task queue (for async)   -> EventLoop
 *   4. Exposure on the global object         -> globalThis.document / setTimeout
 */

// ---------- 1. NATIVE LAYER (pretend C++ DOM engine) ----------
class NativeDOM {
  constructor() {
    this._elements = { body: { tag: "body", id: "body" } };
  }
  // Synchronous native call
  querySelector(selector) {
    console.log(`[native C++] querySelector("${selector}") executing...`);
    if (selector === "body") return this._elements.body;
    return null;
  }
}

// ---------- 2. EVENT LOOP (pretend browser task scheduler) ----------
const REAL_SET_TIMEOUT = globalThis.setTimeout.bind(globalThis); // capture native fn BEFORE we override it

class EventLoop {
  constructor() { this.queue = []; }
  postTask(fn, delayMs) {
    console.log(`[native scheduler] task queued, will fire in ${delayMs}ms`);
    // Simulate async native timer thread using the REAL underlying timer
    REAL_SET_TIMEOUT(() => this.queue.push(fn), delayMs);
  }
  run() {
    setInterval(() => {
      while (this.queue.length) {
        const task = this.queue.shift();
        console.log("[event loop] dequeuing task -> invoking JS callback");
        task();
      }
    }, 10);
  }
}

// ---------- 3. BINDING LAYER (V8 glue code equivalent) ----------
function bindWebAPIsToGlobal(target, nativeDom, loop) {
  // --- Sync binding: document.querySelector ---
  target.document = {
    querySelector(selector) {
      const nativeResult = nativeDom.querySelector(selector); // native call
      if (!nativeResult) return null;
      // Wrap native C++ object into a JS-facing object
      return { tagName: nativeResult.tag, id: nativeResult.id };
    }
  };

  // --- Async binding: setTimeout ---
  target.setTimeout = (callback, delayMs) => {
    loop.postTask(() => callback(), delayMs); // hand off to native scheduler
  };
}

// ---------- 4. WIRE IT UP (what the browser does at page load) ----------
const nativeDom = new NativeDOM();
const loop = new EventLoop();
bindWebAPIsToGlobal(globalThis, nativeDom, loop);
loop.run();

// ---------- YOUR "WEB PAGE" JS CODE ----------
console.log("--- page script starts ---");

const el = document.querySelector("body");   // sync Web API call
console.log("found element:", el);

setTimeout(() => {                           // async Web API call
  console.log("timer fired! (this ran via the event loop, not directly)");
}, 500);

console.log("--- sync code finished, waiting for async callback ---");
