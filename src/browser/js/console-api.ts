// ─────────────────────────────────────────────────────────────────────────────
// CONSOLE — window.console, with a real structured, externally-readable log
// ─────────────────────────────────────────────────────────────────────────────
//
// Previously, console.log/warn/error/info pushed raw values into a local
// array that nothing outside this one closure could ever read — a write-only
// sink. That's the root reason a DevTools Console panel could never exist:
// there was no way for anything outside the JS engine to see what a page had
// logged. This gives each entry a level + timestamp and a real display
// string, and exposes the whole log via getConsoleLog(consoleObj) so a
// DevTools UI (or a test, or this session) can actually read it back.

import type { JSValue, JSObject, JSObjectWithMeta } from './values';
import { createObject, createNativeFunction, toString } from './values';

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface ConsoleEntry {
  level: ConsoleLevel;
  args: JSValue[];
  /** Pre-formatted display text, e.g. for a DevTools panel to render directly. */
  text: string;
  timestamp: number;
}

export type ConsoleListener = (entry: ConsoleEntry) => void;

interface ConsoleState {
  entries: ConsoleEntry[];
  listeners: Set<ConsoleListener>;
}

const consoleState = new WeakMap<JSObject, ConsoleState>();

/** Read the structured log for a `console` object created by createConsoleObject(). */
export function getConsoleLog(consoleObj: JSValue): ConsoleEntry[] {
  const state = typeof consoleObj === 'object' && consoleObj !== null ? consoleState.get(consoleObj as JSObject) : undefined;
  return state ? [...state.entries] : [];
}

/** Subscribe to new console entries as they're logged (for a live DevTools panel). Returns an unsubscribe function. */
export function onConsoleMessage(consoleObj: JSValue, listener: ConsoleListener): () => void {
  const state = typeof consoleObj === 'object' && consoleObj !== null ? consoleState.get(consoleObj as JSObject) : undefined;
  if (!state) return () => {};
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

/** Render a JSValue the way a real console does: unquoted at top level, quoted/nested when inside an array or object. */
function formatValue(v: JSValue, depth: number, seen: Set<JSObject>, quoteStrings: boolean): string {
  if (typeof v === 'string') return quoteStrings ? `'${v}'` : v;
  if (typeof v !== 'object' || v === null) return toString(v);

  const obj = v as JSObjectWithMeta;
  if (seen.has(obj)) return '[Circular]';
  if (depth > 4) return obj.type === 'array' ? '[Array]' : '[Object]';
  if ('closure' in obj || obj.type === 'function' || obj.type === 'class') {
    const name = (obj as { name?: string }).name;
    return `[Function: ${name || 'anonymous'}]`;
  }

  seen.add(obj);
  try {
    if (obj.type === 'array') {
      const len = Number(obj.properties.get('length')?.value ?? 0);
      const items: string[] = [];
      for (let i = 0; i < len; i++) items.push(formatValue(obj.properties.get(String(i))?.value as JSValue, depth + 1, seen, true));
      return `[ ${items.join(', ')} ]`;
    }
    const parts: string[] = [];
    for (const [key, prop] of obj.properties) {
      if (prop.enumerable === false) continue;
      const val = prop.getter ? '[Getter]' : prop.value as JSValue;
      parts.push(`${key}: ${formatValue(val, depth + 1, seen, true)}`);
    }
    return parts.length ? `{ ${parts.join(', ')} }` : '{}';
  } finally {
    seen.delete(obj);
  }
}

function formatArgs(args: JSValue[]): string {
  return args.map((a) => formatValue(a, 0, new Set(), false)).join(' ');
}

export function createConsoleObject(): JSObject {
  const consoleObj = createObject(null);
  const state: ConsoleState = { entries: [], listeners: new Set() };
  consoleState.set(consoleObj, state);

  const record = (level: ConsoleLevel, args: JSValue[]): void => {
    const entry: ConsoleEntry = { level, args, text: formatArgs(args), timestamp: Date.now() };
    state.entries.push(entry);
    for (const listener of state.listeners) {
      try { listener(entry); } catch { /* a broken devtools listener shouldn't break page console output */ }
    }
  };

  const def = (name: ConsoleLevel | 'clear' | 'assert' | 'trace' | 'count'): void => {
    consoleObj.properties.set(name, {
      value: createNativeFunction(name, (_this, args) => {
        switch (name) {
          case 'clear':
            state.entries.length = 0;
            return undefined;
          case 'assert':
            if (!args[0]) record('error', ['Assertion failed:', ...args.slice(1)]);
            return undefined;
          case 'trace':
            record('debug', ['Trace:', ...args]);
            return undefined;
          case 'count': {
            const label = args.length ? toString(args[0]) : 'default';
            record('debug', [`${label}: (count not tracked across calls)`]);
            return undefined;
          }
          default:
            record(name, args);
            return undefined;
        }
      }),
      writable: true, enumerable: true, configurable: true,
    });
  };

  (['log', 'info', 'warn', 'error', 'debug'] as const).forEach(def);
  def('clear');
  def('assert');
  def('trace');
  def('count');

  consoleObj.properties.set('table', {
    // Simplification: real console.table renders a grid; without a UI panel
    // to draw it, formatting as a plain log entry keeps output visible
    // instead of being a silent no-op.
    value: createNativeFunction('table', (_this, args) => { record('log', args); return undefined; }),
    writable: true, enumerable: true, configurable: true,
  });

  return consoleObj;
}
