/**
 * @file src/ui/components/bookmarks-history/bookmarks-history.ts
 *
 * -----------------------------------------------------------------------
 * Bookmarks manager and History UI for NovaBrowser's chrome (the
 * browser's own interface, not rendered web content).
 *
 * Design brief: a working browser tool used dozens of times a day, not a
 * marketing surface. The visual language borrows from flight-log
 * wayfinding — fitting for a "history" of visited places over time and
 * "bookmarks" as fixed waypoints you return to — kept restrained to one
 * signature device (the trail line threading through a day's visits) so
 * the UI stays fast to scan rather than decorative.
 *
 * Token system:
 *   Color   — ink-slate chrome (#14171C/#1C2027) with a desaturated
 *             brass accent (#C9974C), not the cream+terracotta or
 *             near-black+neon defaults.
 *   Type    — system humanist sans for titles (content), system
 *             monospace for timestamps/URLs/hostnames (data/metadata) —
 *             the split signals "this is a log" vs "this is a page".
 *   Layout  — dense single-column lists; History groups visits by day
 *             behind a 1px trail line with small nodes, encoding
 *             chronological order as the organizing structure.
 *   Signature — the trail line in the History panel.
 *
 * Split into two layers, same separation used elsewhere in NovaBrowser:
 *   1. Data services (BookmarksService, HistoryService) — framework-free,
 *      fully unit-testable, no DOM dependency.
 *   2. Render functions — vanilla DOM, no framework, consuming the
 *      services and an `onNavigate` callback supplied by the Navigation
 *      layer (this module never navigates on its own).
 *
 * Zero external dependencies. Compiles clean under strict TypeScript
 * (strict: true, noUncheckedIndexedAccess: true).
 * -----------------------------------------------------------------------
 */

// =========================================================================
// 1. Shared event emitter (same minimal pattern as devtools.ts)
// =========================================================================

type Listener<T> = (payload: T) => void;

class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<any>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return () => this.off(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter++;
  return `${prefix}-${idCounter}-${Date.now().toString(36)}`;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// =========================================================================
// 2. Bookmarks data model & service
// =========================================================================

export interface BookmarkFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  hostname: string;
  folderId: string | null;
  tags: string[];
  createdAt: number;
}

export interface BookmarkInput {
  title: string;
  url: string;
  folderId?: string | null;
  tags?: string[];
}

export interface BookmarkTreeNode {
  folder: BookmarkFolder | null;
  bookmarks: Bookmark[];
  children: BookmarkTreeNode[];
}

interface BookmarksEvents {
  changed: void;
  [key: string]: unknown;
}

export class BookmarksService {
  private bookmarks = new Map<string, Bookmark>();
  private folders = new Map<string, BookmarkFolder>();
  private byUrl = new Map<string, string>();
  private events = new Emitter<BookmarksEvents>();

  addBookmark(input: BookmarkInput): Bookmark {
    const existingId = this.byUrl.get(input.url);
    if (existingId) return this.bookmarks.get(existingId)!;

    const bookmark: Bookmark = {
      id: nextId("bm"),
      title: input.title,
      url: input.url,
      hostname: hostnameOf(input.url),
      folderId: input.folderId ?? null,
      tags: input.tags ?? [],
      createdAt: Date.now(),
    };
    this.bookmarks.set(bookmark.id, bookmark);
    this.byUrl.set(bookmark.url, bookmark.id);
    this.events.emit("changed", undefined);
    return bookmark;
  }

  removeBookmark(id: string): boolean {
    const bookmark = this.bookmarks.get(id);
    if (!bookmark) return false;
    this.bookmarks.delete(id);
    this.byUrl.delete(bookmark.url);
    this.events.emit("changed", undefined);
    return true;
  }

  updateBookmark(id: string, patch: Partial<Pick<Bookmark, "title" | "folderId" | "tags">>): Bookmark | null {
    const bookmark = this.bookmarks.get(id);
    if (!bookmark) return null;
    const updated = { ...bookmark, ...patch };
    this.bookmarks.set(id, updated);
    this.events.emit("changed", undefined);
    return updated;
  }

  isBookmarked(url: string): boolean {
    return this.byUrl.has(url);
  }

  getByUrl(url: string): Bookmark | null {
    const id = this.byUrl.get(url);
    return id ? this.bookmarks.get(id) ?? null : null;
  }

