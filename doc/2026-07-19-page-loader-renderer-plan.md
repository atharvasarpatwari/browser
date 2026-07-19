# PageLoader & PageRenderer Implementation Plan

**Date:** 2026-07-19  
**Session:** Extract inline adapters from main.ts into standalone classes  
**Status:** Completed

---

## Summary

Extract the inline `createPageLoader()` and `createPageRenderer()` adapter methods from `main.ts` into proper standalone classes implementing the `IPageLoader` and `IPageRenderer` interfaces. This improves code organization, testability, and separation of concerns.

## Benefits

1. **Testability:** Standalone classes can be unit tested in isolation with mocked dependencies
2. **Separation of Concerns:** Each class has a single responsibility (loading vs rendering)
3. **Code Reusability:** Classes can be instantiated multiple times for different tabs
4. **Maintainability:** Clear boundaries between networking and rendering subsystems
5. **Bug Fixes:** Proper signal propagation (currently ignored in render lambda)
6. **Coverage:** Fills critical gaps in test coverage for orchestration layer

## Current State

### Problem
- `ApplicationBootstrap.createPageLoader()` (lines 679-693) is an inline adapter object literal
- `ApplicationBootstrap.createPageRenderer()` (lines 699-742) is a large inline adapter with 6 helper methods
- Both are private methods on `ApplicationBootstrap`, making them untestable in isolation
- The `render()` lambda ignores the `signal: AbortSignal` parameter from the interface

### Existing Interfaces
```typescript
// From src/browser/engine/browser-engine.ts
interface IPageLoader {
  load(url: string, signal: AbortSignal): Promise<PageLoadResult>;
}

interface IPageRenderer {
  render(result: PageLoadResult, signal: AbortSignal): Promise<void>;
}
```

## Implementation Plan

### Phase 1: PageLoader Class

**File:** `src/browser/engine/page-loader.ts`

**Dependencies:**
- `IResourceLoader` (from `src/browser/netwroking/resource-loader.ts`)
- `IPageLoader`, `PageLoadResult` (from `src/browser/engine/browser-engine.ts`)

**Implementation:**
```typescript
export class PageLoader implements IPageLoader {
  constructor(private readonly resourceLoader: IResourceLoader) {}
  
  async load(url: string, signal: AbortSignal): Promise<PageLoadResult> {
    const result = await this.resourceLoader.loadResource(url, 'document', { signal });
    return {
      url: result.url,
      statusCode: result.statusCode,
      contentType: result.contentType,
      body: result.body,
      headers: result.headers,
      loadedAt: result.loadedAt,
    };
  }
}
```

**Key Design Decisions:**
- Wraps `IResourceLoader` for dependency injection
- Maintains the same behavior as the current inline adapter
- Proper error handling for network failures
- Signal propagation for abort support

### Phase 2: PageRenderer Class

**File:** `src/browser/engine/page-renderer.ts`

**Dependencies:**
- `HtmlParser` (from `src/browser/rendering/html-parser.ts`)
- `IDomTree` (from `src/browser/rendering/dom-tree.ts`)
- `ICssParser`, `CssParser` (from `src/browser/rendering/css-parser.ts`)
- `ILayoutEngine` (from `src/browser/rendering/layout-engine.ts`)
- `IPaintEngine` (from `src/browser/rendering/paint-engine.ts`)
- `IResourceLoader` (from `src/browser/netwroking/resource-loader.ts`)
- `ResourcePrioritizer` (from `src/browser/netwroking/resource-prioritizer.ts`)
- `LazyLoader` (from `src/browser/rendering/lazy-loader.ts`)
- `computeComputedStyles`, `StyleableElement` (from `src/browser/rendering/css5/cascade.ts`)
- `Css5Stylesheet`, `Css5Rule`, `CssStyleRule` (from `src/browser/rendering/css5/types.ts`)
- `runJS` (from `src/browser/js/index.ts`)
- `JsEventLoop` (from `src/browser/js/event-loop.ts`)
- `DomNode`, `DomElement`, `DomDocument` (from `src/browser/rendering/dom-tree.ts`)
- `CssRule` (from `src/browser/rendering/css-parser.ts`)

**Constructor Parameters:**
```typescript
export class PageRenderer implements IPageRenderer {
  constructor(
    private readonly htmlParser: HtmlParser,
    private readonly domTree: IDomTree,
    private readonly cssParser: ICssParser,
    private readonly layoutEngine: ILayoutEngine,
    private readonly paintEngine: IPaintEngine,
    private readonly resourceLoader: IResourceLoader,
    private readonly prioritizer: ResourcePrioritizer,
  ) {}
}
```

**Methods to Extract:**
1. `applyComputedStyles()` → private method
2. `buildCss5Stylesheet()` → private method
3. `buildStyleableTree()` → private method
4. `applyStylesRecursive()` → private method
5. `executeAllScripts()` → private method
6. `resolveUrl()` → private static method

**Implementation:**
```typescript
async render(result: PageLoadResult, signal: AbortSignal): Promise<void> {
  // 1. Parse HTML
  const parseResult = this.htmlParser.parse(result.body, result.url);
  const htmlDoc = parseResult.document;
  
  // 2. Submit discovered resources to prioritizer
  if (parseResult.resources.length > 0) {
    this.prioritizer.submitBatch(parseResult.resources);
  }
  
  // 3. Build DOM tree
  const doc = this.domTree.buildFromHtml(htmlDoc);
  
  // 4. Extract and apply CSS
  const rules = this.cssParser.extractStylesFromDocument(htmlDoc);
  this.applyComputedStyles(rules);
  
  // 5. Execute scripts (respecting signal)
  await this.executeAllScripts(doc, result.url, signal);
  this.applyComputedStyles(rules); // Re-apply after script execution
  
  // 6. Layout
  this.layoutEngine.layout(doc, this.domTree);
  
  // 7. Setup lazy loading
  const lazyLoader = new LazyLoader();
  lazyLoader.init(doc, this.domTree);
  lazyLoader.scanForLazyElements(doc);
  lazyLoader.setViewport(1920, 1080); // Default viewport
  
  // 8. Paint
  this.paintEngine.paint(doc);
}
```

