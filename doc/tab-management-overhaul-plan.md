# Tab Management Overhaul — Plan

**Date:** 2026-07-22
**Status:** Planned

---

## Problem

Tab management has three layers that don't talk to each other:

```
TabManager (TabSession)  ←── nobody bridges ──→  TabContextManager (TabContext)  ←── TabProcessManager bridges ──→  ProcessManager
```

- `TabManager` manages UI-state tabs (`TabSession`: url, title, favicon, pinned, history)
- `TabContextManager` manages engine-isolation tabs (`TabContext`: DOM, layout, paint, event loop)
- `TabProcessManager` bridges `TabContext ↔ Process` but nobody bridges `TabSession ↔ TabContext`
- `setPinned()` / `setGroupId()` don't emit events (invisible to event system)
- No tab session persistence (tabs lost on restart)
- No unit tests for `TabManager`, `TabSession`, `TabContext`, `NavigationBridge`

## Scope

1. **TabSession ↔ TabContext bridge** — create `TabSessionBridge`
2. **Event emission gaps** — `setPinned` / `setGroupId` emit events
3. **Tab session persistence** — `TabPersistenceStore` (save/restore across restarts)
4. **Comprehensive tests** — TabManager, TabSession, TabContext, NavigationBridge, TabSessionBridge, TabPersistenceStore

---

## Part 1: Event Emission Gaps

**File:** `src/browser/tabs/tab-session.ts`

`setPinned()` and `setGroupId()` currently skip event emission. Fix:

```typescript
// BEFORE
setPinned(pinned: boolean): void {
  this._pinned = pinned;
}

// AFTER
setPinned(pinned: boolean): void {
  if (this._pinned === pinned) return;
  this._pinned = pinned;
  this.bus.emit({ kind: 'pinnedChanged', tabId: this.id, pinned });
}

setGroupId(groupId: string | null): void {
  if (this._groupId === groupId) return;
  this._groupId = groupId;
  this.bus.emit({ kind: 'groupChanged', tabId: this.id, groupId });
}
```

Add event types to `TabEventType`:
```typescript
type TabEventType =
  | 'titleChanged' | 'urlChanged' | 'loadingStateChanged'
  | 'faviconChanged' | 'audibleChanged' | 'mutedChanged'
  | 'pinnedChanged' | 'groupChanged';   // NEW
```

Add event interfaces:
```typescript
interface PinnedChangedEvent extends TabEvent {
  readonly kind: 'pinnedChanged';
  readonly pinned: boolean;
}

interface GroupChangedEvent extends TabEvent {
  readonly kind: 'groupChanged';
  readonly groupId: string | null;
}
```

---

## Part 2: TabSession ↔ TabContext Bridge

**New file:** `src/browser/tabs/tab-session-bridge.ts`

A bridge class that connects `TabManager` (UI layer) to `TabContextManager` (engine layer). Pattern follows `TabProcessManager`:

```
TabManager.on('tabCreated')   →  TabContextManager.createContext()  →  store mapping
TabManager.on('tabRemoved')   →  TabContextManager.destroyContext()
TabManager.on('tabActivated') →  mark context active
TabContextManager events      →  forward crash/recovery to TabSession
```

### Interface

```typescript
interface ITabSessionBridge extends IDisposable {
  /** Get the TabContext for a given TabSession id. */
  getContextForTab(tabId: string): TabContext | null;
  /** Get the TabSession id for a given TabContext id. */
  getTabForContext(contextId: string): string | null;
  /** Get all mappings. */
  getAllMappings(): ReadonlyMap<string, string>;  // tabId → contextId
  /** Whether a tab has a live context. */
  isTabAlive(tabId: string): boolean;
}
```

### Implementation

```typescript
class TabSessionBridge implements ITabSessionBridge {
  private tabToContext = new Map<string, string>();   // tabId → contextId
  private contextToTab = new Map<string, string>();   // contextId → tabId

  constructor(
    private tabManager: ITabManager,
    private contextManager: ITabContextManager,
  ) {
    // Listen for tab lifecycle events
    this.tabManager.on('tabCreated', (e) => {
      if (e.kind === 'tabCreated') {
        const ctx = this.contextManager.createContext();
        this.tabToContext.set(e.tab.id, ctx.id);
        this.contextToTab.set(ctx.id, e.tab.id);

        // Wire tab events → context
        e.tab.on('urlChanged', (ev) => {
          if (ev.kind === 'urlChanged') ctx.setLoading(ev.url);
        });
        e.tab.on('titleChanged', (ev) => {
          if (ev.kind === 'titleChanged') ctx.setActive(ev.title);
        });
      }
    });

    this.tabManager.on('tabRemoved', (e) => {
      if (e.kind === 'tabRemoved') {
        const ctxId = this.tabToContext.get(e.tabId);
        if (ctxId) {
          this.contextManager.destroyContext(ctxId);
          this.tabToContext.delete(e.tabId);
          this.contextToTab.delete(ctxId);
        }
      }
    });

    // Listen for context crash events → update tab state
    for (const ctx of this.contextManager.getAllContexts()) {
      this.wireContextEvents(ctx);
    }
  }

  private wireContextEvents(ctx: TabContext): void {
    ctx.on('crashed', (e) => {
      if (e.kind === 'crashed') {
        const tabId = this.contextToTab.get(e.tabId);
        if (tabId) {
          const tab = this.tabManager.getTab(tabId);
          // TabSession doesn't have crash state — we store it via the bridge
        }
      }
    });
  }

  dispose(): void {
    this.tabToContext.clear();
    this.contextToTab.clear();
  }
}
```

---

## Part 3: Tab Session Persistence

