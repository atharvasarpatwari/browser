/**
 * @file src/common/ipc/channel.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * The IPC channel system sits on top of the transport layer. It provides:
 *
 *   • Named channel subscription (subscribe/unsubscribe)
 *   • Fire-and-forget messaging
 *   • Request-response with timeout and correlation
 *   • Stream requests with async iteration
 *   • Automatic serialization/deserialization via ISerializer
 *   • Message routing by channel name
 *
 * This is the primary API that all subsystems use to communicate across
 * process boundaries.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 *  Abstraction      IChannel is the public contract.
 *  Encapsulation    Transport, serializer, and pending requests are private.
 *  Single-Resp.     Channel manages message routing and correlation.
 *  Open / Closed    New channel patterns are added via composition.
 */

import type { IDisposable } from '../../app/dependency-container';
import type { ITransport } from './transport';
import type { ISerializer } from './serializer';
import { JSONSerializer } from './serializer';
import type { IPCMessage, IFireAndForgetMessage, IRequestMessage, IResponseMessage, IStreamChunkMessage, IStreamRequestMessage } from './message';
import {
  isFireAndForget,
  isRequest,
  isResponse,
  isStreamRequest,
  isStreamChunk,
  createFireAndForget,
  createRequest,
  createResponse,
  createErrorResponse,
  createStreamRequest,
  createStreamChunk,
  createMessageId,
} from './message';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Handler for fire-and-forget messages on a channel. */
type ChannelMessageHandler<T = unknown> = (payload: T, message: IFireAndForgetMessage) => void;

/** Handler for request messages on a channel. */
type ChannelRequestHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  message: IRequestMessage,
) => Promise<TResult> | TResult;

/** Handler for stream request messages (server-side). Returns an async iterable of chunks. */
type ChannelStreamHandler<TPayload = unknown, TChunk = unknown> = (
  payload: TPayload,
  message: IStreamRequestMessage,
) => AsyncIterable<TChunk> | Promise<AsyncIterable<TChunk>>;

/** Configuration for a channel. */
interface ChannelConfig {
  /** The channel name. */
  readonly name: string;
  /** The direction of messages sent by this channel (e.g., 'main-to-renderer'). */
  readonly direction: string;
  /** Maximum pending requests (0 = unlimited). */
  readonly maxPendingRequests: number;
  /** Default timeout for requests on this channel. */
  readonly defaultTimeoutMs: number;
}

const DEFAULT_CHANNEL_CONFIG: ChannelConfig = {
  name: 'unnamed',
  direction: 'main-to-renderer',
  maxPendingRequests: 100,
  defaultTimeoutMs: 30_000,
};

