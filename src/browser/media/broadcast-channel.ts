import type { IDisposable } from '../../app/dependency-container';

interface IBroadcastChannelService extends IDisposable {
  readonly name: string;
  postMessage(message: unknown): void;
  close(): void;
  onEvent(handler: BroadcastEventHandler): () => void;
}

interface BroadcastEvent {
  readonly kind: BroadcastEventKind;
  readonly data?: Record<string, unknown>;
}

type BroadcastEventKind = 'message' | 'messageerror';
type BroadcastEventHandler = (event: BroadcastEvent) => void;

class BroadcastChannelService implements IBroadcastChannelService {
  readonly name: string;
  private _channel: BroadcastChannel | null = null;
  private _handlers = new Set<BroadcastEventHandler>();

  constructor(name: string) {
    this.name = name;
    try {
      this._channel = new BroadcastChannel(name);
      this._channel.onmessage = (event: MessageEvent) => {
        this.emit({ kind: 'message', data: { data: event.data } });
      };
      this._channel.onmessageerror = () => {
        this.emit({ kind: 'messageerror' });
      };
    } catch {
      // BroadcastChannel not available in this environment
    }
  }

  postMessage(message: unknown): void {
    if (this._channel) {
      this._channel.postMessage(message);
    }
  }

  close(): void {
    if (this._channel) {
      this._channel.close();
      this._channel = null;
    }
  }

  onEvent(handler: BroadcastEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: BroadcastEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this.close();
    this._handlers.clear();
  }
}

export { BroadcastChannelService };
export type { IBroadcastChannelService, BroadcastEvent, BroadcastEventKind, BroadcastEventHandler };
