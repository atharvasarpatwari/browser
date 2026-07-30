import type { IDisposable } from '../../app/dependency-container';

interface IFetchClient extends IDisposable {
  get(url: string, options?: FetchOptions): Promise<FetchResponse>;
  post(url: string, body?: unknown, options?: FetchOptions): Promise<FetchResponse>;
  put(url: string, body?: unknown, options?: FetchOptions): Promise<FetchResponse>;
  patch(url: string, body?: unknown, options?: FetchOptions): Promise<FetchResponse>;
  delete(url: string, options?: FetchOptions): Promise<FetchResponse>;
  head(url: string, options?: FetchOptions): Promise<FetchResponse>;
  onEvent(handler: FetchEventHandler): () => void;
}

interface FetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeout?: number;
}

interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly url: string;
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface FetchEvent {
  readonly kind: FetchEventKind;
  readonly data?: Record<string, unknown>;
}

type FetchEventKind = 'request' | 'response' | 'error';
type FetchEventHandler = (event: FetchEvent) => void;

class FetchClient implements IFetchClient {
  private _handlers = new Set<FetchEventHandler>();

  async request(method: string, url: string, body?: unknown, options?: FetchOptions): Promise<FetchResponse> {
    this.emit({ kind: 'request', data: { method, url } });

    const headers: Record<string, string> = { ...options?.headers };
    let fetchBody: BodyInit | null = null;
    if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
      if (body instanceof FormData || body instanceof URLSearchParams) {
        fetchBody = body as any;
      } else {
        headers['content-type'] ??= 'application/json';
        fetchBody = JSON.stringify(body);
      }
    }

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (options?.timeout) {
      timeoutId = setTimeout(() => controller.abort(), options.timeout);
    }
    const signal = options?.signal ?? controller.signal;

    try {
      const res = await fetch(url, { method, headers, body: fetchBody, signal });
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { resHeaders[k] = v; });

      const response: FetchResponse = {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        url: res.url,
        json: <T>() => res.clone().json() as Promise<T>,
        text: () => res.clone().text(),
        blob: () => res.clone().blob(),
        arrayBuffer: () => res.clone().arrayBuffer(),
      };

      this.emit({ kind: 'response', data: { method, url, status: res.status } });
      return response;
    } catch (err) {
      this.emit({ kind: 'error', data: { method, url, error: String(err) } });
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  get(url: string, options?: FetchOptions): Promise<FetchResponse> {
    return this.request('GET', url, undefined, options);
  }

  post(url: string, body?: unknown, options?: FetchOptions): Promise<FetchResponse> {
    return this.request('POST', url, body, options);
  }

  put(url: string, body?: unknown, options?: FetchOptions): Promise<FetchResponse> {
    return this.request('PUT', url, body, options);
  }

  patch(url: string, body?: unknown, options?: FetchOptions): Promise<FetchResponse> {
    return this.request('PATCH', url, body, options);
  }

  delete(url: string, options?: FetchOptions): Promise<FetchResponse> {
    return this.request('DELETE', url, undefined, options);
  }

  head(url: string, options?: FetchOptions): Promise<FetchResponse> {
    return this.request('HEAD', url, undefined, options);
  }

  onEvent(handler: FetchEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: FetchEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
  }
}

export { FetchClient };
export type { IFetchClient, FetchOptions, FetchResponse, FetchEvent, FetchEventKind, FetchEventHandler };
