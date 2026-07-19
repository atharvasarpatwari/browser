import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BookmarksService,
  HistoryService,
  renderBookmarksPanel,
  renderHistoryPage,
  renderBookmarkStarButton,
} from "../src/ui/components/bookmarks-history/bookmarks-history";
import type { Bookmark, HistoryVisit } from "../src/ui/components/bookmarks-history/bookmarks-history";

// =========================================================================
// Helpers
// =========================================================================

function freshDoc(): Document {
  const d = document.implementation.createHTMLDocument("");
  return d;
}

function click(node: Element): void {
  node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const DAY_MS = 86_400_000;

function localStartOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// =========================================================================
// BookmarksService
// =========================================================================

describe("BookmarksService", () => {
  describe("addBookmark", () => {
    it("creates a bookmark with a derived hostname", () => {
      const service = new BookmarksService();
      const bookmark = service.addBookmark({ title: "Anthropic", url: "https://www.anthropic.com/news" });
      expect(bookmark.title).toBe("Anthropic");
      expect(bookmark.hostname).toBe("www.anthropic.com");
      expect(bookmark.folderId).toBeNull();
    });

    it("falls back to the raw string as hostname when the URL is unparseable", () => {
      const service = new BookmarksService();
      const bookmark = service.addBookmark({ title: "Weird", url: "not-a-real-url" });
      expect(bookmark.hostname).toBe("not-a-real-url");
    });

    it("is idempotent for a duplicate URL", () => {
      const service = new BookmarksService();
      const first = service.addBookmark({ title: "First", url: "https://example.com" });
      const second = service.addBookmark({ title: "Second", url: "https://example.com" });
      expect(first.id).toBe(second.id);
      expect(second.title).toBe("First");
      const tree = service.getTree();
      expect(tree.bookmarks).toHaveLength(1);
    });
  });

  describe("removeBookmark", () => {
    it("removes an existing bookmark and returns true", () => {
      const service = new BookmarksService();
      const bookmark = service.addBookmark({ title: "X", url: "https://x.example" });
      expect(service.removeBookmark(bookmark.id)).toBeTruthy();
      expect(service.isBookmarked("https://x.example")).toBeFalsy();
    });

    it("returns false for an unknown id", () => {
      const service = new BookmarksService();
      expect(service.removeBookmark("nope")).toBeFalsy();
    });
  });

  describe("updateBookmark", () => {
    it("patches title, folderId, and tags", () => {
      const service = new BookmarksService();
      const bookmark = service.addBookmark({ title: "Old", url: "https://y.example" });
      const updated = service.updateBookmark(bookmark.id, { title: "New", tags: ["a", "b"] });
      expect(updated?.title).toBe("New");
      expect(updated?.tags).toEqual(["a", "b"]);
    });

    it("returns null for an unknown id", () => {
      const service = new BookmarksService();
      expect(service.updateBookmark("nope", { title: "X" })).toBeNull();
    });
  });

  describe("isBookmarked / getByUrl", () => {
    it("reflects current state accurately", () => {
      const service = new BookmarksService();
      expect(service.isBookmarked("https://z.example")).toBeFalsy();
      service.addBookmark({ title: "Z", url: "https://z.example" });
      expect(service.isBookmarked("https://z.example")).toBeTruthy();
      expect(service.getByUrl("https://z.example")?.title).toBe("Z");
    });
  });

  describe("toggleBookmark", () => {
    it("adds when absent and removes when present", () => {
      const service = new BookmarksService();
      const first = service.toggleBookmark("https://toggle.example", "Toggle");
      expect(first.bookmarked).toBeTruthy();
      const second = service.toggleBookmark("https://toggle.example", "Toggle");
      expect(second.bookmarked).toBeFalsy();
      expect(second.bookmark).toBeNull();
    });
  });

  describe("folders", () => {
    it("nests bookmarks under their folder in getTree()", () => {
      const service = new BookmarksService();
      const folder = service.createFolder("Work");
      service.addBookmark({ title: "In folder", url: "https://a.example", folderId: folder.id });
      service.addBookmark({ title: "At root", url: "https://b.example" });

      const tree = service.getTree();
      expect(tree.bookmarks).toHaveLength(1);
      expect(tree.bookmarks[0]?.title).toBe("At root");
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0]?.folder?.name).toBe("Work");
      expect(tree.children[0]?.bookmarks).toHaveLength(1);
    });

    it("supports nested subfolders", () => {
      const service = new BookmarksService();
      const parent = service.createFolder("Parent");
      const child = service.createFolder("Child", parent.id);
      service.addBookmark({ title: "Deep", url: "https://deep.example", folderId: child.id });

      const tree = service.getTree();
      const parentNode = tree.children.find((n) => n.folder?.id === parent.id);
      expect(parentNode?.children).toHaveLength(1);
      expect(parentNode?.children[0]?.folder?.id).toBe(child.id);
      expect(parentNode?.children[0]?.bookmarks[0]?.title).toBe("Deep");
    });

    it("removeFolder promotes its bookmarks and subfolders to the parent", () => {
      const service = new BookmarksService();
      const folder = service.createFolder("Temp");
      const bookmark = service.addBookmark({ title: "Survivor", url: "https://s.example", folderId: folder.id });

      service.removeFolder(folder.id);

      const tree = service.getTree();
      expect(tree.children).toHaveLength(0);
      expect(tree.bookmarks.map((b) => b.id)).toContain(bookmark.id);
    });

    it("moveBookmark reassigns a bookmark's folder", () => {
      const service = new BookmarksService();
      const folderA = service.createFolder("A");
      const folderB = service.createFolder("B");
      const bookmark = service.addBookmark({ title: "M", url: "https://m.example", folderId: folderA.id });

      service.moveBookmark(bookmark.id, folderB.id);

      const tree = service.getTree();
      const nodeB = tree.children.find((n) => n.folder?.id === folderB.id);
      expect(nodeB?.bookmarks[0]?.id).toBe(bookmark.id);
    });
  });

  describe("search", () => {
    it("matches by title, url, and tag, case-insensitively", () => {
      const service = new BookmarksService();
      service.addBookmark({ title: "Anthropic Docs", url: "https://docs.anthropic.com", tags: ["reference"] });
      service.addBookmark({ title: "Cooking", url: "https://recipes.example", tags: ["food"] });

      expect(service.search("ANTHROPIC")).toHaveLength(1);
      expect(service.search("docs.anthropic")).toHaveLength(1);
      expect(service.search("reference")).toHaveLength(1);
      expect(service.search("food")).toHaveLength(1);
      expect(service.search("nonexistent")).toHaveLength(0);
    });

    it("returns no results for an empty query", () => {
      const service = new BookmarksService();
      service.addBookmark({ title: "X", url: "https://x.example" });
      expect(service.search("   ")).toHaveLength(0);
    });
  });

  describe("import / export", () => {
    it("round-trips bookmarks and folders through JSON", () => {
      const source = new BookmarksService();
      const folder = source.createFolder("Saved");
      source.addBookmark({ title: "Roundtrip", url: "https://rt.example", folderId: folder.id });

      const json = source.exportJSON();

      const destination = new BookmarksService();
      destination.importJSON(json);

      expect(destination.isBookmarked("https://rt.example")).toBeTruthy();
      const tree = destination.getTree();
      expect(tree.children[0]?.folder?.name).toBe("Saved");
    });
  });

  describe("onChanged", () => {
    it("fires on mutations and stops firing after unsubscribe", () => {
      const service = new BookmarksService();
      let callCount = 0;
      const unsubscribe = service.onChanged(() => {
        callCount++;
      });

      service.addBookmark({ title: "One", url: "https://one.example" });
      expect(callCount).toBe(1);

      unsubscribe();
      service.addBookmark({ title: "Two", url: "https://two.example" });
      expect(callCount).toBe(1);
    });
  });
});

