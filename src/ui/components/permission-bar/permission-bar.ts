import type { IDisposable } from '../../../app/dependency-container';
import type { PermissionName } from '../../../browser/web-apis/web-apis-permissions';

const PERMISSION_COPY: Record<PermissionName, string> = {
  geolocation: 'Know your location',
  notifications: 'Show notifications',
  'clipboard-read': 'See text you copy and paste',
  'clipboard-write': 'See text you copy and paste',
  vibrate: 'Control vibration',
};

interface PendingRequest {
  origin: string;
  name: PermissionName;
  resolve: (decision: 'granted' | 'denied') => void;
}

interface IPermissionBar extends IDisposable {
  attach(container: HTMLElement): void;
  isVisible(): boolean;
  /** Shows a real prompt for (origin, name) and resolves with the user's choice. A request made while one is already visible queues instead of replacing it. */
  request(origin: string, name: PermissionName): Promise<'granted' | 'denied'>;
}

/**
 * Modeled directly on FindBar (attach-once, inline cssText, show/hide/
 * dispose) — the one difference is this returns a Promise per request
 * instead of firing callback-setter events, since a permission prompt is
 * fundamentally a single request/response, not a repeating interaction.
 */
class PermissionBar implements IPermissionBar {
  private container: HTMLElement | null = null;
  private barEl: HTMLElement | null = null;
  private messageEl: HTMLElement | null = null;
  private visible = false;
  private queue: PendingRequest[] = [];

  attach(container: HTMLElement): void {
    this.container = container;
    this.build();
  }

  private build(): void {
    if (!this.container) return;

    const bar = document.createElement('div');
    bar.style.cssText = `
      position:fixed; top:8px; right:8px; z-index:500; display:none;
      align-items:center; gap:10px; background:#292a2d; color:#e8eaed;
      border:1px solid #3c4043; border-radius:6px; padding:10px 12px;
      font-family:system-ui,-apple-system,sans-serif; font-size:13px;
      box-shadow:0 2px 8px rgba(0,0,0,0.3); max-width:320px;
    `.trim();

    const message = document.createElement('span');
    message.style.cssText = 'flex:1;';

    const blockBtn = PermissionBar.makeButton('Block');
    blockBtn.addEventListener('click', () => this.settle('denied'));

    const allowBtn = PermissionBar.makeButton('Allow');
    allowBtn.style.background = '#8ab4f8';
    allowBtn.style.color = '#202124';
    allowBtn.addEventListener('click', () => this.settle('granted'));

    bar.append(message, blockBtn, allowBtn);
    this.container.appendChild(bar);

    this.barEl = bar;
    this.messageEl = message;
  }

  private static makeButton(text: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = 'background:#3c4043; color:#e8eaed; border:none; border-radius:3px; padding:5px 10px; font-size:12px; cursor:pointer;';
    return btn;
  }

  request(origin: string, name: PermissionName): Promise<'granted' | 'denied'> {
    return new Promise((resolve) => {
      this.queue.push({ origin, name, resolve });
      if (this.queue.length === 1) this.showNext();
    });
  }

  private showNext(): void {
    const next = this.queue[0];
    if (!next || !this.barEl || !this.messageEl) return;
    let host: string;
    try {
      host = new URL(next.origin).host || next.origin;
    } catch {
      host = next.origin;
    }
    this.messageEl.textContent = `${host} wants to: ${PERMISSION_COPY[next.name]}`;
    this.barEl.style.display = 'flex';
    this.visible = true;
  }

  private settle(decision: 'granted' | 'denied'): void {
    const current = this.queue.shift();
    current?.resolve(decision);
    if (this.queue.length > 0) {
      this.showNext();
    } else if (this.barEl) {
      this.barEl.style.display = 'none';
      this.visible = false;
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.barEl?.remove();
    this.barEl = null;
    this.messageEl = null;
    this.container = null;
    for (const pending of this.queue) pending.resolve('denied');
    this.queue = [];
  }
}

export { PermissionBar, type IPermissionBar };
