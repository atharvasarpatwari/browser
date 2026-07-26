/**
 * web-apis-permissions.ts
 * NovaBrowser — Permission-Gated Web APIs Layer
 *
 * Implements a shared permission model plus the concrete browser-facing
 * APIs that sit on top of it:
 *   - Permissions Query (generic per-origin permission state)
 *   - Geolocation API      (getCurrentPosition / watchPosition / clearWatch)
 *   - Notifications API    (requestPermission / show / close / events)
 *   - Clipboard API        (readText / writeText)
 *   - Vibration API        (vibrate / cancel)
 *
 * Design notes
 * ------------
 * - All permission-gated APIs share one PermissionStore so a single
 *   consistent prompt/grant/deny flow backs every feature.
 * - The engine (not this file) is expected to supply:
 *     - a `PermissionPrompt` function that shows real UI and resolves
 *       with the user's choice, and
 *     - a `PositionSource` for Geolocation (real GPS/WiFi/IP lookup, or
 *       a deterministic mock for tests).
 *   This keeps the module fully testable without any DOM or OS calls.
 * - No reliance on browser globals (`navigator`, `Notification`, DOM
 *   `EventTarget`) so it runs identically in the engine process and in
 *   a plain Node/Vitest test environment.
 */

// ─────────────────────────────────────────────────────────────────────────
// Shared: lightweight event emitter (stand-in for DOM EventTarget)
// ─────────────────────────────────────────────────────────────────────────

type Listener<T> = (event: T) => void;

class MiniEmitter<EventMap extends Record<string, unknown>> {
  private listeners = new Map<keyof EventMap, Set<Listener<any>>>();

  on<K extends keyof EventMap>(type: K, fn: Listener<EventMap[K]>): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  off<K extends keyof EventMap>(type: K, fn: Listener<EventMap[K]>): void {
    this.listeners.get(type)?.delete(fn);
  }

  emit<K extends keyof EventMap>(type: K, event: EventMap[K]): void {
    this.listeners.get(type)?.forEach((fn) => {
      try {
        fn(event);
      } catch {
        // Listener errors must never break the emitting API.
      }
    });
  }

  removeAll(): void {
    this.listeners.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Shared: permission model
// ─────────────────────────────────────────────────────────────────────────

export type PermissionState = 'granted' | 'denied' | 'prompt';

export type PermissionName =
  | 'geolocation'
  | 'notifications'
  | 'clipboard-read'
  | 'clipboard-write'
  | 'vibrate';

/** Engine-supplied function that shows a real permission prompt to the user. */
export type PermissionPrompt = (
  origin: string,
  name: PermissionName
) => Promise<'granted' | 'denied'>;

export interface PermissionDescriptor {
  name: PermissionName;
}

export interface PermissionStatusChangeEvent {
  name: PermissionName;
  origin: string;
  state: PermissionState;
}

/**
 * Per-origin permission storage plus the query/request flow shared by
 * every permission-gated API in this module.
 */
export class PermissionStore extends MiniEmitter<{
  change: PermissionStatusChangeEvent;
}> {
  // origin -> (permission name -> state)
  private grants = new Map<string, Map<PermissionName, PermissionState>>();

  constructor(private readonly promptUser: PermissionPrompt) {
    super();
  }

  /** Directly set a permission's state (used by engine settings / tests). */
  setState(origin: string, name: PermissionName, state: PermissionState): void {
    const originMap = this.grants.get(origin) ?? new Map();
    originMap.set(name, state);
    this.grants.set(origin, originMap);
    this.emit('change', { name, origin, state });
  }

  /** Non-prompting lookup. Defaults to 'prompt' if never set. */
  query(origin: string, name: PermissionName): PermissionState {
    return this.grants.get(origin)?.get(name) ?? 'prompt';
  }

  /**
   * Resolve a permission, prompting the user if the current state is
   * 'prompt'. A previously granted or denied permission is returned
   * immediately without re-prompting.
   */
  async request(origin: string, name: PermissionName): Promise<PermissionState> {
    const current = this.query(origin, name);
    if (current !== 'prompt') return current;

    const decision = await this.promptUser(origin, name);
    this.setState(origin, name, decision);
    return decision;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Geolocation API
// ─────────────────────────────────────────────────────────────────────────

export interface GeolocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
}

export interface GeolocationPosition {
  coords: GeolocationCoordinates;
  timestamp: number;
}

export type GeolocationErrorCode = 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT';

export class GeolocationPositionError extends Error {
  constructor(public readonly code: GeolocationErrorCode, message: string) {
    super(message);
    this.name = 'GeolocationPositionError';
  }
}

export interface PositionOptions {
  enableHighAccuracy?: boolean;
  timeout?: number; // ms; Infinity by default, matching the browser spec
  maximumAge?: number; // ms; 0 by default (no cache)
}

/** Engine-supplied source of truth for the device's current position. */
export interface PositionSource {
  /** Resolve with a fresh position, or throw/reject on failure. */
  getPosition(options: PositionOptions): Promise<GeolocationPosition>;
  /**
   * Subscribe to position updates for watchPosition. Returns an
   * unsubscribe function. The source decides its own update cadence.
   */
  subscribe(
    options: PositionOptions,
    onUpdate: (pos: GeolocationPosition) => void,
    onError: (err: GeolocationPositionError) => void
  ): () => void;
}

type PositionSuccessCallback = (position: GeolocationPosition) => void;
type PositionErrorCallback = (error: GeolocationPositionError) => void;

export class GeolocationAPI {
  private cachedPosition: GeolocationPosition | null = null;
  private nextWatchId = 1;
  private activeWatches = new Map<number, () => void>();

  constructor(
    private readonly origin: string,
    private readonly permissions: PermissionStore,
    private readonly source: PositionSource
  ) {}

  private isCacheValid(maximumAge: number): boolean {
    if (!this.cachedPosition || maximumAge <= 0) return false;
    return Date.now() - this.cachedPosition.timestamp <= maximumAge;
  }

  async getCurrentPosition(
    onSuccess: PositionSuccessCallback,
    onError?: PositionErrorCallback,
    options: PositionOptions = {}
  ): Promise<void> {
    const opts: Required<PositionOptions> = {
      enableHighAccuracy: options.enableHighAccuracy ?? false,
      timeout: options.timeout ?? Infinity,
      maximumAge: options.maximumAge ?? 0,
    };

    const state = await this.permissions.request(this.origin, 'geolocation');
    if (state !== 'granted') {
      onError?.(
        new GeolocationPositionError('PERMISSION_DENIED', 'User denied geolocation permission')
      );
      return;
    }

    if (this.isCacheValid(opts.maximumAge)) {
      onSuccess(this.cachedPosition!);
      return;
    }

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Race the real position lookup against the timeout instead of awaiting
    // the source directly — otherwise a source that never resolves would
    // leave this whole method hanging even after the timeout fires.
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      if (opts.timeout === Infinity) return;
      timer = setTimeout(() => {
        reject(new GeolocationPositionError('TIMEOUT', 'Position request timed out'));
      }, opts.timeout);
    });

    try {
      const position = await Promise.race([this.source.getPosition(opts), timeoutPromise]);
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      this.cachedPosition = position;
      onSuccess(position);
    } catch (err) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      onError?.(
        err instanceof GeolocationPositionError
          ? err
          : new GeolocationPositionError('POSITION_UNAVAILABLE', 'Unable to determine position')
      );
    }
  }

