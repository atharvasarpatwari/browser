/**
 * Shared engine interfaces used by both the engine and networking modules.
 * Extracted here to break the circular dependency between engine/browser-engine
 * and networking/request-manager.
 */

/** Raw document received from the network. */
interface PageLoadResult {
  readonly url: string;
  readonly statusCode: number;
  readonly contentType: string;
  readonly body: string;
  readonly headers: ReadonlyMap<string, string>;
  readonly loadedAt: number;
}

/**
 * Fetches the raw document for a URL.
 * Implemented by networking/request-manager.ts.
 */
interface IPageLoader {
  /** `bypassCache`: a user reload, which must go back to the network. `postData`: a form POST. */
  load(url: string, signal: AbortSignal, options?: { readonly bypassCache?: boolean; readonly postData?: { readonly body: string; readonly contentType: string } }): Promise<PageLoadResult>;
}

export type { IPageLoader, PageLoadResult };
