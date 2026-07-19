/**
 * @file src/common/ipc/message.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Define the core IPC message protocol. Every message sent between processes
 * conforms to this structure. Messages are discriminated unions based on
 * `type`, enabling exhaustive switch-case handling.
 *
 * Three message patterns:
 *   1. Fire-and-forget  — sender sends, no response expected
 *   2. Request-response — sender sends, awaits a response with matching id
 *   3. Streaming        — sender sends, receives multiple responses until done
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 *  Abstraction      IMessage is the base; concrete types hide transport details.
 *  Encapsulation    Message IDs are generated internally; callers never forge them.
 *  Open / Closed    New message types are added via union extension, not editing.
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE ID
// ─────────────────────────────────────────────────────────────────────────────

let _msgSeq = 0;

/** Generate a unique message ID. */
export function createMessageId(): string {
  return `msg-${Date.now().toString(36)}-${(++_msgSeq).toString(36)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE DIRECTION
// ─────────────────────────────────────────────────────────────────────────────

/** Which direction a message flows. */
export type MessageDirection = 'main-to-renderer' | 'renderer-to-main' | 'main-to-main' | 'renderer-to-renderer';

// ─────────────────────────────────────────────────────────────────────────────
// BASE MESSAGE
// ─────────────────────────────────────────────────────────────────────────────

/** Base structure shared by all IPC messages. */
interface IMessage {
  /** Unique identifier for this message. */
  readonly id: string;
  /** Channel this message is sent on. */
  readonly channel: string;
  /** Direction of the message. */
  readonly direction: MessageDirection;
  /** When the message was created. */
  readonly timestamp: number;
  /** The originating process ID. */
  readonly sourceProcessId: string;
  /** Optional correlation ID for request-response pairing. */
  readonly correlationId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIRE-AND-FORGET
// ─────────────────────────────────────────────────────────────────────────────

/** A message sent with no expectation of a response. */
interface IFireAndForgetMessage extends IMessage {
  readonly kind: 'fire-and-forget';
  /** The payload data. */
  readonly payload: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST / RESPONSE
// ─────────────────────────────────────────────────────────────────────────────

/** A message that expects a single response. */
interface IRequestMessage extends IMessage {
  readonly kind: 'request';
  /** The payload data (request body). */
  readonly payload: unknown;
  /** Timeout in ms for the response (0 = no timeout). */
  readonly timeoutMs: number;
}

/** A response to a request message. */
interface IResponseMessage extends IMessage {
  readonly kind: 'response';
  /** Whether the request succeeded. */
  readonly success: boolean;
  /** The response payload (only on success). */
  readonly payload?: unknown;
  /** The error (only on failure). */
  readonly error?: SerializedError;
  /** The correlation ID matching the original request. */
  readonly correlationId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAMING
// ─────────────────────────────────────────────────────────────────────────────

/** A message that opens a streaming channel. */
interface IStreamRequestMessage extends IMessage {
  readonly kind: 'stream-request';
  /** The payload data (stream parameters). */
  readonly payload: unknown;
  /** Timeout in ms for the entire stream (0 = no timeout). */
  readonly timeoutMs: number;
}

/** A single chunk in a stream. */
interface IStreamChunkMessage extends IMessage {
  readonly kind: 'stream-chunk';
  /** The chunk data. */
  readonly data: unknown;
  /** Whether this is the last chunk. */
  readonly done: boolean;
  /** The correlation ID matching the original stream request. */
  readonly correlationId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR SERIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/** Serializable error representation (errors can't cross process boundaries). */
interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  /** Optional error code for programmatic handling. */
  readonly code?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// UNION TYPE
// ─────────────────────────────────────────────────────────────────────────────

/** All IPC message types. */
type IPCMessage =
  | IFireAndForgetMessage
  | IRequestMessage
  | IResponseMessage
  | IStreamRequestMessage
  | IStreamChunkMessage;

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

/** Serialize an Error into a cross-process-safe form. */
export function serializeError(error: Error): SerializedError {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: (error as any).code,
  };
}

/** Deserialize a SerializedError back into an Error instance. */
export function deserializeError(serialized: SerializedError): Error {
  const error = new Error(serialized.message);
  error.name = serialized.name;
  if (serialized.stack) error.stack = serialized.stack;
  if (serialized.code) (error as any).code = serialized.code;
  return error;
}

/** Create a fire-and-forget message. */
export function createFireAndForget(
  channel: string,
  direction: MessageDirection,
  sourceProcessId: string,
  payload: unknown,
): IFireAndForgetMessage {
  return {
    id: createMessageId(),
    channel,
    direction,
    timestamp: Date.now(),
    sourceProcessId,
    kind: 'fire-and-forget',
    payload,
  };
}

/** Create a request message. */
export function createRequest(
  channel: string,
  direction: MessageDirection,
  sourceProcessId: string,
  payload: unknown,
  timeoutMs = 30_000,
): IRequestMessage {
  return {
    id: createMessageId(),
    channel,
    direction,
    timestamp: Date.now(),
    sourceProcessId,
    kind: 'request',
    payload,
    timeoutMs,
  };
}

/** Create a response to a request. */
export function createResponse(
  channel: string,
  direction: MessageDirection,
  sourceProcessId: string,
  correlationId: string,
  payload: unknown,
): IResponseMessage {
  return {
    id: createMessageId(),
    channel,
    direction,
    timestamp: Date.now(),
    sourceProcessId,
    kind: 'response',
    success: true,
    payload,
    correlationId,
  };
}

/** Create an error response to a request. */
export function createErrorResponse(
  channel: string,
  direction: MessageDirection,
  sourceProcessId: string,
  correlationId: string,
  error: Error,
): IResponseMessage {
  return {
    id: createMessageId(),
    channel,
    direction,
    timestamp: Date.now(),
    sourceProcessId,
    kind: 'response',
    success: false,
    error: serializeError(error),
    correlationId,
  };
}

/** Create a stream request. */
export function createStreamRequest(
  channel: string,
  direction: MessageDirection,
  sourceProcessId: string,
  payload: unknown,
  timeoutMs = 60_000,
): IStreamRequestMessage {
  return {
    id: createMessageId(),
    channel,
    direction,
    timestamp: Date.now(),
    sourceProcessId,
    kind: 'stream-request',
    payload,
    timeoutMs,
  };
}

/** Create a stream chunk. */
export function createStreamChunk(
  channel: string,
  direction: MessageDirection,
  sourceProcessId: string,
  correlationId: string,
  data: unknown,
  done: boolean,
): IStreamChunkMessage {
  return {
    id: createMessageId(),
    channel,
    direction,
    timestamp: Date.now(),
    sourceProcessId,
    kind: 'stream-chunk',
    data,
    done,
    correlationId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPE GUARDS
// ─────────────────────────────────────────────────────────────────────────────

export function isFireAndForget(msg: IPCMessage): msg is IFireAndForgetMessage {
  return msg.kind === 'fire-and-forget';
}

export function isRequest(msg: IPCMessage): msg is IRequestMessage {
  return msg.kind === 'request';
}

export function isResponse(msg: IPCMessage): msg is IResponseMessage {
  return msg.kind === 'response';
}

export function isStreamRequest(msg: IPCMessage): msg is IStreamRequestMessage {
  return msg.kind === 'stream-request';
}

export function isStreamChunk(msg: IPCMessage): msg is IStreamChunkMessage {
  return msg.kind === 'stream-chunk';
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pre-defined channel names for each subsystem.
 * Using a namespace object prevents typos and provides autocomplete.
 */
export const IPCChannels = {
  // Tab lifecycle
  TAB_CREATE:          'tab:create',
  TAB_DESTROY:         'tab:destroy',
  TAB_ACTIVATE:        'tab:activate',
  TAB_STATE_CHANGED:   'tab:state-changed',
  TAB_TITLE_CHANGED:   'tab:title-changed',
  TAB_URL_CHANGED:     'tab:url-changed',
  TAB_FAVICON_CHANGED: 'tab:favicon-changed',

  // Navigation
  NAVIGATE:            'navigation:navigate',
  NAVIGATION_STARTED:  'navigation:started',
  NAVIGATION_COMMITTED:'navigation:committed',
  NAVIGATION_ERROR:    'navigation:error',
  NAVIGATION_COMPLETE: 'navigation:complete',

  // DOM / Rendering
  DOM_MUTATION:        'dom:mutation',
  DOM_SNAPSHOT:        'dom:snapshot',
  LAYOUT_UPDATE:       'layout:update',
  PAINT_COMMANDS:      'paint:commands',

  // JavaScript
  JS_EVALUATE:         'js:evaluate',
  JS_RESULT:           'js:result',
  JS_ERROR:            'js:error',
  JS_CONSOLE:          'js:console',
  JS_TIMER:            'js:timer',

  // Networking
  NET_REQUEST:         'net:request',
  NET_RESPONSE:        'net:response',
  NET_EVENT:           'net:event',

  // Security
  SEC_PERMISSION:      'security:permission',
  SEC_CSP_VIOLATION:   'security:csp-violation',
  SEC_SANDBOX:         'security:sandbox',

  // Storage
  STORAGE_READ:        'storage:read',
  STORAGE_WRITE:       'storage:write',
  STORAGE_DELETE:      'storage:delete',

  // DevTools
  DEVTOOLS_ATTACH:     'devtools:attach',
  DEVTOOLS_DETACH:     'devtools:detach',
  DEVTOOLS_COMMAND:    'devtools:command',
  DEVTOOLS_EVENT:      'devtools:event',

  // Process lifecycle
  PROCESS_READY:       'process:ready',
  PROCESS_ERROR:       'process:error',
  PROCESS_CRASH:       'process:crash',
  PROCESS_EXIT:        'process:exit',

  // System
  SYSTEM_CONFIG:       'system:config',
  SYSTEM_METRICS:      'system:metrics',
  SYSTEM_PING:         'system:ping',
  SYSTEM_PONG:         'system:pong',
} as const;

/** Channel name type for type-safe usage. */
export type IPCChannelName = typeof IPCChannels[keyof typeof IPCChannels];

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export type {
  IMessage,
  IFireAndForgetMessage,
  IRequestMessage,
  IResponseMessage,
  IStreamRequestMessage,
  IStreamChunkMessage,
  IPCMessage,
  SerializedError,
};
