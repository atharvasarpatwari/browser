import type { IDisposable } from '../../app/dependency-container';

interface ReaderContent {
  readonly title: string;
  readonly author: string;
  readonly content: string;
  readonly textLength: number;
  readonly readingTimeMinutes: number;
}

interface IReaderMode extends IDisposable {
  enter(rawHtml: string, baseUrl?: string): ReaderContent | null;
  exit(): void;
  isActive(): boolean;
  getContent(): ReaderContent | null;
  onEvent(handler: ReaderModeEventHandler): () => void;
}

type ReaderModeEventKind = 'entered' | 'exited';
interface ReaderModeEvent {
  readonly kind: ReaderModeEventKind;
  readonly content?: ReaderContent;
}

type ReaderModeEventHandler = (event: ReaderModeEvent) => void;

const WORDS_PER_MINUTE = 200;
const READABLE_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'code', 'td', 'th', 'figcaption', 'summary'];

class ReaderMode implements IReaderMode {
  private active = false;
  private content: ReaderContent | null = null;
  private handlers = new Set<ReaderModeEventHandler>();

  enter(rawHtml: string, baseUrl?: string): ReaderContent | null {
    if (!rawHtml.trim()) return null;

    const title = this.extractTitle(rawHtml) || baseUrl || 'Untitled';
    const author = this.extractAuthor(rawHtml);
    const body = this.extractBody(rawHtml);
    const cleaned = this.cleanContent(body);
    const textLength = cleaned.length;
    const readingTimeMinutes = Math.max(1, Math.ceil(this.countWords(cleaned) / WORDS_PER_MINUTE));

    this.content = { title, author, content: cleaned, textLength, readingTimeMinutes };
    this.active = true;
    this.emit({ kind: 'entered', content: this.content });
    return this.content;
  }

  exit(): void {
    this.active = false;
    this.content = null;
    this.emit({ kind: 'exited' });
  }

  isActive(): boolean {
    return this.active;
  }

  getContent(): ReaderContent | null {
    return this.content;
  }

  private extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (match) return match[1].trim();
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) return this.stripTags(h1[1]).trim();
    return '';
  }

  private extractAuthor(html: string): string {
    const patterns = [
      /<meta\s+name="author"[^>]*content="([^"]*)"/i,
      /<meta\s+property="article:author"[^>]*content="([^"]*)"/i,
      /<a[^>]*rel="author"[^>]*>([\s\S]*?)<\/a>/i,
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) return this.stripTags(m[1]).trim();
    }
    return '';
  }

  private extractBody(html: string): string {
    const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (article) return article[1];
    const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (main) return main[1];
    const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (body) return body[1];
    return html;
  }

  private cleanContent(html: string): string {
    let text = html;
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
    text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
    text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
    text = text.replace(/<aside[\s\S]*?<\/aside>/gi, '');
    text = text.replace(/<form[\s\S]*?<\/form>/gi, '');
    text = text.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
    text = text.replace(/<svg[\s\S]*?<\/svg>/gi, '');
    text = text.replace(/<button[\s\S]*?<\/button>/gi, '');
    text = text.replace(/<!--[\s\S]*?-->/g, '');

    let result = '';
    const tagRegex = /<\/?(div|section|span|p|h[1-6]|li|br|blockquote|pre|code|hr|figcaption|summary|ul|ol|table|tr|td|th|strong|em|b|i|a|img|figure|q|cite|sup|sub|abbr|del|ins|u|s|mark|small|time)[^>]*>/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(text)) !== null) {
      result += this.escapeHtml(text.slice(lastIndex, match.index));
      result += match[0];
      lastIndex = match.index + match[0].length;
    }
    result += this.escapeHtml(text.slice(lastIndex));

    result = result.replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '</p><p>');
    result = result.replace(/<\/?(div|section|span|header)[^>]*>/gi, '');
    result = result.replace(/\n{3,}/g, '\n\n');

    return `<article class="reader-content">${result}</article>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private stripTags(html: string): string {
    return html.replace(/<[^>]*>/g, '').trim();
  }

  private countWords(text: string): number {
    const clean = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return clean ? clean.split(' ').length : 0;
  }

  onEvent(handler: ReaderModeEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: ReaderModeEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.active = false;
    this.content = null;
    this.handlers.clear();
  }
}

export { ReaderMode, WORDS_PER_MINUTE, READABLE_TAGS };
export type { IReaderMode, ReaderContent, ReaderModeEvent, ReaderModeEventKind, ReaderModeEventHandler };
