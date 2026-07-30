export { AudioElement } from './audio';
export type { IAudioElement, AudioReadyState, AudioNetworkState, AudioError, AudioErrorKind, AudioEvent, AudioEventKind, AudioEventHandler } from './audio';

export { VideoElement, KNOWN_QUALITIES } from './video';
export type { IVideoElement, VideoReadyState, VideoNetworkState, VideoError, VideoErrorKind, VideoTextTrack, VideoAudioTrack, VideoVideoTrack, VideoEvent, VideoEventKind, VideoEventHandler } from './video';

export { MediaSource, SourceBufferImpl } from './media-source';
export type { IMediaSource, ISourceBuffer, MediaSourceReadyState, SourceBufferMode, TimeRange, MediaSourceEvent, MediaSourceEventKind, MediaSourceEventHandler, SourceBufferEvent, SourceBufferEventKind, SourceBufferEventHandler } from './media-source';

export { MediaKeys, MediaKeySessionImpl, MediaKeySystemAccessImpl, requestMediaKeySystemAccess, isKeySystemSupported, SUPPORTED_KEY_SYSTEMS } from './eme';
export type { IMediaKeySystemAccess, IMediaKeys, IMediaKeySession, MediaKeySessionType, MediaKeyStatus, MediaKeySystemConfiguration, MediaKeySystemMediaCapability, MediaKeySessionEvent, MediaKeySessionEventKind, MediaKeySessionEventHandler } from './eme';

export {
  AudioContextImpl, AudioParam, AudioBufferImpl, AudioBufferSourceNode,
  AudioDestinationNode, AudioListenerImpl, OscillatorNode, GainNode,
  AnalyserNode, BiquadFilterNode, DelayNode, ConvolverNode,
  ChannelMergerNode, ChannelSplitterNode, DynamicsCompressorNode,
  WaveShaperNode, ConstantSourceNode, StereoPannerNode,
} from './webaudio';
export type {
  IAudioContext, IAudioNode, IAudioDestinationNode, IAudioListener, IAudioParam, IAudioBuffer,
  IOscillatorNode, IGainNode, IAnalyserNode, IBiquadFilterNode, IDelayNode,
  IConvolverNode, IChannelMergerNode, IChannelSplitterNode, IDynamicsCompressorNode,
  IWaveShaperNode, IConstantSourceNode, IStereoPannerNode,
  IAudioBufferSourceNode, IMediaStreamAudioSourceNode, IMediaStreamAudioDestinationNode,
  AudioContextState, OscillatorType, BiquadFilterType, OverSampleType,
} from './webaudio';

export {
  VideoDecoderImpl, AudioDecoderImpl, VideoEncoderImpl, AudioEncoderImpl,
  EncodedVideoChunkImpl, EncodedAudioChunkImpl, VideoFrameImpl, AudioDataImpl,
  isCodecSupported, isConfigSupported,
} from './webcodecs';
export type {
  IVideoDecoder, IAudioDecoder, IVideoEncoder, IAudioEncoder,
  CodecState, VideoDecoderConfig, AudioDecoderConfig, VideoEncoderConfig, AudioEncoderConfig,
  EncodedVideoChunk, EncodedAudioChunk, EncodedChunkType,
  VideoFrame, VideoPixelFormat, AudioSampleFormat,
} from './webcodecs';

export { CanvasElement } from './canvas';
export type { ICanvasElement, CanvasEvent, CanvasEventKind, CanvasEventHandler, CanvasOptions } from './canvas';

export { SVGDocument, createSVGElement, elementToSVGString } from './svg';
export type { ISVGDocument, SVGElement, SVGElementKind, SVGEvent, SVGEventKind, SVGEventHandler, SVGTextData } from './svg';

export { WebGLRenderingContext, NO_ERROR, INVALID_ENUM, INVALID_VALUE, INVALID_OPERATION } from './webgl';
export type { IWebGLRenderingContext, WebGLCanvas, WebGLBuffer, WebGLTexture, WebGLProgram, WebGLShader, WebGLFramebuffer, WebGLRenderbuffer, WebGLUniformLocation, WebGLEvent, WebGLEventKind, WebGLEventHandler } from './webgl';

