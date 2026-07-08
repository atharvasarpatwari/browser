# Nova Browser

A TypeScript browser engine built from scratch for learning and experimentation.

## Features

- **HTML Parser** — Tokenizes and parses HTML into an AST/DOM tree
- **CSS Parser** — Parses stylesheets and computes styles for DOM nodes
- **Layout Engine** — Calculates box models and page layout
- **Navigation** — URL parsing, validation, routing, history stack
- **Networking** — Request management, caching, resource loading
- **Security** — Sandboxing, certificate validation, permission management
- **Storage** — Cookies, sessions, history, bookmarks
- **JavaScript Bridge** — DOM bindings, event loop, runtime bridge
- **UI** — Address bar, tab management, settings, window management

## Getting Started

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run watch
```

## Project Structure

```
src/
  app/          — Application shell, DI container, entry point
  browser/      — Core browser engine modules
    bookmarks/  — Bookmark service and store
    downloads/  — Download manager and file verification
    engine/     — Browser engine and lifecycle management
    history/    — History service and store
    javascript/ — JS runtime bridge, DOM bindings, event loop
    navigation/ — URL parser, router, navigation controller
    networking/ — Cache, request manager, resource loader
    rendering/  — HTML/CSS parsers, DOM tree, layout, paint
    security/   — Sandbox, certificate validation, permissions
    storage/    — Cookie, session, history, bookmark stores
    tabs/       — Tab management and session handling
  platform/     — Desktop platform integration and runtime adapter
  ui/           — UI components, pages, and layouts
tests/          — Vitest test suites
docs/           — Architecture and design documentation
```

## Scripts

| Script | Command |
|--------|---------|
| `npm run build` | Compile TypeScript |
| `npm test` | Run all tests |
| `npm run lint` | Lint source files |
| `npm run format` | Check formatting |
| `npm run clean` | Remove dist/ and coverage/ |
| `npm run test:coverage` | Run tests with coverage |

## License

Private — All rights reserved.
