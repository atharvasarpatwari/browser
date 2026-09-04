import type { IDisposable } from '../../app/dependency-container';
import type { IResearchService, ResearchOptions, ResearchResult, ResearchState } from '../../browser/research/research-types';

type ResearchPageEventType = 'externalNavigation';

interface ResearchPageEvent {
  readonly kind: ResearchPageEventType;
  readonly url?: string;
}

interface IResearchPage extends IDisposable {
  readonly isMounted: boolean;
  mount(container: HTMLElement): void;
  unmount(): void;
  setResearchService(service: IResearchService): void;
  setResearchOptions(options: ResearchOptions): void;
  submitQuery(query: string): void;
  on(type: ResearchPageEventType, handler: (event: ResearchPageEvent) => void): void;
  off(type: ResearchPageEventType, handler: (event: ResearchPageEvent) => void): void;
}

type ResearchPageEventHandler = (event: ResearchPageEvent) => void;

class ResearchPage implements IResearchPage {
  private readonly handlers: ResearchPageEventHandler[] = [];
  private service: IResearchService | null = null;
  private researchOptions: ResearchOptions = {};
  private container: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private submitBtn: HTMLButtonElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private progressEl: HTMLElement | null = null;
  private resultEl: HTMLElement | null = null;
  private sourcesEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private _mounted = false;
  private disposed = false;

  get isMounted(): boolean {
    return this._mounted;
  }

  mount(container: HTMLElement): void {
    this.container = container;
    this.container.className = 'research-page';
    this.container.style.cssText = 'display:flex;flex-direction:column;height:100%;font-family:system-ui,-apple-system,sans-serif;background:var(--bg-body,#0f0f0f);color:var(--text-primary,#e0e0e0);';
    this.build();
    this._mounted = true;
  }

  unmount(): void {
    if (this.service) {
      this.service.cancel();
    }
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
    this.input = null;
    this.submitBtn = null;
    this.cancelBtn = null;
    this.progressEl = null;
    this.resultEl = null;
    this.sourcesEl = null;
    this.errorEl = null;
    this._mounted = false;
  }

  setResearchService(service: IResearchService): void {
    this.service = service;
    this.service.on('statusChanged', (event) => this.handleStateChange(event.state));
    this.service.on('complete', (event) => this.handleComplete(event.state));
    this.service.on('error', (event) => this.handleError(event.state));
  }

  setResearchOptions(options: ResearchOptions): void {
    this.researchOptions = { ...options };
  }

  submitQuery(query: string): void {
    const trimmed = query.trim();
    if (!trimmed || !this.service || !this._mounted) {
      return;
    }
    if (this.service.state.status === 'searching' || this.service.state.status === 'synthesizing') {
      return;
    }
    this.clearResult();
    this.showError(null);
    this.showProgress();
    this.setProgressText(`Searching: "${trimmed}"`);

    void this.service.research(trimmed, this.researchOptions).catch(() => {
      // Errors are signalled via the state/event callbacks.
    });
  }

  on(type: ResearchPageEventType, handler: ResearchPageEventHandler): void {
    this.handlers.push(handler);
  }

  off(type: ResearchPageEventType, handler: ResearchPageEventHandler): void {
    const idx = this.handlers.indexOf(handler);
    if (idx !== -1) this.handlers.splice(idx, 1);
  }