export { WebGL2RenderingContext } from './webgl2';
export type { IWebGL2RenderingContext, WebGLVertexArrayObject, WebGLSampler, WebGLTransformFeedback, WebGLQuery } from './webgl2';

export { GPUCanvasContext, GPUDevice, requestAdapter } from './webgpu';
export type { IGPUCanvasContext, IGPUAdapter, IGPUDevice, IGPUQueue, GPUCanvasConfiguration, GPULimits, GPUDeviceDescriptor, GPUBufferDescriptor, GPUTextureDescriptor, GPUSamplerDescriptor, GPUShaderModuleDescriptor, GPUBindGroupLayoutDescriptor, GPUBindGroupDescriptor, GPUPipelineLayoutDescriptor, GPURenderPipelineDescriptor, GPUComputePipelineDescriptor, GPUCommandEncoder, GPURenderPassEncoder, GPUComputePassEncoder, GPURenderPassDescriptor, GPUComputePassDescriptor, GPUTexture, GPUBuffer, GPUSampler, GPUShaderModule, GPUBindGroupLayout, GPUBindGroup, GPUPipelineLayout, GPURenderPipeline, GPUComputePipeline, GPUCommandBuffer, GPUTextureView, GPUQuerySet, GPUColor, WebGPUCanvas, GPUEvent, GPUEventKind, GPUEventHandler, GPUBufferBinding, GPUVertexState, GPUVertexBufferLayout, GPUVertexAttribute, GPUFragmentState, GPUColorTargetState, GPUBlendState, GPUBlendComponent, GPUPrimitiveState, GPUDepthStencilState, GPUMultisampleState, GPUProgrammableStage, GPUBindGroupLayoutEntry, GPUBindGroupEntry, GPURenderPassColorAttachment, GPURenderPassDepthStencilAttachment, GPUQuerySetDescriptor } from './webgpu';

export { OffscreenCanvas, OffscreenCanvasRenderingContext2D } from './offscreen-canvas';
export type { IOffscreenCanvas, OffscreenCanvasRenderingContext2DSettings, ImageEncodeOptions, ImageBitmap, ImageData, OffscreenCanvasEvent, OffscreenCanvasEventKind, OffscreenCanvasEventHandler } from './offscreen-canvas';

export { FetchClient } from './fetch';
export type { IFetchClient, FetchOptions, FetchResponse, FetchEvent, FetchEventKind, FetchEventHandler } from './fetch';

export { XHRClient, READY_STATE_UNSENT, READY_STATE_OPENED, READY_STATE_HEADERS_RECEIVED, READY_STATE_LOADING, READY_STATE_DONE } from './xml-http-request';
export type { IXHRClient, XHRResponse, XHREvent, XHREventKind, XHREventHandler } from './xml-http-request';

export { HistoryService } from './history';
export type { IHistoryService, HistoryEntry, HistoryEvent, HistoryEventKind, HistoryEventHandler } from './history';

export { LocationService } from './location';
export type { ILocationService, LocationEvent, LocationEventKind, LocationEventHandler } from './location';

export { NavigatorService } from './navigator';
export type { INavigatorService, BatteryInfo, NetworkConnection, NavigatorEvent, NavigatorEventKind, NavigatorEventHandler } from './navigator';

export { ClipboardService } from './clipboard';
export type { IClipboardService, ClipboardItem, ClipboardEvent, ClipboardEventKind, ClipboardEventHandler } from './clipboard';

export { NotificationService } from './notifications';
export type { INotificationService, NotificationPermission, NotificationOptions, NotificationHandle, NotificationEvent, NotificationEventKind, NotificationEventHandler } from './notifications';

export { PermissionService } from './permissions';
export type { IPermissionService, PermissionName, PermissionStatus, PermissionResult, PermissionEvent, PermissionEventKind, PermissionEventHandler } from './permissions';

export { GeolocationService } from './geolocation';
export type { IGeolocationService, GeolocationPermission, PositionOptions, GeolocationPosition, GeolocationCoordinates, GeolocationEvent, GeolocationEventKind, GeolocationEventHandler } from './geolocation';

export { WebSocketClient } from './websocket';
export type { IWebSocketClient, WSReadyState, WebSocketEvent, WebSocketEventKind, WebSocketEventHandler } from './websocket';

