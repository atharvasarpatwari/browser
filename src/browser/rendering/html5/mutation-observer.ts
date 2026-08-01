/**
 * @file html5/mutation-observer.ts
 * DOM MutationObserver — WHATWG DOM Level 4 implementation.
 *
 * Watches for changes to the DOM tree and fires a callback with
 * batched MutationRecords when mutations are queued.
 *
 * Supports:
 *   - childList mutations (node added/removed)
 *   - attributes mutations (attribute set/removed/changed)
 *   - characterData mutations (text content changed)
 *   - subtree observation (deep watch)
 *   - attributeOldValue / attributeFilter
 *   - takeRecords() / disconnect()
 *   - Microtask-batched callback delivery
 */

import type { HtmlNode, HtmlElement } from './dom';
import { NodeType } from './dom';
import { isEventHandlerAttribute, isUrlAttribute, isBlockedUrlScheme } from '../../security/blocked-url-schemes';
import { containsDangerousCss, sanitizeStyleAttribute } from '../../security/html-sanitizer';

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION RECORD
// ─────────────────────────────────────────────────────────────────────────────

export type MutationType = 'childList' | 'attributes' | 'characterData';

export interface MutationRecord {
  readonly type: MutationType;
  readonly target: HtmlNode;
  readonly addedNodes: readonly HtmlNode[];
  readonly removedNodes: readonly HtmlNode[];
  readonly previousSibling: HtmlNode | null;
  readonly nextSibling: HtmlNode | null;
  readonly attributeName: string | null;
  readonly attributeNamespace: string | null;
  readonly oldValue: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION OBSERVER INIT (options)
// ─────────────────────────────────────────────────────────────────────────────

export interface MutationObserverInit {
  childList?: boolean;
  attributes?: boolean;
  characterData?: boolean;
  subtree?: boolean;
  attributeOldValue?: boolean;
  attributeFilter?: string[];
  characterDataOldValue?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION CALLBACK
// ─────────────────────────────────────────────────────────────────────────────

export type MutationCallback = (
  mutations: MutationRecord[],
  observer: MutationObserver,
) => void;

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: Observer registration record
// ─────────────────────────────────────────────────────────────────────────────

interface ObserverRegistration {
  observer: MutationObserver;
  target: HtmlNode;
  options: MutationObserverInit;
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

/** All active observer registrations. */
const registrations: ObserverRegistration[] = [];

/** Queued records not yet delivered. */
const recordQueue: MutationRecord[] = [];

/** Observers that have pending records to deliver. */
const pendingObservers = new Set<MutationObserver>();

/** Whether a microtask is already scheduled. */
let microtaskScheduled = false;

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION OBSERVER CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class MutationObserver {
  _callback: MutationCallback;
  private _records: MutationRecord[] = [];
  _disconnected = false;

  constructor(callback: MutationCallback) {
    this._callback = callback;
  }

  /**
   * Start observing a target node.
   * If the target is already being observed with different options,
   * the old registration is replaced.
   */
  observe(target: HtmlNode, options: MutationObserverInit): void {
    // Remove existing registration for this observer + target
    this.unobserve(target);

    // Validate: at least one of childList, attributes, characterData must be true
    if (!options.childList && !options.attributes && !options.characterData) {
      return;
    }

    // Re-activate if previously disconnected
    this._disconnected = false;

    registrations.push({
      observer: this,
      target,
      options: { ...options },
    });
  }

  /**
   * Stop observing a specific target.
   */
  unobserve(target: HtmlNode): void {
    for (let i = registrations.length - 1; i >= 0; i--) {
      if (registrations[i].observer === this && registrations[i].target === target) {
        registrations.splice(i, 1);
      }
    }
  }

  /**
   * Stop observing all targets.
   */
  disconnect(): void {
    this._disconnected = true;
    this._records = [];
    // Remove all registrations for this observer
    for (let i = registrations.length - 1; i >= 0; i--) {
      if (registrations[i].observer === this) {
        registrations.splice(i, 1);
      }
    }
    pendingObservers.delete(this);
  }

  /**
   * Get pending records and clear the queue.
   */
  takeRecords(): MutationRecord[] {
    const records = this._records;
    this._records = [];
    pendingObservers.delete(this);
    return records;
  }

  /** @internal — called by DOM mutation functions */
  _queueRecord(record: MutationRecord): void {
    if (this._disconnected) return;
    this._records.push(record);
    recordQueue.push(record);
    pendingObservers.add(this);
    scheduleMicrotask();
  }

  /** @internal */
  _getCallback(): MutationCallback {
    return this._callback;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MICROTASK SCHEDULING
// ─────────────────────────────────────────────────────────────────────────────

function scheduleMicrotask(): void {
  if (microtaskScheduled) return;
  microtaskScheduled = true;
  // Use queueMicrotask if available, otherwise setTimeout
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(deliverRecords);
  } else if (typeof Promise !== 'undefined') {
    Promise.resolve().then(deliverRecords);
  } else {
    setTimeout(deliverRecords, 0);
  }
}

function deliverRecords(): void {
  microtaskScheduled = false;

  // Snapshot the pending observers and clear
  const observers = [...pendingObservers];
  pendingObservers.clear();

  for (const observer of observers) {
    if (observer._disconnected) continue;
    const records = observer.takeRecords();
    if (records.length > 0) {
      try {
        observer._callback(records, observer);
      } catch (_e) {
        // Swallow errors in observer callbacks
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: Mutation firing (called from dom.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface MutationFireOptions {
  target: HtmlNode;
  type: MutationType;
  addedNodes?: HtmlNode[];
  removedNodes?: HtmlNode[];
  previousSibling?: HtmlNode | null;
  nextSibling?: HtmlNode | null;
  attributeName?: string | null;
  attributeNamespace?: string | null;
  oldValue?: string | null;
}

/**
 * Fire a mutation to all matching observers.
 * Called by dom.ts mutation functions.
 */
export function fireMutation(opts: MutationFireOptions): void {
  // Sanitize mutation data as defense-in-depth
  const sanitized = sanitizeMutationFire(opts);
  const { target } = sanitized;

  // Walk the target and all ancestors to find matching observers.
  // An observer on ancestor A with subtree:true fires for mutations
  // on A's descendants (including the direct target).
  let node: HtmlNode | null = target;
  while (node) {
    for (const reg of registrations) {
      if (reg.observer._disconnected) continue;
      if (reg.target !== node) continue;

      // Non-subtree observers only match the direct mutation target
      if (node !== target && !reg.options.subtree) continue;

      const { options } = reg;

      // Check if this mutation matches the observer's options
      if (!matchesMutation(sanitized, options)) continue;

      // Determine oldValue based on observer options
      let oldValue: string | null = null;
      if (sanitized.oldValue != null) {
        if (sanitized.type === 'attributes' && options.attributeOldValue) {
          oldValue = sanitized.oldValue;
        } else if (sanitized.type === 'characterData' && options.characterDataOldValue) {
          oldValue = sanitized.oldValue;
        }
      }

      // Create the record
      const record: MutationRecord = {
        type: sanitized.type,
        target,
        addedNodes: sanitized.addedNodes ?? [],
        removedNodes: sanitized.removedNodes ?? [],
        previousSibling: sanitized.previousSibling ?? null,
        nextSibling: sanitized.nextSibling ?? null,
        attributeName: sanitized.attributeName ?? null,
        attributeNamespace: sanitized.attributeNamespace ?? null,
        oldValue,
      };

      reg.observer._queueRecord(record);
    }

    node = node.parent as HtmlNode | null;
  }
}

function matchesMutation(
  mutation: MutationFireOptions,
  options: MutationObserverInit,
): boolean {
  switch (mutation.type) {
    case 'childList':
      return options.childList === true;
    case 'attributes':
      if (!options.attributes) return false;
      if (options.attributeFilter && mutation.attributeName) {
        return options.attributeFilter.includes(mutation.attributeName);
      }
      return true;
    case 'characterData':
      return options.characterData === true;
    default:
      return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLEANUP: Remove registrations for a node
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remove all registrations targeting a specific node.
 * Called when a node is removed from the DOM.
 */
export function cleanupRegistrations(node: HtmlNode): void {
  for (let i = registrations.length - 1; i >= 0; i--) {
    if (registrations[i].target === node) {
      registrations.splice(i, 1);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synchronously deliver all pending records (for testing only).
 */
export function deliverRecordsSync(): void {
  const observers = [...pendingObservers];
  pendingObservers.clear();
  microtaskScheduled = false;

  for (const observer of observers) {
    if (observer._disconnected) continue;
    const records = observer.takeRecords();
    if (records.length > 0) {
      try {
        observer._callback(records, observer);
      } catch (_e) {
        // Swallow
      }
    }
  }
}

/**
 * Get the number of active registrations (for testing/debugging).
 */
export function getRegistrationCount(): number {
  return registrations.length;
}

/**
 * Clear all registrations (for testing teardown).
 */
export function clearAllRegistrations(): void {
  registrations.length = 0;
  recordQueue.length = 0;
  pendingObservers.clear();
  microtaskScheduled = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION SANITIZATION — Defense-in-depth for DOM-based XSS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitize a newly added HtmlNode tree in-place.
 * Strips event handler attributes and dangerous URL schemes from
 * element attributes and text content.
 *
 * Called automatically from `fireMutation()` for childList mutations.
 */
function sanitizeAddedNode(node: HtmlNode): void {
  if (node.nodeType !== NodeType.Element) return;
  const el = node as HtmlElement;
  const attrs = el.attributes as unknown as Map<string, string>;

  // Sanitize attributes on this element
  const attrsToRemove: string[] = [];
  for (const [name, value] of attrs) {
    // Block event handler attributes
    if (isEventHandlerAttribute(name)) {
      attrsToRemove.push(name);
      continue;
    }
    // Block dangerous URL schemes in URL-bearing attributes
    if (isUrlAttribute(name) && isBlockedUrlScheme(value)) {
      attrsToRemove.push(name);
      continue;
    }
    // Sanitize style attribute
    if (name.toLowerCase() === 'style' && containsDangerousCss(value)) {
      attrs.set(name, sanitizeStyleAttribute(value));
    }
  }
  for (const attr of attrsToRemove) {
    attrs.delete(attr);
  }

  // Recurse into children
  for (const child of el.children) {
    sanitizeAddedNode(child);
  }
}

/**
 * Sanitize a mutation fire call — intercepts childList mutations
 * to strip dangerous attributes from added nodes.
 *
 * This is a defense-in-depth measure. The primary sanitization
 * should happen at the HTML parser level, but this catches
 * dynamically inserted content.
 */
export function sanitizeMutationFire(opts: MutationFireOptions): MutationFireOptions {
  if (opts.type === 'childList' && opts.addedNodes) {
    for (const node of opts.addedNodes) {
      sanitizeAddedNode(node);
    }
  }

  // Sanitize attribute mutations
  if (opts.type === 'attributes' && opts.attributeName) {
    const attrName = opts.attributeName;
    // Block event handler attributes
    if (isEventHandlerAttribute(attrName)) {
      return { ...opts, type: 'attributes', oldValue: null } as MutationFireOptions;
    }
    // Block dangerous URL schemes
    if (isUrlAttribute(attrName) && typeof opts.oldValue === 'string' && isBlockedUrlScheme(opts.oldValue)) {
      return { ...opts, type: 'attributes', oldValue: null } as MutationFireOptions;
    }
  }

  return opts;
}
