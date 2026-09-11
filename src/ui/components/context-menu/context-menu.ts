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
    this.menuEl.style.zIndex = '99999';

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'nova-context-menu-separator';
        this.menuEl.appendChild(sep);
        continue;
      }

      const row = document.createElement('button');
      row.className = `nova-context-menu-item${item.disabled ? ' nova-context-menu-item--disabled' : ''}`;

      if (item.icon) {
        const iconEl = document.createElement('span');
        iconEl.className = 'nova-context-menu-icon';
        iconEl.textContent = item.icon;
        row.appendChild(iconEl);
      }

      const label = document.createElement('span');
      label.textContent = item.label ?? '';
      row.appendChild(label);

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
