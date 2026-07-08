# Folder Flow

Data flow between source directories and module interactions.

## Navigation Flow

```
User Input
    │
    ▼
AddressBar ──► NavigationController ──► UrlParser
(src/ui/)        (src/browser/navigation/)    │
                    │                          │
                    │                          ▼
                    │                   ParsedUrl / Error
                    │                          │
                    ▼                          │
            Router ───────────────────────────┘
            (src/browser/navigation/)
                    │
                    ▼
         ┌─────────┴─────────┐
         ▼                   ▼
  ResourceLoader     HistoryService
  (src/browser/      (src/browser/history/)
   networking/)
         │
         ▼
   HtmlParser ──► DomTree ──► CssParser ──► LayoutEngine ──► PaintEngine
   (src/browser/rendering/)
```

## Rendering Pipeline

```
HTML Bytes
    │
    ▼
HtmlParser ──► AST ──► DomTree ──► CssParser ──► LayoutEngine ──► PaintEngine
    │                       │              │              │              │
    │                       ▼              ▼              ▼              ▼
    │                  DomNode      ComputedStyle     LayoutBox       PaintCommands
    │                                                                         │
    └────────────────────── JsRuntimeBridge ─────────────────────────────────┘
                              (src/browser/javascript/)
```

## Service Registration Flow

```
main.ts
  │
  ▼
DependencyContainer ──► app-shell.ts
(src/app/)            (src/app/)
  │                        │
  ├── NavigationController │
  ├── HistoryService       ├── BrowserEngine ──► TabManager
  ├── BookmarkService      │   (src/browser/    (src/browser/tabs/)
  ├── DownloadManager      │    engine/)
  ├── SecurityManager      ├── BrowserWindow ──► AddressBar
  ├── CacheManager         │   (src/ui/pages/)  (src/ui/components/address-bar/)
  ├── TabManager           └── DesktopLayout
  └── WindowManager            (src/ui/layout/)
```

## Storage Architecture

```
Services Layer
  HistoryService    BookmarkService   TabManager    DownloadManager
       │                  │               │               │
       ▼                  ▼               ▼               ▼
Stores Layer
  HistoryStore    BookmarkStore     SessionStore    (filesystem)
  (in-memory)     (in-memory)       (in-memory)
       │                  │               │
       ▼                  ▼               ▼
Serialization Layer (future: IndexedDB / SQLite / JSON files)
```

## Event Flow

```
User Action
    │
    ▼
UI Component ──emit()──► EventBus ──on()──► Service
    │                                              │
    │                                              ▼
    ◄──────── on()/off() ────── EventBus ◄── Mutation/State Change
```

## Request/Response Flow

```
NavigationController ──navigate()──► RequestManager
    │                                      │
    │                                      ▼
    │                               CacheManager
    │                                      │
    │                                      ├── Cache Hit ──► ResponseParser
    │                                      └── Cache Miss ──► Network Fetch
    │                                                              │
    │                                                              ▼
    │                                                         ResourceLoader
    │                                                              │
    ▼                                                              ▼
HistoryService.addVisit()                                    HtmlParser.parse()
```
