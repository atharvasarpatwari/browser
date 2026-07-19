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

/** Configuration for a channel. */
interface ChannelConfig {
  /** The channel name. */
  readonly name: string;
  /** Direction filter — only receive messages from this direction. */
  readonly directionFilter?: string;
  /** Maximum pending requests (0 = unlimited). */
  readonly maxPendingRequests: number;
  /** Default timeout for requests on this channel. */
  readonly defaultTimeoutMs: number;
}

const DEFAULT_CHANNEL_CONFIG: ChannelConfig = {
  name: 'unnamed',
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
  /** Unsubscribe from fire-and-forget messages. */
  offMessage<T = unknown>(handler: ChannelMessageHandler<T>): void;
  /** Unsubscribe from request messages. */
  offRequest<TPayload = unknown, TResult = unknown>(handler: ChannelRequestHandler<TPayload, TResult>): void;

  /** Send a fire-and-forget message. */
  send(payload: unknown): Promise<void>;
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
  private readonly _pendingRequests = new Map<string, PendingRequest>();
  private readonly _pendingStreams = new Map<string, {
    chunks: unknown[];
    resolve: (value: AsyncIterable<unknown>) => void;
    reject: (error: Error) => void;
    done: boolean;
  }>();

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

  // ── Sending ───────────────────────────────────────────────────────────────

  async send(payload: unknown): Promise<void> {
    if (!this._active) throw new Error(`Channel "${this.name}" is not active`);
    const msg = createFireAndForget(
      this.name,
      'main-to-renderer', // TODO: direction should come from config
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
      'main-to-renderer',
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
      'main-to-renderer',
      this._processId,
      payload,
      timeout,
    );

    // Send the stream request
    await this._transport.send(this._serializer.encode(msg));

    // Yield chunks as they arrive
    // In a real implementation, this would use a queue-based approach
    // For now, we collect chunks from the stream handler
    const correlationId = msg.id;
    const chunks: unknown[] = [];
    let done = false;
    let resolveChunk: (() => void) | null = null;
    let rejectChunk: ((err: Error) => void) | null = null;

    // Register a temporary handler for stream chunks
    const chunkHandler = (message: IPCMessage) => {
      if (isStreamChunk(message) && message.correlationId === correlationId) {
        chunks.push(message.data);
        done = message.done;
        if (resolveChunk) resolveChunk();
      }
    };

    // Use a wrapper for the message handler
    this.onMessage(chunkHandler as ChannelMessageHandler);

    try {
      while (!done) {
        if (chunks.length === 0) {
          await new Promise<void>((resolve, reject) => {
            resolveChunk = resolve;
            rejectChunk = reject;
          });
        }
        while (chunks.length > 0) {
          yield chunks.shift() as TChunk;
        }
      }
    } finally {
      this.offMessage(chunkHandler as ChannelMessageHandler);
    }
  }

  // ── Activation ────────────────────────────────────────────────────────────

  activate(): void {
    if (this._active) return;
    this._active = true;

    // Register a raw message handler on the transport
    this._transport.onData((data) => {
      this._handleIncoming(data);
    });
  }

  deactivate(): void {
    if (!this._active) return;
    this._active = false;

    // Clear pending requests
    for (const [, pending] of this._pendingRequests) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(`Channel "${this.name}" deactivated`));
    }
    this._pendingRequests.clear();
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
    for (const handler of this._requestHandlers) {
      try {
        const result = await handler(msg.payload, msg);
        const response = createResponse(
          this.name,
          'renderer-to-main',
          this._processId,
          msg.id,
          result,
        );
        await this._transport.send(this._serializer.encode(response));
      } catch (err) {
        const errorResponse = createErrorResponse(
          this.name,
          'renderer-to-main',
          this._processId,
          msg.id,
          err instanceof Error ? err : new Error(String(err)),
        );
        await this._transport.send(this._serializer.encode(errorResponse));
      }
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

  private _handleStreamRequest(_msg: IStreamRequestMessage): void {
    // Stream requests are handled by the request handler on the other side
    // The handler would call createStreamChunk and send chunks back
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
};
