/**
 * @file src/browser/engine/telemetry.ts
 *
 * Privacy-respecting telemetry system. All data is opt-in, stored locally
 * by default, and batched before transmission. No PII is collected.
 */

import type { IDisposable } from '../../app/dependency-container';
import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type TelemetryConsent = 'opted-in' | 'opted-out' | 'not-decided';

export interface TelemetryConfig {
  /** Whether telemetry is enabled (false = no data collected at all) */
  enabled: boolean;
  /** Endpoint URL for batched telemetry submission */
  endpointUrl: string;
  /** How often to flush events to the endpoint (ms) */
  flushIntervalMs: number;
  /** Maximum events to hold in buffer before force-flushing */
  maxBufferSize: number;
  /** Maximum number of retry attempts for failed flushes */
  maxRetries: number;
  /** Retry delay multiplier (exponential backoff) */
  retryBackoffMs: number;
  /** Session ID for this browser session */
  sessionId: string;
  /** User-facing consent status */
  consent: TelemetryConsent;
  /** App version reported with each event */
  appVersion?: string;
}

export interface TelemetryEvent {
  /** Unique event identifier */
  readonly id: string;
  /** Event name / category */
  readonly name: string;
  /** Event timestamp (epoch ms) */
  readonly timestamp: number;
  /** Session this event belongs to */
  readonly sessionId: string;
  /** Anonymized user ID (SHA-256 of machine ID) */
  readonly anonymousUserId: string;
  /** Event properties (no PII) */
  readonly properties: Record<string, unknown>;
  /** Event category: 'performance', 'usage', 'error', 'navigation' */
  readonly category: TelemetryCategory;
  /** Application version */
  readonly appVersion: string;
}

export type TelemetryCategory =
  | 'performance'
  | 'usage'
  | 'error'
  | 'navigation'
  | 'feature-usage'
  | 'startup';

export interface TelemetryBatch {
  readonly batchId: string;
  readonly events: TelemetryEvent[];
  readonly createdAt: number;
  retryCount: number;
}

export interface TelemetryFlushResult {
  success: boolean;
  eventsSent: number;
  error?: string;
}

export interface TelemetrySummary {
  totalEventsCollected: number;
  totalEventsFlushed: number;
  totalFlushAttempts: number;
  successfulFlushes: number;
  failedFlushes: number;
  eventsInBuffer: number;
  consent: TelemetryConsent;
  enabled: boolean;
}

