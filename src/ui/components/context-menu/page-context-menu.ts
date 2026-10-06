import type { IDisposable } from '../../../app/dependency-container';
import { reverseImageSearchLinks } from '../../../browser/search/image-search';
import { computeViewTransform, pointToFrame } from '../find-bar/find-overlay';
import type { ContextMenuItem, IContextMenu } from './context-menu';

/** What is under the pointer on a page, as the page's layout resolves it (a link and/or an image). */
interface PageTarget {
  readonly linkUrl: string | null;
  readonly linkText: string | null;
  readonly imageUrl: string | null;
  readonly imageAlt: string | null;
}

interface PageMenuContext {
  readonly pageUrl: string;
  /** The default engine's name, for "Search <engine> for …". */
  readonly engineName: string;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  /** The text selected on the page, when the pointer is on it. */
  readonly selection?: string;
}

interface PageMenuActions {
  openInNewTab(url: string): void;
  copy(text: string): void;
  /** Search the default engine for `text` (the window opens it in a new tab). */
  searchFor(text: string): void;
  askAi(text: string): void;
  back(): void;
  forward(): void;
  reload(): void;
  find(): void;
}

const MAX_QUOTED_CHARS = 40;

/** Page-controlled text in a menu label: one line, short, in quotes. It is only ever sent anywhere when the user clicks. */
function quoted(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return `“${oneLine.length > MAX_QUOTED_CHARS ? `${oneLine.slice(0, MAX_QUOTED_CHARS - 1)}…` : oneLine}”`;
}

/**
 * The right-click menu of a rendered page: a link (open, copy, search for its text), an image (open, copy, reverse
 * lookups), or — over plain page — navigation and find. A link around an image gets both groups.
 */
function buildPageContextMenu(target: PageTarget | null, context: PageMenuContext, actions: PageMenuActions): ContextMenuItem[] {
  const groups: ContextMenuItem[][] = [];
  const link = target?.linkUrl ?? null;
  const image = target?.imageUrl ?? null;

  const selected = context.selection?.replace(/\s+/g, ' ').trim();
  if (selected) {
    groups.push([
      { label: 'Copy', icon: '⧉', action: () => actions.copy(context.selection!.trim()) },
      { label: `Search ${context.engineName} for ${quoted(selected)}`, icon: '🔍', action: () => actions.searchFor(selected) },
      { label: `Ask Nova AI about ${quoted(selected)}`, icon: '✨', action: () => actions.askAi(selected) },
    ]);
  }

  if (link) {
    const group: ContextMenuItem[] = [
      { label: 'Open link in new tab', icon: '↗', action: () => actions.openInNewTab(link) },
      { label: 'Copy link address', icon: '⧉', action: () => actions.copy(link) },
    ];
    const text = target?.linkText?.replace(/\s+/g, ' ').trim();
    if (text) {
      group.push({ label: `Search ${context.engineName} for ${quoted(text)}`, icon: '🔍', action: () => actions.searchFor(text) });
      group.push({ label: `Ask Nova AI about ${quoted(text)}`, icon: '✨', action: () => actions.askAi(text) });
    }
    groups.push(group);
  }

  if (image) {
    const lookups = reverseImageSearchLinks(image);
    groups.push([
      { label: 'Open image in new tab', icon: '↗', action: () => actions.openInNewTab(image) },
      { label: 'Copy image address', icon: '⧉', action: () => actions.copy(image) },
      ...(lookups.length > 0
        ? lookups.map((l): ContextMenuItem => ({ label: `Search image with ${l.name}`, icon: '🖼', action: () => actions.openInNewTab(l.url) }))
        : [{ label: 'Search the web for this image', icon: '🖼', disabled: true } satisfies ContextMenuItem]),
    ]);
  }

  if (!link && !image) {
    groups.push(
      [
        { label: 'Back', icon: '←', disabled: !context.canGoBack, action: () => actions.back() },
        { label: 'Forward', icon: '→', disabled: !context.canGoForward, action: () => actions.forward() },
        { label: 'Reload', icon: '↻', action: () => actions.reload() },
      ],
      [
        { label: 'Find in page…', icon: '🔎', action: () => actions.find() },
        { label: 'Copy page address', icon: '⧉', disabled: !context.pageUrl, action: () => actions.copy(context.pageUrl) },
      ],
    );
  }
  return groups.flatMap((group, i): ContextMenuItem[] => (i === 0 ? group : [{ separator: true }, ...group]));
}

interface PageContextMenuDeps {
  /** The content area; the page bitmap is a `<canvas>` inside it. */
  readonly area: HTMLElement;
  readonly menu: () => IContextMenu;
  /** Hit-test in page-bitmap coordinates (`BrowserWindowPage.resolveContextTarget`). */
  readonly resolveTarget: (x: number, y: number) => PageTarget | null;
  readonly context: () => PageMenuContext;
  readonly actions: PageMenuActions;
  /** The text selected on the page when the client point is on it; asking also ends a selection the point is not on. */
  readonly selectionAt?: (clientX: number, clientY: number) => string;
}

/**
 * Right-click on a rendered page → the page menu. The click lands on the page bitmap scaled into the content area
 * (`object-fit: contain`), so it is mapped back to bitmap coordinates before hit-testing; built-in pages (real DOM,
 * no bitmap) keep the default behaviour.
 */
class PageContextMenuController implements IDisposable {
  private listener: ((e: MouseEvent) => void) | null = null;

  constructor(private readonly deps: PageContextMenuDeps) {}

  attach(): void {
    if (this.listener) return;
    this.listener = (e) => this.onContextMenu(e);
    this.deps.area.addEventListener('contextmenu', this.listener);
  }

  dispose(): void {
    if (this.listener) this.deps.area.removeEventListener('contextmenu', this.listener);
    this.listener = null;
  }

  private onContextMenu(e: MouseEvent): void {
    const canvas = e.target instanceof Element ? e.target.closest('canvas') : null;
    if (e.defaultPrevented || !canvas || canvas.classList.contains('nova-find-overlay') || !this.deps.area.contains(canvas)) return;

    const rect = canvas.getBoundingClientRect();
    const frame = { width: canvas.width, height: canvas.height };
    const view = computeViewTransform({ width: rect.width, height: rect.height }, frame);
    const point = pointToFrame({ x: e.clientX - rect.left, y: e.clientY - rect.top }, view, frame);

    let target: PageTarget | null = null;
    if (point) {
      try {
        target = this.deps.resolveTarget(point.x, point.y);
      } catch (err) {
        console.error('[PageContextMenu] hit-testing failed:', err); // the page menu still opens
        target = null;
      }
    }
    e.preventDefault();
    const selection = this.deps.selectionAt?.(e.clientX, e.clientY) ?? '';
    this.deps.menu().show(e.clientX, e.clientY, buildPageContextMenu(target, { ...this.deps.context(), selection }, this.deps.actions));
  }
}

export { buildPageContextMenu, PageContextMenuController };
export type { PageTarget, PageMenuContext, PageMenuActions, PageContextMenuDeps };
