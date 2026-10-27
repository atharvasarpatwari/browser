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
import type { IResourceLoader, ResourceLoadResult } from '../networking/resource-loader';
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
  async load(url: string, signal: AbortSignal, options?: { readonly bypassCache?: boolean; readonly postData?: { readonly body: string; readonly contentType: string } }): Promise<PageLoadResult> {
    if (this.disposed) {
      throw new Error('PageLoader has been disposed');
    }

    try {
      const post = options?.postData;
      const result = await this.resourceLoader.loadResource(url, 'document', post
        ? { signal, method: 'POST', body: post.body, contentType: post.contentType }
        : { signal, bypassCache: options?.bypassCache });
      // The loader reports network failures (DNS, refused, timeout, blocked) as a result with
      // status 0 and an error instead of throwing. They used to render as an empty page: a blank
      // screen with a green lock and no pageLoadError, so the native error page never showed.
      if (result.error || result.statusCode === 0) {
        throw new Error(result.error || 'The server did not respond.');
      }
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
    // An HTTP error with no body (an empty 404) gets a minimal page saying so, as browsers do,
    // instead of a blank white screen.
    const emptyError = result.statusCode >= 400 && !result.body.trim();
    return {
      url: result.url,
      statusCode: result.statusCode,
      contentType: emptyError ? 'text/html' : result.contentType,
      body: emptyError ? httpErrorPage(result.statusCode, result.url) : result.body,
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

function httpErrorPage(status: number, url: string): string {
  const reason = STATUS_TEXT[status] ?? (status >= 500 ? 'Server error' : 'Request failed');
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  let host = url;
  try { host = new URL(url).host; } catch { /* keep the raw URL */ }
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${status} ${esc(reason)}</title></head>`
    + `<body style="font-family:sans-serif;margin:0;padding:25vh 24px 24px;text-align:center;color:#3c4043">`
    + `<h1 style="font-size:22px;margin:0 0 12px">This page isn't working</h1>`
    + `<p style="margin:0 0 8px">${esc(host)} returned an empty response.</p>`
    + `<p style="margin:0;color:#70757a">HTTP ${status} ${esc(reason)}</p></body></html>`;
}

const STATUS_TEXT: Readonly<Record<number, string>> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
  408: 'Request Timeout', 410: 'Gone', 429: 'Too Many Requests', 500: 'Internal Server Error',
  502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { PageLoader };
