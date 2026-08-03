import type { IDisposable } from '../../app/dependency-container';
import type { IBrowserEngine, EngineEvent, PageLoadSession } from '../../browser/engine/browser-engine';
import type { IContentRenderer } from './content-renderer/content-renderer';
import type { IPaintEngine } from '../../browser/rendering/paint-engine';
import type { INavigationController, NavigationEvent } from '../../browser/navigation/navigation-controller';

interface INavigationFetcher extends IDisposable {
  start(): void;
  stop(): void;
}

class NavigationFetcher implements INavigationFetcher {
  private readonly engine: IBrowserEngine;
  private readonly contentRenderer: IContentRenderer;
  private readonly paintEngine: IPaintEngine;
  private readonly navController: INavigationController;
  private disposed = false;

  private readonly engineHandler: (e: EngineEvent) => void;
  private readonly navHandler: (e: NavigationEvent) => void;

  constructor(
    engine: IBrowserEngine,
    contentRenderer: IContentRenderer,
    paintEngine: IPaintEngine,
    navController: INavigationController,
  ) {
    this.engine = engine;
    this.contentRenderer = contentRenderer;
    this.paintEngine = paintEngine;
    this.navController = navController;

    this.engineHandler = (e: EngineEvent) => this.handleEngineEvent(e);
    this.navHandler = (e: NavigationEvent) => this.handleNavEvent(e);
  }

  start(): void {
    if (this.disposed) return;
    this.engine.on('pageLoadReady', this.engineHandler);
    this.engine.on('pageLoadError', this.engineHandler);
    this.engine.on('pageLoadAborted', this.engineHandler);
    this.navController.on('navigationStarted', this.navHandler);
    this.navController.on('navigationCommitted', this.navHandler);
  }

  stop(): void {
    this.engine.off('pageLoadReady', this.engineHandler);
    this.engine.off('pageLoadError', this.engineHandler);
    this.engine.off('pageLoadAborted', this.engineHandler);
    this.navController.off('navigationStarted', this.navHandler);
    this.navController.off('navigationCommitted', this.navHandler);
  }

  private handleEngineEvent(e: EngineEvent): void {
    switch (e.kind) {
      case 'pageLoadReady':
        this.renderFromEngine(e.session);
        break;
      case 'pageLoadError':
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
        this.contentRenderer.renderLoading(e.request.url);
        break;
    }
  }

  private renderFromEngine(session: PageLoadSession): void {
    const url = session.finalUrl ?? session.entry.url;
    const hostname = this.extractHostname(url);
    try {
      const imageData = this.paintEngine.rasterize();
      if (imageData.width > 0 && imageData.height > 0) {
        this.contentRenderer.renderFromImageData(imageData);
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
