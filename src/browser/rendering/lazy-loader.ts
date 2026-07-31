import type { DomElement, DomDocument, IDomTree } from './dom-tree';
import { IntersectionObserver, type IntersectionObserverEntry } from './intersection-observer';
import { FrameScheduler } from './frame-scheduler';
import type { IResourceLoader } from '../networking/resource-loader';
import { ImageDecoder, isSupportedImageType } from '../image/decoder';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type LoadEventType = 'load' | 'error' | 'abort';

export interface LoadEvent {
  readonly type: LoadEventType;
  readonly target: DomElement;
}

export type LoadEventHandler = (event: LoadEvent) => void;

export interface LazyLoadConfig {
  /** Root margin for the IntersectionObserver (default: "200px"). */
  readonly rootMargin?: string;
  /** Threshold for the IntersectionObserver (default: 0). */
  readonly threshold?: number;
  /** Whether to use a placeholder for unloaded images (default: true). */
  readonly showPlaceholder?: boolean;
  /** Placeholder background color (default: "#f0f0f0"). */
  readonly placeholderColor?: string;
  /** Default viewport dimensions. */
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// LAZY LOADER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages lazy loading of images and iframes via IntersectionObserver.
 *
 * Scans the DOM for elements with `loading="lazy"` and observes them.
 * When an element enters the viewport (plus rootMargin), triggers resource
 * loading and updates the element's imageData/loadingState.
 *
 * For images, generates a placeholder ImageData (solid color) to represent
 * the loaded state. In a real browser this would decode JPEG/PNG/WEBP.
 */
export class LazyLoader {
  private observer: IntersectionObserver | null = null;
  private scheduler: FrameScheduler | null = null;
  private config: Required<LazyLoadConfig>;
  private domTree: IDomTree | null = null;
  private document: DomDocument | null = null;
  private resourceLoader: IResourceLoader | null = null;
  private decoder: ImageDecoder | null = null;
  private baseUrl = '';
  private eventHandlers = new Map<DomElement, Set<LoadEventHandler>>();
  private pendingElements = new Set<DomElement>();
  private disposed = false;

