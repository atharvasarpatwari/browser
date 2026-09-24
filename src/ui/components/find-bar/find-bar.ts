import type { IDisposable } from '../../../app/dependency-container';

interface IFindBar extends IDisposable {
  attach(container: HTMLElement): void;
  show(): void;
  hide(): void;
  isVisible(): boolean;
  focus(): void;
  /** Positions the bar (fixed, viewport coordinates) — e.g. top-right of the content area. */
  setPosition(top: number, right: number): void;
  setMatchCount(current: number, total: number): void;
  onQueryChange(handler: (query: string) => void): void;
  onNext(handler: () => void): void;
  onPrevious(handler: () => void): void;
  onClose(handler: () => void): void;
}

class FindBar implements IFindBar {
  private container: HTMLElement | null = null;
  private barEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private countEl: HTMLElement | null = null;
  private visible = false;

  private queryHandler: ((query: string) => void) | null = null;
  private nextHandler: (() => void) | null = null;
  private prevHandler: (() => void) | null = null;
  private closeHandler: (() => void) | null = null;

  attach(container: HTMLElement): void {
    this.container = container;
    this.build();
  }

  private build(): void {
    if (!this.container) return;

    const bar = document.createElement('div');
    bar.style.cssText = `
      position:fixed; top:8px; right:8px; z-index:500; display:none;
      align-items:center; gap:6px; background:#292a2d; color:#e8eaed;
      border:1px solid #3c4043; border-radius:6px; padding:6px 8px;
      font-family:system-ui,-apple-system,sans-serif; font-size:13px;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
    `.trim();

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Find in page';
    input.style.cssText = 'background:#202124; color:#e8eaed; border:1px solid #3c4043; border-radius:3px; padding:4px 8px; font-size:13px; width:160px; outline:none;';
    input.addEventListener('input', () => this.queryHandler?.(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) this.prevHandler?.();
        else this.nextHandler?.();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeHandler?.();
      }
    });

    const count = document.createElement('span');
    count.style.cssText = 'color:#9aa0a6; min-width:48px; text-align:center; font-variant-numeric:tabular-nums;';
    count.textContent = '0/0';

    const prevBtn = FindBar.makeButton('▲', 'Previous match');
    prevBtn.addEventListener('click', () => this.prevHandler?.());

    const nextBtn = FindBar.makeButton('▼', 'Next match');
    nextBtn.addEventListener('click', () => this.nextHandler?.());

    const closeBtn = FindBar.makeButton('✕', 'Close (Esc)');
    closeBtn.addEventListener('click', () => this.closeHandler?.());

    bar.append(input, count, prevBtn, nextBtn, closeBtn);
    this.container.appendChild(bar);

    this.barEl = bar;
    this.inputEl = input;
    this.countEl = count;
  }

  private static makeButton(text: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.title = title;
    btn.style.cssText = 'background:#3c4043; color:#e8eaed; border:none; border-radius:3px; padding:4px 8px; font-size:11px; cursor:pointer;';
    return btn;
  }

  show(): void {
    if (!this.barEl) return;
    this.barEl.style.display = 'flex';
    this.visible = true;
    this.focus();
  }

  hide(): void {
    if (!this.barEl) return;
    this.barEl.style.display = 'none';
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  setPosition(top: number, right: number): void {
    if (!this.barEl) return;
    this.barEl.style.top = `${top}px`;
    this.barEl.style.right = `${right}px`;
  }

  focus(): void {
    this.inputEl?.focus();
    this.inputEl?.select();
  }

  setMatchCount(current: number, total: number): void {
    if (this.countEl) this.countEl.textContent = total === 0 ? '0/0' : `${current + 1}/${total}`;
  }

  onQueryChange(handler: (query: string) => void): void {
    this.queryHandler = handler;
  }

  onNext(handler: () => void): void {
    this.nextHandler = handler;
  }

  onPrevious(handler: () => void): void {
    this.prevHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  dispose(): void {
    this.barEl?.remove();
    this.barEl = null;
    this.inputEl = null;
    this.countEl = null;
    this.container = null;
  }
}

export { FindBar, type IFindBar };