export type TelemetryEventHandler = (event: TelemetryEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// ANONYMIZATION
// ─────────────────────────────────────────────────────────────────────────────

function anonymizeId(raw: string): string {
  const hash = require('crypto').createHash('sha256').update(raw).digest('hex');
  return hash.slice(0, 16);
}

function generateMachineId(): string {
  const parts = [
    process.platform,
    process.arch,
    String(process.pid),
    String(Date.now()),
  ];
  return parts.join('-');
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface ITelemetry extends IDisposable {
  /** Initialize the telemetry system */
  initialize(): Promise<void>;
  /** Set consent status */
  setConsent(consent: TelemetryConsent): void;
  /** Get consent status */
  getConsent(): TelemetryConsent;
  /** Record a telemetry event */
  record(name: string, category: TelemetryCategory, properties?: Record<string, unknown>): void;
  /** Flush all buffered events to the endpoint */
  flush(): Promise<TelemetryFlushResult>;
  /** Get all buffered (unsent) events */
  getBufferedEvents(): TelemetryEvent[];
  /** Get summary statistics */
  getSummary(): TelemetrySummary;
  /** Clear all buffered events */
  clearBuffer(): void;
  /** Subscribe to events */
  onEvent(handler: TelemetryEventHandler): () => void;
  /** Enable/disable telemetry */
  setEnabled(enabled: boolean): void;
  /** Check if enabled */
  isEnabled(): boolean;
  /** Get config */
  getConfig(): TelemetryConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

export class Telemetry implements ITelemetry {
  private buffer: TelemetryEvent[] = [];
  private handlers: TelemetryEventHandler[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private initialized = false;
  private anonymousUserId: string;
  private totalFlushAttempts = 0;
  private successfulFlushes = 0;
  private failedFlushes = 0;
  private totalEventsFlushed = 0;

  constructor(private config: TelemetryConfig) {
    this.anonymousUserId = anonymizeId(generateMachineId());
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (this.config.enabled && this.config.consent === 'opted-in') {
      this.flushTimer = setInterval(() => {
        this.flush().catch(() => {});
      }, this.config.flushIntervalMs);
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.disposed = true;
  }

  setConsent(consent: TelemetryConsent): void {
    this.config.consent = consent;
    if (consent === 'opted-out') {
      this.buffer = [];
      this.setEnabled(false);
    } else if (consent === 'opted-in') {
      this.setEnabled(true);
    }
  }

  getConsent(): TelemetryConsent {
    return this.config.consent;
  }

  record(name: string, category: TelemetryCategory, properties: Record<string, unknown> = {}): void {
    if (!this.config.enabled) return;
    if (this.config.consent !== 'opted-in') return;
    if (this.disposed) return;

    const event: TelemetryEvent = {
      id: randomUUID(),
      name,
      timestamp: Date.now(),
      sessionId: this.config.sessionId,
      anonymousUserId: this.anonymousUserId,
      properties: { ...properties },
      category,
      appVersion: this.config.appVersion ?? '0.0.0',
    };

    this.buffer.push(event);
    this.emit(event);

    if (this.buffer.length >= this.config.maxBufferSize) {
      this.flush().catch(() => {});
    }
  }

  async flush(): Promise<TelemetryFlushResult> {
    if (this.buffer.length === 0) {
      return { success: true, eventsSent: 0 };
    }

    this.totalFlushAttempts++;
    const batch: TelemetryBatch = {
      batchId: randomUUID(),
      events: [...this.buffer],
      createdAt: Date.now(),
      retryCount: 0,
    };

    let lastError: string | undefined;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.sendBatch(batch);
        // Remove flushed events
        const flushedIds = new Set(batch.events.map(e => e.id));
        this.buffer = this.buffer.filter(e => !flushedIds.has(e.id));
        this.successfulFlushes++;
        this.totalEventsFlushed += batch.events.length;
        return { success: true, eventsSent: batch.events.length };
      } catch (err: any) {
        lastError = err.message;
        batch.retryCount++;
        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryBackoffMs * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    this.failedFlushes++;
    return { success: false, eventsSent: 0, error: lastError };
  }

  getBufferedEvents(): TelemetryEvent[] {
    return [...this.buffer];
  }

  getSummary(): TelemetrySummary {
    return {
      totalEventsCollected: this.successfulFlushes * (this.config.maxBufferSize || 1) + this.buffer.length,
      totalEventsFlushed: this.totalEventsFlushed,
      totalFlushAttempts: this.totalFlushAttempts,
      successfulFlushes: this.successfulFlushes,
      failedFlushes: this.failedFlushes,
      eventsInBuffer: this.buffer.length,
      consent: this.config.consent,
      enabled: this.config.enabled,
    };
  }

  clearBuffer(): void {
    this.buffer = [];
  }

  onEvent(handler: TelemetryEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (enabled && this.config.consent === 'opted-in') {
      if (!this.flushTimer) {
        this.flushTimer = setInterval(() => {
          this.flush().catch(() => {});
        }, this.config.flushIntervalMs);
      }
    } else {
      if (this.flushTimer) {
        clearInterval(this.flushTimer);
        this.flushTimer = null;
      }
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getConfig(): TelemetryConfig {
    return { ...this.config };
  }

  dispose(): void {
    this.disposed = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async sendBatch(batch: TelemetryBatch): Promise<void> {
    const resp = await fetch(this.config.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telemetry-Batch-Id': batch.batchId,
      },
      body: JSON.stringify({
        batchId: batch.batchId,
        events: batch.events.map(e => ({
          id: e.id,
          name: e.name,
          timestamp: e.timestamp,
          sessionId: e.sessionId,
          anonymousUserId: e.anonymousUserId,
          properties: e.properties,
          category: e.category,
          appVersion: e.appVersion,
        })),
      }),
    });

    if (!resp.ok) {
      throw new Error(`Telemetry flush failed: ${resp.status} ${resp.statusText}`);
    }
  }

  private emit(event: TelemetryEvent): void {
    for (const handler of this.handlers) {
      try { handler(event); } catch {}
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  enabled: false,
  endpointUrl: 'https://telemetry.nova-browser.org/events',
  flushIntervalMs: 60_000,
  maxBufferSize: 100,
  maxRetries: 3,
  retryBackoffMs: 1000,
  sessionId: randomUUID(),
  consent: 'not-decided',
};

export function createTelemetry(config?: Partial<TelemetryConfig>): Telemetry {
  return new Telemetry({ ...DEFAULT_TELEMETRY_CONFIG, ...config });
}
