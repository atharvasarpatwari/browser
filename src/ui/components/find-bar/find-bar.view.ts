import type { IDisposable } from '../../../app/dependency-container';
import type { FindEventKind, FindOptions, FindResult, IFindInPage } from '../../../browser/navigation-controls/find-in-page';

interface FindBarHooks {
  /**
   * Fired after every search/navigation/clear with the engine's latest state. `kind`: a new search (also a re-run
   * after a repaint), a step to another match, or the search ended.
   */
  onChange?(result: FindResult, kind: FindEventKind): void;
  onClose?(): void;
}

type ToggleKey = 'caseSensitive' | 'wholeWord' | 'regex';

const TOGGLES: ReadonlyArray<readonly [ToggleKey, string, string]> = [
  ['caseSensitive', 'Aa', 'Match case'],
  ['wholeWord', 'W', 'Whole word'],
  ['regex', '.*', 'Regular expression'],
];

/** The count shown next to the box: "3/12", "No results", "Invalid regex" or nothing. */
function describeResult(result: FindResult): string {
  if (result.error) return 'Invalid regex';
  if (!result.query) return '';
  if (result.total === 0) return 'No results';
  return `${result.activeIndex + 1}/${result.total}${result.truncated ? '+' : ''}`;
}

/** Ctrl/Cmd+F find bar over a find engine: Enter/Shift+Enter step through matches, Escape closes. */
class FindBarView implements IDisposable {
  private root: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private count: HTMLElement | null = null;
  private readonly options: Record<ToggleKey, boolean> = { caseSensitive: false, wholeWord: false, regex: false };
  private off: (() => void) | null = null;

  constructor(private readonly engine: IFindInPage, private readonly hooks: FindBarHooks = {}) {}

  get isOpen(): boolean { return this.root !== null && !this.root.hidden; }

  mount(parent: HTMLElement): void {
    const root = document.createElement('div');
    root.className = 'nova-find-bar';
    root.setAttribute('role', 'search');
    root.hidden = true;

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Find in page';
    input.setAttribute('aria-label', 'Find in page');
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('input', () => this.search());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) this.engine.findPrevious(); else this.engine.findNext(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });

    const count = document.createElement('span');
    count.className = 'nova-find-bar-count';
    count.setAttribute('aria-live', 'polite');

    root.append(input, count);
    root.append(this.iconButton('▲', 'Previous match (Shift+Enter)', () => this.engine.findPrevious()));
    root.append(this.iconButton('▼', 'Next match (Enter)', () => this.engine.findNext()));
    for (const [key, label, title] of TOGGLES) {
      const b = this.iconButton(label, title, () => {
        this.options[key] = !this.options[key];
        b.setAttribute('aria-pressed', String(this.options[key]));
        if (input.value.trim()) this.search();
      });
      b.classList.add('nova-find-toggle');
      b.setAttribute('aria-pressed', 'false');
      root.append(b);
    }
    root.append(this.iconButton('✕', 'Close (Esc)', () => this.close()));

    parent.appendChild(root);
    this.root = root;
    this.input = input;
    this.count = count;
    this.off = this.engine.onEvent((e) => {
      this.render(e.result);
      this.hooks.onChange?.(e.result, e.kind);
    });
  }

  /** Shows the bar, focuses and selects the box; a non-empty `prefill` (e.g. the selection) is searched immediately. */
  open(prefill?: string): void {
    if (!this.root || !this.input) return;
    this.root.hidden = false;
    if (prefill && prefill.trim()) this.input.value = prefill.trim();
    this.input.focus();
    this.input.select();
    if (this.input.value.trim()) this.search();
  }

  close(): void {
    if (!this.root || this.root.hidden) return;
    this.root.hidden = true;
    this.engine.clear();
    this.hooks.onClose?.();
  }

  /** Re-runs the current query against the page as it is now (after a repaint). */
  refresh(): void {
    if (this.isOpen && this.input?.value.trim()) this.engine.refresh();
  }

  dispose(): void {
    this.off?.();
    this.off = null;
    this.root?.remove();
    this.root = null;
    this.input = null;
    this.count = null;
  }

  private search(): void {
    if (!this.input) return;
    const opts: FindOptions = { ...this.options };
    const result = this.engine.find(this.input.value, opts);
    this.input.toggleAttribute('aria-invalid', Boolean(result.error));
  }

  private render(result: FindResult): void {
    if (this.count) {
      this.count.textContent = describeResult(result);
      this.count.classList.toggle('nova-find-bar-count--empty', result.total === 0 && Boolean(result.query));
    }
  }

  private iconButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nova-find-btn';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', onClick);
    return b;
  }
}

export { FindBarView, describeResult };
export type { FindBarHooks };
