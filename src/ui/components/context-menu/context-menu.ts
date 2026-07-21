import type { IDisposable } from '../../../app/dependency-container';

interface ContextMenuItem {
  readonly label?: string;
  readonly icon?: string;
  readonly disabled?: boolean;
  readonly separator?: boolean;
  readonly action?: () => void;
}

interface IContextMenu extends IDisposable {
  show(x: number, y: number, items: readonly ContextMenuItem[]): void;
  hide(): void;
  get isVisible(): boolean;
}

class ContextMenu implements IContextMenu {
  private menuEl: HTMLElement | null = null;
  private _isVisible = false;

  get isVisible(): boolean { return this._isVisible; }

  show(x: number, y: number, items: readonly ContextMenuItem[]): void {
    this.hide();

    this.menuEl = document.createElement('div');
    this.menuEl.className = 'nova-context-menu';
    this.menuEl.style.cssText = `
      position:fixed;z-index:99999;
      background:var(--bg-elevated,#fff);
      border:1px solid var(--border-subtle,#e0e0e0);
      border-radius:8px;
      box-shadow:0 4px 12px rgba(0,0,0,0.15),0 1px 4px rgba(0,0,0,0.1);
      padding:4px 0;
      min-width:180px;
      font-family:system-ui,-apple-system,sans-serif;
      font-size:13px;
      color:var(--text-primary,#1a1a1a);
    `;

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:var(--border-subtle,#e0e0e0);margin:4px 0;';
        this.menuEl.appendChild(sep);
        continue;
      }

      const row = document.createElement('div');
      row.style.cssText = `
        display:flex;align-items:center;gap:8px;
        padding:6px 12px;cursor:pointer;
        opacity:${item.disabled ? '0.4' : '1'};
        pointer-events:${item.disabled ? 'none' : 'auto'};
      `;

      if (item.icon) {
        const iconEl = document.createElement('span');
        iconEl.textContent = item.icon;
        iconEl.style.cssText = 'width:16px;text-align:center;font-size:14px;';
        row.appendChild(iconEl);
      }

      const label = document.createElement('span');
      label.textContent = item.label ?? '';
      label.style.cssText = 'flex:1;';
      row.appendChild(label);

      row.addEventListener('mouseenter', () => {
        row.style.background = 'var(--bg-hover,rgba(0,0,0,0.06))';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = '';
      });
      row.addEventListener('click', () => {
        this.hide();
        item.action?.();
      });

      this.menuEl.appendChild(row);
    }

    document.body.appendChild(this.menuEl);
    this._isVisible = true;

    this.positionMenu(x, y);

    const closeHandler = (e: Event) => {
      if (this.menuEl && !this.menuEl.contains(e.target as Node)) {
        this.hide();
        document.removeEventListener('mousedown', closeHandler);
        document.removeEventListener('contextmenu', closeHandler);
      }
    };
    setTimeout(() => {
      document.addEventListener('mousedown', closeHandler);
      document.addEventListener('contextmenu', closeHandler);
    }, 0);
  }

  hide(): void {
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
    this._isVisible = false;
  }

  private positionMenu(x: number, y: number): void {
    if (!this.menuEl) return;
    const rect = this.menuEl.getBoundingClientRect();
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    let posX = x;
    let posY = y;

    if (x + rect.width > viewW) posX = viewW - rect.width - 4;
    if (y + rect.height > viewH) posY = viewH - rect.height - 4;
    if (posX < 0) posX = 4;
    if (posY < 0) posY = 4;

    this.menuEl.style.left = `${posX}px`;
    this.menuEl.style.top = `${posY}px`;
  }

  dispose(): void {
    this.hide();
  }
}

export { ContextMenu };
export type { IContextMenu, ContextMenuItem };
