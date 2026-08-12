import type { IDisposable } from '../../../app/dependency-container';

interface ContentRenderOptions {
  readonly baseUrl?: string;
  readonly title?: string;
}

interface IContentRenderer extends IDisposable {
  attach(container: HTMLElement): void;
  setBrandName(name: string): void;
  setLinkHoverHandler(handler: (url: string | null) => void): void;
  renderHtml(html: string, options?: ContentRenderOptions): void;
  renderFromImageData(imageData: ImageData, freshCanvas?: boolean): void;
  renderSearchResults(query: string, searchUrl: string, results: readonly SearchResult[]): void;
  renderError(title: string, message: string, url?: string): void;
  renderLoading(url: string): void;
  renderNewTab(): void;
  clear(): void;
}

interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

class ContentRenderer implements IContentRenderer {
  private container: HTMLElement | null = null;
  private _brandName = 'Nova Browser';
  private _linkHoverHandler: ((url: string | null) => void) | null = null;

  attach(container: HTMLElement): void {
    this.container = container;
  }

  setBrandName(name: string): void {
    this._brandName = name;
  }

  setLinkHoverHandler(handler: (url: string | null) => void): void {
    this._linkHoverHandler = handler;
  }

  renderHtml(html: string, options?: ContentRenderOptions): void {
    if (!this.container) return;
    this.container.innerHTML = '';

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups');
    this.container.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(html);
    doc.close();

    if (options?.title) {
      doc.title = options.title;
    }

    this.wireLinkHoverTracking(doc);
  }

  renderFromImageData(imageData: ImageData, freshCanvas = false): void {
    if (!this.container) return;

    // Reuse the existing canvas when the page is only being repainted in place
    // (e.g. per-frame animation updates). A fresh canvas is created on
    // navigation so consumers can detect a new page by element identity.
    const existing = this.container.querySelector('canvas');
    const canvas = existing && !freshCanvas
      ? existing
      : null;

    if (!canvas) {
      this.container.innerHTML = '';
    }

    const target = canvas ?? (() => {
      const el = document.createElement('canvas');
      el.width = imageData.width;
      el.height = imageData.height;
      el.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#fff;display:block;';
      this.container!.appendChild(el);
      return el;
    })();

    target.width = imageData.width;
    target.height = imageData.height;
    const ctx = target.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(imageData, 0, 0);
  }

