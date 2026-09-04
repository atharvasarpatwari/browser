# AI Web Research Agent Integration Plan

**Date:** 2026-09-03
**Session:** Integrate Python research agent as Nova Browser feature
**Status:** Planned

---

## Summary

Integrate the standalone Python AI Web Research Agent (`new/research_agent.py`) as a native browser feature in Nova Browser. The feature will provide a built-in research panel accessible via `nova://research` that uses Claude's web search API to perform deep research and generate structured, cited reports.

## Architecture Decision

**Approach:** Server-side API integration using the browser's existing HTTP client infrastructure.

The Python agent uses Anthropic's `web_search_20250305` tool which executes web searches server-side. This is ideal for a browser feature because:
1. No need to implement web search logic in TypeScript
2. Claude handles source discovery, cross-checking, and synthesis
3. The browser only needs to make API calls and render results
4. The existing `IHttpClient` and `RawSocketHttpClient` can be used directly

## Files to Create

### 1. Research Service (Core Logic)
**File:** `src/browser/research/research-service.ts`

```typescript
// Interface
interface IResearchService extends IDisposable {
  readonly state: ResearchState;
  research(query: string, options?: ResearchOptions): Promise<ResearchResult>;
  cancel(): void;
  on(type: ResearchEventType, handler: (event: ResearchEvent) => void): void;
  off(type: ResearchEventType, handler: (event: ResearchEvent) => void): void;
}

// Types
interface ResearchState {
  status: 'idle' | 'searching' | 'synthesizing' | 'complete' | 'error';
  query: string;
  progress: string;
  result: ResearchResult | null;
  error: string | null;
}

interface ResearchOptions {
  maxSearches?: number; // default: 10
  model?: string; // default: claude-sonnet-4-5-20250929
}

interface ResearchResult {
  report: string; // Markdown formatted
  citations: Array<{ title: string; url: string }>;
  timestamp: Date;
  query: string;
}

type ResearchEventType = 'statusChanged' | 'progress' | 'complete' | 'error';
```

The service will:
- Use `IHttpClient` to call Anthropic's Messages API
- Implement the same system prompt from `research_agent.py`
- Handle `pause_turn` stop reason for long research sessions
- Parse citations from response content blocks
- Emit events for UI updates

### 2. Research Types
**File:** `src/browser/research/research-types.ts`

Export all interfaces and types for the research module.

### 3. Research Panel (UI)
**File:** `src/ui/pages/research-page.ts`

```typescript
interface IResearchPage extends IDisposable {
  mount(container: HTMLElement): void;
  unmount(): void;
  setResearchService(service: IResearchService): void;
  submitQuery(query: string): void;
}
```

The page will have:
- Search input field
- "Research" button
- Progress indicator (shows current search/synthesis status)
- Report display area (rendered Markdown)
- Citation list with clickable links
- Export/download button

### 4. Research Styles
**File:** `src/ui/pages/research-page.css`

Styled to match Nova's dark theme and settings page aesthetics.

## Files to Modify

### 1. DI Container Registration
**File:** `src/app/main.ts`

Add token and registration:
```typescript
// In Tokens object:
ResearchService: Symbol('ResearchService'),

// In ApplicationBootstrap.registerServices():
c.register<IResearchService>(
  Tokens.ResearchService,
  (ctx) => new ResearchService(
    ctx.resolve<IHttpClient>(Tokens.ResourceLoader).getClient(),
    ctx.resolve<ISettingsService>(Tokens.SettingsService),
  ),
  ServiceLifetime.Singleton,
);
```

### 2. Router Registration
**File:** `src/browser/navigation/router.ts`

Add route in `registerBuiltinRoutes()`:
```typescript
add({
  pattern: 'nova://research',
  strategy: MatchStrategy.Exact,
  type: RouteType.InternalPage,
  priority: 150,
  label: 'built-in:research',
  handler: Router.makeStaticHandler(RouteType.InternalPage, 'research', 'Research'),
});
```

### 3. Browser Window Page
**File:** `src/ui/pages/browser-window.ts`

- Import `ResearchPage` and `IResearchService`
- Add `setResearchService(service: IResearchService)` method
- Add `renderResearchPanel()` method
- Add case in `renderSpecialPage()`:
  ```typescript
  case 'nova://research':
    this.renderResearchPanel();
    break;
  ```

### 4. Settings Page
**File:** `src/ui/pages/settings-page.ts`

Add AI Research section:
```typescript
{
  id: 'ai-research', title: 'AI Research', icon: '🔬',
  settings: [
    { key: 'researchEnabled', label: 'Enable AI Research', description: 'Show research panel in browser', type: 'boolean', defaultValue: true },
    { key: 'anthropicApiKey', label: 'Anthropic API Key', description: 'API key for Claude web search', type: 'text', defaultValue: '' },
    { key: 'researchMaxSearches', label: 'Max searches per query', description: 'Maximum web searches per research session', type: 'range', defaultValue: 10, min: 1, max: 30, step: 1 },
    { key: 'researchModel', label: 'Model', description: 'Claude model for research', type: 'select', defaultValue: 'claude-sonnet-4-5-20250929', options: [{ label: 'Sonnet 4.5', value: 'claude-sonnet-4-5-20250929' }, { label: 'Opus 4', value: 'claude-opus-4-20250514' }] },
  ],
}
```

