/**
 * @file src/common/ipc/index.ts
 *
 * Barrel exports for the IPC system.
 */

// Message protocol
export {
  createMessageId,
  serializeError,
  deserializeError,
  createFireAndForget,
  createRequest,
  createResponse,
  createErrorResponse,
  createStreamRequest,
  createStreamChunk,
  isFireAndForget,
  isRequest,
  isResponse,
  isStreamRequest,
  isStreamChunk,
  IPCChannels,
} from './message';

export type {
  IMessage,
  IFireAndForgetMessage,
  IRequestMessage,
  IResponseMessage,
  IStreamRequestMessage,
  IStreamChunkMessage,
  IPCMessage,
  SerializedError,
  MessageDirection,
  IPCChannelName,
} from './message';

// Serializer
export { JSONSerializer } from './serializer';
export type { ISerializer } from './serializer';

// Transport
export {
  InProcessTransport,
  EventEmitterTransport,
  createInProcessPair,
  DEFAULT_TRANSPORT_CONFIG,
} from './transport';

export type {
  ITransport,
  TransportConfig,
  TransportData,
  TransportHandler,
  TransportErrorHandler,
  TransportCloseHandler,
} from './transport';

// Worker Transport
export {
  WorkerParentTransport,
  WorkerSideTransport,
} from './worker-transport';

// Socket Transport
export {
  SocketTransport,
  SocketServerTransport,
} from './socket-transport';

// Channel
export {
  Channel,
  ChannelManager,
  DEFAULT_CHANNEL_CONFIG,
} from './channel';

export type {
  IChannel,
  IChannelManager,
  ChannelConfig,
  ChannelMessageHandler,
  ChannelRequestHandler,
  ChannelStreamHandler,
} from './channel';

// Service Proxy
export {
  ServiceProxy,
  ServiceStub,
  createTypedProxy,
  DEFAULT_PROXY_CONFIG,
} from './service-proxy';

export type {
  IServiceProxy,
  IServiceStub,
  ServiceProxyConfig,
  MethodCall,
  MethodResult,
} from './service-proxy';

// Process Manager
export {
  ProcessManager,
  ProcessEventBus,
  ProcessState,
  createInProcessManager,
  createChildProcessManager,
  DEFAULT_PROCESS_MANAGER_CONFIG,
} from './process-manager';

export type {
  IProcessManager,
  ProcessManagerConfig,
  ProcessInfo,
  ProcessFactory,
  ProcessEvent,
  ProcessBusEvent,
  ProcessEventHandler,
  ProcessEventType,
} from './process-manager';
