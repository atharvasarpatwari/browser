interface SpeculativeDeps {
  /** Warms DNS (and later a connection) for `host`. Fire-and-forget; failures are ignored. */
  warm(host: string): void | Promise<void>;
  isEnabled(): boolean;
  isIncognito(): boolean;
  readonly now?: () => number;
  /** Minimum omnibox score of the top result before anything is warmed. Default 90. */
  readonly threshold?: number;
  /** A host is not warmed again within this window. Default 5 minutes. */
  readonly ttlMs?: number;
}

interface WarmCandidate {
  readonly url?: string;
  readonly score: number;
  readonly action: string;
}

const INTERNAL_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet', '.test', '.invalid'];
const MAX_TRACKED_HOSTS = 200;

/** Public, named hosts only: never IP literals, single-label or internal names. */
function isWarmableHost(host: string): boolean {
  if (!host.includes('.') || host.endsWith('.')) return false;
  if (host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host)) return false;
  return !INTERNAL_SUFFIXES.some((s) => host.endsWith(s));
}

/**
 * Warms the destination of a high-confidence top omnibox result so pressing Enter is faster.
 * Warming is invisible speculation, so it is limited to confident, plain `https://host/` targets
 * on public hostnames, never runs in incognito, and never repeats within the TTL.
 */
class SpeculativeLoader {
  private readonly warmed = new Map<string, number>();
  private readonly now: () => number;
  private readonly threshold: number;
  private readonly ttlMs: number;

  constructor(private readonly deps: SpeculativeDeps) {
    this.now = deps.now ?? Date.now;
    this.threshold = deps.threshold ?? 90;
    this.ttlMs = deps.ttlMs ?? 5 * 60_000;
  }

  /** Returns true when a warm-up was started for the candidate. */
  consider(top: WarmCandidate | undefined): boolean {
    if (!top?.url || top.action !== 'navigate' || top.score < this.threshold) return false;
    if (!this.deps.isEnabled() || this.deps.isIncognito()) return false;

    let url: URL;
    try { url = new URL(top.url); } catch { return false; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    if (!isWarmableHost(host)) return false;

    const t = this.now();
    const last = this.warmed.get(host);
    if (last !== undefined && t - last < this.ttlMs) return false;
    this.warmed.delete(host);
    this.warmed.set(host, t);
    if (this.warmed.size > MAX_TRACKED_HOSTS) {
      const oldest = this.warmed.keys().next();
      if (!oldest.done) this.warmed.delete(oldest.value);
    }

    try {
      const pending = this.deps.warm(host);
      if (pending) void Promise.resolve(pending).catch(() => { /* speculation must never surface errors */ });
    } catch { /* same */ }
    return true;
  }

  reset(): void { this.warmed.clear(); }
}

export { SpeculativeLoader, isWarmableHost };
export type { SpeculativeDeps, WarmCandidate };