export { RTCPeerConnection } from './webrtc';
export type { IRTCPeerConnection, RTCSignalingState, RTCIceGatheringState, RTCIceConnectionState, RTCSessionDescription, RTCIceCandidate, RTCOfferOptions, RTCAnswerOptions, RTCEvent, RTCEventKind, RTCEventHandler } from './webrtc';

export { BroadcastChannelService } from './broadcast-channel';
export type { IBroadcastChannelService, BroadcastEvent, BroadcastEventKind, BroadcastEventHandler } from './broadcast-channel';

export { ServiceWorkerContainer } from './service-workers';
export type { IServiceWorkerContainer, ServiceWorkerRegistration, ServiceWorker, SWState, RegistrationOptions, SWEvent, SWEventKind, SWEventHandler } from './service-workers';

export { PushManager } from './push-api';
export type { IPushManager, PushSubscription, PushSubscriptionOptions, PushSubscriptionJSON, PushPermissionState, PushEvent, PushEventKind, PushEventHandler } from './push-api';

export { SameOriginPolicy } from './same-origin-policy';
export type { ISameOriginPolicy, SOPResourceType, SOPAccessResult, SOPEvent, SOPEventKind, SOPEventHandler } from './same-origin-policy';

export { CorsService } from './cors';
export type { ICorsService, CorsServiceEvent, CorsServiceEventKind, CorsServiceEventHandler } from './cors';

export { CspService } from './csp';
export type { ICspService, CspEvent, CspEventKind, CspEventHandler } from './csp';

export { SandboxService } from './sandbox';
export type { ISandboxService, SandboxEvent, SandboxEventKind, SandboxEventHandler } from './sandbox';

export { HttpsService } from './https';
export type { IHttpsService, HttpsEvent, HttpsEventKind, HttpsEventHandler } from './https';

export { CertificateService } from './certificates';
export type { ICertificateService, CertificateEvent, CertificateEventKind, CertificateEventHandler } from './certificates';

export { MixedContentService } from './mixed-content';
export type { IMixedContentService, MixedContentResourceType, MixedContentDecision, MixedContentBlockMode, MixedContentEntry, MixedContentEvent, MixedContentEventKind, MixedContentEventHandler } from './mixed-content';

export { XssProtectionService } from './xss-protection';
export type { IXssProtectionService, XssContext, XssProtectionMode, XssDetectionResult, XssProtectionEvent, XssEventKind, XssProtectionEventHandler } from './xss-protection';

export { CsrfProtectionService } from './csrf-protection';
export type { ICsrfProtectionService, CsrfDecision, CsrfEvent, CsrfEventKind, CsrfEventHandler } from './csrf-protection';

export { ClickjackingProtectionService } from './clickjacking-protection';
export type { IClickjackingProtectionService, XFrameOptionsPolicy, ClickjackingDecision, ClickjackingEvent, ClickjackingEventKind, ClickjackingEventHandler } from './clickjacking-protection';

export { PermissionManagerService } from './permission-manager';
export type { IPermissionManagerService, ManagerPermissionName, ManagerPermissionState, ManagerPermissionEntry, ManagerPermissionEvent, ManagerPermissionEventKind, ManagerPermissionEventHandler } from './permission-manager';

export { CookieService } from './cookies';
export type { ICookieService, CookieEvent, CookieEventKind, CookieEventHandler } from './cookies';

export { LocalStorageService } from './local-storage';
export type { ILocalStorageService, LocalStorageEvent, LocalStorageEventKind, LocalStorageEventHandler } from './local-storage';

export { SessionStorageService } from './session-storage';
export type { ISessionStorageService, SessionStorageEvent, SessionStorageEventKind, SessionStorageEventHandler } from './session-storage';

export { IndexedDBService } from './indexed-db';
export type { IIndexedDBService, IndexedDBEvent, IndexedDBEventKind, IndexedDBEventHandler } from './indexed-db';

export { CacheStorageService } from './cache-api';
export type { ICacheStorageService, CacheStorageEvent, CacheStorageEventKind, CacheStorageEventHandler, CacheQueryOptions } from './cache-api';

