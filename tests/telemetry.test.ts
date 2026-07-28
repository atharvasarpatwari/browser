import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Telemetry, createTelemetry, DEFAULT_TELEMETRY_CONFIG,
} from '../src/browser/engine/telemetry';

describe('Telemetry', () => {
  let telemetry: Telemetry;

  beforeEach(() => {
    telemetry = createTelemetry({
      enabled: false,
      endpointUrl: 'https://example.com/events',
      flushIntervalMs: 60_000,
      maxBufferSize: 50,
      consent: 'not-decided',
    });
  });

  afterEach(async () => {
    await telemetry.shutdown();
  });

  // ── Lifecycle ──

  it('initializes cleanly', async () => {
    await telemetry.initialize();
    expect(telemetry.isEnabled()).toBe(false);
  });

  it('shutdown clears timer', async () => {
    await telemetry.initialize();
    await telemetry.shutdown();
  });

  it('double-initialize is safe', async () => {
    await telemetry.initialize();
    await telemetry.initialize();
  });

  // ── Consent ──

  it('getConsent returns not-decided initially', () => {
    expect(telemetry.getConsent()).toBe('not-decided');
  });

  it('setConsent opted-in enables telemetry', () => {
    telemetry.setConsent('opted-in');
    expect(telemetry.getConsent()).toBe('opted-in');
  });

  it('setConsent opted-out disables and clears buffer', () => {
    const t = createTelemetry({ enabled: true, consent: 'opted-in' });
    t.record('test-event', 'usage');
    expect(t.getBufferedEvents()).toHaveLength(1);
    t.setConsent('opted-out');
    expect(t.getBufferedEvents()).toHaveLength(0);
    expect(t.isEnabled()).toBe(false);
  });

  // ── Recording ──

  it('does not record when disabled', () => {
    telemetry.record('test', 'usage');
    expect(telemetry.getBufferedEvents()).toHaveLength(0);
  });

  it('does not record when consent is not opted-in', () => {
    const t = createTelemetry({ enabled: true, consent: 'not-decided' });
    t.record('test', 'usage');
    expect(t.getBufferedEvents()).toHaveLength(0);
  });

  it('records events when enabled and opted-in', () => {
    const t = createTelemetry({ enabled: true, consent: 'opted-in' });
    t.record('page-load', 'performance', { url: 'https://example.com' });
    const events = t.getBufferedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('page-load');
    expect(events[0].category).toBe('performance');
    expect(events[0].properties.url).toBe('https://example.com');
    expect(events[0].id).toBeDefined();
    expect(events[0].timestamp).toBeGreaterThan(0);
    expect(events[0].sessionId).toBeDefined();
    expect(events[0].anonymousUserId).toBeDefined();
  });

  it('emits event to handler', () => {
    const t = createTelemetry({ enabled: true, consent: 'opted-in' });
    const handler = vi.fn();
    t.onEvent(handler);
    t.record('test', 'usage');
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].name).toBe('test');
  });

  it('does not record after dispose', () => {
    const t = createTelemetry({ enabled: true, consent: 'opted-in' });
    t.dispose();
    t.record('test', 'usage');
    expect(t.getBufferedEvents()).toHaveLength(0);
  });

  // ── Buffer management ──

  it('clearBuffer empties the buffer', () => {
    const t = createTelemetry({ enabled: true, consent: 'opted-in' });
    t.record('event1', 'usage');
    t.record('event2', 'usage');
    t.clearBuffer();
    expect(t.getBufferedEvents()).toHaveLength(0);
  });

  it('getBufferedEvents returns copies', () => {
    const t = createTelemetry({ enabled: true, consent: 'opted-in' });
    t.record('event', 'usage');
    const events = t.getBufferedEvents();
    events.pop();
    expect(t.getBufferedEvents()).toHaveLength(1);
  });

  // ── Summary ──

  it('getSummary returns correct data', () => {
    const t = createTelemetry({ enabled: true, consent: 'opted-in' });
    t.record('event1', 'usage');
    t.record('event2', 'performance');
    const summary = t.getSummary();
    expect(summary.eventsInBuffer).toBe(2);
    expect(summary.consent).toBe('opted-in');
    expect(summary.enabled).toBe(true);
    expect(summary.totalEventsCollected).toBeGreaterThanOrEqual(2);
  });

  // ── Enable/disable ──

  it('setEnabled toggles', () => {
    const t = createTelemetry({ enabled: false, consent: 'opted-in' });
    expect(t.isEnabled()).toBe(false);
    t.setEnabled(true);
    expect(t.isEnabled()).toBe(true);
    t.setEnabled(false);
    expect(t.isEnabled()).toBe(false);
  });

  it('getConfig returns copy', () => {
    const config = telemetry.getConfig();
    config.enabled = true;
    expect(telemetry.isEnabled()).toBe(false);
  });

  // ── Events ──

  it('unsubscribe stops events', () => {
    const t = createTelemetry({ enabled: true, consent: 'opted-in' });
    const handler = vi.fn();
    const unsub = t.onEvent(handler);
    t.record('before', 'usage');
    expect(handler).toHaveBeenCalledOnce();
    unsub();
    t.record('after', 'usage');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('handler errors do not crash', () => {
    const t = createTelemetry({ enabled: true, consent: 'opted-in' });
    t.onEvent(() => { throw new Error('bad handler'); });
    t.record('test', 'usage');
    expect(t.getBufferedEvents()).toHaveLength(1);
  });
});

// ── DEFAULT CONFIG ──

describe('DEFAULT_TELEMETRY_CONFIG', () => {
  it('is disabled by default', () => {
    expect(DEFAULT_TELEMETRY_CONFIG.enabled).toBe(false);
    expect(DEFAULT_TELEMETRY_CONFIG.consent).toBe('not-decided');
  });

  it('has sensible limits', () => {
    expect(DEFAULT_TELEMETRY_CONFIG.maxBufferSize).toBeGreaterThan(0);
    expect(DEFAULT_TELEMETRY_CONFIG.maxRetries).toBeGreaterThan(0);
    expect(DEFAULT_TELEMETRY_CONFIG.flushIntervalMs).toBeGreaterThan(0);
  });
});
