import type { IDisposable } from '../../app/dependency-container';
import type { IDomTree, DomNode, DomElement, DomTextNode } from '../rendering/dom-tree';

interface FindMatch {
  readonly index: number;
  readonly text: string;
  readonly context: string;
  readonly position: number;
  /** For a real-page match (via findInDom): the containing element's domId, for highlight lookup. */
  readonly elementDomId?: string;
}

interface IFindInPage extends IDisposable {
  find(query: string, options?: FindOptions): FindResult;
  /** Searches the real, live page DOM tree instead of the built-in sample text. */
  findInDom(domTree: IDomTree, query: string, options?: FindOptions): FindResult;
  findNext(): FindMatch | null;
  findPrevious(): FindMatch | null;
  clear(): void;
  getActiveMatch(): FindMatch | null;
  getMatchCount(): number;
  getCurrentIndex(): number;
  onEvent(handler: FindEventHandler): () => void;
}

interface FindOptions {
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
}

interface FindResult {
  readonly matches: FindMatch[];
  readonly activeIndex: number;
  readonly total: number;
  readonly query: string;
}

type FindEventKind = 'search' | 'navigated' | 'cleared';
interface FindEvent {
  readonly kind: FindEventKind;
  readonly result: FindResult;
}

type FindEventHandler = (event: FindEvent) => void;

class FindInPage implements IFindInPage {
  private matches: FindMatch[] = [];
  private activeIndex = -1;
  private _query = '';
  private handlers = new Set<FindEventHandler>();

  find(query: string, options?: FindOptions): FindResult {
    this.clear();
    if (!query.trim()) {
      const result: FindResult = { matches: [], activeIndex: -1, total: 0, query: '' };
      return result;
    }

    this._query = query;
    this.matches = this.searchInText(query, options ?? {});
    this.activeIndex = this.matches.length > 0 ? 0 : -1;

    const result: FindResult = {
      matches: [...this.matches],
      activeIndex: this.activeIndex,
      total: this.matches.length,
      query: this._query,
    };
    this.emit({ kind: 'search', result });
    return result;
  }

  findInDom(domTree: IDomTree, query: string, options?: FindOptions): FindResult {
    this.clear();
    if (!query.trim()) {
      const result: FindResult = { matches: [], activeIndex: -1, total: 0, query: '' };
      return result;
    }

    this._query = query;
    this.matches = this.searchDomText(domTree, query, options ?? {});
    this.activeIndex = this.matches.length > 0 ? 0 : -1;

    const result: FindResult = {
      matches: [...this.matches],
      activeIndex: this.activeIndex,
      total: this.matches.length,
      query: this._query,
    };
    this.emit({ kind: 'search', result });
    return result;
  }

  private searchDomText(domTree: IDomTree, query: string, options: FindOptions): FindMatch[] {
    const doc = domTree.getDocument();
    if (!doc) return [];

    const flags = options.caseSensitive ? 'g' : 'gi';
    const pattern = options.wholeWord ? `\\b${this.escapeRegex(query)}\\b` : this.escapeRegex(query);
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      return [];
    }

    const results: FindMatch[] = [];
    let index = 0;

    const walk = (node: DomNode, nearestElementId: string | null): void => {
      if (node.nodeType === 'element') {
        const el = node as DomElement;
        for (const child of el.children) walk(child, el.domId);
        return;
      }
      if (node.nodeType !== 'text') return;

      const text = (node as DomTextNode).text;
      if (!text || !text.trim()) return;

      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const start = Math.max(0, match.index - 40);
        const end = Math.min(text.length, match.index + match[0].length + 40);
        let context = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
        context = context.replace(/\s+/g, ' ').trim();

        results.push({
          index: index++,
          text: match[0],
          context,
          position: match.index,
          elementDomId: nearestElementId ?? undefined,
        });

        if (match[0].length === 0) regex.lastIndex++;
      }
    };

    for (const child of doc.children) walk(child, null);
    return results;
  }

  findNext(): FindMatch | null {
    if (this.matches.length === 0) return null;
    this.activeIndex = (this.activeIndex + 1) % this.matches.length;
    const match = this.matches[this.activeIndex];
    this.emit({
      kind: 'navigated',
      result: { matches: this.matches, activeIndex: this.activeIndex, total: this.matches.length, query: this._query },
    });
    return match;
  }

  findPrevious(): FindMatch | null {
    if (this.matches.length === 0) return null;
    this.activeIndex = (this.activeIndex - 1 + this.matches.length) % this.matches.length;
    const match = this.matches[this.activeIndex];
    this.emit({
      kind: 'navigated',
      result: { matches: this.matches, activeIndex: this.activeIndex, total: this.matches.length, query: this._query },
    });
    return match;
  }

  clear(): void {
    this.matches = [];
    this.activeIndex = -1;
    this._query = '';
    this.emit({
      kind: 'cleared',
      result: { matches: [], activeIndex: -1, total: 0, query: '' },
    });
  }

  getActiveMatch(): FindMatch | null {
    return this.activeIndex >= 0 && this.activeIndex < this.matches.length
      ? this.matches[this.activeIndex]
      : null;
  }

  getMatchCount(): number {
    return this.matches.length;
  }

  getCurrentIndex(): number {
    return this.activeIndex;
  }

  private searchInText(query: string, options: FindOptions): FindMatch[] {
    const sampleText = this.getSampleText();
    const flags = options.caseSensitive ? 'g' : 'gi';
    const pattern = options.wholeWord ? `\\b${this.escapeRegex(query)}\\b` : this.escapeRegex(query);
    const regex = new RegExp(pattern, flags);

    const results: FindMatch[] = [];
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = regex.exec(sampleText)) !== null) {
      const start = Math.max(0, match.index - 40);
      const end = Math.min(sampleText.length, match.index + match[0].length + 40);
      let context = (start > 0 ? '...' : '') + sampleText.slice(start, end) + (end < sampleText.length ? '...' : '');
      context = context.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

      results.push({
        index,
        text: match[0],
        context,
        position: match.index,
      });
      index++;
    }

    return results;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getSampleText(): string {
    return `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump. The five boxing wizards jump quickly. Sphinx of black quartz, judge my vow.

JavaScript is a programming language. TypeScript adds static typing. Node.js runs JavaScript on the server. React is a UI library. Vitest is a test runner. The browser renders HTML and CSS. Web APIs provide functionality for modern web applications.

Hello world. Test search find match query. Nova Browser. Example.com. User interface. Address bar. Tab manager. Navigation controller. Download manager. Bookmark service. History service. Extension system. DevTools panel. Screen reader. Accessibility tree.`;

    // In a real browser, this would search the actual page DOM text content
  }

  onEvent(handler: FindEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: FindEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.matches = [];
    this.activeIndex = -1;
    this._query = '';
    this.handlers.clear();
  }
}

export { FindInPage };
export type { IFindInPage, FindMatch, FindOptions, FindResult, FindEvent, FindEventKind, FindEventHandler };
