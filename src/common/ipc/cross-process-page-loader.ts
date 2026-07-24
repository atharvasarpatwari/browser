import type { IPageLoader, ILoadProgress } from '../browser/navigation/page-loader';
import type { IChannel } from './channel';

/**
 * Cross-process page loader proxy.
 * 
 * This proxy implements IPageLoader but forwards all requests to the renderer
 * process via IPC. The browser process uses this to load pages without
 * having direct access to the renderer's DOM.
 * 
 * Usage:
 * ```typescript
 * const channel = channelManager.getChannel('renderer-process-123');
 * const loader = new CrossProcessPageLoader(channel);
 * const result = await loader.load('https://example.com');
 * ```
 */
export class CrossProcessPageLoader implements IPageLoader {
  private progressHandler: ((progress: ILoadProgress) => void) | null = null;
  private progressUnsubscribe: (() => void) | null = null;

  constructor(private readonly channel: IChannel) {}

  async load(url: string): Promise<{ success: boolean; title: string; url: string }> {
    const result = await this.channel.request<{ success: boolean; title: string; url: string }>(
      'load-page',
      { url }
    );
    return result;
  }

  async loadHTML(html: string, baseUrl?: string): Promise<{ success: boolean; title: string; url: string }> {
    const result = await this.channel.request<{ success: boolean; title: string; url: string }>(
      'load-html',
      { html, baseUrl }
    );
    return result;
  }

  onProgress(handler: (progress: ILoadProgress) => void): void {
    this.progressHandler = handler;
    
    if (!this.progressUnsubscribe) {
      this.progressUnsubscribe = this.channel.subscribe<ILoadProgress>(
        'load-progress',
        (progress) => {
          this.progressHandler?.(progress);
        }
      );
    }
  }

  offProgress(handler: (progress: ILoadProgress) => void): void {
    if (this.progressHandler === handler) {
      this.progressHandler = null;
    }
  }

  abort(): void {
    this.channel.send('abort-load', {});
  }

  dispose(): void {
    this.progressUnsubscribe?.();
    this.progressUnsubscribe = null;
    this.progressHandler = null;
  }
}