  toggleBookmark(url: string, title: string): { bookmarked: boolean; bookmark: Bookmark | null } {
    const existing = this.getByUrl(url);
    if (existing) {
      this.removeBookmark(existing.id);
      return { bookmarked: false, bookmark: null };
    }
    const created = this.addBookmark({ title, url });
    return { bookmarked: true, bookmark: created };
  }

  createFolder(name: string, parentId: string | null = null): BookmarkFolder {
    const folder: BookmarkFolder = { id: nextId("bmf"), name, parentId, createdAt: Date.now() };
    this.folders.set(folder.id, folder);
    this.events.emit("changed", undefined);
    return folder;
  }

  removeFolder(id: string): boolean {
    const folder = this.folders.get(id);
    if (!folder) return false;

    for (const bookmark of this.bookmarks.values()) {
      if (bookmark.folderId === id) bookmark.folderId = folder.parentId;
    }
    for (const sub of this.folders.values()) {
      if (sub.parentId === id) sub.parentId = folder.parentId;
    }
    this.folders.delete(id);
    this.events.emit("changed", undefined);
    return true;
  }

  moveBookmark(id: string, folderId: string | null): void {
    this.updateBookmark(id, { folderId });
  }

  getTree(): BookmarkTreeNode {
    const buildNode = (folderId: string | null): BookmarkTreeNode => {
      const folder = folderId ? this.folders.get(folderId) ?? null : null;
      const bookmarks = [...this.bookmarks.values()]
        .filter((b) => b.folderId === folderId)
        .sort((a, b) => b.createdAt - a.createdAt);
      const children = [...this.folders.values()]
        .filter((f) => f.parentId === folderId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => buildNode(f.id));
      return { folder, bookmarks, children };
    };
    return buildNode(null);
  }

  search(query: string): Bookmark[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return [...this.bookmarks.values()].filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  exportJSON(): string {
    return JSON.stringify(
      { bookmarks: [...this.bookmarks.values()], folders: [...this.folders.values()] },
      null,
      2
    );
  }

  importJSON(json: string): void {
    const parsed = JSON.parse(json) as { bookmarks: Bookmark[]; folders: BookmarkFolder[] };
    for (const folder of parsed.folders ?? []) this.folders.set(folder.id, folder);
    for (const bookmark of parsed.bookmarks ?? []) {
      this.bookmarks.set(bookmark.id, bookmark);
      this.byUrl.set(bookmark.url, bookmark.id);
    }
    this.events.emit("changed", undefined);
  }

  onChanged(listener: Listener<void>): () => void {
    return this.events.on("changed", listener);
  }
}

// =========================================================================
// 3. History data model, frecency, & service
// =========================================================================

export type TransitionType = "link" | "typed" | "reload" | "bookmark";

export interface HistoryVisit {
  id: string;
  url: string;
  hostname: string;
  title: string;
  visitedAt: number;
  transitionType: TransitionType;
}

export interface DateGroup {
  label: string;
  visits: HistoryVisit[];
}

interface HistoryEvents {
  changed: void;
  [key: string]: unknown;
}

const MAX_HISTORY_ENTRIES = 20_000;

const FRECENCY_AGE_BUCKETS: Array<{ maxAgeMs: number; weight: number }> = [
  { maxAgeMs: 4 * 60 * 60 * 1000, weight: 100 },
  { maxAgeMs: 24 * 60 * 60 * 1000, weight: 70 },
  { maxAgeMs: 7 * 24 * 60 * 60 * 1000, weight: 50 },
  { maxAgeMs: 30 * 24 * 60 * 60 * 1000, weight: 30 },
  { maxAgeMs: Infinity, weight: 10 },
];

const TRANSITION_WEIGHT: Record<TransitionType, number> = {
  typed: 2.0,
  bookmark: 1.5,
  link: 1.0,
  reload: 0.5,
};

function ageWeight(visitedAt: number, now: number): number {
  const age = now - visitedAt;
  for (const bucket of FRECENCY_AGE_BUCKETS) {
    if (age <= bucket.maxAgeMs) return bucket.weight;
  }
  return FRECENCY_AGE_BUCKETS[FRECENCY_AGE_BUCKETS.length - 1]!.weight;
}

export class HistoryService {
  private visits: HistoryVisit[] = [];
  private events = new Emitter<HistoryEvents>();
  private privateMode = false;

