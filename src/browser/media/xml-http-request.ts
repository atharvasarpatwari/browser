import type { IDisposable } from '../../app/dependency-container';

interface IXHRClient extends IDisposable {
  get(url: string): Promise<XHRResponse>;
  post(url: string, body?: unknown): Promise<XHRResponse>;
  put(url: string, body?: unknown): Promise<XHRResponse>;
  delete(url: string): Promise<XHRResponse>;
  onEvent(handler: XHREventHandler): () => void;
}

interface XHRResponse {
  readonly status: number;
  readonly statusText: string;
  readonly responseText: string;
  readonly responseUrl: string;
  readonly headers: Record<string, string>;
}

interface XHREvent {
  readonly kind: XHREventKind;
  readonly data?: Record<string, unknown>;
}

type XHREventKind = 'loadstart' | 'progress' | 'load' | 'error' | 'abort' | 'timeout' | 'loadend';
type XHREventHandler = (event: XHREvent) => void;

const READY_STATE_UNSENT = 0;
const READY_STATE_OPENED = 1;
const READY_STATE_HEADERS_RECEIVED = 2;
const READY_STATE_LOADING = 3;
const READY_STATE_DONE = 4;

class XHRClient implements IXHRClient {
  private _handlers = new Set<XHREventHandler>();

  private async request(method: string, url: string, body?: unknown): Promise<XHRResponse> {
    return new Promise<XHRResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);

      this.emit({ kind: 'loadstart' });

      xhr.onreadystatechange = () => {
        if (xhr.readyState === READY_STATE_LOADING) {
          this.emit({ kind: 'progress', data: { loaded: 0, total: 0 } });
        }
      };

      xhr.onload = () => {
        const headers: Record<string, string> = {};
        const headerStr = xhr.getAllResponseHeaders();
        for (const line of headerStr.split('\r\n')) {
          const idx = line.indexOf(':');
          if (idx > 0) {
            headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
          }
        }

        const response: XHRResponse = {
          status: xhr.status,
          statusText: xhr.statusText,
          responseText: xhr.responseText,
          responseUrl: xhr.responseURL,
          headers,
        };

        this.emit({ kind: 'load' });
        this.emit({ kind: 'loadend' });
        resolve(response);
      };

      xhr.onerror = () => {
        this.emit({ kind: 'error' });
        this.emit({ kind: 'loadend' });
        reject(new Error('XHR request failed'));
      };

      xhr.onabort = () => {
        this.emit({ kind: 'abort' });
        this.emit({ kind: 'loadend' });
        reject(new Error('XHR request aborted'));
      };

      xhr.ontimeout = () => {
        this.emit({ kind: 'timeout' });
        this.emit({ kind: 'loadend' });
        reject(new Error('XHR request timed out'));
      };

      if (body !== undefined) {
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(body));
      } else {
        xhr.send();
      }
    });
  }

  get(url: string): Promise<XHRResponse> {
    return this.request('GET', url);
  }

  post(url: string, body?: unknown): Promise<XHRResponse> {
    return this.request('POST', url, body);
  }

  put(url: string, body?: unknown): Promise<XHRResponse> {
    return this.request('PUT', url, body);
  }

  delete(url: string): Promise<XHRResponse> {
    return this.request('DELETE', url);
  }

  onEvent(handler: XHREventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: XHREvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
  }
}

export { XHRClient, READY_STATE_UNSENT, READY_STATE_OPENED, READY_STATE_HEADERS_RECEIVED, READY_STATE_LOADING, READY_STATE_DONE };
export type { IXHRClient, XHRResponse, XHREvent, XHREventKind, XHREventHandler };
