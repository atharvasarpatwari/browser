import type { IDisposable } from '../../app/dependency-container';

interface IMixedContentService extends IDisposable {
  isMixedContent(pageUrl: string, resourceUrl: string): boolean;
  checkAndBlock(pageUrl: string, resourceUrl: string, resourceType: MixedContentResourceType): MixedContentDecision;
  setBlockMode(mode: MixedContentBlockMode): void;
  getBlockMode(): MixedContentBlockMode;
  getAllowedMixedContent(): MixedContentEntry[];
  addAllowedMixedContent(url: string, resourceType: MixedContentResourceType): void;
  getBlockedCount(): number;
  onEvent(handler: MixedContentEventHandler): () => void;
}

type MixedContentResourceType = 'script' | 'style' | 'fetch' | 'image' | 'media' | 'font' | 'websocket' | 'worker' | 'other';
type MixedContentDecision = 'allowed' | 'blocked' | 'upgraded';
type MixedContentBlockMode = 'block-all' | 'block-display' | 'block-script' | 'warn-only' | 'disabled';

interface MixedContentEntry {
  readonly url: string;
  readonly resourceType: MixedContentResourceType;
  readonly decision: MixedContentDecision;
}

type MixedContentEventKind = 'blocked' | 'allowed' | 'upgraded';
type MixedContentEventHandler = (event: MixedContentEvent) => void;

interface MixedContentEvent {
  readonly kind: MixedContentEventKind;
  readonly data?: Record<string, unknown>;
}

const SCRIPT_LIKE_TYPES: ReadonlySet<MixedContentResourceType> = new Set(['script', 'worker', 'fetch', 'websocket']);
const DISPLAY_TYPES: ReadonlySet<MixedContentResourceType> = new Set(['image', 'media', 'font', 'style']);

class MixedContentService implements IMixedContentService {
  private _blockMode: MixedContentBlockMode = 'block-all';
  private _allowed = new Set<string>();
  private _blockedCount = 0;
  private _blockedEntries: MixedContentEntry[] = [];
  private _handlers = new Set<MixedContentEventHandler>();

  isMixedContent(pageUrl: string, resourceUrl: string): boolean {
    try {
      const page = new URL(pageUrl);
      const resource = new URL(resourceUrl);
      return page.protocol === 'https:' && resource.protocol !== 'https:' && resource.protocol !== 'data:' && resource.protocol !== 'blob:';
    } catch {
      return false;
    }
  }

  checkAndBlock(pageUrl: string, resourceUrl: string, resourceType: MixedContentResourceType): MixedContentDecision {
    if (!this.isMixedContent(pageUrl, resourceUrl)) {
      return 'allowed';
    }

    const key = `${resourceUrl}::${resourceType}`;
    if (this._allowed.has(key)) {
      this.emit({ kind: 'allowed', data: { url: resourceUrl, resourceType } });
      return 'allowed';
    }

    if (this._blockMode === 'disabled') {
      this.emit({ kind: 'allowed', data: { url: resourceUrl, resourceType } });
      return 'allowed';
    }

    if (this._blockMode === 'warn-only') {
      this.emit({ kind: 'allowed', data: { url: resourceUrl, resourceType } });
      return 'allowed';
    }

    if (this._blockMode === 'block-all') {
      this._blockedCount++;
      this._blockedEntries.push({ url: resourceUrl, resourceType, decision: 'blocked' });
      this.emit({ kind: 'blocked', data: { url: resourceUrl, resourceType } });
      return 'blocked';
    }

    if (this._blockMode === 'block-script' && SCRIPT_LIKE_TYPES.has(resourceType)) {
      this._blockedCount++;
      this._blockedEntries.push({ url: resourceUrl, resourceType, decision: 'blocked' });
      this.emit({ kind: 'blocked', data: { url: resourceUrl, resourceType } });
      return 'blocked';
    }

    if (this._blockMode === 'block-display' && DISPLAY_TYPES.has(resourceType)) {
      this._blockedCount++;
      this._blockedEntries.push({ url: resourceUrl, resourceType, decision: 'blocked' });
      this.emit({ kind: 'blocked', data: { url: resourceUrl, resourceType } });
      return 'blocked';
    }

    this.emit({ kind: 'allowed', data: { url: resourceUrl, resourceType } });
    return 'allowed';
  }

  setBlockMode(mode: MixedContentBlockMode): void {
    this._blockMode = mode;
  }

  getBlockMode(): MixedContentBlockMode {
    return this._blockMode;
  }

  getAllowedMixedContent(): MixedContentEntry[] {
    return [...this._blockedEntries];
  }

  addAllowedMixedContent(url: string, resourceType: MixedContentResourceType): void {
    this._allowed.add(`${url}::${resourceType}`);
  }

  getBlockedCount(): number {
    return this._blockedCount;
  }

  onEvent(handler: MixedContentEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: MixedContentEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._allowed.clear();
    this._blockedEntries = [];
    this._blockedCount = 0;
  }
}

export { MixedContentService, SCRIPT_LIKE_TYPES, DISPLAY_TYPES };
export type { IMixedContentService, MixedContentResourceType, MixedContentDecision, MixedContentBlockMode, MixedContentEntry, MixedContentEvent, MixedContentEventKind, MixedContentEventHandler };
