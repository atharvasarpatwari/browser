# API Contracts

Defines the public interfaces and contracts between modules.

## NavigationController

```typescript
interface INavigationController {
  navigate(url: string): Promise<NavigationResult>;
  back(): Promise<NavigationResult>;
  forward(): Promise<NavigationResult>;
  reload(): Promise<NavigationResult>;
  replace(url: string): Promise<NavigationResult>;
  stop(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  readonly state: NavigationState;
  readonly currentUrl: string | null;
  addGuard(guard: NavigationGuard): void;
  removeGuard(guard: NavigationGuard): void;
}
```

## UrlParser

```typescript
interface IUrlParser {
  parse(input: string): ParsedUrl;
  normalize(input: string): string;
  validate(input: string): UrlValidationResult;
  isSpecialPage(url: string): boolean;
  isBlockedProtocol(url: string): boolean;
}

interface ParsedUrl {
  protocol: string;
  hostname: string;
  port?: number;
  pathname: string;
  search: string;
  hash: string;
  queryParams: Record<string, string>;
  href: string;
}
```

## HtmlParser

```typescript
interface IHtmlParser {
  parse(html: string, baseUrl: string): DocumentNode;
  parseFragment(html: string, baseUrl: string): DocumentFragment;
}

interface DocumentNode {
  tagName: string;
  attributes: Record<string, string>;
  children: DocumentNode[];
  textContent: string;
  getElementsByTagName(tag: string): DocumentNode[];
  getResources(): ResourceInfo[];
}
```

## DomTree

```typescript
interface IDomTree {
  build(parsed: DocumentNode): DomNode;
  getNodeById(id: string): DomNode | undefined;
  getNodeByDomId(domId: number): DomNode | undefined;
  appendChild(parent: DomNode, child: DomNode): void;
  removeChild(parent: DomNode, child: DomNode): void;
  insertBefore(parent: DomNode, child: DomNode, reference: DomNode): void;
  setAttribute(node: DomNode, name: string, value: string): void;
  removeAttribute(node: DomNode, name: string): void;
  setTextContent(node: DomNode, text: string): void;
  setComputedStyle(node: DomNode, style: ComputedStyle): void;
  setLayoutBox(node: DomNode, box: LayoutBox): void;
  dispose(): void;
}
```

## Event Bus Pattern

All stateful modules expose an event bus (typed `EventEmitter`):

```typescript
interface EventBus<T extends Record<string, unknown[]>> {
  on<K extends keyof T>(event: K, handler: (...args: T[K]) => void): void;
  off<K extends keyof T>(event: K, handler: (...args: T[K]) => void): void;
  emit<K extends keyof T>(event: K, ...args: T[K]): void;
  dispose(): void;
}
```

## DependencyContainer

```typescript
interface IDependencyContainer {
  registerClass<T>(key: string, ctor: new (...args: unknown[]) => T, lifetime: 'singleton' | 'transient'): void;
  registerValue<T>(key: string, value: T): void;
  resolve<T>(key: string): T;
  isRegistered(key: string): boolean;
  unregister(key: string): void;
  clear(): void;
  dispose(): void;
}
```

## BrowserEngine

```typescript
interface IBrowserEngine {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  navigate(url: string): Promise<void>;
  readonly navigation: NavigationController;
  readonly rendering: RenderingEngine;
  readonly history: HistoryService;
  readonly downloads: DownloadManager;
  readonly bookmarks: BookmarkService;
  readonly tabs: TabManager;
}
```
