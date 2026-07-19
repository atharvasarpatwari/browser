/**
 * @file src/browser/engine/page-loader.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Standalone implementation of IPageLoader that wraps IResourceLoader.
 * Handles:
 *   • Fetching raw HTML documents from URLs
 *   • Mapping ResourceLoadResult to PageLoadResult
 *   • Propagating abort signals for cancellation
 *   • Error handling for network failures
 *
 * Does NOT:
 *   • Parse HTML (PageRenderer's job)
 *   • Render content (PageRenderer's job)
 *   • Manage caching (ResourceLoader's job)
 *   • Handle sub-resources (ResourcePrioritizer's job)
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only loads pages from URLs.
 *  Encapsulation    ResourceLoader is private; callers use the public API.
 *  Dependency-Inv.  Depends on IResourceLoader interface, not concrete class.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../app/dependency-container';
import type { IResourceLoader, ResourceLoadResult } from '../netwroking/resource-loader';
import type { IPageLoader, PageLoadResult } from './browser-engine';

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class PageLoader implements IPageLoader, IDisposable {
  private readonly resourceLoader: IResourceLoader;
  private disposed = false;

  constructor(resourceLoader: IResourceLoader) {
    this.resourceLoader = resourceLoader;
  }

  /**
   * Fetches the raw document for a URL.
   *
   * @param url    The URL to fetch.
   * @param signal AbortSignal for cancellation.
   * @returns      The loaded page content.
   */
  async load(url: string, signal: AbortSignal): Promise<PageLoadResult> {
    if (this.disposed) {
      throw new Error('PageLoader has been disposed');
    }

    try {
      const result = await this.resourceLoader.loadResource(url, 'document', { signal });
      return this.mapResult(result);
    } catch (err) {
      // Re-throw abort errors as-is.
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }

      // Wrap other errors with context.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load page from ${url}: ${message}`);
    }
  }

  /**
   * Maps a ResourceLoadResult to a PageLoadResult.
   */
  private mapResult(result: ResourceLoadResult): PageLoadResult {
    return {
      url: result.url,
      statusCode: result.statusCode,
      contentType: result.contentType,
      body: result.body,
      headers: result.headers,
      loadedAt: result.loadedAt,
    };
  }

  /**
   * Disposes the loader and releases resources.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { PageLoader };