  dispose(): void {
    this.disposed = true;
    if (this.service) {
      this.service.cancel();
    }
    this.off('externalNavigation', () => {});
    this.handlers.length = 0;
    this.unmount();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private build(): void {
    if (!this.container) return;

    this.container.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = 'padding:16px 24px;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,.06));background:var(--bg-surface,#161618);';
    this.container.appendChild(header);

    const title = document.createElement('h1');
    title.textContent = 'AI Research';
    title.style.cssText = 'margin:0 0 4px;font-size:20px;font-weight:600;';
    header.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.textContent = 'Deep web research with cited, structured reports.';
    subtitle.style.cssText = 'margin:0;font-size:12px;color:var(--text-secondary,#a0a098);';
    header.appendChild(subtitle);

    const searchRow = document.createElement('div');
    searchRow.style.cssText = 'display:flex;gap:8px;margin-top:12px;';
    header.appendChild(searchRow);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enter your research query...';
    input.className = 'research-input';
    input.style.cssText = 'flex:1;padding:10px 14px;border:1px solid var(--border-subtle,rgba(255,255,255,.1));border-radius:6px;background:var(--bg-body,#0f0f0f);color:var(--text-primary,#e0e0e0);font-size:14px;outline:none;';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const value = input.value;
        if (value.trim()) this.submitQuery(value);
      }
    });
    this.input = input;
    searchRow.appendChild(input);

    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Research';
    submitBtn.className = 'research-submit';
    submitBtn.style.cssText = 'padding:10px 20px;border:none;border-radius:6px;background:var(--accent,#7c9cf5);color:#0f0f0f;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .12s;';
    submitBtn.addEventListener('click', () => {
      const value = this.input?.value ?? '';
      if (value.trim()) this.submitQuery(value);
    });
    this.submitBtn = submitBtn;
    searchRow.appendChild(submitBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'research-cancel';
    cancelBtn.style.cssText = 'padding:10px 16px;border:1px solid var(--border-subtle,rgba(255,255,255,.2));border-radius:6px;background:transparent;color:var(--text-secondary,#a0a098);font-size:14px;cursor:pointer;display:none;transition:opacity .12s;';
    cancelBtn.addEventListener('click', () => {
      this.service?.cancel();
      this.hideProgress();
      if (this.submitBtn) this.submitBtn.style.display = '';
      if (this.cancelBtn) this.cancelBtn.style.display = 'none';
    });
    this.cancelBtn = cancelBtn;
    searchRow.appendChild(cancelBtn);

    // Progress area
    const progressEl = document.createElement('div');
    progressEl.className = 'research-progress';
    progressEl.style.cssText = 'display:none;padding:12px 16px;margin-top:12px;border-radius:6px;background:rgba(124,156,245,.08);border:1px solid rgba(124,156,245,.2);';
    this.progressEl = progressEl;
    header.appendChild(progressEl);

    // Error area
    const errorEl = document.createElement('div');
    errorEl.className = 'research-error';
    errorEl.style.cssText = 'display:none;padding:12px 16px;margin-top:12px;border-radius:6px;background:rgba(229,57,53,.08);border:1px solid rgba(229,57,53,.25);color:var(--text-danger,#e57373);font-size:13px;';
    this.errorEl = errorEl;
    header.appendChild(errorEl);

    // Result area
    const scrollArea = document.createElement('div');
    scrollArea.style.cssText = 'flex:1;overflow-y:auto;padding:24px 32px;';
    this.container.appendChild(scrollArea);

    this.resultEl = scrollArea;
  }

  private handleStateChange(state: ResearchState): void {
    if (!this._mounted) return;

    if (state.status === 'searching' || state.status === 'synthesizing') {
      this.showProgress();
      this.setProgressText(state.progress || 'Working...');
      if (this.submitBtn) this.submitBtn.style.display = 'none';
      if (this.cancelBtn) this.cancelBtn.style.display = '';
    } else if (state.status === 'complete') {
      this.hideProgress();
      if (this.submitBtn) this.submitBtn.style.display = '';
      if (this.cancelBtn) this.cancelBtn.style.display = 'none';
    } else if (state.status === 'error') {
      this.hideProgress();
      this.showError(state.error);
      if (this.submitBtn) this.submitBtn.style.display = '';
      if (this.cancelBtn) this.cancelBtn.style.display = 'none';
    } else if (state.status === 'cancelled') {
      this.hideProgress();
      if (this.submitBtn) this.submitBtn.style.display = '';
      if (this.cancelBtn) this.cancelBtn.style.display = 'none';
    }
  }

  private handleComplete(state: ResearchState): void {
    if (!this._mounted || !state.result) return;
    this.renderResult(state.result);
  }

  private handleError(state: ResearchState): void {
    if (!this._mounted) return;
    this.showError(state.error ?? 'An unknown error occurred.');
  }

  private showProgress(): void {
    if (this.progressEl) this.progressEl.style.display = 'block';
  }

  private hideProgress(): void {
    if (this.progressEl) this.progressEl.style.display = 'none';
  }

  private setProgressText(text: string): void {
    if (this.progressEl) {
      this.progressEl.textContent = `🔍 ${text}`;
    }
  }

  private showError(message: string | null): void {
    if (this.errorEl) {
      if (message) {
        this.errorEl.style.display = 'block';
        this.errorEl.textContent = `⚠️ ${message}`;
      } else {
        this.errorEl.style.display = 'none';
        this.errorEl.textContent = '';
      }
    }
  }

  private clearResult(): void {
    if (this.resultEl) {
      this.resultEl.innerHTML = '';
    }
  }

  private renderResult(result: ResearchResult): void {
    if (!this.resultEl) return;

    this.resultEl.innerHTML = '';

    const reportEl = document.createElement('div');
    reportEl.className = 'research-report';
    reportEl.style.cssText = 'max-width:820px;line-height:1.6;font-size:14px;';
    reportEl.innerHTML = this.renderMarkdown(result.report);
    reportEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'A') {
        e.preventDefault();
        const url = target.getAttribute('data-url');
        if (url) this.navigateExternal(url);
      }
    });
    this.resultEl.appendChild(reportEl);

    const sources = document.createElement('div');
    sources.className = 'research-sources';
    sources.style.cssText = 'max-width:820px;margin-top:32px;padding-top:16px;border-top:1px solid var(--border-subtle,rgba(255,255,255,.08));';
    this.sourcesEl = sources;

    const sourcesTitle = document.createElement('h2');
    sourcesTitle.textContent = 'Sources';
    sourcesTitle.style.cssText = 'margin:0 0 12px;font-size:16px;';
    sources.appendChild(sourcesTitle);

    if (result.citations.length === 0) {
      const note = document.createElement('p');
      note.textContent = 'No external sources were cited.';
      note.style.cssText = 'margin:0;color:var(--text-secondary,#a0a098);font-size:13px;';
      sources.appendChild(note);
    } else {
      const list = document.createElement('ul');
      list.style.cssText = 'margin:0;padding-left:20px;';
      for (const c of result.citations) {
        const item = document.createElement('li');
        item.style.cssText = 'margin-bottom:8px;font-size:13px;';

        const link = document.createElement('a');
        link.textContent = c.title;
        link.href = '#';
        link.style.cssText = 'color:var(--accent,#7c9cf5);text-decoration:none;';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          this.navigateExternal(c.url);
        });
        item.appendChild(link);

        const urlEl = document.createElement('div');
        urlEl.textContent = c.url;
        urlEl.style.cssText = 'color:var(--text-secondary,#a0a098);font-size:12px;word-break:break-all;';
        item.appendChild(urlEl);

        list.appendChild(item);
      }
      sources.appendChild(list);
    }

    this.resultEl.appendChild(sources);

    if (result.searchLog.length > 0) {
      const logSection = document.createElement('div');
      logSection.className = 'research-search-log';
      logSection.style.cssText = 'max-width:820px;margin-top:24px;padding-top:16px;border-top:1px solid var(--border-subtle,rgba(255,255,255,.08));';

      const logTitle = document.createElement('h2');
      logTitle.textContent = 'Search Log';
      logTitle.style.cssText = 'margin:0 0 10px;font-size:16px;';
      logSection.appendChild(logTitle);

      const logList = document.createElement('ul');
      logList.style.cssText = 'margin:0;padding-left:20px;font-size:13px;';
      for (const entry of result.searchLog) {
        const item = document.createElement('li');
        item.style.cssText = 'margin-bottom:4px;';
        const querySpan = document.createElement('code');
        querySpan.textContent = entry.query;
        querySpan.style.cssText = 'background:var(--bg-surface,#161618);padding:2px 6px;border-radius:3px;font-size:12px;';
        item.appendChild(querySpan);
        const countSpan = document.createElement('span');
        countSpan.textContent = ` → ${entry.resultCount !== null ? entry.resultCount : '?'} result(s)`;
        countSpan.style.cssText = 'color:var(--text-secondary,#a0a098);';
        item.appendChild(countSpan);
        logList.appendChild(item);
      }
      logSection.appendChild(logList);
      this.resultEl.appendChild(logSection);
    }

    const usage = result.usage;
    const footer = document.createElement('div');
    footer.className = 'research-usage';
    footer.style.cssText = 'max-width:820px;margin-top:24px;padding-top:12px;border-top:1px solid var(--border-subtle,rgba(255,255,255,.08));font-size:12px;color:var(--text-secondary,#a0a098);';
    const ts = result.timestamp instanceof Date ? result.timestamp.toISOString() : String(result.timestamp);
    footer.textContent = `Tokens: ${usage.inputTokens} in / ${usage.outputTokens} out \u00b7 Searches: ${usage.searchesUsed}/${usage.maxSearches} \u00b7 ${ts}`;
    this.resultEl.appendChild(footer);
  }

  private navigateExternal(url: string): void {
    for (const handler of this.handlers) {
      try {
        handler({ kind: 'externalNavigation', url });
      } catch (err) {
        console.error('[ResearchPage] Handler threw on externalNavigation:', err);
      }
    }
  }

  private renderMarkdown(md: string): string {
    const lines = md.split('\n');
    const out: string[] = [];
    let inList = false;
    let inCode = false;
    let codeBuffer: string[] = [];

    const closeList = (): void => {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
    };

    const closeCode = (): void => {
      if (inCode) {
        out.push(`<pre style="background:var(--bg-surface,#161618);padding:12px;border-radius:6px;overflow-x:auto;font-size:13px;border:1px solid var(--border-subtle,rgba(255,255,255,.08));"><code>${this.escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
        codeBuffer = [];
        inCode = false;
      }
    };

    for (const line of lines) {
      if (line.startsWith('```')) {
        closeList();
        if (inCode) {
          closeCode();
        } else {
          inCode = true;
        }
        continue;
      }

      if (inCode) {
        codeBuffer.push(line);
        continue;
      }

      const headingMatch = line.match(/^(#{1,4})\s+(.*)/);
      if (headingMatch) {
        closeList();
        const level = Math.min(headingMatch[1].length, 4);
        const text = this.inlineMarkdown(headingMatch[2]);
        const sizes = ['18px', '17px', '16px', '15px'];
        out.push(`<h${Math.min(level + 1, 5)} style="font-size:${sizes[level - 1]};margin:20px 0 10px;font-weight:600;">${text}</h${Math.min(level + 1, 5)}>`);
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        if (!inList) {
          out.push('<ul style="margin:10px 0 10px 20px;padding:0;">');
          inList = true;
        }
        out.push(`<li style="margin-bottom:6px;">${this.inlineMarkdown(line.replace(/^\s*[-*+]\s+/g, ''))}</li>`);
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        closeList();
        const num = line.match(/^\s*\d+\.\s+(.*)/);
        if (num) {
          out.push(`<p style="margin:8px 0;">${num[1]}</p>`);
        }
        continue;
      }

      if (line.trim() === '') {
        closeList();
        closeCode();
        continue;
      }

      closeList();
      out.push(`<p style="margin:8px 0;">${this.inlineMarkdown(line)}</p>`);
    }

    closeList();
    closeCode();
    return out.join('\n');
  }

  private inlineMarkdown(text: string): string {
    let result = this.escapeHtml(text);
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
    result = result.replace(/`([^`]+)`/g, '<code style="background:var(--bg-surface,#161618);padding:2px 5px;border-radius:3px;font-size:12px;">$1</code>');
    result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label: string, url: string) => {
      const safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `<a href="#" data-url="${safeUrl}" style="color:var(--accent,#7c9cf5);text-decoration:none;">${label}</a>`;
    });
    return result;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

export { ResearchPage };
export type { IResearchPage, ResearchPageEvent, ResearchPageEventType };
