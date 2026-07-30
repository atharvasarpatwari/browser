import type { IDisposable } from '../../app/dependency-container';

type NotificationPermission = 'default' | 'granted' | 'denied';

interface INotificationService extends IDisposable {
  readonly permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  show(title: string, options?: NotificationOptions): Promise<NotificationHandle>;
  closeAll(): void;
  onEvent(handler: NotificationEventHandler): () => void;
}

interface NotificationOptions {
  body?: string;
  icon?: string;
  tag?: string;
  data?: unknown;
  silent?: boolean;
  vibrate?: number[];
  requireInteraction?: boolean;
  badge?: string;
  image?: string;
}

interface NotificationHandle {
  readonly title: string;
  readonly options: NotificationOptions;
  readonly timestamp: number;
  close(): void;
}

interface NotificationEvent {
  readonly kind: NotificationEventKind;
  readonly data?: Record<string, unknown>;
}

type NotificationEventKind = 'show' | 'click' | 'close' | 'error' | 'permission';
type NotificationEventHandler = (event: NotificationEvent) => void;

class NotificationService implements INotificationService {
  private _permission: NotificationPermission = 'default';
  private _handlers = new Set<NotificationEventHandler>();
  private _notifications = new Map<string, NotificationHandle>();

  get permission(): NotificationPermission { return this._permission; }

  async requestPermission(): Promise<NotificationPermission> {
    if (typeof Notification !== 'undefined' && Notification.permission !== 'default') {
      this._permission = Notification.permission;
    } else if (this._permission === 'default') {
      this._permission = 'granted';
    }
    this.emit({ kind: 'permission', data: { permission: this._permission } });
    return this._permission;
  }

  async show(title: string, options: NotificationOptions = {}): Promise<NotificationHandle> {
    if (this._permission !== 'granted') {
      throw new Error('Notification permission not granted');
    }

    const handle: NotificationHandle = {
      title,
      options,
      timestamp: Date.now(),
      close: () => {
        this._notifications.delete(tag);
        this.emit({ kind: 'close', data: { title, tag } });
      },
    };
    const tag = options.tag ?? title + '_' + handle.timestamp;
    this._notifications.set(tag, handle);

    if (typeof Notification !== 'undefined') {
      const n = new Notification(title, options as any);
      n.onclick = () => this.emit({ kind: 'click', data: { title, tag } });
      n.onclose = () => handle.close();
      n.onerror = () => this.emit({ kind: 'error', data: { title, tag } });
    }

    this.emit({ kind: 'show', data: { title, tag } });
    return handle;
  }

  closeAll(): void {
    for (const [tag, handle] of this._notifications) {
      handle.close();
    }
    this._notifications.clear();
  }

  onEvent(handler: NotificationEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: NotificationEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this.closeAll();
    this._handlers.clear();
  }
}

export { NotificationService };
export type { INotificationService, NotificationPermission, NotificationOptions, NotificationHandle, NotificationEvent, NotificationEventKind, NotificationEventHandler };
