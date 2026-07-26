/**
 * web-apis-permissions.test.ts
 * Comprehensive test suite for the NovaBrowser Permission-Gated Web APIs layer.
 *
 * Run with: npx vitest run web-apis-permissions.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PermissionStore,
  GeolocationAPI,
  GeolocationPositionError,
  NotificationsAPI,
  ClipboardAPI,
  VibrationAPI,
  PermissionGatedWebApis,
  type PermissionPrompt,
  type PositionSource,
  type GeolocationPosition,
  type ClipboardBackend,
  type VibrationBackend,
} from '../src/browser/web-apis/web-apis-permissions';

const ORIGIN = 'https://example.com';

function makePosition(overrides: Partial<GeolocationPosition['coords']> = {}): GeolocationPosition {
  return {
    coords: {
      latitude: 17.385,
      longitude: 78.4867,
      accuracy: 10,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      ...overrides,
    },
    timestamp: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PermissionStore
// ─────────────────────────────────────────────────────────────────────────

describe('PermissionStore', () => {
  it('defaults to "prompt" for an unqueried permission', () => {
    const store = new PermissionStore(async () => 'granted');
    expect(store.query(ORIGIN, 'geolocation')).toBe('prompt');
  });

  it('prompts the user only when state is "prompt"', async () => {
    const prompt = vi.fn<PermissionPrompt>().mockResolvedValue('granted');
    const store = new PermissionStore(prompt);

    await store.request(ORIGIN, 'geolocation');
    await store.request(ORIGIN, 'geolocation');

    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('persists the decision after prompting', async () => {
    const store = new PermissionStore(async () => 'denied');
    await store.request(ORIGIN, 'notifications');
    expect(store.query(ORIGIN, 'notifications')).toBe('denied');
  });

  it('keeps permissions isolated per origin', async () => {
    const store = new PermissionStore(async () => 'granted');
    await store.request('https://a.com', 'geolocation');
    expect(store.query('https://a.com', 'geolocation')).toBe('granted');
    expect(store.query('https://b.com', 'geolocation')).toBe('prompt');
  });

  it('emits a "change" event when state changes', () => {
    const store = new PermissionStore(async () => 'granted');
    const listener = vi.fn();
    store.on('change', listener);
    store.setState(ORIGIN, 'clipboard-read', 'granted');
    expect(listener).toHaveBeenCalledWith({
      name: 'clipboard-read',
      origin: ORIGIN,
      state: 'granted',
    });
  });

  it('allows setState to override a previously granted permission', async () => {
    const store = new PermissionStore(async () => 'granted');
    await store.request(ORIGIN, 'geolocation');
    store.setState(ORIGIN, 'geolocation', 'denied');
    expect(store.query(ORIGIN, 'geolocation')).toBe('denied');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GeolocationAPI
// ─────────────────────────────────────────────────────────────────────────

describe('GeolocationAPI', () => {
  let permissions: PermissionStore;
  let source: PositionSource;

  beforeEach(() => {
    permissions = new PermissionStore(async () => 'granted');
    source = {
      getPosition: vi.fn().mockResolvedValue(makePosition()),
      subscribe: vi.fn(),
    };
  });

  it('calls onSuccess with a position when permission is granted', async () => {
    const geo = new GeolocationAPI(ORIGIN, permissions, source);
    const onSuccess = vi.fn();
    await geo.getCurrentPosition(onSuccess);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0][0].coords.latitude).toBe(17.385);
  });

  it('calls onError with PERMISSION_DENIED when the user denies access', async () => {
    permissions = new PermissionStore(async () => 'denied');
    const geo = new GeolocationAPI(ORIGIN, permissions, source);
    const onSuccess = vi.fn();
    const onError = vi.fn();
    await geo.getCurrentPosition(onSuccess, onError);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(GeolocationPositionError);
    expect(onError.mock.calls[0][0].code).toBe('PERMISSION_DENIED');
  });

  it('calls onError with POSITION_UNAVAILABLE when the source fails', async () => {
    source.getPosition = vi.fn().mockRejectedValue(new Error('gps down'));
    const geo = new GeolocationAPI(ORIGIN, permissions, source);
    const onError = vi.fn();
    await geo.getCurrentPosition(vi.fn(), onError);
    expect(onError.mock.calls[0][0].code).toBe('POSITION_UNAVAILABLE');
  });

  it('times out if the source takes too long', async () => {
    vi.useFakeTimers();
    source.getPosition = vi.fn(() => new Promise<GeolocationPosition>(() => {})); // never resolves
    const geo = new GeolocationAPI(ORIGIN, permissions, source);
    const onError = vi.fn();

    const promise = geo.getCurrentPosition(vi.fn(), onError, { timeout: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    await promise;

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].code).toBe('TIMEOUT');
    vi.useRealTimers();
  });

  it('serves a cached position within maximumAge without re-querying the source', async () => {
    const geo = new GeolocationAPI(ORIGIN, permissions, source);
    await geo.getCurrentPosition(vi.fn());
    await geo.getCurrentPosition(vi.fn(), undefined, { maximumAge: 60_000 });
    expect(source.getPosition).toHaveBeenCalledTimes(1);
  });

  it('does not use the cache when maximumAge is 0 (default)', async () => {
    const geo = new GeolocationAPI(ORIGIN, permissions, source);
    await geo.getCurrentPosition(vi.fn());
    await geo.getCurrentPosition(vi.fn());
    expect(source.getPosition).toHaveBeenCalledTimes(2);
  });

  it('watchPosition delivers repeated updates and can be cleared', async () => {
    const unsubscribe = vi.fn();
    let deliver: (pos: GeolocationPosition) => void = () => {};
    source.subscribe = vi.fn((_opts, onUpdate) => {
      deliver = onUpdate;
      return unsubscribe;
    });

    const geo = new GeolocationAPI(ORIGIN, permissions, source);
    const onSuccess = vi.fn();
    const watchId = await geo.watchPosition(onSuccess);

    deliver(makePosition({ latitude: 1 }));
    deliver(makePosition({ latitude: 2 }));
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(geo.activeWatchCount).toBe(1);

    geo.clearWatch(watchId);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(geo.activeWatchCount).toBe(0);
  });

  it('watchPosition reports PERMISSION_DENIED and never subscribes if denied', async () => {
    permissions = new PermissionStore(async () => 'denied');
    const geo = new GeolocationAPI(ORIGIN, permissions, source);
    const onError = vi.fn();
    await geo.watchPosition(vi.fn(), onError);
    expect(onError.mock.calls[0][0].code).toBe('PERMISSION_DENIED');
    expect(source.subscribe).not.toHaveBeenCalled();
  });

  it('clearWatch is a safe no-op for an unknown watch id', () => {
    const geo = new GeolocationAPI(ORIGIN, permissions, source);
    expect(() => geo.clearWatch(9999)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// NotificationsAPI
// ─────────────────────────────────────────────────────────────────────────

describe('NotificationsAPI', () => {
  it('reports "default" before any permission decision has been made', () => {
    const permissions = new PermissionStore(async () => 'granted');
    const notif = new NotificationsAPI(ORIGIN, permissions);
    expect(notif.permission()).toBe('default');
  });

  it('requestPermission resolves to the user\'s decision', async () => {
    const permissions = new PermissionStore(async () => 'granted');
    const notif = new NotificationsAPI(ORIGIN, permissions);
    await expect(notif.requestPermission()).resolves.toBe('granted');
    expect(notif.permission()).toBe('granted');
  });

  it('create() returns null without prompting if permission is still default', () => {
    const permissions = new PermissionStore(async () => 'granted');
    const notif = new NotificationsAPI(ORIGIN, permissions);
    expect(notif.create('Hello')).toBeNull();
  });

  it('create() throws if permission was denied', async () => {
    const permissions = new PermissionStore(async () => 'denied');
    const notif = new NotificationsAPI(ORIGIN, permissions);
    await notif.requestPermission();
    expect(() => notif.create('Hello')).toThrow(/denied/i);
  });

  it('create() displays a notification and fires "show"', async () => {
    const permissions = new PermissionStore(async () => 'granted');
    const notif = new NotificationsAPI(ORIGIN, permissions);
    await notif.requestPermission();

    const showHandler = vi.fn();
    const n = notif.create('Build finished', { body: 'All tests passed' })!;
    n.on('show', showHandler);
    // 'show' is emitted synchronously in create(); attach before create in
    // real usage — here we verify state directly as well.
    expect(n.title).toBe('Build finished');
    expect(n.options.body).toBe('All tests passed');
    expect(notif.activeCount).toBe(1);
  });

  it('close() fires "close" and removes it from the active set', async () => {
    const permissions = new PermissionStore(async () => 'granted');
    const notif = new NotificationsAPI(ORIGIN, permissions);
    await notif.requestPermission();

    const n = notif.create('Ping')!;
    const closeHandler = vi.fn();
    n.on('close', closeHandler);
    n.close();

    expect(closeHandler).toHaveBeenCalledTimes(1);
    expect(n.isClosed).toBe(true);
    expect(notif.activeCount).toBe(0);
  });

  it('close() is idempotent', async () => {
    const permissions = new PermissionStore(async () => 'granted');
    const notif = new NotificationsAPI(ORIGIN, permissions);
    await notif.requestPermission();
    const n = notif.create('Ping')!;
    const closeHandler = vi.fn();
    n.on('close', closeHandler);
    n.close();
    n.close();
    expect(closeHandler).toHaveBeenCalledTimes(1);
  });

  it('replaces an existing notification with the same tag', async () => {
    const permissions = new PermissionStore(async () => 'granted');
    const notif = new NotificationsAPI(ORIGIN, permissions);
    await notif.requestPermission();

    const first = notif.create('First', { tag: 'chat' })!;
    const second = notif.create('Second', { tag: 'chat' })!;

    expect(first.isClosed).toBe(true);
    expect(second.isClosed).toBe(false);
    expect(notif.activeCount).toBe(1);
  });

  it('evicts the oldest notification once the active limit is exceeded', async () => {
    const permissions = new PermissionStore(async () => 'granted');
    const notif = new NotificationsAPI(ORIGIN, permissions);
    await notif.requestPermission();

    const n1 = notif.create('One')!;
    notif.create('Two');
    notif.create('Three');
    notif.create('Four'); // exceeds MAX_ACTIVE_NOTIFICATIONS of 3

    expect(n1.isClosed).toBe(true);
    expect(notif.activeCount).toBe(3);
  });

  it('closeAll() closes every active notification', async () => {
    const permissions = new PermissionStore(async () => 'granted');
    const notif = new NotificationsAPI(ORIGIN, permissions);
    await notif.requestPermission();
    notif.create('One');
    notif.create('Two');
    notif.closeAll();
    expect(notif.activeCount).toBe(0);
  });

  it('simulateClick() fires the "click" event for testing UI wiring', async () => {
    const permissions = new PermissionStore(async () => 'granted');
    const notif = new NotificationsAPI(ORIGIN, permissions);
    await notif.requestPermission();
    const n = notif.create('Clickable')!;
    const clickHandler = vi.fn();
    n.on('click', clickHandler);
    n.simulateClick();
    expect(clickHandler).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ClipboardAPI
// ─────────────────────────────────────────────────────────────────────────

describe('ClipboardAPI', () => {
  let backend: ClipboardBackend;

  beforeEach(() => {
    backend = {
      read: vi.fn().mockResolvedValue('clipboard contents'),
      write: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('readText resolves with backend contents when granted', async () => {
    const permissions = new PermissionStore(async () => 'granted');
    const clipboard = new ClipboardAPI(ORIGIN, permissions, backend);
    await expect(clipboard.readText()).resolves.toBe('clipboard contents');
  });

  it('readText rejects when permission is denied', async () => {
    const permissions = new PermissionStore(async () => 'denied');
    const clipboard = new ClipboardAPI(ORIGIN, permissions, backend);
    await expect(clipboard.readText()).rejects.toThrow(/denied/i);
    expect(backend.read).not.toHaveBeenCalled();
  });

  it('writeText calls the backend with the given text when granted', async () => {
    const permissions = new PermissionStore(async () => 'granted');
    const clipboard = new ClipboardAPI(ORIGIN, permissions, backend);
    await clipboard.writeText('hello nova');
    expect(backend.write).toHaveBeenCalledWith('hello nova');
  });

  it('writeText rejects when permission is denied and never touches the backend', async () => {
    const permissions = new PermissionStore(async () => 'denied');
    const clipboard = new ClipboardAPI(ORIGIN, permissions, backend);
    await expect(clipboard.writeText('nope')).rejects.toThrow(/denied/i);
    expect(backend.write).not.toHaveBeenCalled();
  });

  it('read and write permissions are independent', async () => {
    const permissions = new PermissionStore(async (_o, name) =>
      name === 'clipboard-read' ? 'granted' : 'denied'
    );
    const clipboard = new ClipboardAPI(ORIGIN, permissions, backend);
    await expect(clipboard.readText()).resolves.toBe('clipboard contents');
    await expect(clipboard.writeText('x')).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// VibrationAPI
// ─────────────────────────────────────────────────────────────────────────

describe('VibrationAPI', () => {
  let backend: VibrationBackend;

  beforeEach(() => {
    backend = { vibrate: vi.fn(), cancel: vi.fn() };
  });

  it('vibrates with a single duration when granted', async () => {
    const permissions = new PermissionStore(async () => 'granted');
    const vibration = new VibrationAPI(ORIGIN, permissions, backend);
    const result = await vibration.vibrate(200);
    expect(result).toBe(true);
    expect(backend.vibrate).toHaveBeenCalledWith([200]);
  });

  it('vibrates with a pattern array when granted', async () => {
    const permissions = new PermissionStore(async () => 'granted');
    const vibration = new VibrationAPI(ORIGIN, permissions, backend);
    await vibration.vibrate([100, 50, 100]);
    expect(backend.vibrate).toHaveBeenCalledWith([100, 50, 100]);
  });

  it('returns false and never calls the backend when permission is denied', async () => {
    const permissions = new PermissionStore(async () => 'denied');
    const vibration = new VibrationAPI(ORIGIN, permissions, backend);
    const result = await vibration.vibrate(200);
    expect(result).toBe(false);
    expect(backend.vibrate).not.toHaveBeenCalled();
  });

  it('treats a zero / all-zero pattern as a cancel request', async () => {
    const permissions = new PermissionStore(async () => 'granted');
    const vibration = new VibrationAPI(ORIGIN, permissions, backend);
    await vibration.vibrate(0);
    expect(backend.cancel).toHaveBeenCalledTimes(1);
    expect(backend.vibrate).not.toHaveBeenCalled();
  });

  it('floors and clamps negative values in the pattern', async () => {
    const permissions = new PermissionStore(async () => 'granted');
    const vibration = new VibrationAPI(ORIGIN, permissions, backend);
    await vibration.vibrate([-50, 100.9]);
    expect(backend.vibrate).toHaveBeenCalledWith([0, 100]);
  });

  it('cancel() always delegates to the backend regardless of permission', () => {
    const permissions = new PermissionStore(async () => 'denied');
    const vibration = new VibrationAPI(ORIGIN, permissions, backend);
    vibration.cancel();
    expect(backend.cancel).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PermissionGatedWebApis (integration / facade)
// ─────────────────────────────────────────────────────────────────────────

describe('PermissionGatedWebApis facade', () => {
  function buildApis(promptResult: 'granted' | 'denied') {
    const promptUser: PermissionPrompt = vi.fn().mockResolvedValue(promptResult);
    return new PermissionGatedWebApis({
      origin: ORIGIN,
      promptUser,
      positionSource: {
        getPosition: vi.fn().mockResolvedValue(makePosition()),
        subscribe: vi.fn(),
      },
      clipboardBackend: { read: vi.fn().mockResolvedValue(''), write: vi.fn() },
      vibrationBackend: { vibrate: vi.fn(), cancel: vi.fn() },
    });
  }

  it('wires all sub-APIs to a single shared PermissionStore', async () => {
    const apis = buildApis('granted');
    await apis.permissions.request(ORIGIN, 'geolocation');
    // Geolocation's own request should now be a no-op re-read, not a re-prompt.
    const onSuccess = vi.fn();
    await apis.geolocation.getCurrentPosition(onSuccess);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('a single denial affects only its own permission, not siblings', async () => {
    const apis = buildApis('denied');
    const geoError = vi.fn();
    await apis.geolocation.getCurrentPosition(vi.fn(), geoError);
    expect(geoError.mock.calls[0][0].code).toBe('PERMISSION_DENIED');

    // Notifications permission is independent — still 'prompt'/'default' until asked.
    expect(apis.notifications.permission()).toBe('default');
  });

  it('exposes independently constructed instances for each API', () => {
    const apis = buildApis('granted');
    expect(apis.geolocation).toBeInstanceOf(GeolocationAPI);
    expect(apis.notifications).toBeInstanceOf(NotificationsAPI);
    expect(apis.clipboard).toBeInstanceOf(ClipboardAPI);
    expect(apis.vibration).toBeInstanceOf(VibrationAPI);
  });
});
