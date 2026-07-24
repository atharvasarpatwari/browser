import type { IPageRenderer } from '../browser/navigation/page-renderer';
import type { IChannel } from './channel';

/**
 * Cross-process page renderer proxy.
 * 
 * This proxy implements IPageRenderer but forwards all requests to the renderer
 * process via IPC. The browser process uses this to render pages without
 * having direct access to the renderer's DOM and layout engine.
 * 
 * Usage:
 * ```typescript
 * const channel = channelManager.getChannel('renderer-process-123');
 * const renderer = new CrossProcessPageRenderer(channel);
 * await renderer.render(document);
 * ```
 */
export class CrossProcessPageRenderer implements IPageRenderer {
  private renderCompleteHandler: (() => void) | null = null;
  private renderCompleteUnsubscribe: (() => void) | null = null;

  constructor(private readonly channel: IChannel) {}

  async render(document: unknown): Promise<void> {
    await this.channel.request<void>('render-page', { document });
  }

  onRenderComplete(handler: () => void): void {
    this.renderCompleteHandler = handler;
    
    if (!this.renderCompleteUnsubscribe) {
      this.renderCompleteUnsubscribe = this.channel.subscribe<void>(
        'render-complete',
        () => {
          this.renderCompleteHandler?.();
        }
      );
    }
  }

  offRenderComplete(handler: () => void): void {
    if (this.renderCompleteHandler === handler) {
      this.renderCompleteHandler = null;
    }
  }

  getLayoutTree(): unknown {
    // This is a synchronous call that would need to be handled differently
    // in a real cross-process scenario. For now, we throw an error
    // indicating this operation is not supported cross-process.
    throw new Error('getLayoutTree() is not supported in cross-process mode. Use async getLayoutTreeAsync() instead.');
  }

  async getLayoutTreeAsync(): Promise<unknown> {
    return await this.channel.request<unknown>('get-layout-tree', {});
  }

  dispose(): void {
    this.renderCompleteUnsubscribe?.();
    this.renderCompleteUnsubscribe = null;
    this.renderCompleteHandler = null;
  }
}