/** Pending request tracking. */
interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout> | null;
  readonly channel: string;
  readonly startedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IChannel extends IDisposable {
  /** The channel name. */
  readonly name: string;
  /** Whether the channel is active. */
  readonly active: boolean;

  /** Subscribe to fire-and-forget messages. */
  onMessage<T = unknown>(handler: ChannelMessageHandler<T>): void;
  /** Subscribe to request messages (handler returns a result). */
  onRequest<TPayload = unknown, TResult = unknown>(handler: ChannelRequestHandler<TPayload, TResult>): void;
  /** Subscribe to stream requests (handler returns an async iterable of chunks). */
  onStream<TPayload = unknown, TChunk = unknown>(handler: ChannelStreamHandler<TPayload, TChunk>): void;
  /** Unsubscribe from fire-and-forget messages. */
  offMessage<T = unknown>(handler: ChannelMessageHandler<T>): void;
  /** Unsubscribe from request messages. */
  offRequest<TPayload = unknown, TResult = unknown>(handler: ChannelRequestHandler<TPayload, TResult>): void;
  /** Unsubscribe from stream request handlers. */
  offStream<TPayload = unknown, TChunk = unknown>(handler: ChannelStreamHandler<TPayload, TChunk>): void;

  /** Subscribe to fire-and-forget messages. Returns an unsubscribe function. */
  subscribe<T = unknown>(topic: string, handler: (payload: T) => void): () => void;
  /** Send a fire-and-forget message. */
  send(payload: unknown): Promise<void>;
  /** Send a fire-and-forget message on a named topic (for subscribe pattern). */
  send(topic: string, payload: unknown): Promise<void>;
  /** Send a request and await a response. */
  request<TPayload = unknown, TResult = unknown>(payload: unknown, timeoutMs?: number): Promise<TResult>;
  /** Open a stream and iterate over chunks. */
  stream<TPayload = unknown, TChunk = unknown>(payload: unknown, timeoutMs?: number): AsyncIterable<TChunk>;

  /** Activate the channel (start processing messages). */
  activate(): void;
  /** Deactivate the channel (stop processing messages). */
  deactivate(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class Channel implements IChannel {
  readonly name: string;
  private _active = false;
  private readonly _config: ChannelConfig;
  private readonly _transport: ITransport;
  private readonly _serializer: ISerializer;
  private readonly _processId: string;
  private readonly _messageHandlers = new Set<ChannelMessageHandler>();
  private readonly _requestHandlers = new Set<ChannelRequestHandler>();
  private readonly _streamHandlers = new Set<ChannelStreamHandler>();
  private readonly _pendingRequests = new Map<string, PendingRequest>();
  private readonly _pendingStreams = new Map<string, {
    queue: unknown[];
    resolve: ((value: IteratorResult<unknown>) => void) | null;
    done: boolean;
    error: Error | null;
    timeout: ReturnType<typeof setTimeout> | null;
  }>();
  private readonly _topicHandlers = new Map<string, Set<(payload: unknown) => void>>();
  private _transportDataHandler: ((data: string) => void) | null = null;

  constructor(
    transport: ITransport,
    config: Partial<ChannelConfig> & { name: string },
    processId: string,
    serializer?: ISerializer,
  ) {
    this.name = config.name;
    this._config = { ...DEFAULT_CHANNEL_CONFIG, ...config };
    this._transport = transport;
    this._serializer = serializer ?? new JSONSerializer();
    this._processId = processId;
  }

  get active(): boolean { return this._active; }

  // ── Subscription ──────────────────────────────────────────────────────────

  onMessage<T = unknown>(handler: ChannelMessageHandler<T>): void {
    this._messageHandlers.add(handler as ChannelMessageHandler);
  }

  onRequest<TPayload = unknown, TResult = unknown>(handler: ChannelRequestHandler<TPayload, TResult>): void {
    this._requestHandlers.add(handler as ChannelRequestHandler);
  }

  offMessage<T = unknown>(handler: ChannelMessageHandler<T>): void {
    this._messageHandlers.delete(handler as ChannelMessageHandler);
  }

  offRequest<TPayload = unknown, TResult = unknown>(handler: ChannelRequestHandler<TPayload, TResult>): void {
    this._requestHandlers.delete(handler as ChannelRequestHandler);
  }

  onStream<TPayload = unknown, TChunk = unknown>(handler: ChannelStreamHandler<TPayload, TChunk>): void {
    this._streamHandlers.add(handler as ChannelStreamHandler);
  }

  offStream<TPayload = unknown, TChunk = unknown>(handler: ChannelStreamHandler<TPayload, TChunk>): void {
    this._streamHandlers.delete(handler as ChannelStreamHandler);
  }

  subscribe<T = unknown>(topic: string, handler: (payload: T) => void): () => void {
    if (!this._topicHandlers.has(topic)) {
      this._topicHandlers.set(topic, new Set());
    }
    const handlers = this._topicHandlers.get(topic)!;
    const wrapped = handler as (payload: unknown) => void;
    handlers.add(wrapped);

    // Register a message handler that filters by topic
    const messageHandler: ChannelMessageHandler<{ __topic__: string; __payload__: unknown }> = (payload, _msg) => {
      if (payload && typeof payload === 'object' && '__topic__' in payload && (payload as any).__topic__ === topic) {
        handler((payload as any).__payload__ as T);
      }
    };
    this._messageHandlers.add(messageHandler as ChannelMessageHandler);

    return () => {
      handlers.delete(wrapped);
      this._messageHandlers.delete(messageHandler as ChannelMessageHandler);
      if (handlers.size === 0) {
        this._topicHandlers.delete(topic);
      }
    };
  }

  // ── Sending ───────────────────────────────────────────────────────────────

  async send(topicOrPayload: unknown, maybePayload?: unknown): Promise<void> {
    if (!this._active) throw new Error(`Channel "${this.name}" is not active`);

    // Support both send(payload) and send(topic, payload) overloads
    let payload: unknown;
    let topic: string | null = null;
    if (maybePayload !== undefined && typeof topicOrPayload === 'string') {
      topic = topicOrPayload;
      payload = { __topic__: topic, __payload__: maybePayload };
    } else {
      payload = topicOrPayload;
    }

    const msg = createFireAndForget(
      this.name,
      this._config.direction,
      this._processId,
      payload,
    );
    const encoded = this._serializer.encode(msg);
    await this._transport.send(encoded);
  }

  async request<TPayload = unknown, TResult = unknown>(
    payload: unknown,
    timeoutMs?: number,
  ): Promise<TResult> {
    if (!this._active) throw new Error(`Channel "${this.name}" is not active`);

    const timeout = timeoutMs ?? this._config.defaultTimeoutMs;
    const msg = createRequest(
      this.name,
      this._config.direction,
      this._processId,
      payload,
      timeout,
    );

    return new Promise<TResult>((resolve, reject) => {
      // Set up timeout
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (timeout > 0) {
        timer = setTimeout(() => {
          this._pendingRequests.delete(msg.correlationId ?? msg.id);
          reject(new Error(`Request timed out after ${timeout}ms on channel "${this.name}"`));
        }, timeout);
      }

      this._pendingRequests.set(msg.correlationId ?? msg.id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        channel: this.name,
        startedAt: Date.now(),
      });

      this._transport.send(this._serializer.encode(msg)).catch(err => {
        if (timer) clearTimeout(timer);
        this._pendingRequests.delete(msg.correlationId ?? msg.id);
        reject(err);
      });
    });
  }

  async *stream<TPayload = unknown, TChunk = unknown>(
    payload: unknown,
    timeoutMs?: number,
  ): AsyncIterable<TChunk> {
    if (!this._active) throw new Error(`Channel "${this.name}" is not active`);

    const timeout = timeoutMs ?? this._config.defaultTimeoutMs;
    const msg = createStreamRequest(
      this.name,
      this._config.direction,
      this._processId,
      payload,
      timeout,
    );

    const correlationId = msg.id;

    // Set up pending stream state with queue
    const state: {
      queue: unknown[];
      resolve: ((value: IteratorResult<unknown>) => void) | null;
      done: boolean;
      error: Error | null;
      timeout: ReturnType<typeof setTimeout> | null;
    } = { queue: [], resolve: null, done: false, error: null, timeout: null };

    if (timeout > 0) {
      state.timeout = setTimeout(() => {
        state.error = new Error(`Stream timed out after ${timeout}ms on channel "${this.name}"`);
        state.done = true;
        if (state.resolve) {
          const r = state.resolve;
          state.resolve = null;
          r({ value: undefined, done: true });
        }
      }, timeout);
    }

    this._pendingStreams.set(correlationId, state);

    // Register a raw handler for stream chunks (bypasses onMessage — chunks are internal)
    const rawChunkHandler = (data: string) => {
      let msg: IPCMessage;
      try {
        msg = this._serializer.decode(data);
      } catch { return; }
      if (msg.channel !== this.name) return;

      if (isStreamChunk(msg) && msg.correlationId === correlationId) {
        if (state.timeout) clearTimeout(state.timeout);

        if (msg.done) {
          state.done = true;
        } else {
          state.queue.push(msg.data);
        }

        // Wake up the iterator if it's waiting
        if (state.resolve) {
          const r = state.resolve;
          state.resolve = null;

          if (state.error) {
            r({ value: undefined, done: true });
          } else if (state.queue.length > 0) {
            r({ value: state.queue.shift(), done: false });
          } else if (state.done) {
            r({ value: undefined, done: true });
          } else {
            // Still waiting — re-register
            state.timeout = setTimeout(() => {
              state.error = new Error(`Stream timed out after ${timeout}ms on channel "${this.name}"`);
              state.done = true;
              if (state.resolve) {
                const r2 = state.resolve;
                state.resolve = null;
                r2({ value: undefined, done: true });
              }
            }, timeout);
          }
        }
      }
    };

    this._transport.onData(rawChunkHandler);

    // Send the stream request
    await this._transport.send(this._serializer.encode(msg));

    try {
      while (true) {
        // If queue has items, yield them
        if (state.queue.length > 0) {
          yield state.queue.shift() as TChunk;
          continue;
        }

        // If done, stop
        if (state.done) break;

        // Wait for next chunk or done
        const result = await new Promise<IteratorResult<unknown>>((resolve) => {
          state.resolve = resolve;
        });

        if (result.done) break;
        yield result.value as TChunk;
      }
    } finally {
      this._transport.offData(rawChunkHandler);
      if (state.timeout) clearTimeout(state.timeout);
      this._pendingStreams.delete(correlationId);
    }
  }

  // ── Activation ────────────────────────────────────────────────────────────

  activate(): void {
    if (this._active) return;
    this._active = true;

    // Register a raw message handler on the transport
    this._transportDataHandler = (data) => this._handleIncoming(data);
    this._transport.onData(this._transportDataHandler);
  }

  deactivate(): void {
    if (!this._active) return;
    this._active = false;

    // Remove transport handler
    if (this._transportDataHandler) {
      this._transport.offData(this._transportDataHandler);
      this._transportDataHandler = null;
    }

    // Clear pending requests
    for (const [, pending] of this._pendingRequests) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(`Channel "${this.name}" deactivated`));
    }
    this._pendingRequests.clear();

    // Clear pending streams
    for (const [id, state] of this._pendingStreams) {
      if (state.timeout) clearTimeout(state.timeout);
      state.done = true;
      state.error = new Error(`Channel "${this.name}" deactivated`);
      if (state.resolve) {
        const r = state.resolve;
        state.resolve = null;
        r({ value: undefined, done: true });
      }
    }
    this._pendingStreams.clear();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _handleIncoming(data: string): void {
    if (!this._active) return;
    let msg: IPCMessage;
    try {
      msg = this._serializer.decode(data);
    } catch {
      return; // Drop malformed messages
    }

    // Only process messages for our channel
    if (msg.channel !== this.name) return;

    if (isFireAndForget(msg)) {
      for (const h of this._messageHandlers) {
        try { h(msg.payload, msg); } catch { /* swallow handler errors */ }
      }
    } else if (isRequest(msg)) {
      this._handleRequest(msg);
    } else if (isResponse(msg)) {
      this._handleResponse(msg);
    } else if (isStreamRequest(msg)) {
      this._handleStreamRequest(msg);
    } else if (isStreamChunk(msg)) {
      this._handleStreamChunk(msg);
    }
  }

  private async _handleRequest(msg: IRequestMessage): Promise<void> {
    const handlers = Array.from(this._requestHandlers);
    if (handlers.length === 0) {
      const errorResponse = createErrorResponse(
        this.name,
        this._config.direction,
        this._processId,
        msg.id,
        new Error(`No handler registered for channel "${this.name}"`),
      );
      await this._transport.send(this._serializer.encode(errorResponse));
      return;
    }

    try {
      const result = await handlers[0](msg.payload, msg);
      const response = createResponse(
        this.name,
        this._config.direction,
        this._processId,
        msg.id,
        result,
      );
      await this._transport.send(this._serializer.encode(response));
    } catch (err) {
      const errorResponse = createErrorResponse(
        this.name,
        this._config.direction,
        this._processId,
        msg.id,
        err instanceof Error ? err : new Error(String(err)),
      );
      await this._transport.send(this._serializer.encode(errorResponse));
    }
  }

  private _handleResponse(msg: IResponseMessage): void {
    const pending = this._pendingRequests.get(msg.correlationId);
    if (!pending) return;

    if (pending.timer) clearTimeout(pending.timer);
    this._pendingRequests.delete(msg.correlationId);

    if (msg.success) {
      pending.resolve(msg.payload);
    } else {
      pending.reject(msg.error
        ? new Error(msg.error.message)
        : new Error('Unknown error'));
    }
  }

  private async _handleStreamRequest(msg: IStreamRequestMessage): Promise<void> {
    const handlers = Array.from(this._streamHandlers);
    if (handlers.length === 0) {
      // No stream handler registered — send done signal
      const doneChunk = createStreamChunk(
        this.name,
        this._config.direction,
        this._processId,
        msg.id,
        undefined,
        true,
      );
      await this._transport.send(this._serializer.encode(doneChunk));
      return;
    }

    try {
      const iterable = await handlers[0](msg.payload, msg);
      for await (const chunk of iterable) {
        const streamChunk = createStreamChunk(
          this.name,
          this._config.direction,
          this._processId,
          msg.id,
          chunk,
          false,
        );
        await this._transport.send(this._serializer.encode(streamChunk));
      }
      // Send done signal
      const doneChunk = createStreamChunk(
        this.name,
        this._config.direction,
        this._processId,
        msg.id,
        undefined,
        true,
      );
      await this._transport.send(this._serializer.encode(doneChunk));
    } catch (err) {
      // Send done signal with error — the stream consumer will see done=true
      const doneChunk = createStreamChunk(
        this.name,
        this._config.direction,
        this._processId,
        msg.id,
        undefined,
        true,
      );
      await this._transport.send(this._serializer.encode(doneChunk));
    }
  }

  private _handleStreamChunk(msg: IStreamChunkMessage): void {
    // Deliver to message handlers (stream chunks are delivered as messages)
    for (const h of this._messageHandlers) {
      try { h(msg.data, msg as unknown as IFireAndForgetMessage); } catch { /* swallow */ }
    }
  }

  // ── IDisposable ───────────────────────────────────────────────────────────

  dispose(): void {
    this.deactivate();
    this._messageHandlers.clear();
    this._requestHandlers.clear();
    this._streamHandlers.clear();
    this._topicHandlers.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANAGER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages a set of named channels over a single transport.
 * Provides channel creation, lookup, and lifecycle management.
 */
interface IChannelManager extends IDisposable {
  /** Create or get a named channel. */
  getChannel(name: string, config?: Partial<ChannelConfig>): IChannel;
  /** Check if a channel exists. */
  hasChannel(name: string): boolean;
  /** Remove a channel. */
  removeChannel(name: string): boolean;
  /** Get all channel names. */
  getChannelNames(): readonly string[];
  /** Activate all channels. */
  activateAll(): void;
  /** Deactivate all channels. */
  deactivateAll(): void;
}

class ChannelManager implements IChannelManager {
  private readonly _channels = new Map<string, Channel>();
  private readonly _transport: ITransport;
  private readonly _processId: string;
  private readonly _serializer: ISerializer;

  constructor(transport: ITransport, processId: string, serializer?: ISerializer) {
    this._transport = transport;
    this._processId = processId;
    this._serializer = serializer ?? new JSONSerializer();
  }

  getChannel(name: string, config?: Partial<ChannelConfig>): IChannel {
    let channel = this._channels.get(name);
    if (!channel) {
      channel = new Channel(
        this._transport,
        { name, ...config },
        this._processId,
        this._serializer,
      );
      this._channels.set(name, channel);
    }
    return channel;
  }

  hasChannel(name: string): boolean {
    return this._channels.has(name);
  }

  removeChannel(name: string): boolean {
    const channel = this._channels.get(name);
    if (!channel) return false;
    channel.dispose();
    return this._channels.delete(name);
  }

  getChannelNames(): readonly string[] {
    return [...this._channels.keys()];
  }

  activateAll(): void {
    for (const channel of this._channels.values()) {
      channel.activate();
    }
  }

  deactivateAll(): void {
    for (const channel of this._channels.values()) {
      channel.deactivate();
    }
  }

  dispose(): void {
    for (const channel of this._channels.values()) {
      channel.dispose();
    }
    this._channels.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  Channel,
  ChannelManager,
  DEFAULT_CHANNEL_CONFIG,
};

export type {
  IChannel,
  IChannelManager,
  ChannelConfig,
  ChannelMessageHandler,
  ChannelRequestHandler,
  ChannelStreamHandler,
};
