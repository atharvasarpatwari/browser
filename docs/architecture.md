# Architecture

Nova Browser follows a layered architecture with clear separation of concerns.

## High-Level Layers

```
┌─────────────────────────────────────────────────────────┐
│                        UI Layer                          │
│  AddressBar  BrowserWindow  Settings  Downloads  Layouts │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                     App Layer                             │
│            DependencyContainer  AppShell  Main            │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                   Browser Core Layer                      │
│  ┌─────────┐ ┌───────────┐ ┌──────────┐ ┌───────────┐  │
│  │Navigation│ │ Networking │ │Rendering │ │ JavaScript │  │
│  └─────────┘ └───────────┘ └──────────┘ └───────────┘  │
│  ┌─────────┐ ┌───────────┐ ┌──────────┐ ┌───────────┐  │
│  │Storage   │ │  Security  │ │ Bookmarks│ │ Downloads  │  │
│  └─────────┘ └───────────┘ └──────────┘ └───────────┘  │
│  ┌─────────┐                                            │
│  │   Tabs   │                                            │
│  └─────────┘                                            │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                   Platform Layer                          │
│         WindowManager  RuntimeAdapter  MenuIntegration   │
└─────────────────────────────────────────────────────────┘
```

## Module Responsibilities

### App Layer
- **DependencyContainer** — Inversion of Control container; registers and resolves module dependencies
- **AppShell** — Top-level shell hosting the UI and coordinating startup/shutdown
- **Main** — Application entry point

### Browser Core Layer
- **Navigation** — URL parsing (`UrlParser`), routing (`Router`), history stack and state machine (`NavigationController`)
- **Networking** — Request/response handling (`RequestManager`), caching (`CacheManager`), resource loading (`ResourceLoader`)
- **Rendering** — HTML parsing (`HtmlParser`), CSS parsing (`CssParser`), DOM tree construction, layout calculation, paint engine
- **JavaScript** — Runtime bridge (`JsRuntimeBridge`), DOM bindings, event loop
- **Storage** — Persistent stores for cookies, sessions, history, bookmarks
- **Security** — Sandbox manager, certificate validation, permission management
- **Bookmarks** — Bookmark service with tree-based folder organization
- **Downloads** — Download lifecycle management and file verification
- **Tabs** — Tab management and session persistence

### UI Layer
- **AddressBar** — URL input, navigation events, security indicators
- **Pages** — Settings, downloads, history, bookmarks, extensions pages
- **Layouts** — Desktop and mobile layout adapters

### Platform Layer
- **WindowManager** — Desktop window creation, sizing, positioning
- **RuntimeAdapter** — Environment detection (browser/node/electron)
- **MenuIntegration** — Native menu bar integration

## Dependency Flow

Dependencies flow downward. UI components depend on Browser Core services, which depend on Platform abstractions. The DependencyContainer wires everything together at startup.