  renderSearchResults(query: string, searchUrl: string, results: readonly SearchResult[]): void {
    if (!this.container) return;
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'font-family:system-ui,-apple-system,sans-serif;max-width:700px;margin:0 auto;padding:24px 16px;color:#1a1a1a;';

    // Search bar at the top
    const searchBar = document.createElement('div');
    searchBar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:24px;padding:8px 12px;border:1px solid #dfe1e5;border-radius:24px;background:#fff;';
    searchBar.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" value="${this.escapeHtml(query)}" readonly style="flex:1;border:none;outline:none;font-size:14px;background:transparent;color:#1a1a1a;">
    `;
    wrapper.appendChild(searchBar);

    // Search results
    if (results.length === 0) {
      const noResults = document.createElement('div');
      noResults.style.cssText = 'text-align:center;padding:40px 0;color:#70757a;';
      noResults.textContent = `No results found for "${query}"`;
      wrapper.appendChild(noResults);
    } else {
      for (const result of results) {
        const item = document.createElement('div');
        item.style.cssText = 'margin-bottom:24px;';

        const breadcrumb = document.createElement('div');
        breadcrumb.style.cssText = 'font-size:12px;color:#4d5156;margin-bottom:4px;';
        const host = this.extractHost(result.url);
        breadcrumb.textContent = host;

        const title = document.createElement('a');
        title.href = result.url;
        title.style.cssText = 'font-size:18px;color:#1a0dab;text-decoration:none;line-height:1.3;display:block;margin-bottom:4px;';
        title.textContent = result.title;
        title.addEventListener('click', (e) => {
          e.preventDefault();
          const event = new CustomEvent('nova-navigate', { detail: { url: result.url }, bubbles: true });
          this.container?.dispatchEvent(event);
        });

        const snippet = document.createElement('div');
        snippet.style.cssText = 'font-size:13px;color:#4d5156;line-height:1.5;';
        snippet.textContent = result.snippet;

        item.appendChild(breadcrumb);
        item.appendChild(title);
        item.appendChild(snippet);
        wrapper.appendChild(item);
      }
    }

    // Powered by line
    const footer = document.createElement('div');
    footer.style.cssText = 'text-align:center;padding:16px 0;color:#9aa0a6;font-size:12px;border-top:1px solid #ebebeb;margin-top:16px;';
    footer.innerHTML = `Search powered by <a href="${this.escapeHtml(searchUrl)}" style="color:#1a0dab;text-decoration:none;">${this.escapeHtml(this._brandName)}</a>`;
    wrapper.appendChild(footer);

    this.container.appendChild(wrapper);
  }

  renderError(title: string, message: string, url?: string): void {
    if (!this.container) return;
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:40px 20px;font-family:system-ui,-apple-system,sans-serif;text-align:center;';

    const icon = document.createElement('div');
    icon.style.cssText = 'font-size:48px;margin-bottom:16px;';
    icon.textContent = '⚠️';

    const titleEl = document.createElement('h1');
    titleEl.style.cssText = 'font-size:20px;color:#1a1a1a;margin:0 0 8px;';
    titleEl.textContent = title;

    const msgEl = document.createElement('p');
    msgEl.style.cssText = 'font-size:14px;color:#5f6368;margin:0 0 16px;max-width:500px;line-height:1.5;';
    msgEl.textContent = message;

    wrapper.appendChild(icon);
    wrapper.appendChild(titleEl);
    wrapper.appendChild(msgEl);

    if (url) {
      const urlEl = document.createElement('div');
      urlEl.style.cssText = 'font-size:12px;color:#9aa0a6;word-break:break-all;max-width:500px;';
      urlEl.textContent = url;
      wrapper.appendChild(urlEl);
    }

    this.container.appendChild(wrapper);
  }

  renderLoading(url: string): void {
    if (!this.container) return;
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;font-family:system-ui,-apple-system,sans-serif;';

    const spinner = document.createElement('div');
    spinner.style.cssText = 'width:32px;height:32px;border:3px solid #e8eaed;border-top-color:#4285f4;border-radius:50%;animation:nova-spin 0.8s linear infinite;margin-bottom:16px;';

    const style = document.createElement('style');
    style.textContent = '@keyframes nova-spin{to{transform:rotate(360deg)}}';
    wrapper.appendChild(style);
    wrapper.appendChild(spinner);

    const text = document.createElement('div');
    text.style.cssText = 'font-size:13px;color:#5f6368;';
    text.textContent = `Loading ${this.extractHost(url)}...`;
    wrapper.appendChild(text);

    this.container.appendChild(wrapper);
  }

  renderNewTab(): void {
    if (!this.container) return;
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:50px 20px;position:relative;overflow:hidden;';
    wrapper.innerHTML = `
      <div style="font-family:system-ui,-apple-system,sans-serif;font-size:42px;font-weight:700;letter-spacing:-.03em;margin-bottom:2px;background:linear-gradient(135deg,#f0eee6 0%,#9bb5ff 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">${this.escapeHtml(this._brandName)}</div>
      <div style="font-size:13px;color:#9aa0a6;margin-bottom:30px;letter-spacing:.3px;">Private &amp; secure browsing</div>
      <div style="display:flex;align-items:center;width:100%;max-width:440px;background:rgba(255,255,255,0.8);border:1px solid #dfe1e5;border-radius:24px;padding:0 12px;margin-bottom:18px;backdrop-filter:blur(12px);">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" stroke-width="2" style="margin-right:8px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <div style="flex:1;color:#9aa0a6;font-size:13px;padding:9px 0;">Search the web or enter a URL...</div>
      </div>
    `;
    this.container.appendChild(wrapper);
  }

  private wireLinkHoverTracking(doc: Document): void {
    if (!this._linkHoverHandler) return;
    doc.addEventListener('mouseover', (e: Event) => {
      const target = (e.target as HTMLElement)?.closest('a[href]');
      if (target) {
        this._linkHoverHandler?.(target.getAttribute('href'));
      }
    });
    doc.addEventListener('mouseout', (e: Event) => {
      const target = (e.target as HTMLElement)?.closest('a[href]');
      if (target) {
        this._linkHoverHandler?.(null);
      }
    });
  }

  clear(): void {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  dispose(): void {
    this.clear();
    this.container = null;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private extractHost(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url.slice(0, 60);
    }
  }
}

export { ContentRenderer };
export type { IContentRenderer, ContentRenderOptions, SearchResult };
