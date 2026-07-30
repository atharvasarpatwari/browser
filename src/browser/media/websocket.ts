import type { IDisposable } from '../../app/dependency-container';

type WSReadyState = 'connecting' | 'open' | 'closing' | 'closed';

interface IWebSocketClient extends IDisposable {
  readonly url: string;
  readonly readyState: WSReadyState;
  connect(): void;
  send(data: string | ArrayBuffer | Blob): void;
  close(code?: number, reason?: string): void;
  onEvent(handler: WebSocketEventHandler): () => void;
}

interface WebSocketEvent {
  readonly kind: WebSocketEventKind;
  readonly data?: Record<string, unknown>;
}

type WebSocketEventKind = 'open' | 'message' | 'error' | 'close';
type WebSocketEventHandler = (event: WebSocketEvent) => void;

class WebSocketClient implements IWebSocketClient {
  readonly url: string;
  private _ws: WebSocket | null = null;
  private _readyState: WSReadyState = 'closed';
  private _handlers = new Set<WebSocketEventHandler>();

  constructor(url: string) {
    this.url = url;
  }

  get readyState(): WSReadyState { return this._readyState; }

  connect(): void {
    if (this._readyState === 'connecting' || this._readyState === 'open') return;
    this._readyState = 'connecting';

    try {
      this._ws = new WebSocket(this.url);

      this._ws.onopen = () => {
        this._readyState = 'open';
        this.emit({ kind: 'open' });
      };

      this._ws.onmessage = (event: MessageEvent) => {
        this.emit({ kind: 'message', data: { data: event.data } });
      };

      this._ws.onerror = () => {
        this.emit({ kind: 'error' });
      };

      this._ws.onclose = (event: CloseEvent) => {
        this._readyState = 'closed';
        this.emit({ kind: 'close', data: { code: event.code, reason: event.reason } });
        this._ws = null;
      };
    } catch {
      this._readyState = 'closed';
      this.emit({ kind: 'error' });
    }
  }

  send(data: string | ArrayBuffer | Blob): void {
    if (this._readyState !== 'open' || !this._ws) {
      throw new Error('WebSocket is not connected');
    }
    this._ws.send(data);
  }

  close(code?: number, reason?: string): void {
    if (this._readyState === 'closed') return;
    this._readyState = 'closing';
    if (this._ws) {
      try {
        this._ws.close(code, reason);
      } catch { }
    }
    this._readyState = 'closed';
    this._ws = null;
    this.emit({ kind: 'close', data: { code: code ?? 1000 } });
  }

  onEvent(handler: WebSocketEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: WebSocketEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this.close();
    this._handlers.clear();
  }
}

export { WebSocketClient };
export type { IWebSocketClient, WSReadyState, WebSocketEvent, WebSocketEventKind, WebSocketEventHandler };