  setPrivateMode(enabled: boolean): void {
    this.privateMode = enabled;
  }

  isPrivateMode(): boolean {
    return this.privateMode;
  }

  recordVisit(url: string, title: string, transitionType: TransitionType = "link"): HistoryVisit | null {
    if (this.privateMode) return null;

    const visit: HistoryVisit = {
      id: nextId("hv"),
      url,
      hostname: hostnameOf(url),
      title,
      visitedAt: Date.now(),
      transitionType,
    };
    this.visits.push(visit);
    if (this.visits.length > MAX_HISTORY_ENTRIES) {
      this.visits.shift();
    }
    this.events.emit("changed", undefined);
    return visit;
  }

  deleteEntry(id: string): boolean {
    const before = this.visits.length;
    this.visits = this.visits.filter((v) => v.id !== id);
    const changed = this.visits.length !== before;
    if (changed) this.events.emit("changed", undefined);
    return changed;
  }

  deleteRange(fromMs: number, toMs: number): number {
    const before = this.visits.length;
    this.visits = this.visits.filter((v) => v.visitedAt < fromMs || v.visitedAt > toMs);
    const removed = before - this.visits.length;
    if (removed > 0) this.events.emit("changed", undefined);
    return removed;
  }

  clearAll(): void {
    this.visits = [];
    this.events.emit("changed", undefined);
  }

  search(query: string): HistoryVisit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return [...this.visits]
      .reverse()
      .filter((v) => v.title.toLowerCase().includes(q) || v.url.toLowerCase().includes(q));
  }

  getGroupedByDate(now: number = Date.now()): DateGroup[] {
    const startOfToday = startOfDay(now);
    const startOfYesterday = startOfToday - 86_400_000;
    const startOfWeek = startOfToday - 6 * 86_400_000;
    const startOfMonth = startOfToday - 29 * 86_400_000;

    const buckets: DateGroup[] = [
      { label: "Today", visits: [] },
      { label: "Yesterday", visits: [] },
      { label: "Last 7 Days", visits: [] },
      { label: "Last 30 Days", visits: [] },
      { label: "Older", visits: [] },
    ];

    for (const visit of [...this.visits].reverse()) {
      if (visit.visitedAt >= startOfToday) buckets[0]!.visits.push(visit);
      else if (visit.visitedAt >= startOfYesterday) buckets[1]!.visits.push(visit);
      else if (visit.visitedAt >= startOfWeek) buckets[2]!.visits.push(visit);
      else if (visit.visitedAt >= startOfMonth) buckets[3]!.visits.push(visit);
      else buckets[4]!.visits.push(visit);
    }

    return buckets.filter((b) => b.visits.length > 0);
  }

  getFrecency(url: string, now: number = Date.now()): number {
    return this.visits
      .filter((v) => v.url === url)
      .reduce((sum, v) => sum + ageWeight(v.visitedAt, now) * TRANSITION_WEIGHT[v.transitionType], 0);
  }

