# Development Steps

## Phase 1: Foundation (Complete)

- [x] Project scaffolding (TypeScript, ESLint, Prettier, Vitest)
- [x] Dependency injection container
- [x] URL parser with validation, normalization, and protocol blocking
- [x] Navigation state machine and history stack
- [x] Routing infrastructure
- [x] HTML parser (tokenizer, tree construction, resource discovery)
- [x] DOM tree implementation with mutation tracking
- [x] Platform adapter (runtime detection, Electron mock)

## Phase 2: Browser Core (In Progress)

- [ ] CSS parser — selector matching, property cascade, computed styles
- [ ] Layout engine — box model, positioning, stacking contexts
- [ ] Paint engine — visual rendering pipeline
- [ ] JavaScript runtime bridge — DOM bindings, event loop
- [ ] Network stack — request manager, caching, resource loading
- [ ] Security infrastructure — sandbox, certificate validation, permissions

## Phase 3: Services & Storage

- [ ] History service with in-memory and persistent store
- [ ] Bookmark service with folder tree organization
- [ ] Cookie store with domain/path scoping
- [ ] Session store for tab restoration
- [ ] Download manager with pause/resume/cancel lifecycle

## Phase 4: UI & Integration

- [ ] Address bar with suggestions and security indicators
- [ ] Tab management (create, close, switch, reorder)
- [ ] Settings page with configurable options
- [ ] Downloads page
- [ ] Desktop window management (create, resize, minimize, close)
- [ ] Browser engine orchestration (initialize, navigate, shutdown)

## Phase 5: Polish & Hardening

- [ ] Error handling and recovery across all modules
- [ ] Performance optimization (lazy loading, caching, memoization)
- [ ] Security audits (XSS prevention, CSP enforcement, sandboxing)
- [ ] Accessibility (keyboard navigation, ARIA labels, screen reader support)
- [ ] Cross-platform testing (Windows, macOS, Linux)
- [ ] Integration and E2E test coverage

## Running Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

## Linting & Formatting

```bash
npm run lint         # Check lint
npm run lint:fix     # Auto-fix
npm run format       # Check formatting
npm run format:fix   # Auto-format
```
