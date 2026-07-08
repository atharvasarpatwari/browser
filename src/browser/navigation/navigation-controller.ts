/**
 * @file src/browser/navigation/navigation-controller.ts
 * @session 3
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Coordinate every navigation event for a single browser tab.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  UI  ──navigate(url)──▶  NavigationController               │
 *   │                               │                             │
 *   │               ┌───────────────▼────────────────┐            │
 *   │               │  1. UrlParser.parse(url)        │            │
 *   │               │  2. Run guard chain             │            │
 *   │               │  3. Detect hash-only change     │            │
 *   │               │  4. Push NavigationEntry        │            │
 *   │               │  5. Emit typed events           │            │
 *   │               └────────────────────────────────┘            │
 *   │                         ▼                                   │
 *   │              BrowserEngine listens for                      │
 *   │              "navigationCommitted" and fetches              │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Does NOT:
 *   • Fetch documents  (RequestManager's job)
 *   • Render content   (rendering pipeline's job)
 *   • Persist history  (HistoryService's job)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction       INavigationController is the only type callers use.
 *  Encapsulation     NavigationStack and NavigationEventEmitter are private
 *                    collaborators; their internals are invisible to consumers.
 *  Single-Resp.      Each helper class has exactly one reason to change:
 *                     • NavigationStack  — history cursor management
 *                     • NavigationEventEmitter — fan-out to typed listeners
 *                     • NavigationController   — state-machine logic
 *  Open / Closed     New guards are added without touching the controller.
 *                    New event types are added by extending the union, not
 *                    by editing existing emit() calls.
 *  Liskov-Subst.     INavigationController is fully honoured — no hidden
 *                    behaviour in the concrete class.
 *  Dependency-Inv.   Controller receives IUrlParser; never constructs UrlParser.
 */

import type { IUrlParser, ParsedUrl } from './url-parser';
import { UrlParseError } from './url-parser';

// ─────────────────────────────────────────────────────────────────────────────
// UNIQUE ID
// ─────────────────────────────────────────────────────────────────────────────