  getTopSites(limit = 10, now: number = Date.now()): Array<{ url: string; title: string; hostname: string; score: number }> {
    const byUrl = new Map<string, { title: string; hostname: string; latestVisit: number }>();
    for (const v of this.visits) {
      const existing = byUrl.get(v.url);
      if (!existing || v.visitedAt >= existing.latestVisit) {
        byUrl.set(v.url, { title: v.title, hostname: v.hostname, latestVisit: v.visitedAt });
      }
    }

    return [...byUrl.entries()]
      .map(([url, info]) => ({
        url,
        title: info.title,
        hostname: info.hostname,
        score: this.getFrecency(url, now),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  getAllVisits(): HistoryVisit[] {
    return [...this.visits];
  }

  onChanged(listener: Listener<void>): () => void {
    return this.events.on("changed", listener);
  }
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// =========================================================================
// 4. Design tokens & style injection
// =========================================================================

const STYLE_ELEMENT_ID = "novabrowser-bookmarks-history-styles";

const STYLES = `
:root {
  --nb-bg: #14171C;
  --nb-surface: #1C2027;
  --nb-surface-hover: #242933;
  --nb-border: #2A2F3A;
  --nb-text: #E4E7EC;
  --nb-text-muted: #8B92A3;
  --nb-accent: #C9974C;
  --nb-accent-soft: rgba(201, 151, 76, 0.14);
  --nb-danger: #D65F5F;
  --nb-font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  --nb-font-mono: ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", monospace;
  --nb-radius: 5px;
}

.nb-panel {
  background: var(--nb-bg);
  color: var(--nb-text);
  font-family: var(--nb-font-body);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  min-width: 260px;
  max-width: 480px;
  box-sizing: border-box;
}

.nb-panel * { box-sizing: border-box; }

.nb-search {
  width: 100%;
  padding: 8px 10px;
  background: var(--nb-surface);
  border: 1px solid var(--nb-border);
  border-radius: var(--nb-radius);
  color: var(--nb-text);
  font-family: var(--nb-font-body);
  font-size: 13px;
  outline: none;
}

.nb-search:focus-visible {
  border-color: var(--nb-accent);
  box-shadow: 0 0 0 2px var(--nb-accent-soft);
}

.nb-empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--nb-text-muted);
  font-size: 12px;
}

.nb-folder-label {
  padding: 6px 8px 4px;
  color: var(--nb-text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.nb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--nb-radius);
  cursor: pointer;
  color: var(--nb-text);
  text-decoration: none;
}

.nb-row:hover, .nb-row:focus-visible {
  background: var(--nb-surface-hover);
  outline: none;
}

.nb-row:focus-visible {
  box-shadow: inset 0 0 0 1px var(--nb-accent);
}

.nb-favicon {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: var(--nb-accent-soft);
  color: var(--nb-accent);
  font-family: var(--nb-font-mono);
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nb-row-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.nb-row-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nb-row-url {
  font-family: var(--nb-font-mono);
  font-size: 11px;
  color: var(--nb-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nb-row-time {
  flex: 0 0 auto;
  font-family: var(--nb-font-mono);
  font-size: 11px;
  color: var(--nb-text-muted);
}

.nb-row-delete {
  flex: 0 0 auto;
  background: none;
  border: none;
  color: var(--nb-text-muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  opacity: 0;
}

.nb-row:hover .nb-row-delete,
.nb-row-delete:focus-visible {
  opacity: 1;
}

.nb-row-delete:hover {
  color: var(--nb-danger);
  background: rgba(214, 95, 95, 0.12);
}

.nb-day-group {
  position: relative;
  padding-left: 18px;
  margin-bottom: 4px;
}

.nb-day-group::before {
  content: "";
  position: absolute;
  left: 8px;
  top: 22px;
  bottom: 6px;
  width: 1px;
  background: var(--nb-border);
}

@media (prefers-reduced-motion: no-preference) {
  .nb-day-group::before {
    transition: background-color 0.2s ease;
  }
}

.nb-day-label {
  padding: 6px 0 6px 2px;
  font-weight: 600;
  font-size: 12px;
  color: var(--nb-text);
}

.nb-day-group .nb-row {
  position: relative;
  margin-left: -18px;
  padding-left: 26px;
}

.nb-day-group .nb-row::before {
  content: "";
  position: absolute;
  left: 8px;
  top: 50%;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--nb-border);
  transform: translate(-50%, -50%);
}

.nb-day-group .nb-row:hover::before {
  background: var(--nb-accent);
}

.nb-star-button {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 4px;
  color: var(--nb-text-muted);
  border-radius: 4px;
}

.nb-star-button:hover {
  background: var(--nb-surface-hover);
}

.nb-star-button:focus-visible {
  box-shadow: 0 0 0 2px var(--nb-accent-soft);
  outline: none;
}

.nb-star-button[aria-pressed="true"] {
  color: var(--nb-accent);
}

.nb-toolbar {
  display: flex;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--nb-border);
}

.nb-toolbar-button {
  background: var(--nb-surface);
  border: 1px solid var(--nb-border);
  color: var(--nb-text-muted);
  border-radius: var(--nb-radius);
  padding: 5px 9px;
  font-size: 12px;
  cursor: pointer;
}

.nb-toolbar-button:hover {
  color: var(--nb-text);
  border-color: var(--nb-accent);
}

.nb-toolbar-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--nb-accent-soft);
}

.nb-list {
  overflow-y: auto;
  padding: 8px;
  flex: 1 1 auto;
}
`;

/** Idempotent — safe to call multiple times; injects the stylesheet once per document. */
export function injectStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ELEMENT_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = STYLES;
  doc.head.appendChild(style);
}

// =========================================================================
// 5. Rendering helpers
// =========================================================================

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function faviconLetter(hostname: string): string {
  const clean = hostname.replace(/^www\./, "");
  return (clean[0] ?? "?").toUpperCase();
}

function formatTime(ms: number, now: number = Date.now()): string {
  const date = new Date(ms);
  const sameDay = startOfDay(ms) === startOfDay(now);
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export interface RenderCallbacks {
  onNavigate: (url: string) => void;
}

// -------------------------------------------------------------------------
// Bookmarks panel
// -------------------------------------------------------------------------

export interface BookmarksPanelHandle {
  root: HTMLElement;
  refresh: () => void;
  destroy: () => void;
}

export function renderBookmarksPanel(
  service: BookmarksService,
  callbacks: RenderCallbacks,
  doc: Document = document
): BookmarksPanelHandle {
  injectStyles(doc);

  const root = el(doc, "div", "nb-panel");
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Bookmarks");

  const search = el(doc, "input", "nb-search") as HTMLInputElement;
  search.type = "search";
  search.placeholder = "Search bookmarks";
  search.setAttribute("aria-label", "Search bookmarks");
  root.appendChild(search);

  const list = el(doc, "div", "nb-list");
  root.appendChild(list);

  function renderRow(bookmark: Bookmark): HTMLElement {
    const row = el(doc, "a", "nb-row");
    row.href = bookmark.url;
    row.tabIndex = 0;
    row.addEventListener("click", (e) => {
      e.preventDefault();
      callbacks.onNavigate(bookmark.url);
    });

    const icon = el(doc, "div", "nb-favicon", faviconLetter(bookmark.hostname));
    const textWrap = el(doc, "div", "nb-row-text");
    textWrap.appendChild(el(doc, "div", "nb-row-title", bookmark.title || bookmark.url));
    textWrap.appendChild(el(doc, "div", "nb-row-url", bookmark.hostname));

    const deleteBtn = el(doc, "button", "nb-row-delete", "✕");
    deleteBtn.type = "button";
    deleteBtn.setAttribute("aria-label", `Remove bookmark: ${bookmark.title || bookmark.url}`);
    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      service.removeBookmark(bookmark.id);
    });

    row.append(icon, textWrap, deleteBtn);
    return row;
  }

  function renderTree(node: BookmarkTreeNode, container: HTMLElement, depth: number): void {
    if (node.folder) {
      container.appendChild(el(doc, "div", "nb-folder-label", node.folder.name));
    }
    for (const bookmark of node.bookmarks) {
      container.appendChild(renderRow(bookmark));
    }
    for (const child of node.children) {
      renderTree(child, container, depth + 1);
    }
  }

  function paint(): void {
    list.innerHTML = "";
    const query = search.value.trim();

    if (query) {
      const results = service.search(query);
      if (results.length === 0) {
        list.appendChild(el(doc, "div", "nb-empty", "No bookmarks match your search."));
      } else {
        for (const bookmark of results) list.appendChild(renderRow(bookmark));
      }
      return;
    }

    const tree = service.getTree();
    if (tree.bookmarks.length === 0 && tree.children.length === 0) {
      list.appendChild(el(doc, "div", "nb-empty", "No bookmarks yet. Star a page to save it here."));
      return;
    }
    renderTree(tree, list, 0);
  }

  search.addEventListener("input", paint);
  const unsubscribe = service.onChanged(paint);
  paint();

  return {
    root,
    refresh: paint,
    destroy: () => unsubscribe(),
  };
}

// -------------------------------------------------------------------------
// History page
// -------------------------------------------------------------------------

export interface HistoryPageHandle {
  root: HTMLElement;
  refresh: () => void;
  destroy: () => void;
}

export function renderHistoryPage(
  service: HistoryService,
  callbacks: RenderCallbacks,
  doc: Document = document
): HistoryPageHandle {
  injectStyles(doc);

  const root = el(doc, "div", "nb-panel");
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "History");

  const toolbar = el(doc, "div", "nb-toolbar");
  const clearTodayBtn = el(doc, "button", "nb-toolbar-button", "Clear today");
  clearTodayBtn.type = "button";
  clearTodayBtn.addEventListener("click", () => {
    service.deleteRange(startOfDay(Date.now()), Date.now());
  });
  const clearAllBtn = el(doc, "button", "nb-toolbar-button", "Clear all history");
  clearAllBtn.type = "button";
  clearAllBtn.addEventListener("click", () => service.clearAll());
  toolbar.append(clearTodayBtn, clearAllBtn);
  root.appendChild(toolbar);

  const searchWrap = el(doc, "div");
  searchWrap.style.padding = "8px";
  const search = el(doc, "input", "nb-search") as HTMLInputElement;
  search.type = "search";
  search.placeholder = "Search history";
  search.setAttribute("aria-label", "Search history");
  searchWrap.appendChild(search);
  root.appendChild(searchWrap);

  const list = el(doc, "div", "nb-list");
  root.appendChild(list);

  function renderVisitRow(visit: HistoryVisit): HTMLElement {
    const row = el(doc, "a", "nb-row");
    row.href = visit.url;
    row.tabIndex = 0;
    row.addEventListener("click", (e) => {
      e.preventDefault();
      callbacks.onNavigate(visit.url);
    });

    const icon = el(doc, "div", "nb-favicon", faviconLetter(visit.hostname));
    const textWrap = el(doc, "div", "nb-row-text");
    textWrap.appendChild(el(doc, "div", "nb-row-title", visit.title || visit.url));
    textWrap.appendChild(el(doc, "div", "nb-row-url", visit.hostname));

    const time = el(doc, "div", "nb-row-time", formatTime(visit.visitedAt));

    const deleteBtn = el(doc, "button", "nb-row-delete", "✕");
    deleteBtn.type = "button";
    deleteBtn.setAttribute("aria-label", `Remove from history: ${visit.title || visit.url}`);
    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      service.deleteEntry(visit.id);
    });

    row.append(icon, textWrap, time, deleteBtn);
    return row;
  }