// =========================================================================
// HistoryService
// =========================================================================

describe("HistoryService", () => {
  describe("recordVisit", () => {
    it("records a visit with a derived hostname", () => {
      const service = new HistoryService();
      const visit = service.recordVisit("https://news.example/a", "News A", "typed");
      expect(visit?.hostname).toBe("news.example");
      expect(visit?.transitionType).toBe("typed");
    });

    it("no-ops silently while private mode is enabled", () => {
      const service = new HistoryService();
      service.setPrivateMode(true);
      const result = service.recordVisit("https://private.example", "Private");
      expect(result).toBeNull();
      expect(service.getAllVisits()).toHaveLength(0);

      service.setPrivateMode(false);
      service.recordVisit("https://public.example", "Public");
      expect(service.getAllVisits()).toHaveLength(1);
    });
  });

  describe("deleteEntry / deleteRange / clearAll", () => {
    it("deleteEntry removes exactly one visit by id", () => {
      const service = new HistoryService();
      const v1 = service.recordVisit("https://a.example", "A")!;
      service.recordVisit("https://b.example", "B");
      service.deleteEntry(v1.id);
      expect(service.getAllVisits()).toHaveLength(1);
      expect(service.getAllVisits()[0]?.url).toBe("https://b.example");
    });

    it("deleteRange removes only visits within the given window", () => {
      const service = new HistoryService();
      const now = Date.now();
      const oldVisit = service.recordVisit("https://old.example", "Old")!;
      oldVisit.visitedAt = now - 10 * DAY_MS;

      service.recordVisit("https://recent.example", "Recent");

      const removed = service.deleteRange(now - DAY_MS, now + DAY_MS);
      expect(removed).toBe(1);
      expect(service.getAllVisits()).toHaveLength(1);
      expect(service.getAllVisits()[0]?.url).toBe("https://old.example");
    });

    it("clearAll empties history entirely", () => {
      const service = new HistoryService();
      service.recordVisit("https://a.example", "A");
      service.recordVisit("https://b.example", "B");
      service.clearAll();
      expect(service.getAllVisits()).toHaveLength(0);
    });
  });

  describe("search", () => {
    it("matches by title or url, most recent first", () => {
      const service = new HistoryService();
      service.recordVisit("https://old.example", "Old Match");
      service.recordVisit("https://new.example", "New Match");
      const results = service.search("match");
      expect(results).toHaveLength(2);
      expect(results[0]?.url).toBe("https://new.example");
    });
  });

  describe("getGroupedByDate", () => {
    it("buckets visits into Today / Yesterday / Last 7 Days / Last 30 Days / Older", () => {
      const service = new HistoryService();
      const now = Date.now();
      const startOfToday = localStartOfDay(now);

      const today = service.recordVisit("https://today.example", "Today")!;
      today.visitedAt = now;

      const yesterday = service.recordVisit("https://yesterday.example", "Yesterday")!;
      yesterday.visitedAt = startOfToday - 1;

      const lastWeek = service.recordVisit("https://week.example", "Week")!;
      lastWeek.visitedAt = startOfToday - 4 * DAY_MS;

      const lastMonth = service.recordVisit("https://month.example", "Month")!;
      lastMonth.visitedAt = startOfToday - 20 * DAY_MS;

      const older = service.recordVisit("https://older.example", "Older")!;
      older.visitedAt = startOfToday - 100 * DAY_MS;

      const groups = service.getGroupedByDate(now);
      const labels = groups.map((g) => g.label);
      expect(labels).toEqual(["Today", "Yesterday", "Last 7 Days", "Last 30 Days", "Older"]);
      for (const group of groups) {
        expect(group.visits).toHaveLength(1);
      }
    });

    it("omits empty buckets", () => {
      const service = new HistoryService();
      service.recordVisit("https://only-today.example", "Only Today");
      const groups = service.getGroupedByDate();
      expect(groups).toHaveLength(1);
      expect(groups[0]?.label).toBe("Today");
    });
  });

  describe("frecency", () => {
    it("weights typed visits higher than link-followed visits", () => {
      const service = new HistoryService();
      const now = Date.now();
      service.recordVisit("https://typed.example", "Typed", "typed");
      service.recordVisit("https://linked.example", "Linked", "link");

      const typedScore = service.getFrecency("https://typed.example", now);
      const linkedScore = service.getFrecency("https://linked.example", now);
      expect(typedScore).toBeGreaterThan(linkedScore);
    });

    it("weights recent visits higher than old visits of the same type", () => {
      const service = new HistoryService();
      const now = Date.now();

      const recent = service.recordVisit("https://recent.example", "Recent", "link")!;
      recent.visitedAt = now;

      const old = service.recordVisit("https://old.example", "Old", "link")!;
      old.visitedAt = now - 60 * DAY_MS;

      const recentScore = service.getFrecency("https://recent.example", now);
      const oldScore = service.getFrecency("https://old.example", now);
      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it("accumulates score across repeated visits to the same URL", () => {
      const service = new HistoryService();
      const now = Date.now();
      service.recordVisit("https://frequent.example", "Frequent", "link");
      service.recordVisit("https://frequent.example", "Frequent", "link");
      service.recordVisit("https://once.example", "Once", "link");

      const frequentScore = service.getFrecency("https://frequent.example", now);
      const onceScore = service.getFrecency("https://once.example", now);
      expect(frequentScore).toBeGreaterThan(onceScore);
    });
  });

  describe("getTopSites", () => {
    it("ranks unique URLs by frecency, most relevant first, respecting the limit", () => {
      const service = new HistoryService();
      const now = Date.now();
      service.recordVisit("https://hot.example", "Hot", "typed");
      service.recordVisit("https://hot.example", "Hot", "typed");
      service.recordVisit("https://warm.example", "Warm", "link");
      service.recordVisit("https://cold.example", "Cold", "link");

      const top = service.getTopSites(2, now);
      expect(top).toHaveLength(2);
      expect(top[0]?.url).toBe("https://hot.example");
    });

    it("uses the most recent title for a repeatedly-visited URL", () => {
      const service = new HistoryService();
      service.recordVisit("https://retitled.example", "Old Title", "link");
      service.recordVisit("https://retitled.example", "New Title", "link");
      const top = service.getTopSites(5);
      expect(top[0]?.title).toBe("New Title");
    });
  });

  describe("capacity", () => {
    it("evicts the oldest visit once the history cap is exceeded", () => {
      const service = new HistoryService();
      const cap = 20_000;
      for (let i = 0; i < cap; i++) {
        service.recordVisit(`https://site-${i}.example`, `Site ${i}`);
      }
      expect(service.getAllVisits()).toHaveLength(cap);

      service.recordVisit("https://one-too-many.example", "Overflow");
      const all = service.getAllVisits();
      expect(all).toHaveLength(cap);
      expect(all[0]?.url).toBe("https://site-1.example");
      expect(all[all.length - 1]?.url).toBe("https://one-too-many.example");
    });
  });
});

// =========================================================================
// Rendering: Bookmarks panel
// =========================================================================

describe("renderBookmarksPanel", () => {
  it("renders one row per bookmark and a folder label for grouped bookmarks", () => {
    const d = freshDoc();
    const service = new BookmarksService();
    const folder = service.createFolder("Work");
    service.addBookmark({ title: "Root Page", url: "https://root.example" });
    service.addBookmark({ title: "Folder Page", url: "https://folder.example", folderId: folder.id });

    const panel = renderBookmarksPanel(service, { onNavigate: () => {} }, d);
    expect(panel.root.querySelectorAll(".nb-row")).toHaveLength(2);
    expect(panel.root.querySelectorAll(".nb-folder-label")).toHaveLength(1);
    panel.destroy();
  });

  it("shows an empty state when there are no bookmarks", () => {
    const d = freshDoc();
    const service = new BookmarksService();
    const panel = renderBookmarksPanel(service, { onNavigate: () => {} }, d);
    expect(panel.root.querySelector(".nb-empty")).toBeTruthy();
    panel.destroy();
  });

  it("clicking a row calls onNavigate with that bookmark's url", () => {
    const d = freshDoc();
    const service = new BookmarksService();
    service.addBookmark({ title: "Nav Target", url: "https://nav.example" });
    const captured: { url: string | null } = { url: null };
    const panel = renderBookmarksPanel(service, { onNavigate: (url) => (captured.url = url) }, d);

    click(panel.root.querySelector(".nb-row")!);
    expect(captured.url).toBe("https://nav.example");
    panel.destroy();
  });

  it("filters rows live as the search input changes", () => {
    const d = freshDoc();
    const service = new BookmarksService();
    service.addBookmark({ title: "Findable", url: "https://findable.example" });
    service.addBookmark({ title: "Other", url: "https://other.example" });
    const panel = renderBookmarksPanel(service, { onNavigate: () => {} }, d);

    const search = panel.root.querySelector(".nb-search") as HTMLInputElement;
    typeInto(search, "findable");
    expect(panel.root.querySelectorAll(".nb-row")).toHaveLength(1);

    typeInto(search, "nothing-matches-this");
    expect(panel.root.querySelector(".nb-empty")).toBeTruthy();

    typeInto(search, "");
    expect(panel.root.querySelectorAll(".nb-row")).toHaveLength(2);
    panel.destroy();
  });

  it("the row delete button removes the bookmark without triggering navigation", () => {
    const d = freshDoc();
    const service = new BookmarksService();
    service.addBookmark({ title: "Delete Me", url: "https://delete.example" });
    let navigated = false;
    const panel = renderBookmarksPanel(service, { onNavigate: () => (navigated = true) }, d);

    click(panel.root.querySelector(".nb-row-delete")!);
    expect(navigated).toBeFalsy();
    expect(service.isBookmarked("https://delete.example")).toBeFalsy();
    expect(panel.root.querySelector(".nb-empty")).toBeTruthy();
    panel.destroy();
  });

  it("repaints automatically when the service changes from outside the panel", () => {
    const d = freshDoc();
    const service = new BookmarksService();
    const panel = renderBookmarksPanel(service, { onNavigate: () => {} }, d);
    expect(panel.root.querySelectorAll(".nb-row")).toHaveLength(0);

    service.addBookmark({ title: "External Add", url: "https://external.example" });
    expect(panel.root.querySelectorAll(".nb-row")).toHaveLength(1);
    panel.destroy();
  });

  it("stops repainting after destroy() is called", () => {
    const d = freshDoc();
    const service = new BookmarksService();
    const panel = renderBookmarksPanel(service, { onNavigate: () => {} }, d);
    panel.destroy();

    service.addBookmark({ title: "After Destroy", url: "https://after.example" });
    expect(panel.root.querySelectorAll(".nb-row")).toHaveLength(0);
  });
});

// =========================================================================
// Rendering: History page
// =========================================================================

describe("renderHistoryPage", () => {
  it("groups today's visits under a single 'Today' day group with the trail-line container", () => {
    const d = freshDoc();
    const service = new HistoryService();
    service.recordVisit("https://a.example", "A");
    service.recordVisit("https://b.example", "B");

    const page = renderHistoryPage(service, { onNavigate: () => {} }, d);
    const groups = page.root.querySelectorAll(".nb-day-group");
    expect(groups).toHaveLength(1);
    expect(page.root.querySelector(".nb-day-label")?.textContent).toBe("Today");
    expect(page.root.querySelectorAll(".nb-row")).toHaveLength(2);
    page.destroy();
  });

  it("shows an empty state when there is no history", () => {
    const d = freshDoc();
    const service = new HistoryService();
    const page = renderHistoryPage(service, { onNavigate: () => {} }, d);
    expect(page.root.querySelector(".nb-empty")).toBeTruthy();
    page.destroy();
  });

  it("the per-row delete button removes only that visit", () => {
    const d = freshDoc();
    const service = new HistoryService();
    service.recordVisit("https://keep.example", "Keep");
    service.recordVisit("https://remove.example", "Remove");
    const page = renderHistoryPage(service, { onNavigate: () => {} }, d);

    const rows = page.root.querySelectorAll(".nb-row");
    const removeRow = [...rows].find((r) => r.querySelector(".nb-row-url")?.textContent === "remove.example");
    click(removeRow!.querySelector(".nb-row-delete")!);

    expect(service.getAllVisits()).toHaveLength(1);
    expect(service.getAllVisits()[0]?.url).toBe("https://keep.example");
    page.destroy();
  });

  it("'Clear all history' empties the list via the service", () => {
    const d = freshDoc();
    const service = new HistoryService();
    service.recordVisit("https://a.example", "A");
    service.recordVisit("https://b.example", "B");
    const page = renderHistoryPage(service, { onNavigate: () => {} }, d);

    const clearAll = [...page.root.querySelectorAll(".nb-toolbar-button")].find(
      (b) => b.textContent === "Clear all history"
    ) as HTMLButtonElement;
    click(clearAll);

    expect(service.getAllVisits()).toHaveLength(0);
    expect(page.root.querySelector(".nb-empty")).toBeTruthy();
    page.destroy();
  });

  it("'Clear today' calls deleteRange bounded to the current day", () => {
    const d = freshDoc();
    const service = new HistoryService();
    const now = Date.now();

    const oldVisit = service.recordVisit("https://old.example", "Old")!;
    oldVisit.visitedAt = now - 10 * DAY_MS;
    service.recordVisit("https://today.example", "Today Visit");

    const page = renderHistoryPage(service, { onNavigate: () => {} }, d);
    const clearToday = [...page.root.querySelectorAll(".nb-toolbar-button")].find(
      (b) => b.textContent === "Clear today"
    ) as HTMLButtonElement;
    click(clearToday);

    const remaining = service.getAllVisits();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.url).toBe("https://old.example");
    page.destroy();
  });

  it("search filters across all history regardless of day grouping", () => {
    const d = freshDoc();
    const service = new HistoryService();
    service.recordVisit("https://apple.example", "Apple Fruit");
    service.recordVisit("https://banana.example", "Banana Fruit");
    const page = renderHistoryPage(service, { onNavigate: () => {} }, d);

    const search = page.root.querySelector(".nb-search") as HTMLInputElement;
    typeInto(search, "apple");
    expect(page.root.querySelectorAll(".nb-row")).toHaveLength(1);
    expect(page.root.querySelectorAll(".nb-day-group")).toHaveLength(0);
    page.destroy();
  });
});

// =========================================================================
// Rendering: star button
// =========================================================================

describe("renderBookmarkStarButton", () => {
  it("is disabled and unpressed when there is no current page", () => {
    const d = freshDoc();
    const service = new BookmarksService();
    const star = renderBookmarkStarButton(service, () => null, d);
    expect(star.root.disabled).toBeTruthy();
    expect(star.root.getAttribute("aria-pressed")).toBe("false");
    star.destroy();
  });

  it("toggles bookmark state on click and reflects it visually", () => {
    const d = freshDoc();
    const service = new BookmarksService();
    const page = { url: "https://star.example", title: "Star Me" };
    const star = renderBookmarkStarButton(service, () => page, d);

    expect(star.root.textContent).toBe("☆");
    click(star.root);
    expect(star.root.getAttribute("aria-pressed")).toBe("true");
    expect(star.root.textContent).toBe("★");
    expect(service.isBookmarked(page.url)).toBeTruthy();

    click(star.root);
    expect(star.root.getAttribute("aria-pressed")).toBe("false");
    expect(service.isBookmarked(page.url)).toBeFalsy();
    star.destroy();
  });

  it("reacts to bookmark changes made elsewhere", () => {
    const d = freshDoc();
    const service = new BookmarksService();
    const page = { url: "https://external-star.example", title: "External" };
    const star = renderBookmarkStarButton(service, () => page, d);

    service.addBookmark({ title: page.title, url: page.url });
    expect(star.root.getAttribute("aria-pressed")).toBe("true");
    star.destroy();
  });
});

// =========================================================================
// Style injection
// =========================================================================

describe("injectStyles", () => {
  it("is idempotent — mounting multiple panels injects one stylesheet", () => {
    const d = freshDoc();
    const bookmarksService = new BookmarksService();
    const historyService = new HistoryService();

    const panel = renderBookmarksPanel(bookmarksService, { onNavigate: () => {} }, d);
    const page = renderHistoryPage(historyService, { onNavigate: () => {} }, d);
    const star = renderBookmarkStarButton(bookmarksService, () => null, d);

    expect(d.querySelectorAll("#novabrowser-bookmarks-history-styles")).toHaveLength(1);

    panel.destroy();
    page.destroy();
    star.destroy();
  });
});
