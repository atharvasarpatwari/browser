import type { IDisposable } from '../../app/dependency-container';

interface IClipboardService extends IDisposable {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  read(): Promise<ClipboardItem[]>;
  write(items: ClipboardItem[]): Promise<void>;
  onEvent(handler: ClipboardEventHandler): () => void;
}

interface ClipboardItem {
  readonly types: string[];
  getType(type: string): Promise<Blob>;
}

interface ClipboardEvent {
  readonly kind: ClipboardEventKind;
  readonly data?: Record<string, unknown>;
}

type ClipboardEventKind = 'copy' | 'cut' | 'paste';
type ClipboardEventHandler = (event: ClipboardEvent) => void;

class ClipboardService implements IClipboardService {
  private _store = '';
  private _handlers = new Set<ClipboardEventHandler>();

  async readText(): Promise<string> {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try { return await navigator.clipboard.readText(); } catch { }
    }
    return this._store;
  }

  async writeText(text: string): Promise<void> {
    this._store = text;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try { await navigator.clipboard.writeText(text); return; } catch { }
    }
    this.emit({ kind: 'copy', data: { text } });
  }

  async read(): Promise<ClipboardItem[]> {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try { return await navigator.clipboard.read(); } catch { }
    }
    return [];
  }

  async write(items: ClipboardItem[]): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try { await navigator.clipboard.write(items); return; } catch { }
    }
    this.emit({ kind: 'copy', data: { items: items.length } });
  }

  onEvent(handler: ClipboardEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: ClipboardEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
  }
}

export { ClipboardService };
export type { IClipboardService, ClipboardItem, ClipboardEvent, ClipboardEventKind, ClipboardEventHandler };
