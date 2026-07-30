import type { MessageSender, MessageResponse } from './extension-types';

export interface Message {
  type: string;
  data: unknown;
  sender: MessageSender;
  timestamp: number;
  messageId: string;
}

export type MessageListener = (
  message: unknown,
  sender: MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined | void;

export interface Port {
  name: string;
  sender: MessageSender;
  postMessage(msg: unknown): void;
  disconnect(): void;
  onMessage: { addListener(fn: (msg: unknown) => void): void; removeListener(fn: (msg: unknown) => void): void };
  onDisconnect: { addListener(fn: () => void): void; removeListener(fn: () => void): void };
}

export type MsgEventType = 'messageSent' | 'messageReceived' | 'portConnected' | 'portDisconnected';

export interface MsgEvent {
  kind: MsgEventType;
  extensionId: string;
  messageId?: string;
  portName?: string;
}

export type MsgEventHandler = (event: MsgEvent) => void;

export class Messaging {
  private listeners = new Map<string, Set<MessageListener>>();
  private externalListeners = new Map<string, Set<MessageListener>>();
  private connectListeners = new Map<string, Set<(port: Port) => void>>();
  private ports = new Map<string, Port>();
  private handlers = new Set<MsgEventHandler>();
  private counter = 0;

  private nextId(): string { this.counter++; return `msg-${this.counter}`; }

  addListener(extensionId: string, listener: MessageListener): () => void {
    const set = this.listeners.get(extensionId) ?? new Set();
    set.add(listener);
    this.listeners.set(extensionId, set);
    return () => { set.delete(listener); if (set.size === 0) this.listeners.delete(extensionId); };
  }

  addExternalListener(extensionId: string, listener: MessageListener): () => void {
    const set = this.externalListeners.get(extensionId) ?? new Set();
    set.add(listener);
    this.externalListeners.set(extensionId, set);
    return () => { set.delete(listener); if (set.size === 0) this.externalListeners.delete(extensionId); };
  }

  onConnect(extensionId: string, listener: (port: Port) => void): () => void {
    const set = this.connectListeners.get(extensionId) ?? new Set();
    set.add(listener);
    this.connectListeners.set(extensionId, set);
    return () => { set.delete(listener); if (set.size === 0) this.connectListeners.delete(extensionId); };
  }

  sendMessage(
    targetExtensionId: string,
    message: unknown,
    sender: MessageSender,
    includeExternal = false,
  ): Promise<unknown> {
    return new Promise((resolve) => {
      const listeners = this.listeners.get(targetExtensionId);
      const extListeners = includeExternal ? this.externalListeners.get(targetExtensionId) : undefined;
      const allListeners = new Set<MessageListener>();
      if (listeners) for (const l of listeners) allListeners.add(l);
      if (extListeners) for (const l of extListeners) allListeners.add(l);

      if (allListeners.size === 0) {
        resolve({ success: false, error: 'No listeners registered' });
        return;
      }

      let responded = false;
      const msgId = this.nextId();
      this.emit({ kind: 'messageSent', extensionId: targetExtensionId, messageId: msgId });

      for (const listener of allListeners) {
        const result = listener(message, sender, (response?: unknown) => {
          if (!responded) {
            responded = true;
            resolve(response);
          }
        });
        if (result === true) {
          // listener will call sendResponse asynchronously
        }
      }

      // If no listener returned true, resolve immediately
      if (!responded) {
        responded = true;
        resolve(undefined);
      }
    });
  }

  connect(extensionId: string, portName: string, sender: MessageSender): Port {
    const portId = `${extensionId}:${portName}:${this.counter}`;
    const callbacks: Array<(msg: unknown) => void> = [];
    const disconnectCallbacks: Array<() => void> = [];
    let disconnected = false;
    const self = this;

    const port: Port = {
      name: portName,
      sender,
      postMessage(msg: unknown): void {
        for (const cb of callbacks) cb(msg);
      },
      disconnect(): void {
        if (disconnected) return;
        disconnected = true;
        self.ports.delete(portId);
        for (const dc of disconnectCallbacks) dc();
        self.emit({ kind: 'portDisconnected', extensionId, portName });
      },
      onMessage: {
        addListener(fn: (msg: unknown) => void): void { callbacks.push(fn); },
        removeListener(fn: (msg: unknown) => void): void {
          const idx = callbacks.indexOf(fn);
          if (idx >= 0) callbacks.splice(idx, 1);
        },
      },
      onDisconnect: {
        addListener(fn: () => void): void { disconnectCallbacks.push(fn); },
        removeListener(fn: () => void): void {
          const idx = disconnectCallbacks.indexOf(fn);
          if (idx >= 0) disconnectCallbacks.splice(idx, 1);
        },
      },
    };

    this.ports.set(portId, port);
    this.emit({ kind: 'portConnected', extensionId, portName });

    const connectListeners = this.connectListeners.get(extensionId);
    if (connectListeners) {
      for (const cl of connectListeners) {
        try { cl(port); } catch { }
      }
    }

    return port;
  }

  onEvent(handler: MsgEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  clear(): void {
    this.listeners.clear();
    this.externalListeners.clear();
    this.connectListeners.clear();
    this.ports.clear();
    this.counter = 0;
  }

  dispose(): void {
    this.clear();
    this.handlers.clear();
  }

  private emit(event: MsgEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { }
    }
  }
}