export { FileSystemAccessService } from './file-system';
export type { IFileSystemAccessService, FileHandle, DirectoryHandle, FileSystemEvent, FileSystemEventKind, FileSystemEventHandler } from './file-system';

export { OPFSService } from './opfs';
export type { IOPFSService, OPFSDirectoryHandle, OPFSFileHandle, OPFSWritableStream, StorageEstimate, OPFSEvent, OPFSEventKind, OPFSEventHandler } from './opfs';

export { CallStackService } from './call-stack';
export type { ICallStackService, CallFrame, CallStackEvent, CallStackEventKind, CallStackEventHandler } from './call-stack';

export { TaskQueueService } from './task-queue';
export type { ITaskQueueService, QueuedTask, TaskQueueEvent, TaskQueueEventKind, TaskQueueEventHandler } from './task-queue';

export { MicrotaskService } from './microtasks';
export type { IMicrotaskService, MicrotaskPriority, MicrotaskEvent, MicrotaskEventKind, MicrotaskEventHandler } from './microtasks';

export { AnimationFrameService } from './request-animation-frame';
export type { IAnimationFrameService, AnimationFrameEvent, AnimationFrameEventKind, AnimationFrameEventHandler } from './request-animation-frame';

export { IdleCallbackService, IdleDeadlineImpl } from './request-idle-callback';
export type { IIdleCallbackService, IdleCallback, IdleDeadline, IdleCallbackOptions, IdleCallbackEvent, IdleCallbackEventKind, IdleCallbackEventHandler } from './request-idle-callback';

export { BytecodeService, OPCodes } from './bytecode';
export type { IBytecodeService, OpcodeDef, CompiledBytecode, CompiledFunction, CompileResult, CompileError, BytecodeStats, BytecodeEvent, BytecodeEventKind, BytecodeEventHandler } from './bytecode';

export { InterpreterService } from './interpreter';
export type { IInterpreterService, ExecutionContext, CallFrameInfo, ExecutionResult, ExecutionError, InterpreterState, InterpreterEvent, InterpreterEventKind, InterpreterEventHandler } from './interpreter';

export { GarbageCollectionService, DEFAULT_THRESHOLDS } from './garbage-collection';
export type { IGarbageCollectionService, GCThresholds, GCStats, GCResult, GCEvent, GCEventKind, GCEventHandler } from './garbage-collection';

export { JITCompilerService, JIT_DEFAULT_THRESHOLDS } from './jit-compiler';
export type { IJITCompilerService, JITThresholds, JITFunctionInfo, CompilationResult, JITStats, ExecutionTier, JITEvent, JITEventKind, JITEventHandler } from './jit-compiler';

export { VariableService } from './variables';
export type { IVariableService, VariableKind, ScopeType, VariableEvent, VariableEventKind, VariableEventHandler, VariableRecord, VariableResult, ScopeInfo, ScopeId } from './variables';

export { FunctionService } from './functions';
export type { IFunctionService, FunctionInfo, CallEntry, CallResult, FunctionStats, FunctionEvent, FunctionEventKind, FunctionEventHandler } from './functions';

export { ClosureService } from './closures';
export type { IClosureService, ClosureInfo, ClosureResult, ClosureStats, ClosureEvent, ClosureEventKind, ClosureEventHandler } from './closures';

export { ClassService } from './classes';
export type { IClassService, ClassInfo, InstanceInfo, InstanceResult, ClassStats, ClassEvent, ClassEventKind, ClassEventHandler } from './classes';

export { ModuleService } from './modules';
export type { IModuleService, ModuleInfo, ImportResult, ResolvedModule, LinkResult, EvalResult, ModuleStats, ModuleStatus, ModuleEvent, ModuleEventKind, ModuleEventHandler } from './modules';

export { AsyncService } from './async';
export type { IAsyncService, AsyncOperationStatus, AsyncScheduler, AsyncOperation, AsyncOperationHandle, AwaitResult, AsyncStats, AsyncEvent, AsyncEventKind, AsyncEventHandler } from './async';

export { PromiseService } from './promises';
export type { IPromiseService, PromiseState, PromiseExecutor, FulfillmentHandler, ErrorHandler, PromiseHandle, PromiseEntry, PromiseStats, PromiseEvent, PromiseEventKind, PromiseEventHandler } from './promises';