  constructor(config?: LazyLoadConfig) {
    this.config = {
      rootMargin: config?.rootMargin ?? '200px',
      threshold: config?.threshold ?? 0,
      showPlaceholder: config?.showPlaceholder ?? true,
      placeholderColor: config?.placeholderColor ?? '#f0f0f0',
      viewportWidth: config?.viewportWidth ?? 1920,
      viewportHeight: config?.viewportHeight ?? 1080,
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Initialize the lazy loader with a DOM document.
   * Sets up the observer but does NOT auto-observe elements.
   * Use scanForLazyElements() to auto-observe, or observe() for individual elements.
   */
  init(document: DomDocument, domTree: IDomTree, resourceLoader?: IResourceLoader, baseUrl?: string): void {
    this.document = document;
    this.domTree = domTree;
    this.resourceLoader = resourceLoader ?? null;
    this.baseUrl = baseUrl ?? '';
    if (this.resourceLoader) {
      this.decoder = new ImageDecoder();
    }

    this.observer = new IntersectionObserver(
      (entries) => this.handleIntersections(entries),
      {
        root: null,
        rootMargin: this.config.rootMargin,
        threshold: [0, 0.1, 0.5, 1],
      },
    );

    this.observer.setViewport(this.config.viewportWidth, this.config.viewportHeight);
  }

  /**
   * Scan the DOM tree for elements with `loading="lazy"` and start observing.
   */
  scanForLazyElements(node: DomDocument | DomElement): void {
    if (this.disposed || !this.observer) return;

    if (node.nodeType === 'element') {
      const el = node as DomElement;
      if (el.loadingState === 'lazy') {
        this.pendingElements.add(el);
        this.observer.observe(el);
      }
    }

    for (const child of node.children) {
      if (child.nodeType === 'element') {
        this.scanForLazyElements(child as DomElement);
      }
    }
  }

  /**
   * Observe a specific element for lazy loading (even if not `loading="lazy"`).
   */
  observe(el: DomElement): void {
    if (this.disposed || !this.observer) return;
    if (el.loadingState === 'none') {
      el.loadingState = 'lazy';
    }
    this.pendingElements.add(el);
    this.observer.observe(el);
  }

  /** Stop observing an element. */
  unobserve(el: DomElement): void {
    this.observer?.unobserve(el);
    this.pendingElements.delete(el);
  }

  /** Update viewport dimensions. */
  setViewport(width: number, height: number): void {
    this.config.viewportWidth = width;
    this.config.viewportHeight = height;
    this.observer?.setViewport(width, height);
  }

  /** Update scroll position. */
  setScroll(x: number, y: number): void {
    this.observer?.setScroll(x, y);
  }

  dispose(): void {
    this.disposed = true;
    this.observer?.disconnect();
    this.observer = null;
    this.pendingElements.clear();
    this.eventHandlers.clear();
    this.scheduler?.cancel();
    this.scheduler = null;
    this.domTree = null;
    this.document = null;
    this.resourceLoader = null;
    this.decoder = null;
  }

  // ── Event handling ──────────────────────────────────────────────────

  /** Register a load/error handler on a lazy element. */
  onLoad(el: DomElement, handler: LoadEventHandler): void {
    if (!this.eventHandlers.has(el)) this.eventHandlers.set(el, new Set());
    this.eventHandlers.get(el)!.add(handler);
  }

  /** Remove a handler from a lazy element. */
  offLoad(el: DomElement, handler: LoadEventHandler): void {
    this.eventHandlers.get(el)?.delete(handler);
  }

  // ── Intersection handling ───────────────────────────────────────────

  private handleIntersections(entries: readonly IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (entry.isIntersecting && this.pendingElements.has(entry.target)) {
        this.loadElement(entry.target);
      }
    }
  }

  // ── Element loading ─────────────────────────────────────────────────

  private loadElement(el: DomElement): void {
    if (el.loadingState === 'loaded' || el.loadingState === 'loading') return;

    el.loadingState = 'loading';
    this.pendingElements.delete(el);
    this.observer?.unobserve(el);

    const tagName = el.tagName.toLowerCase();
    if (tagName === 'img') {
      this.loadImage(el);
    } else if (tagName === 'iframe') {
      this.loadIframe(el);
    } else {
      el.loadingState = 'error';
      this.emit({ type: 'error', target: el });
    }
  }

  private loadImage(el: DomElement): void {
    const src = el.attributes.get('src') ?? el.attributes.get('data-src') ?? '';
    if (!src) {
      el.loadingState = 'error';
      this.emit({ type: 'error', target: el });
      return;
    }

    // Resolve explicit width/height from attributes
    const wAttr = el.attributes.get('width');
    const hAttr = el.attributes.get('height');
    const w = wAttr ? parseInt(wAttr, 10) : 0;
    const h = hAttr ? parseInt(hAttr, 10) : 0;

    const box = el.layoutBox;
    const imgW = w > 0 ? w : (box ? Math.round(box.width) : 100);
    const imgH = h > 0 ? h : (box ? Math.round(box.height) : 100);

    // Set placeholder immediately for visual feedback
    const placeholder = this.generateImageData(src, imgW, imgH);
    el.imageData = placeholder;
    el.naturalWidth = imgW;
    el.naturalHeight = imgH;

    // If no resource loader available, use placeholder
    if (!this.resourceLoader || !this.decoder) {
      el.loadingState = 'loaded';
      el._dirtyPaint = true;
      this.emit({ type: 'load', target: el });
      return;
    }

    // Attempt real image decoding
    el.loadingState = 'loading';
    this.loadImageAsync(el, src, imgW, imgH);
  }

  private async loadImageAsync(el: DomElement, src: string, fallbackW: number, fallbackH: number): Promise<void> {
    try {
      const resolvedUrl = this.resolveUrl(src);
      const result = await this.resourceLoader!.loadImage(resolvedUrl);

      if (result.error || !result.bodyBinary) {
        // Keep placeholder — mark as loaded
        el.loadingState = 'loaded';
        el._dirtyPaint = true;
        this.emit({ type: 'load', target: el });
        return;
      }

      // Decode the binary data
      if (isSupportedImageType(result.contentType)) {
        const decoded = await this.decoder!.decode(result.bodyBinary, result.contentType);
        if (decoded) {
          el.imageData = { data: decoded.data, width: decoded.width, height: decoded.height };
          el.naturalWidth = decoded.width;
          el.naturalHeight = decoded.height;
          el.loadingState = 'loaded';
          el._dirtyPaint = true;
          this.emit({ type: 'load', target: el });
          return;
        }
      }

      // Unsupported format or decode failure — keep placeholder
      el.loadingState = 'loaded';
      el._dirtyPaint = true;
      this.emit({ type: 'load', target: el });
    } catch {
      // Network or decode error — keep placeholder
      el.loadingState = 'loaded';
      el._dirtyPaint = true;
      this.emit({ type: 'load', target: el });
    }
  }

  private resolveUrl(src: string): string {
    // Already absolute
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
      return src;
    }

    // Try to resolve relative to a base URL stored during init
    if (this.baseUrl) {
      try {
        return new URL(src, this.baseUrl).toString();
      } catch {
        // fall through
      }
    }

    return src;
  }