**New file:** `src/browser/tabs/tab-persistence.ts`

### Storage Format

```typescript
interface TabPersistenceData {
  readonly version: 1;
  readonly tabs: TabSessionState[];
  readonly activeTabId: string | null;
  readonly savedAt: number;
}
```

Uses `localStorage` for browser context, with a `TabPersistenceStore` abstraction so it can be swapped for file-based storage in Electron later.

### Interface

```typescript
interface ITabPersistenceStore extends IDisposable {
  save(tabs: readonly ITabSession[], activeTabId: string | null): void;
  restore(): TabPersistenceData | null;
  clear(): void;
}

interface ITabPersistenceManager extends IDisposable {
  /** Auto-save whenever tabs change. */
  startAutoSave(tabManager: ITabManager): void;
  /** Stop auto-saving. */
  stopAutoSave(): void;
  /** Restore tabs from storage. Returns null if no saved state. */
  restoreTabs(): TabPersistenceData | null;
  /** Save current state. */
  saveNow(): void;
  /** Clear saved state. */
  clearSaved(): void;
}
```

### Auto-save triggers
- `tabCreated` → save
- `tabRemoved` → save
- `tabActivated` → save (active tab changed)
- `tabMoved` → save (order changed)
- `tabPinned` → save
- `titleChanged` / `urlChanged` → debounced save (500ms)

### Restore flow (called during `BrowserWindowPage.mount()`)
1. `TabPersistenceManager.restoreTabs()` reads from store
2. If data exists and is < 24 hours old:
   - Create `TabSession` for each entry (passing url to constructor)
   - Restore pinned state, group, title
   - Activate the saved active tab
3. If no data or stale: create default `about:blank` tab

---

## Part 4: Tests

### New test files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/tab-manager.test.ts` | ~25 | TabManager: create, remove, activate, move, pin, group, events, dispose |
| `tests/tab-session.test.ts` | ~30 | TabSession: all setters, events, history, getState, dispose |
| `tests/tab-context.test.ts` | ~20 | TabContext: state transitions, crash, recover, snapshot, config |
| `tests/navigation-bridge.test.ts` | ~25 | NavigationBridge: sync, navigate, back/forward, events |
| `tests/tab-session-bridge.test.ts` | ~20 | TabSessionBridge: mapping, lifecycle sync, crash forwarding |
| `tests/tab-persistence.test.ts` | ~20 | TabPersistenceStore + Manager: save, restore, auto-save, debounce |

**Total new tests: ~140**

### Test patterns
- Follow existing patterns from `tab-strip.test.ts` and `tab-process-adapter.test.ts`
- Use `vi.fn()` for event handlers, `beforeEach` for fresh instances
- Mock `localStorage` for persistence tests (or use in-memory Map)
- Mock `ProcessManager` for crash forwarding tests (reuse `MockProcessManager` pattern)

---

## Part 5: Integration in BrowserWindowPage

**File:** `src/ui/pages/browser-window.ts`

Wire the new bridge and persistence into `BrowserWindowPage`:

```typescript
// In constructor or mount():
this.tabSessionBridge = new TabSessionBridge(this.tabManager, contextManager);
this.tabPersistence = new TabPersistenceManager(persistenceStore);
this.tabPersistence.startAutoSave(this.tabManager);

// On mount: restore tabs
const saved = this.tabPersistence.restoreTabs();
if (saved) {
  for (const tabState of saved.tabs) {
    const tab = this.tabManager.createTab(tabState.url, tabState.pinned);
    tab.setTitle(tabState.title);
    if (tabState.groupId) tab.setGroupId(tabState.groupId);
  }
  if (saved.activeTabId) this.tabManager.activateTab(saved.activeTabId);
} else {
  this.tabManager.createTab();
}
```

---

## Files Summary

### New files (3)
| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `src/browser/tabs/tab-session-bridge.ts` | ~120 | TabSession ↔ TabContext bridge |
| `src/browser/tabs/tab-persistence.ts` | ~150 | Save/restore tab sessions |
| `tests/tab-manager.test.ts` | ~200 | TabManager unit tests |
| `tests/tab-session.test.ts` | ~250 | TabSession unit tests |
| `tests/tab-context.test.ts` | ~200 | TabContext unit tests |
| `tests/navigation-bridge.test.ts` | ~200 | NavigationBridge unit tests |
| `tests/tab-session-bridge.test.ts` | ~160 | Bridge unit tests |
| `tests/tab-persistence.test.ts` | ~160 | Persistence unit tests |

### Modified files (3)
| File | Change |
|------|--------|
| `src/browser/tabs/tab-session.ts` | Add `pinnedChanged`/`groupChanged` events, emit in `setPinned`/`setGroupId` |
| `src/ui/pages/browser-window.ts` | Wire TabSessionBridge + TabPersistenceManager, restore on mount |
| `src/browser/tabs/index.ts` (or equivalent) | Export new modules |

---

## Execution Order

1. Fix event emission gaps in `tab-session.ts` (5 min)
2. Write `tests/tab-session.test.ts` (validate events work) (15 min)
3. Write `tests/tab-manager.test.ts` (15 min)
4. Write `tests/tab-context.test.ts` (15 min)
5. Create `tab-session-bridge.ts` (20 min)
6. Write `tests/tab-session-bridge.test.ts` (15 min)
7. Write `tests/navigation-bridge.test.ts` (20 min)
8. Create `tab-persistence.ts` (20 min)
9. Write `tests/tab-persistence.test.ts` (15 min)
10. Integrate into `browser-window.ts` (15 min)
11. Run full test suite, fix regressions (10 min)
12. Write change log doc, commit (5 min)

**Estimated total: ~2.5 hours**
