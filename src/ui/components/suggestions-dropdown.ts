import type { OmniboxResult } from '../../browser/omnibox/omnibox';

interface SuggestionsDropdownOptions {
  /** Rows for what was typed (the omnibox providers: archive, history, bookmarks, bangs, instant answers). */
  fetch(text: string): Promise<readonly OmniboxResult[]>;
  /** A row was chosen (click, or Enter on a highlighted row). */
  onPick(result: OmniboxResult, how: { readonly newTab: boolean }): void;
  /** Enter with no row highlighted. */
  onSubmit(text: string): void;
  readonly maxRows?: number;
  readonly debounceMs?: number;
}

/**
 * The suggestions list under a search box that is not the address bar (the home page and the results page), driven by the
 * same omnibox providers. Keyboard: Down/Up move, Enter picks or submits, Escape closes; a click picks (the row is
 * activated on mousedown so the input's blur does not close the list first). Late answers to older keystrokes are dropped.
 */
class SuggestionsDropdown {
  private list: HTMLUListElement | null = null;
  private rows: readonly OmniboxResult[] = [];
  private active = -1;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly input: HTMLInputElement, private readonly anchor: HTMLElement, private readonly options: SuggestionsDropdownOptions) {
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void): void => {
      el.addEventListener(type, fn as EventListener);
      this.cleanups.push(() => el.removeEventListener(type, fn as EventListener));
    };
    on(input, 'input', () => this.schedule());
    on(input, 'keydown', (e) => this.onKey(e));
    on(input, 'blur', () => { setTimeout(() => this.close(), 120); });
  }

  get isOpen(): boolean { return this.list !== null; }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.seq++;
    for (const off of this.cleanups) off();
    this.cleanups.length = 0;
    this.close();
  }

  close(): void {
    this.list?.remove();
    this.list = null;
    this.rows = [];
    this.active = -1;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    const text = this.input.value;
    if (!text.trim()) { this.seq++; this.close(); return; }
    this.timer = setTimeout(() => { void this.update(text); }, this.options.debounceMs ?? 60);
  }

  private async update(text: string): Promise<void> {
    const mine = ++this.seq;
    let found: readonly OmniboxResult[] = [];
    try { found = await this.options.fetch(text); } catch { found = []; }
    if (mine !== this.seq || this.input.value !== text) return; // an older answer
    this.show(found.slice(0, this.options.maxRows ?? 8));
  }

  private show(rows: readonly OmniboxResult[]): void {
    this.close();
    if (rows.length === 0) return;
    this.rows = rows;
    const ul = document.createElement('ul');
    ul.className = 'ns-suggest';
    ul.setAttribute('role', 'listbox');
    rows.forEach((row, i) => {
      const li = document.createElement('li');
      li.className = 'ns-suggest-row';
      li.setAttribute('role', 'option');
      const icon = document.createElement('span');
      icon.className = 'ns-suggest-icon';
      icon.textContent = row.icon ?? '🔍';
      const text = document.createElement('span');
      text.className = 'ns-suggest-text';
      text.textContent = row.text;
      const desc = document.createElement('span');
      desc.className = 'ns-suggest-desc';
      desc.textContent = row.hint ?? row.description;
      li.append(icon, text, desc);
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.pick(i, { newTab: e.ctrlKey || e.metaKey });
      });
      ul.appendChild(li);
    });
    this.anchor.appendChild(ul);
    this.list = ul;
  }

  private highlight(index: number): void {
    this.active = index;
    this.list?.querySelectorAll('.ns-suggest-row').forEach((li, i) => li.classList.toggle('ns-active', i === index));
  }

  private pick(index: number, how: { readonly newTab: boolean }): void {
    const row = this.rows[index];
    this.close();
    if (row) this.options.onPick(row, how);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' && this.list) { e.preventDefault(); this.highlight((this.active + 1) % this.rows.length); }
    else if (e.key === 'ArrowUp' && this.list) { e.preventDefault(); this.highlight((this.active - 1 + this.rows.length) % this.rows.length); }
    else if (e.key === 'Escape') this.close();
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.list && this.active >= 0) this.pick(this.active, { newTab: e.ctrlKey || e.metaKey });
      else { const text = this.input.value.trim(); this.close(); if (text) this.options.onSubmit(text); }
    }
  }
}

export { SuggestionsDropdown };
export type { SuggestionsDropdownOptions };