  private loadIframe(_el: DomElement): void {
    // Iframes would load a nested document — for now just mark as loaded
    _el.loadingState = 'loaded';
    _el._dirtyPaint = true;
    this.emit({ type: 'load', target: _el });
  }

  /**
   * Generate a synthetic ImageData for a source URL.
   * In a real browser this would decode JPEG/PNG/etc.
   * For our purposes, creates a colored rectangle based on the URL hash.
   */
  private generateImageData(src: string, width: number, height: number): ImageData {
    const pixels = new Uint8ClampedArray(width * height * 4);
    const color = this.urlToColor(src);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;

        // Checkerboard pattern with subtle border
        const isBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
        const isChecker = (Math.floor(x / 20) + Math.floor(y / 20)) % 2 === 0;

        if (isBorder) {
          // 2px dark border
          pixels[idx] = Math.round(color.r * 0.5);
          pixels[idx + 1] = Math.round(color.g * 0.5);
          pixels[idx + 2] = Math.round(color.b * 0.5);
          pixels[idx + 3] = 255;
        } else if (isChecker) {
          pixels[idx] = color.r;
          pixels[idx + 1] = color.g;
          pixels[idx + 2] = color.b;
          pixels[idx + 3] = 255;
        } else {
          // Lighter variant
          pixels[idx] = Math.min(255, Math.round(color.r * 1.2));
          pixels[idx + 1] = Math.min(255, Math.round(color.g * 1.2));
          pixels[idx + 2] = Math.min(255, Math.round(color.b * 1.2));
          pixels[idx + 3] = 255;
        }
      }
    }

    return { data: pixels, width, height };
  }

  private urlToColor(url: string): { r: number; g: number; b: number } {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = url.charCodeAt(i) + ((hash << 5) - hash);
    }
    return {
      r: (hash >> 16) & 0xff,
      g: (hash >> 8) & 0xff,
      b: hash & 0xff,
    };
  }

  private emit(event: LoadEvent): void {
    const handlers = this.eventHandlers.get(event.target);
    if (handlers) {
      for (const h of handlers) {
        try { h(event); } catch (err) {
          console.error('[LazyLoader] Handler error:', err);
        }
      }
    }
  }
}

export type { IntersectionObserverEntry, IntersectionObserver };
