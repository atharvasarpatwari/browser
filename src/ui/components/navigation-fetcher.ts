import type { IDisposable } from '../../app/dependency-container';
import type { IBrowserEngine, EngineEvent, PageLoadSession } from '../../browser/engine/browser-engine';
import type { IContentRenderer } from './content-renderer/content-renderer';
import type { IPaintEngine } from '../../browser/rendering/paint-engine';
import type { INavigationController, NavigationEvent } from '../../browser/navigation/navigation-controller';
import type { IUrlParser } from '../../browser/navigation/url-parser';

interface INavigationFetcher extends IDisposable {
  start(): void;
  stop(): void;
}

class NavigationFetcher implements INavigationFetcher {
  private readonly engine: IBrowserEngine;
  private readonly contentRenderer: IContentRenderer;
  private readonly paintEngine: IPaintEngine;
  private readonly navController: INavigationController;
  private readonly urlParser: IUrlParser;
  private disposed = false;

  private readonly engineHandler: (e: EngineEvent) => void;
  private readonly navHandler: (e: NavigationEvent) => void;

  constructor(
    engine: IBrowserEngine,
    contentRenderer: IContentRenderer,
    paintEngine: IPaintEngine,
    navController: INavigationController,
    urlParser: IUrlParser,
  ) {
    this.engine = engine;
    this.contentRenderer = contentRenderer;
    this.paintEngine = paintEngine;
    this.navController = navController;
    this.urlParser = urlParser;

    this.engineHandler = (e: EngineEvent) => this.handleEngineEvent(e);
    this.navHandler = (e: NavigationEvent) => this.handleNavEvent(e);
  }

  start(): void {
    if (this.disposed) return;
    this.engine.on('pageLoadReady', this.engineHandler);
    this.engine.on('pageRepainted', this.engineHandler);
    this.engine.on('pageLoadError', this.engineHandler);
    this.engine.on('pageLoadAborted', this.engineHandler);
    this.navController.on('navigationStarted', this.navHandler);
    this.navController.on('navigationCommitted', this.navHandler);
  }

  stop(): void {
    this.engine.off('pageLoadReady', this.engineHandler);
    this.engine.off('pageRepainted', this.engineHandler);
    this.engine.off('pageLoadError', this.engineHandler);
    this.engine.off('pageLoadAborted', this.engineHandler);
    this.navController.off('navigationStarted', this.navHandler);
    this.navController.off('navigationCommitted', this.navHandler);
  }

  private handleEngineEvent(e: EngineEvent): void {
    switch (e.kind) {
      case 'pageLoadReady':
        // A navigation commits a new page: replace the content canvas.
        this.renderFromEngine(e.session, true);
        break;
      case 'pageRepainted':
        // In-place repaint (animation frames, async image loads): update the
        // existing canvas so the DOM element stays stable while animating.
        if (e.session) this.renderFromEngine(e.session, false);
        break;
      case 'pageLoadError':
        if (this.urlParser.isSpecialPage(e.session.entry.url)) break;
        this.contentRenderer.renderError(
          'Page Load Failed',
          e.error.message,
          e.session.entry.url,
        );
        break;
      case 'pageLoadAborted':
        break;
    }
  }

  private handleNavEvent(e: NavigationEvent): void {
    switch (e.kind) {
      case 'navigationStarted':
        if (this.urlParser.isSpecialPage(e.request.url)) break;
        this.contentRenderer.renderLoading(e.request.url);
        break;
    }
  }

  private renderFromEngine(session: PageLoadSession, freshCanvas: boolean): void {
    const url = session.finalUrl ?? session.entry.url;
    // Internal pages (nova://settings, nova://history, etc.) are rendered
    // directly into the content area by BrowserWindowPage — the engine still
    // runs its own (pointless) fetch/render pipeline for them, but nothing
    // here should paint over what was already put in the DOM for one.
    if (this.urlParser.isSpecialPage(url)) return;
    const hostname = this.extractHostname(url);
    try {
      const imageData = this.paintEngine.rasterize();
      if (imageData.width > 0 && imageData.height > 0) {
        this.contentRenderer.renderFromImageData(imageData, freshCanvas);
      } else {
        this.contentRenderer.renderHtml(
          `<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fa;">
            <div style="text-align:center;color:#5f6368;">
              <h2 style="margin:0 0 8px;">${this.escapeHtml(hostname)}</h2>
              <p style="margin:0;word-break:break-all;max-width:500px;">${this.escapeHtml(url)}</p>
            </div>
          </body></html>`,
          { title: hostname, baseUrl: url },
        );
      }
    } catch {
      this.contentRenderer.renderHtml(
        `<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fa;">
          <div style="text-align:center;color:#5f6368;">
            <h2 style="margin:0 0 8px;">${this.escapeHtml(hostname)}</h2>
            <p style="margin:0;word-break:break-all;max-width:500px;">${this.escapeHtml(url)}</p>
          </div>
        </body></html>`,
        { title: hostname, baseUrl: url },
      );
    }
  }

  private extractHostname(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
  }
}

export { NavigationFetcher };
export type { INavigationFetcher };