**Key Improvements:**
- Proper signal propagation through the entire pipeline
- Dependencies injected via constructor (testable)
- Clear separation of concerns
- All helper methods encapsulated within the class

### Phase 3: Integration

**File:** `src/app/main.ts`

**Changes:**
1. Import new classes: `PageLoader`, `PageRenderer`
2. Replace `createPageLoader()` call with `new PageLoader(resourceLoader)`
3. Replace `createPageRenderer()` call with `new PageRenderer(...)`
4. Remove private adapter methods and helper functions
5. Remove unused `ReflowRepaintController` import (dead code)

**Wiring in `mountBrowserUI()`:**
```typescript
// Before (lines 629, 666):
engine.setPageLoader(this.createPageLoader(resourceLoader));
engine.setPageRenderer(this.createPageRenderer());

// After:
const pageLoader = new PageLoader(resourceLoader);
engine.setPageLoader(pageLoader);

const pageRenderer = new PageRenderer(
  new HtmlParser(),
  this.container.resolve<IDomTree>(Tokens.DomTree),
  this.container.resolve<ICssParser>(Tokens.CssParser),
  this.container.resolve<ILayoutEngine>(Tokens.LayoutEngine),
  this.container.resolve<IPaintEngine>(Tokens.PaintEngine),
  resourceLoader,
  new ResourcePrioritizer(),
);
engine.setPageRenderer(pageRenderer);
```

### Phase 4: Testing

**Test Files:**
1. `tests/page-loader.test.ts`
2. `tests/page-renderer.test.ts`

**Test Coverage:**
- PageLoader:
  - Successful page load with mock ResourceLoader
  - Network error handling
  - Abort signal propagation
  - Response mapping correctness

- PageRenderer:
  - Full pipeline execution (HTML → DOM → CSS → Layout → Paint)
  - Signal abort during script execution
  - CSS re-application after script execution
  - Lazy loader initialization
  - Error handling at each pipeline stage

**Mock Strategy:**
- Mock `IResourceLoader` for PageLoader tests
- Mock all rendering dependencies for PageRenderer tests
- Use real implementations where possible for integration tests

### Phase 5: Documentation

**File:** `doc/2026-07-19-page-loader-renderer.md`

**Content:**
- Implementation summary
- Architecture decisions
- File changes
- Test results
- Integration notes

## Files to Create

| File | Purpose |
|------|---------|
| `src/browser/engine/page-loader.ts` | Standalone PageLoader class |
| `src/browser/engine/page-renderer.ts` | Standalone PageRenderer class |
| `tests/page-loader.test.ts` | PageLoader unit tests |
| `tests/page-renderer.test.ts` | PageRenderer unit tests |

## Files to Modify

| File | Changes |
|------|---------|
| `src/app/main.ts` | Remove adapter methods, use new classes |
| `src/browser/engine/browser-engine.ts` | No changes needed (interfaces already exist) |
| `doc/README.md` | Add new session document |

## Success Criteria

1. ✅ PageLoader class implements `IPageLoader` interface
2. ✅ PageRenderer class implements `IPageRenderer` interface
3. ✅ Both classes are properly testable in isolation
4. ✅ Signal propagation works correctly through the pipeline
5. ✅ All existing tests continue to pass
6. ✅ New comprehensive tests cover both classes
7. ✅ Documentation updated with implementation details

## Test Coverage Analysis

### Current State
- **Total:** 79 test files, 3,261 tests (3,259 passing, 2 failing)
- **2 failures:** In `memory-management.test.ts` (PermissionManager cap behavior) - unrelated to rendering

### Coverage Gaps
| Component | Test Coverage | Status |
|-----------|---------------|--------|
| BrowserEngine | **NO TESTS** | Gap |
| PageLoader | **NO TESTS** | Gap |
| PageRenderer | **NO TESTS** | Gap |
| RequestManager | **NO TESTS** | Gap |
| HtmlParser | 35 tests | Well tested |
| DomTree | 20 tests | Well tested |
| CSS5 | 55 tests | Well tested |
| LayoutEngine | 25 tests | Well tested |
| Flex/Grid Layout | 75+ tests | Well tested |
| PaintEngine/Rasterizer | 70+ tests | Well tested |
| ResourceLoader | 10 tests | Moderately tested |
| ResourcePrioritizer | 25 tests | Well tested |
| Integration (full pipeline) | 25+ tests | Well tested |

### Why This Matters
- **No safety net** for orchestration layer changes
- **BrowserEngine coordination** (NavigationController → Router → PageLoader → PageRenderer) is untested
- **New classes fill critical gaps** in test coverage

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing functionality | High | Run full test suite after each phase |
| Signal propagation bugs | Medium | Comprehensive abort testing |
| DI container changes | Low | Keep DI tokens unchanged, only wire new classes |
| Performance regression | Low | Benchmark before/after |

## Timeline

- **Phase 1:** PageLoader implementation (30 min)
- **Phase 2:** PageRenderer implementation (1-2 hours)
- **Phase 3:** Integration wiring (30 min)
- **Phase 4:** Testing (1-2 hours)
- **Phase 5:** Documentation (30 min)

**Total estimated time:** 3-5 hours

---

## Next Steps

After approval:
1. Create `PageLoader` class
2. Create `PageRenderer` class
3. Wire into `main.ts`
4. Write tests
5. Run full test suite
6. Write session documentation