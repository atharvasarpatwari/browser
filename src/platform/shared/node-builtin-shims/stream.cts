/**
 * @file src/platform/shared/node-builtin-shims/stream.ts
 *
 * CJS shim for `stream`. Bundled libraries that `require('stream')` resolve
 * here instead of the empty `__vite-browser-external` shim. In the packaged
 * Electron build the real Node stream is returned; in a plain browser a
 * minimal EventEmitter-based constructor keeps bundled libs loadable.
 */
import { loadNodeBuiltin } from './loader';

const realStream = loadNodeBuiltin('stream');

function MiniEmitter(this: { _events?: Map<string, unknown[]> }) {
  this._events = new Map();
}
MiniEmitter.prototype.on = function (this: { _events: Map<string, unknown[]> }, evt: string, fn: (...args: unknown[]) => void) {
  const list = this._events.get(evt) ?? [];
  list.push(fn);
  this._events.set(evt, list);
  return this;
};
MiniEmitter.prototype.emit = function (this: { _events: Map<string, unknown[]> }, evt: string, ...args: unknown[]) {
  const list = this._events.get(evt) ?? [];
  for (const fn of list) {
    (fn as (...a: unknown[]) => void).apply(this, args);
  }
  return list.length > 0;
};
MiniEmitter.prototype.removeListener = function (this: { _events: Map<string, unknown[]> }, evt: string, fn: unknown) {
  const list = this._events.get(evt) ?? [];
  this._events.set(evt, list.filter((f) => f !== fn));
  return this;
};

// Node's real `stream` module exports the `Stream` constructor itself
// (callable directly as `Stream.call(this)`, e.g. in pngjs's ChunkStream),
// with the other stream classes attached to it as static properties.
const fallbackStream = MiniEmitter as unknown as Record<string, unknown>;
fallbackStream.Stream = MiniEmitter;
fallbackStream.Readable = MiniEmitter;
fallbackStream.Writable = MiniEmitter;
fallbackStream.Duplex = MiniEmitter;
fallbackStream.Transform = MiniEmitter;
fallbackStream.PassThrough = MiniEmitter;
export = realStream ?? (fallbackStream as unknown as typeof realStream);
