import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { IncognitoManager } from '../src/browser/settings/incognito';

const SESSION_ID_RE = /^incognito-[0-9a-f]{8}$/i;

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

function stubCrypto(randomUUID: unknown, getRandomValues: unknown) {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...(typeof randomUUID === 'function' ? { randomUUID } : {}),
      ...(typeof getRandomValues === 'function' ? { getRandomValues } : {}),
    },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  // Ensure a normal crypto (with randomUUID) is in place for non-fallback tests.
  if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
});

afterEach(() => {
  if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
});

describe('IncognitoManager', () => {
  it('activates with a session id and reflects in isActive()', () => {
    const m = new IncognitoManager();
    expect(m.isActive()).toBe(false);

    const session = m.activate();
    expect(m.isActive()).toBe(true);
    expect(session.sessionId).toMatch(SESSION_ID_RE);
    expect(m.getSession()?.sessionId).toBe(session.sessionId);

    m.deactivate();
    expect(m.isActive()).toBe(false);
    expect(m.getSession()).toBeUndefined();
  });

  it('activate() is idempotent while a session is live', () => {
    const m = new IncognitoManager();
    const first = m.activate();
    expect(m.activate()).toBe(first);
  });

  it('records page/cookie/tracker stats into the live session', () => {
    const m = new IncognitoManager();
    m.activate();
    m.recordVisit('https://example.com/');
    m.recordVisit('https://example.com/a');
    m.recordCookieBlocked();
    m.recordTrackerBlocked();

    const stats = m.getStats();
    expect(stats.isActive).toBe(true);
    expect(stats.pagesVisited).toBe(2);
    expect(stats.cookiesBlocked).toBe(1);
    expect(stats.trackersBlocked).toBe(1);
    expect(stats.totalDataBlocked).toBe(2);
  });

  it('still produces a valid session id when crypto.randomUUID is missing (browser WebView bundle)', () => {
    // The Android WebView bundle maps `import { randomUUID } from 'crypto'`
    // to a shim without randomUUID — the manager must degrade gracefully.
    stubCrypto(null, (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = 1;
    });

    const m = new IncognitoManager();
    const session = m.activate();
    expect(session.sessionId).toMatch(SESSION_ID_RE);
  });

  it('emits modeActivated/modeDeactivated events', () => {
    const m = new IncognitoManager();
    const events: string[] = [];
    m.onEvent((e) => events.push(e.kind));

    m.activate();
    m.deactivate();
    expect(events).toEqual(['modeActivated', 'modeDeactivated']);
  });

  it('dispose() deactivates and clears handlers', () => {
    const m = new IncognitoManager();
    let fired = 0;
    m.onEvent(() => { fired++; });
    m.activate();
    m.dispose();
    expect(m.isActive()).toBe(false);
    expect(fired).toBeGreaterThan(0);
  });
});