### 5. Main Bootstrap
**File:** `src/app/main.ts`

Wire the research service to the page:
```typescript
// In mountBrowserUI():
const researchService = this.container.resolve<IResearchService>(Tokens.ResearchService);
page.setResearchService(researchService);
```

## Implementation Details

### API Key Storage
- Store API key in browser settings (encrypted at rest if possible)
- Allow user to set via Settings page or environment variable
- Never expose in renderer process logs

### Security Considerations
- API key must not be exposed to web content
- Research queries should not leak sensitive browsing data
- Rate limiting to prevent API abuse
- CSP headers must allow Anthropic API endpoint

### Error Handling
- Network errors → show retry button
- Invalid API key → prompt user to configure in settings
- Rate limit exceeded → show backoff timer
- Empty query → show validation message

### Markdown Rendering
Use the existing Markdown rendering in the browser (if available) or implement a simple renderer for:
- Headers (##)
- Bullet points
- Links
- Bold/italic text
- Code blocks

## Testing Strategy

### Unit Tests
- `tests/research-service.test.ts` - Test API calls, response parsing, citation extraction
- `tests/research-page.test.ts` - Test UI interactions, state updates

### Integration Tests
- Test full flow: query → API call → result display
- Test error scenarios (no API key, network failure)
- Test settings persistence

### Test Commands
```bash
npx vitest run tests/research-service.test.ts
npx vitest run tests/research-page.test.ts
npx tsc --noEmit
npx eslint src/browser/research/ src/ui/pages/research-page.ts
```

## Migration from Python

The Python `new/` directory can be:
1. **Kept as reference** - Document the methodology in code comments
2. **Converted to tests** - Use as test cases for the TypeScript implementation
3. **Archived** - Move to `archive/` once integration is complete

**Recommendation:** Keep as reference until integration is complete, then archive.

## UI Mockup

```
┌─────────────────────────────────────────────────────────┐
│ nova://research                                    □ X │
├─────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐   │
│ │ Enter your research query...                    │   │
│ └─────────────────────────────────────────────────┘   │
│                                         [Research]     │
├─────────────────────────────────────────────────────────┤
│ 🔍 Searching: "latest developments in AI browsers"    │
│ ████████████████░░░░░░░░ 60%                           │
├─────────────────────────────────────────────────────────┤
│ ## Answer                                               │
│ Nova Browser integrates AI research using Claude...    │
│                                                         │
│ ## Key Findings                                         │
│ • Server-side web search via Anthropic API             │
│ • Structured report generation                         │
│ • Citation tracking and deduplication                  │
│                                                         │
│ ## Sources                                              │
│ • Anthropic Web Search Docs — anthropic.com — [link]   │
│ • Nova Browser Architecture — github.com — [link]      │
└─────────────────────────────────────────────────────────┘
```

## Implementation Order

1. **Phase 1: Core Service** (Days 1-2)
   - Create `research-types.ts`
   - Create `research-service.ts` with API integration
   - Unit tests

2. **Phase 2: UI Integration** (Days 3-4)
   - Create `research-page.ts` and `research-page.css`
   - Wire into `browser-window.ts`
   - Add router entry

3. **Phase 3: Settings & Polish** (Day 5)
   - Add settings section
   - API key storage
   - Error handling
   - Final testing

## Success Criteria

- [ ] `nova://research` loads the research panel
- [ ] User can enter a query and get a structured report
- [ ] Citations are displayed and clickable
- [ ] Settings allow API key configuration
- [ ] Progress indicator shows research status
- [ ] Error messages are clear and actionable
- [ ] All tests pass
- [ ] TypeScript compiles without errors
- [ ] ESLint passes

---

## Files Modified
| File | Change |
|------|--------|
| `src/app/main.ts` | Add ResearchService token and registration |
| `src/browser/navigation/router.ts` | Add `nova://research` route |
| `src/ui/pages/browser-window.ts` | Add research panel rendering |
| `src/ui/pages/settings-page.ts` | Add AI Research settings section |

## Files Created
| File | Purpose |
|------|--------|
| `src/browser/research/research-service.ts` | Core research API integration |
| `src/browser/research/research-types.ts` | Type definitions |
| `src/ui/pages/research-page.ts` | Research panel UI |
| `src/ui/pages/research-page.css` | Research panel styles |
| `tests/research-service.test.ts` | Service unit tests |
| `tests/research-page.test.ts` | UI unit tests |