  function paint(): void {
    list.innerHTML = "";
    const query = search.value.trim();

    if (query) {
      const results = service.search(query);
      if (results.length === 0) {
        list.appendChild(el(doc, "div", "nb-empty", "No history matches your search."));
      } else {
        for (const visit of results) list.appendChild(renderVisitRow(visit));
      }
      return;
    }

    const groups = service.getGroupedByDate();
    if (groups.length === 0) {
      list.appendChild(el(doc, "div", "nb-empty", "No browsing history yet."));
      return;
    }

    for (const group of groups) {
      const groupEl = el(doc, "div", "nb-day-group");
      groupEl.appendChild(el(doc, "div", "nb-day-label", group.label));
      for (const visit of group.visits) groupEl.appendChild(renderVisitRow(visit));
      list.appendChild(groupEl);
    }
  }

  search.addEventListener("input", paint);
  const unsubscribe = service.onChanged(paint);
  paint();

  return {
    root,
    refresh: paint,
    destroy: () => unsubscribe(),
  };
}

// -------------------------------------------------------------------------
// Address-bar star button
// -------------------------------------------------------------------------

export interface StarButtonHandle {
  root: HTMLButtonElement;
  destroy: () => void;
}

/** A toggleable star button for the address bar — bookmarks/unbookmarks the given URL. */
export function renderBookmarkStarButton(
  service: BookmarksService,
  getCurrentPage: () => { url: string; title: string } | null,
  doc: Document = document
): StarButtonHandle {
  injectStyles(doc);

  const button = el(doc, "button", "nb-star-button") as HTMLButtonElement;
  button.type = "button";

  function paint(): void {
    const page = getCurrentPage();
    if (!page) {
      button.textContent = "☆";
      button.setAttribute("aria-pressed", "false");
      button.disabled = true;
      return;
    }
    button.disabled = false;
    const bookmarked = service.isBookmarked(page.url);
    button.textContent = bookmarked ? "★" : "☆";
    button.setAttribute("aria-pressed", String(bookmarked));
    button.setAttribute(
      "aria-label",
      bookmarked ? "Remove bookmark for this page" : "Bookmark this page"
    );
  }

  button.addEventListener("click", () => {
    const page = getCurrentPage();
    if (!page) return;
    service.toggleBookmark(page.url, page.title);
  });

  const unsubscribe = service.onChanged(paint);
  paint();

  return { root: button, destroy: () => unsubscribe() };
}

// =========================================================================
// 6. Convenience export
// =========================================================================

export const BookmarksHistoryModule = {
  BookmarksService,
  HistoryService,
  injectStyles,
  renderBookmarksPanel,
  renderHistoryPage,
  renderBookmarkStarButton,
};

export default BookmarksHistoryModule;