let _seq = 0;
function nextId(): string {
  return `nav-${Date.now()}-${(++_seq).toString(36)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The lifecycle state of the controller at any moment.
 *
 * Idle → Loading → Committed → Complete
 *                           ↘ Error
 *                           ↘ Stopped
 */
enum NavigationState {
  /** No navigation in progress. */
  Idle      = 'idle',
  /** URL validated, guards passed, fetch not yet committed. */
  Loading   = 'loading',
  /** History entry written; document fetch is underway. */
  Committed = 'committed',
  /** Document fully loaded. */
  Complete  = 'complete',
  /** An error occurred during navigation. */
  Error     = 'error',
  /** User or code called stop() before completion. */
  Stopped   = 'stopped',
}

/** How a navigation was initiated — used for analytics and guard decisions. */
enum NavigationType {
  /** User typed a URL or clicked a link → new history entry. */
  Push       = 'push',
  /** history.replaceState() or address-bar refinement → no new entry. */
  Replace    = 'replace',
  /** Browser back button or history.back(). */
  Back       = 'back',
  /** Browser forward button or history.forward(). */
  Forward    = 'forward',
  /** Reload button or Ctrl+R. */
  Reload     = 'reload',
  /** Same-page anchor jump — no new network request. */
  HashChange = 'hash-change',
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single immutable entry in the navigation history stack.
 * Scroll position is stored so it can be restored on back/forward.
 */
interface NavigationEntry {
  /** Opaque unique identifier. */
  readonly id: string;
  /** Canonical URL string (href from ParsedUrl). */
  readonly url: string;
  /** Page title at the time of navigation (updated by the renderer). */
  readonly title: string;
  /** Unix timestamp (ms) when the entry was created. */
  readonly timestamp: number;
  /** How this entry was created. */
  readonly type: NavigationType;
  /** Horizontal scroll offset to restore on back/forward. */
  readonly scrollX: number;
  /** Vertical scroll offset to restore on back/forward. */
  readonly scrollY: number;
  /** Fully parsed URL components for downstream use. */
  readonly parsedUrl: ParsedUrl;
}

/**
 * Describes an incoming navigation request before it is processed.
 * Guards and the event bus receive this before any state changes.
 */
interface NavigationRequest {
  /** Raw URL string exactly as received from the caller. */
  readonly url: string;
  /** How this navigation was triggered. */
  readonly type: NavigationType;
  /** URL of the page that initiated the navigation, if any. */
  readonly referrer?: string;
  /** True when initiated by an explicit user action (click, address bar). */
  readonly userInitiated: boolean;
}

/** The outcome of a navigation call. */
interface NavigationResult {
  /** True when the navigation reached at least the Committed state. */
  readonly success: boolean;
  /** The committed history entry on success. */
  readonly entry?: NavigationEntry;
  /** The error that caused the navigation to fail. */
  readonly error?: Error;
  /** Controller state at the time the result was produced. */
  readonly state: NavigationState;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────

/** All possible navigation event type strings. */
type NavigationEventType =
  | 'navigationStarted'
  | 'navigationCommitted'
  | 'navigationCompleted'
  | 'navigationFailed'
  | 'navigationStopped'
  | 'hashChanged'
  | 'canGoBackChanged'
  | 'canGoForwardChanged';

/** Fired when navigation is validated and guards have passed. */
interface NavigationStartedEvent {
  readonly kind: 'navigationStarted';
  readonly request: NavigationRequest;
  readonly parsedUrl: ParsedUrl;
}

/**
 * Fired when the history entry has been written and the document fetch
 * should begin.  BrowserEngine subscribes here.
 */
interface NavigationCommittedEvent {
  readonly kind: 'navigationCommitted';
  readonly entry: NavigationEntry;
}

/** Fired when the document has finished loading. */
interface NavigationCompletedEvent {
  readonly kind: 'navigationCompleted';
  readonly entry: NavigationEntry;
  /** Wall-clock milliseconds from navigationStarted to navigationCompleted. */
  readonly elapsedMs: number;
}

/** Fired when a navigation attempt fails. */
interface NavigationFailedEvent {
  readonly kind: 'navigationFailed';
  readonly request: NavigationRequest;
  readonly error: Error;
}

/** Fired when stop() is called. */
interface NavigationStoppedEvent {
  readonly kind: 'navigationStopped';
  /** The entry that was loading when stop() was called, if any. */
  readonly entry: NavigationEntry | null;
}

/** Fired for an in-page anchor jump — no network request is made. */
interface HashChangedEvent {
  readonly kind: 'hashChanged';
  readonly fromUrl: string;
  readonly toUrl: string;
  readonly hash: string;
}

/** Fired when the ability to navigate backwards changes. */
interface CanGoBackChangedEvent {
  readonly kind: 'canGoBackChanged';
  readonly value: boolean;
}

/** Fired when the ability to navigate forwards changes. */
interface CanGoForwardChangedEvent {
  readonly kind: 'canGoForwardChanged';
  readonly value: boolean;
}

/** Discriminated union of all navigation events. */
type NavigationEvent =
  | NavigationStartedEvent
  | NavigationCommittedEvent
  | NavigationCompletedEvent
  | NavigationFailedEvent
  | NavigationStoppedEvent
  | HashChangedEvent
  | CanGoBackChangedEvent
  | CanGoForwardChangedEvent;

// ─────────────────────────────────────────────────────────────────────────────
// GUARD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A guard is any object that can intercept and block a pending navigation.
 *
 * Examples: parental-control filter, corporate firewall, safe-browsing check.
 *
 * Guards run in registration order.  The first false response stops the chain.
 */
interface INavigationGuard {
  /** Identifier shown in NavigationBlockedError messages. */
  readonly name: string;
  /** Return false to block the navigation. */
  canNavigate(request: NavigationRequest): Promise<boolean>;
  /** Optional human-readable reason surfaced in the error and UI. */
  blockedReason?(request: NavigationRequest): string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface INavigationController {
  // ── Navigation actions ────────────────────────────────────────────────────
  /** Navigate to a URL, creating a new history entry. */
  navigate(url: string, referrer?: string): Promise<NavigationResult>;
  /** Full control — pass a NavigationRequest directly. */
  navigateTo(request: NavigationRequest): Promise<NavigationResult>;
  /** Move one step backwards in history. Synchronous. */
  back(): NavigationResult;
  /** Move one step forwards in history. Synchronous. */
  forward(): NavigationResult;
  /** Reload the current entry. */
  reload(): NavigationResult;
  /** Abort an in-progress navigation. */
  stop(): void;
  /** Navigate without creating a new history entry. */
  replace(url: string): Promise<NavigationResult>;

  // ── History state ──────────────────────────────────────────────────────────
  getCurrentEntry(): NavigationEntry | null;
  canGoBack(): boolean;
  canGoForward(): boolean;
  readonly state: NavigationState;
  /** Total entries in the back/forward stack. */
  readonly historyLength: number;

  // ── Guards ─────────────────────────────────────────────────────────────────
  addGuard(guard: INavigationGuard): void;
  removeGuard(guard: INavigationGuard): void;

  // ── Events ─────────────────────────────────────────────────────────────────
  on(type: NavigationEventType, handler: (event: NavigationEvent) => void): void;
  off(type: NavigationEventType, handler: (event: NavigationEvent) => void): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown when a guard returns false. */
class NavigationBlockedError extends Error {
  readonly request: NavigationRequest;
  readonly guardName: string;
  readonly reason: string;

  constructor(request: NavigationRequest, guardName: string, reason: string) {
    super(`Navigation to "${request.url}" blocked by guard "${guardName}": ${reason}`);
    this.name = 'NavigationBlockedError';
    this.request = request;
    this.guardName = guardName;
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when nothing can be reloaded or stepped through. */
class NoEntryError extends Error {
  constructor(action: string) {
    super(`Cannot perform "${action}": no current navigation entry.`);
    this.name = 'NoEntryError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION STACK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages the back / forward history list for one tab.
 *
 * Mental model:
 *   entries = [ e0, e1, e2, e3 ]
 *   cursor  =              ^
 *   canBack  → true (e2 exists)
 *   canForward → false (nothing after e3)
 *
 * On push: everything after the cursor is discarded, then the new entry
 *          is appended and the cursor advances.
 */
class NavigationStack {
  private readonly entries: NavigationEntry[] = [];
  private cursor = -1;
  private readonly maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  // ── Mutation ───────────────────────────────────────────────────────────────

  /**
   * Append a new entry and advance the cursor.
   * All "future" entries (after the cursor) are discarded.
   */
  push(entry: NavigationEntry): void {
    // Drop everything forward of the current position.
    if (this.cursor < this.entries.length - 1) {
      this.entries.splice(this.cursor + 1);
    }
    this.entries.push(entry);
    this.cursor = this.entries.length - 1;

    // Trim oldest entries when the stack exceeds maxSize.
    if (this.entries.length > this.maxSize) {
      const trimCount = this.entries.length - this.maxSize;
      this.entries.splice(0, trimCount);
      this.cursor = Math.max(0, this.cursor - trimCount);
    }
  }

  /**
   * Overwrite the entry at the current cursor position.
   * Equivalent to history.replaceState().
   */
  replace(entry: NavigationEntry): void {
    if (this.cursor >= 0) {
      this.entries[this.cursor] = entry;
    } else {
      this.push(entry);
    }
  }

  /** Move cursor backwards and return the new current entry, or null. */
  stepBack(): NavigationEntry | null {
    if (!this.canBack()) return null;
    this.cursor--;
    return this.current();
  }

  /** Move cursor forwards and return the new current entry, or null. */
  stepForward(): NavigationEntry | null {
    if (!this.canForward()) return null;
    this.cursor++;
    return this.current();
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  current(): NavigationEntry | null {
    return this.cursor >= 0 ? (this.entries[this.cursor] ?? null) : null;
  }

  canBack(): boolean {
    return this.cursor > 0;
  }

  canForward(): boolean {
    return this.cursor < this.entries.length - 1;
  }

  get length(): number {
    return this.entries.length;
  }

  /** Read-only snapshot — useful for HistoryService serialisation. */
  snapshot(): readonly NavigationEntry[] {
    return Object.freeze([...this.entries]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPED EVENT EMITTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lightweight event bus scoped to navigation events.
 *
 * Deliberately not extending Node.js EventEmitter so that this class
 * remains portable to browser and non-Node runtimes.
 */
class NavigationEventBus {
  private readonly channels = new Map<
    NavigationEventType,
    Set<(e: NavigationEvent) => void>
  >();

  on(type: NavigationEventType, handler: (e: NavigationEvent) => void): void {
    if (!this.channels.has(type)) {
      this.channels.set(type, new Set());
    }
    this.channels.get(type)!.add(handler);
  }

  off(type: NavigationEventType, handler: (e: NavigationEvent) => void): void {
    this.channels.get(type)?.delete(handler);
  }

  /**
   * Deliver `event` to every registered handler.
   * Handler exceptions are caught and logged so one bad listener cannot
   * prevent subsequent handlers from running.
   */
  emit(event: NavigationEvent): void {
    const handlers = this.channels.get(event.kind as NavigationEventType);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(
          `[NavigationEventBus] Handler threw on "${event.kind}":`,
          err,
        );
      }
    }
  }

  dispose(): void {
    this.channels.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Concrete INavigationController for one browser tab.
 *
 * Designed to be created by TabSession (or BrowserEngine in tests)
 * with a pre-wired IUrlParser instance from the DI container.
 */
class NavigationController implements INavigationController {

  private readonly parser:  IUrlParser;
  private readonly stack:   NavigationStack;
  private readonly bus:     NavigationEventBus;
  private readonly guards:  INavigationGuard[] = [];

  private _state:          NavigationState = NavigationState.Idle;
  private _navStartTime    = 0;
  private _abortController: AbortController | null = null;

  constructor(parser: IUrlParser, maxHistorySize = 100) {
    this.parser = parser;
    this.stack  = new NavigationStack(maxHistorySize);
    this.bus    = new NavigationEventBus();
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  get state(): NavigationState {
    return this._state;
  }

  get historyLength(): number {
    return this.stack.length;
  }

  // ── navigate / navigateTo ──────────────────────────────────────────────────

  navigate(url: string, referrer?: string): Promise<NavigationResult> {
    return this.navigateTo({
      url,
      type: NavigationType.Push,
      referrer,
      userInitiated: true,
    });
  }

  async navigateTo(request: NavigationRequest): Promise<NavigationResult> {

    // ── Step 1: URL parsing ──────────────────────────────────────────────────
    let parsedUrl: ParsedUrl;
    try {
      parsedUrl = this.parser.parse(request.url);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return this.fail(request, error);
    }

    // ── Step 2: Guard chain ──────────────────────────────────────────────────
    const guardOutcome = await this.runGuards(request);
    if (!guardOutcome.allowed) {
      return this.fail(
        request,
        new NavigationBlockedError(
          request,
          guardOutcome.blockedBy!,
          guardOutcome.reason!,
        ),
      );
    }

    // ── Step 3: Hash-only change ─────────────────────────────────────────────
    const current = this.stack.current();
    if (current !== null && this.isHashChange(current.parsedUrl, parsedUrl)) {
      return this.handleHashChange(current, parsedUrl);
    }

    // ── Step 4: Abort any in-flight navigation ───────────────────────────────
    if (this._state === NavigationState.Loading ||
        this._state === NavigationState.Committed) {
      this.stop();
    }

    // ── Step 5: Record state-machine transition ──────────────────────────────
    this._state       = NavigationState.Loading;
    this._navStartTime = Date.now();
    this._abortController = new AbortController();

    const prevCanBack    = this.stack.canBack();
    const prevCanForward = this.stack.canForward();

    this.bus.emit({
      kind: 'navigationStarted',
      request,
      parsedUrl,
    });

    // ── Step 6: Write history entry ──────────────────────────────────────────
    const entry: NavigationEntry = {
      id:        nextId(),
      url:       parsedUrl.href,
      title:     parsedUrl.hostname || parsedUrl.href,
      timestamp: Date.now(),
      type:      request.type,
      scrollX:   0,
      scrollY:   0,
      parsedUrl,
    };

    if (request.type === NavigationType.Replace ||
        request.type === NavigationType.Reload) {
      this.stack.replace(entry);
    } else {
      this.stack.push(entry);
    }

    this._state = NavigationState.Committed;
    this.bus.emit({ kind: 'navigationCommitted', entry });

    // Notify about back/forward availability changes.
    if (this.stack.canBack() !== prevCanBack) {
      this.bus.emit({ kind: 'canGoBackChanged', value: this.stack.canBack() });
    }
    if (this.stack.canForward() !== prevCanForward) {
      this.bus.emit({ kind: 'canGoForwardChanged', value: this.stack.canForward() });
    }

    // ── Step 7: Complete ─────────────────────────────────────────────────────
    // BrowserEngine (not yet implemented) will listen for 'navigationCommitted'
    // and call completeNavigation() when the document is fully loaded.
    // Until that layer exists, we mark Complete immediately so the controller
    // is testable in isolation.
    this._state = NavigationState.Complete;
    const elapsedMs = Date.now() - this._navStartTime;
    this.bus.emit({ kind: 'navigationCompleted', entry, elapsedMs });

    return { success: true, entry, state: NavigationState.Complete };
  }

  // ── back / forward ─────────────────────────────────────────────────────────

  back(): NavigationResult {
    const prevCanForward = this.stack.canForward();
    const entry = this.stack.stepBack();

    if (entry === null) {
      return this.fail(
        { url: '', type: NavigationType.Back, userInitiated: true },
        new Error('Cannot go back: already at the beginning of history.'),
      );
    }

    if (!prevCanForward) {
      this.bus.emit({ kind: 'canGoForwardChanged', value: true });
    }
    if (!this.stack.canBack()) {
      this.bus.emit({ kind: 'canGoBackChanged', value: false });
    }

    this._state = NavigationState.Complete;
    this.bus.emit({ kind: 'navigationCommitted', entry });
    return { success: true, entry, state: NavigationState.Complete };
  }

  forward(): NavigationResult {
    const prevCanBack = this.stack.canBack();
    const entry = this.stack.stepForward();

    if (entry === null) {
      return this.fail(
        { url: '', type: NavigationType.Forward, userInitiated: true },
        new Error('Cannot go forward: already at the end of history.'),
      );
    }

    if (!prevCanBack) {
      this.bus.emit({ kind: 'canGoBackChanged', value: true });
    }
    if (!this.stack.canForward()) {
      this.bus.emit({ kind: 'canGoForwardChanged', value: false });
    }

    this._state = NavigationState.Complete;
    this.bus.emit({ kind: 'navigationCommitted', entry });
    return { success: true, entry, state: NavigationState.Complete };
  }

  // ── reload ─────────────────────────────────────────────────────────────────

  reload(): NavigationResult {
    const current = this.stack.current();
    if (current === null) {
      return this.fail(
        { url: '', type: NavigationType.Reload, userInitiated: true },
        new NoEntryError('reload'),
      );
    }

    void this.navigateTo({
      url:           current.url,
      type:          NavigationType.Reload,
      userInitiated: true,
    });

    return { success: true, entry: current, state: NavigationState.Loading };
  }

  // ── stop ───────────────────────────────────────────────────────────────────

  stop(): void {
    if (this._abortController !== null) {
      this._abortController.abort();
      this._abortController = null;
    }
    const current = this.stack.current();
    this._state = NavigationState.Stopped;
    this.bus.emit({ kind: 'navigationStopped', entry: current });
  }

  // ── replace ────────────────────────────────────────────────────────────────

  replace(url: string): Promise<NavigationResult> {
    return this.navigateTo({
      url,
      type:          NavigationType.Replace,
      userInitiated: false,
    });
  }

  // ── History queries ────────────────────────────────────────────────────────

  getCurrentEntry(): NavigationEntry | null {
    return this.stack.current();
  }

  canGoBack(): boolean {
    return this.stack.canBack();
  }

  canGoForward(): boolean {
    return this.stack.canForward();
  }

  // ── Guards ─────────────────────────────────────────────────────────────────

  addGuard(guard: INavigationGuard): void {
    if (!this.guards.includes(guard)) {
      this.guards.push(guard);
    }
  }

  removeGuard(guard: INavigationGuard): void {
    const i = this.guards.indexOf(guard);
    if (i !== -1) this.guards.splice(i, 1);
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  on(type: NavigationEventType, handler: (event: NavigationEvent) => void): void {
    this.bus.on(type, handler);
  }

  off(type: NavigationEventType, handler: (event: NavigationEvent) => void): void {
    this.bus.off(type, handler);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Run every registered guard in order.
   * Returns on the first rejection; skips remaining guards.
   */
  private async runGuards(request: NavigationRequest): Promise<{
    allowed: boolean;
    blockedBy?: string;
    reason?: string;
  }> {
    for (const guard of this.guards) {
      let allowed: boolean;
      try {
        allowed = await guard.canNavigate(request);
      } catch (err) {
        // A guard that throws is treated as a block.
        console.error(
          `[NavigationController] Guard "${guard.name}" threw an error:`,
          err,
        );
        allowed = false;
      }

      if (!allowed) {
        const reason = guard.blockedReason?.(request) ?? 'Navigation denied.';
        return { allowed: false, blockedBy: guard.name, reason };
      }
    }
    return { allowed: true };
  }

  /**
   * True when only the fragment (#…) differs between two parsed URLs.
   * No new network request is needed in this case.
   */
  private isHashChange(from: ParsedUrl, to: ParsedUrl): boolean {
    return (
      from.origin   === to.origin   &&
      from.pathname === to.pathname &&
      from.search   === to.search   &&
      from.hash     !== to.hash
    );
  }

  /**
   * Handle a same-page hash jump without a network request.
   * Updates the current entry in-place and fires HashChangedEvent.
   */
  private handleHashChange(
    current: NavigationEntry,
    parsedUrl: ParsedUrl,
  ): NavigationResult {
    const fromUrl = current.url;
    const toUrl   = parsedUrl.href;

    this.bus.emit({
      kind:    'hashChanged',
      fromUrl,
      toUrl,
      hash:    parsedUrl.hash,
    });

    // Update the cursor entry to reflect the new hash.
    const updated: NavigationEntry = {
      ...current,
      id:        nextId(),
      url:       toUrl,
      parsedUrl,
      timestamp: Date.now(),
      type:      NavigationType.HashChange,
    };
    this.stack.replace(updated);

    this._state = NavigationState.Complete;
    return { success: true, entry: updated, state: NavigationState.Complete };
  }

  /**
   * Transition to the Error state and emit a failure event.
   * Always returns a NavigationResult with success = false.
   */
  private fail(request: NavigationRequest, error: Error): NavigationResult {
    this._state = NavigationState.Error;
    this.bus.emit({ kind: 'navigationFailed', request, error });
    return { success: false, error, state: NavigationState.Error };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  NavigationController,
  NavigationStack,
  NavigationEventBus,
  NavigationState,
  NavigationType,
  NavigationBlockedError,
  NoEntryError,
};

export type {
  INavigationController,
  INavigationGuard,
  NavigationEntry,
  NavigationRequest,
  NavigationResult,
  NavigationEvent,
  NavigationEventType,
  NavigationStartedEvent,
  NavigationCommittedEvent,
  NavigationCompletedEvent,
  NavigationFailedEvent,
  NavigationStoppedEvent,
  HashChangedEvent,
  CanGoBackChangedEvent,
  CanGoForwardChangedEvent,
};