  async watchPosition(
    onSuccess: PositionSuccessCallback,
    onError?: PositionErrorCallback,
    options: PositionOptions = {}
  ): Promise<number> {
    const watchId = this.nextWatchId++;

    const state = await this.permissions.request(this.origin, 'geolocation');
    if (state !== 'granted') {
      onError?.(
        new GeolocationPositionError('PERMISSION_DENIED', 'User denied geolocation permission')
      );
      // Register a no-op unsubscribe so clearWatch on this id is still valid.
      this.activeWatches.set(watchId, () => {});
      return watchId;
    }

    const unsubscribe = this.source.subscribe(
      options,
      (pos) => {
        this.cachedPosition = pos;
        onSuccess(pos);
      },
      (err) => onError?.(err)
    );

    this.activeWatches.set(watchId, unsubscribe);
    return watchId;
  }

  clearWatch(watchId: number): void {
    const unsubscribe = this.activeWatches.get(watchId);
    if (unsubscribe) {
      unsubscribe();
      this.activeWatches.delete(watchId);
    }
  }

  /** Number of currently active watchPosition subscriptions (test/debug aid). */
  get activeWatchCount(): number {
    return this.activeWatches.size;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Notifications API
// ─────────────────────────────────────────────────────────────────────────

export type NotificationPermission = 'granted' | 'denied' | 'default';

export interface NotificationOptions {
  body?: string;
  icon?: string;
  tag?: string;
  silent?: boolean;
  data?: unknown;
}

interface NotificationEventMap extends Record<string, unknown> {
  show: { target: NotificationInstance };
  click: { target: NotificationInstance };
  close: { target: NotificationInstance };
  error: { target: NotificationInstance; message: string };
}

/** A single displayed (or pending) notification. */
export class NotificationInstance extends MiniEmitter<NotificationEventMap> {
  private closed = false;

  constructor(
    public readonly title: string,
    public readonly options: NotificationOptions,
    private readonly onCloseRequested: (n: NotificationInstance) => void
  ) {
    super();
  }

  /** Simulates the user clicking the notification. */
  simulateClick(): void {
    if (this.closed) return;
    this.emit('click', { target: this });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', { target: this });
    this.onCloseRequested(this);
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

const MAX_ACTIVE_NOTIFICATIONS = 3; // mirrors common browser display limits

export class NotificationsAPI {
  private active: NotificationInstance[] = [];

  constructor(
    private readonly origin: string,
    private readonly permissions: PermissionStore
  ) {}

  permission(): NotificationPermission {
    const state = this.permissions.query(this.origin, 'notifications');
    return state === 'prompt' ? 'default' : state;
  }

  async requestPermission(): Promise<NotificationPermission> {
    const state = await this.permissions.request(this.origin, 'notifications');
    return state === 'prompt' ? 'default' : state;
  }

  /**
   * Creates and displays a notification. Throws synchronously (matching
   * the spec) if permission has already been denied; returns null if
   * permission has never been requested (mirrors browsers silently
   * no-op'ing rather than showing a notification with no consent).
   */
  create(title: string, options: NotificationOptions = {}): NotificationInstance | null {
    const state = this.permission();

    if (state === 'denied') {
      throw new Error('Notification permission has been denied');
    }
    if (state === 'default') {
      // Spec-accurate: creating a Notification does not itself prompt.
      return null;
    }

    // Replace any existing notification with the same tag (spec behavior).
    if (options.tag) {
      const existingIdx = this.active.findIndex((n) => n.options.tag === options.tag);
      if (existingIdx !== -1) {
        this.active[existingIdx].close();
      }
    }

    if (this.active.length >= MAX_ACTIVE_NOTIFICATIONS) {
      this.active[0].close(); // evict oldest, like a real notification tray
    }

    const instance = new NotificationInstance(title, options, (n) => {
      this.active = this.active.filter((x) => x !== n);
    });
    this.active.push(instance);
    instance.emit('show', { target: instance });
    return instance;
  }

  closeAll(): void {
    [...this.active].forEach((n) => n.close());
  }

  get activeCount(): number {
    return this.active.length;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Clipboard API
// ─────────────────────────────────────────────────────────────────────────

/** Engine-supplied backing store for actual OS clipboard access. */
export interface ClipboardBackend {
  read(): Promise<string>;
  write(text: string): Promise<void>;
}

export class ClipboardAPI {
  constructor(
    private readonly origin: string,
    private readonly permissions: PermissionStore,
    private readonly backend: ClipboardBackend
  ) {}

  async readText(): Promise<string> {
    const state = await this.permissions.request(this.origin, 'clipboard-read');
    if (state !== 'granted') {
      throw new Error('Clipboard read permission denied');
    }
    return this.backend.read();
  }

  async writeText(text: string): Promise<void> {
    const state = await this.permissions.request(this.origin, 'clipboard-write');
    if (state !== 'granted') {
      throw new Error('Clipboard write permission denied');
    }
    await this.backend.write(text);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Vibration API
// ─────────────────────────────────────────────────────────────────────────

/** Engine-supplied hook to actually trigger device vibration hardware. */
export interface VibrationBackend {
  vibrate(pattern: number[]): void;
  cancel(): void;
}

/**
 * Vibration is spec'd as permission-less in real browsers, but NovaBrowser
 * gates it like the other device-sensitive APIs for consistent, testable
 * user control (an intentional, documented deviation from the spec).
 */
export class VibrationAPI {
  constructor(
    private readonly origin: string,
    private readonly permissions: PermissionStore,
    private readonly backend: VibrationBackend
  ) {}

  async vibrate(pattern: number | number[]): Promise<boolean> {
    const state = await this.permissions.request(this.origin, 'vibrate');
    if (state !== 'granted') return false;

    const normalized = (Array.isArray(pattern) ? pattern : [pattern]).map((n) =>
      Math.max(0, Math.floor(n))
    );

    if (normalized.length === 0 || normalized.every((n) => n === 0)) {
      this.backend.cancel();
      return true;
    }

    this.backend.vibrate(normalized);
    return true;
  }

  cancel(): void {
    this.backend.cancel();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Facade: wires every permission-gated API to one shared PermissionStore
// ─────────────────────────────────────────────────────────────────────────

export interface WebApisConfig {
  origin: string;
  promptUser: PermissionPrompt;
  positionSource: PositionSource;
  clipboardBackend: ClipboardBackend;
  vibrationBackend: VibrationBackend;
}

export class PermissionGatedWebApis {
  readonly permissions: PermissionStore;
  readonly geolocation: GeolocationAPI;
  readonly notifications: NotificationsAPI;
  readonly clipboard: ClipboardAPI;
  readonly vibration: VibrationAPI;

  constructor(config: WebApisConfig) {
    this.permissions = new PermissionStore(config.promptUser);
    this.geolocation = new GeolocationAPI(config.origin, this.permissions, config.positionSource);
    this.notifications = new NotificationsAPI(config.origin, this.permissions);
    this.clipboard = new ClipboardAPI(config.origin, this.permissions, config.clipboardBackend);
    this.vibration = new VibrationAPI(config.origin, this.permissions, config.vibrationBackend);
  }
}
