import type { IDisposable } from '../../../app/dependency-container';
import type { OmniboxResult } from '../../../browser/omnibox/omnibox';
import type { IAddressBar, AddressBarState, AddressBarEventUnion } from './address-bar';
import { appendHighlighted, appendRanges } from '../highlight';

/** How a result was chosen: Alt+Enter, Ctrl/Cmd+click and middle-click ask for a new tab. */
interface ActivationOptions {
  readonly newTab: boolean;
}

type ResultHandler = (result: OmniboxResult, how: ActivationOptions) => void;

/** What the typed text was recognised as, shown at the left of the input while typing. */
interface QueryBadge {
  readonly kind: 'url' | 'bang' | 'scope' | 'ai' | 'command' | 'calc' | 'search';
  /** A glyph, or pill text such as `!w` / `@tabs`. */
  readonly text: string;
  readonly title: string;
}

/**
 * A one-click offer in the address bar's action area, e.g. "＋ Add Wikipedia". Without `onAccept` it is a
 * status chip (the offer was taken: "Adding…", "Added · !wiki", "Couldn't add").
 */
interface AddressBarOffer {
  readonly label: string;
  readonly title: string;
  readonly state?: 'busy' | 'done' | 'failed';
  readonly onAccept?: () => void;
}

/** The buttons on a dropdown row: copy its link, or remove a history entry. */
type RowAction = 'copy' | 'delete';
type RowActionHandler = (action: RowAction, row: OmniboxResult) => void;

/** A history row that carries the id needed to delete it. */
const isDeletable = (row: OmniboxResult): boolean => row.type === 'history' && typeof row.meta?.historyId === 'string';

/** Rows that stand for a page, so "copy link" makes sense (a search row's URL is just a generated query). */
const COPYABLE_TYPES: ReadonlySet<OmniboxResult['type']> = new Set(['history', 'bookmark', 'tab', 'url', 'archive']);

/**
 * Called on Enter before the legacy "treat the text as a URL or search" path. Return true when the
 * submission was handled (the legacy path is then skipped). `selected` is the row the user arrowed to.
 */
type SubmitInterceptor = (value: string, selected: OmniboxResult | null, how: ActivationOptions) => boolean;

interface AddressBarViewConfig {
  readonly containerId: string;
  readonly showRefreshButton: boolean;
  readonly showSecurityIcon: boolean;
  readonly maxSuggestions: number;
}

const DEFAULT_VIEW_CONFIG: AddressBarViewConfig = {
  containerId: 'address-bar',
  showRefreshButton: true,
  showSecurityIcon: true,
  maxSuggestions: 8,
};

const ICON_LOCKED =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="7" width="9" height="6" rx="2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
const ICON_UNLOCKED =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="7" width="9" height="6" rx="2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0"/></svg>';
const ICON_RELOAD =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13 2.2v3.3h-3.3"/></svg>';
const ICON_SEARCH =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>';

interface IAddressBarView extends IDisposable {
  readonly element: HTMLElement | null;
  attach(container: HTMLElement): void;
  detach(): void;
  update(state: AddressBarState): void;
  setEventHandler(handler: (event: AddressBarEventUnion) => void): void;
  setResultHandler(handler: ResultHandler): void;
  setSubmitInterceptor(interceptor: SubmitInterceptor): void;
  setRowActionHandler(handler: RowActionHandler): void;
  /** Shows (or, with null, hides) the query-type badge in front of the input. */
  setQueryBadge(badge: QueryBadge | null): void;
  /** Shows, updates or (with null) removes the offer chip next to the reload button. */
  setOffer(offer: AddressBarOffer | null): void;
  /** Replaces the input text as if typed (focuses it and refreshes suggestions). */
  fill(text: string): void;
  setNavigationCallbacks(callbacks: {
    onBack?: () => void;
    onForward?: () => void;
    onReload?: () => void;
    onStop?: () => void;
  }): void;
  focus(): void;
  blur(): void;
  selectAll(): void;
}

// Dropdown section headers, shown when the rows span more than one section.
const GROUP_LABEL: Readonly<Record<OmniboxResult['type'], string>> = {
  search: 'Suggestions', suggestion: 'Suggestions', engine: 'Suggestions',
  tab: 'Open tabs', bookmark: 'Bookmarks & history', history: 'Bookmarks & history', url: 'Go to',
  answer: 'Instant answer', archive: 'Personal archive', action: 'Commands', ai: 'Ask Nova AI',
};

const DEFAULT_ICON: Readonly<Record<OmniboxResult['type'], string>> = {
  search: '🔍', suggestion: '🔍', engine: '🔎', tab: '🗂️', bookmark: '⭐', history: '🕘', url: '🌐',
  answer: '🧮', archive: '🗃️', action: '⚡', ai: '✨',
};

/** What arrowing onto / Tab-completing a row puts in the input; null keeps the typed text. */
function fillTextOf(r: OmniboxResult): string | null {
  switch (r.type) {
    case 'search': case 'suggestion': return r.text;
    case 'url': case 'history': case 'bookmark': case 'tab': case 'archive': return r.url ?? r.text;
    case 'engine': return `${r.text} `;
    default: return null;
  }
}

/** Rows grouped by section, sections ordered by their best-ranked row, order within a section preserved. */
function groupResults(results: readonly OmniboxResult[]): Array<{ label: string; rows: OmniboxResult[] }> {
  const groups = new Map<string, OmniboxResult[]>();
  for (const r of results) {
    const label = GROUP_LABEL[r.type];
    const rows = groups.get(label);
    if (rows) rows.push(r);
    else groups.set(label, [r]);
  }
  return [...groups].map(([label, rows]) => ({ label, rows }));
}

class AddressBarView implements IAddressBarView {
  private readonly config: AddressBarViewConfig;
  private readonly model: IAddressBar;
  private container: HTMLElement | null = null;
  private inputElement: HTMLInputElement | null = null;
  private securityIcon: HTMLElement | null = null;
  private badgeElement: HTMLElement | null = null;
  private actionsElement: HTMLElement | null = null;
  private offerElement: HTMLButtonElement | null = null;
  private offerHandler: (() => void) | null = null;
  private suggestionsContainer: HTMLElement | null = null;
  private refreshButton: HTMLElement | null = null;
  private eventHandler: ((event: AddressBarEventUnion) => void) | null = null;
  private resultHandler: ResultHandler | null = null;
  private rowActionHandler: RowActionHandler | null = null;
  private submitInterceptor: SubmitInterceptor | null = null;
  /** Rich rows in display (flattened, grouped) order — index-aligned with the rows' DOM. */
  private rows: OmniboxResult[] = [];
  /** What the user typed, so arrowing past a non-filling row can restore it. */
  private typedValue = '';
  private legacyShown = false;
  private boundResultsHandler: ((e: AddressBarEventUnion) => void) | null = null;
  private navCallbacks: {
    onBack?: () => void;
    onForward?: () => void;
    onReload?: () => void;
    onStop?: () => void;
  } = {};
  private selectedSuggestionIndex = -1;
  private previousValue = '';
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private boundGlobalKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(model: IAddressBar, config?: Partial<AddressBarViewConfig>) {
    this.model = model;
    this.config = { ...DEFAULT_VIEW_CONFIG, ...config };
  }

  get element(): HTMLElement | null {
    return this.container;
  }

  attach(container: HTMLElement): void {
    this.container = container;
    this.build();
    this.installGlobalShortcuts();
    this.boundResultsHandler = (e) => {
      if (e.kind === 'resultsChanged') this.renderResults((e as { readonly results: readonly OmniboxResult[] }).results);
    };
    this.model.on('resultsChanged', this.boundResultsHandler);
  }

  detach(): void {
    this.uninstallGlobalShortcuts();
    if (this.boundResultsHandler) {
      this.model.off('resultsChanged', this.boundResultsHandler);
      this.boundResultsHandler = null;
    }
    this.rows = [];
    this.legacyShown = false;
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
    this.inputElement = null;
    this.securityIcon = null;
    this.badgeElement = null;
    this.actionsElement = null;
    this.offerElement = null;
    this.offerHandler = null;
    this.suggestionsContainer = null;
    this.refreshButton = null;
    this.boundKeyHandler = null;
    this.boundGlobalKeyHandler = null;
  }

  update(state: AddressBarState): void {
    if (!this.inputElement) return;

    if (document.activeElement !== this.inputElement) {
      this.inputElement.value = state.value;
    }

    if (this.securityIcon) {
      this.securityIcon.className = state.secure ? 'nova-security secure' : 'nova-security warn';
      this.securityIcon.innerHTML = state.secure ? ICON_LOCKED : ICON_UNLOCKED;
    }

    // Legacy string suggestions only. Rich rows are event-driven (`resultsChanged`), so an unrelated
    // chrome refresh must not hide or re-render a dropdown the user is arrowing through.
    if (state.suggestions.length > 0 || this.legacyShown) this.renderSuggestions(state.suggestions);
  }

  setEventHandler(handler: (event: AddressBarEventUnion) => void): void {
    this.eventHandler = handler;
  }

  setResultHandler(handler: ResultHandler): void {
    this.resultHandler = handler;
  }

  setSubmitInterceptor(interceptor: SubmitInterceptor): void {
    this.submitInterceptor = interceptor;
  }

  setRowActionHandler(handler: RowActionHandler): void {
    this.rowActionHandler = handler;
  }

  setQueryBadge(badge: QueryBadge | null): void {
    const el = this.badgeElement;
    if (!el) return;
    el.hidden = !badge;
    el.dataset.kind = badge?.kind ?? '';
    el.textContent = badge?.text ?? '';
    el.title = badge?.title ?? '';
    this.container?.classList.toggle('has-badge', badge !== null); // the badge takes the lock icon's place
  }

  setOffer(offer: AddressBarOffer | null): void {
    if (!offer) {
      this.offerElement?.remove();
      this.offerElement = null;
      this.offerHandler = null;
      return;
    }
    const actions = this.actionsElement;
    if (!actions) return;
    let el = this.offerElement;
    if (!el) {
      el = document.createElement('button');
      el.type = 'button';
      el.className = 'nova-addressbar-offer';
      el.addEventListener('mousedown', (e: MouseEvent) => e.preventDefault()); // keep focus where it is
      el.addEventListener('click', () => this.offerHandler?.());
      actions.prepend(el);
      this.offerElement = el;
    }
    el.textContent = offer.label;
    el.title = offer.title;
    el.dataset.state = offer.state ?? 'idle';
    el.disabled = !offer.onAccept;
    this.offerHandler = offer.onAccept ?? null;
  }

  fill(text: string): void {
    if (!this.inputElement) return;
    this.inputElement.value = text;
    this.typedValue = text;
    this.selectedSuggestionIndex = -1;
    this.inputElement.focus();
    this.model.setDraft(text);
  }

  setNavigationCallbacks(callbacks: {
    onBack?: () => void;
    onForward?: () => void;
    onReload?: () => void;
    onStop?: () => void;
  }): void {
    this.navCallbacks = callbacks;
  }

  focus(): void {
    this.inputElement?.focus();
    this.selectAll();
  }

  blur(): void {
    this.inputElement?.blur();
    this.hideSuggestions();
  }

  selectAll(): void {
    this.inputElement?.select();
  }

  // ── Private: build ────────────────────────────────────────────────────────

  private build(): void {
    if (!this.container) return;

    this.container.innerHTML = '';

    if (this.config.showSecurityIcon) {
      this.securityIcon = document.createElement('span');
      this.securityIcon.className = 'nova-security';
      this.securityIcon.innerHTML = ICON_UNLOCKED;
      this.securityIcon.title = 'Connection security';
      this.container.appendChild(this.securityIcon);
    }

    this.badgeElement = document.createElement('span');
    this.badgeElement.className = 'nova-addressbar-badge';
    this.badgeElement.hidden = true;
    this.container.appendChild(this.badgeElement);

    this.inputElement = document.createElement('input');
    this.inputElement.type = 'text';
    this.inputElement.className = 'nova-addressbar-input';
    this.inputElement.placeholder = 'Search or enter URL';
    this.inputElement.autocomplete = 'off';
    this.inputElement.spellcheck = false;
    this.inputElement.setAttribute('role', 'combobox');
    this.inputElement.setAttribute('aria-expanded', 'false');
    this.inputElement.setAttribute('aria-autocomplete', 'list');
    this.inputElement.setAttribute('aria-controls', 'address-bar-suggestions');

    this.boundKeyHandler = (e: KeyboardEvent) => this.handleKeyDown(e);
    this.inputElement.addEventListener('keydown', this.boundKeyHandler);

    this.inputElement.addEventListener('focus', () => {
      this.previousValue = this.inputElement?.value ?? '';
      this.typedValue = this.previousValue;
      this.container?.classList.add('focused');
      this.selectAll();
    });

    this.inputElement.addEventListener('blur', () => {
      this.container?.classList.remove('focused');
      this.setQueryBadge(null); // Enter, Escape and choosing a row all end in a blur
      // Delay to allow suggestion click to register.
      setTimeout(() => this.hideSuggestions(), 150);
    });

    this.inputElement.addEventListener('input', () => {
      this.selectedSuggestionIndex = -1;
      this.typedValue = this.inputElement?.value ?? '';
      this.model.setDraft(this.typedValue);
    });

    this.container.appendChild(this.inputElement);

    const actions = document.createElement('div');
    actions.className = 'nova-addressbar-actions';
    this.actionsElement = actions;

    if (this.config.showRefreshButton) {
      this.refreshButton = document.createElement('button');
      this.refreshButton.setAttribute('type', 'button');
      this.refreshButton.className = 'nova-addrbar-btn';
      this.refreshButton.innerHTML = ICON_RELOAD;
      this.refreshButton.title = 'Reload current page';
      this.refreshButton.addEventListener('click', () => {
        this.dispatchEvent({ kind: 'reload' });
      });
      actions.appendChild(this.refreshButton);
    }

    this.container.appendChild(actions);

    this.suggestionsContainer = document.createElement('div');
    this.suggestionsContainer.className = 'nova-dropdown';
    this.suggestionsContainer.id = 'address-bar-suggestions';
    this.suggestionsContainer.style.display = 'none';
    this.suggestionsContainer.setAttribute('role', 'listbox');
    this.container.appendChild(this.suggestionsContainer);
  }

  // ── Private: keyboard handling ────────────────────────────────────────────

  private handleKeyDown(e: KeyboardEvent): void {
    const input = this.inputElement;
    if (!input) return;

    switch (e.key) {
      case 'Enter': {
        e.preventDefault();
        const value = input.value.trim();
        if (value) {
          const selected = this.selectedRow();
          if (selected?.action === 'fill') { // a completion row (!g, @tabs): keep typing instead of submitting
            this.fill(fillTextOf(selected) ?? selected.text);
            break;
          }
          const handled = this.submitInterceptor?.(value, selected, { newTab: e.altKey }) ?? false;
          if (!handled) this.model.setValue(value);
          this.hideSuggestions();
          input.blur();
        }
        break;
      }

      case 'Escape': {
        e.preventDefault();
        // Restore previous value and blur.
        input.value = this.previousValue;
        input.blur();
        this.hideSuggestions();
        break;
      }

      case 'ArrowDown': {
        e.preventDefault();
        const items = this.suggestionsContainer?.querySelectorAll('.nova-dropdown-item');
        if (items && items.length > 0) {
          this.selectedSuggestionIndex = Math.min(
            this.selectedSuggestionIndex + 1,
            items.length - 1,
          );
          this.highlightSuggestion(items);
        }
        break;
      }

      case 'ArrowUp': {
        e.preventDefault();
        const items = this.suggestionsContainer?.querySelectorAll('.nova-dropdown-item');
        if (items && items.length > 0) {
          this.selectedSuggestionIndex = Math.max(this.selectedSuggestionIndex - 1, -1);
          if (this.selectedSuggestionIndex === -1) {
            input.value = this.typedValue;
          }
          this.highlightSuggestion(items);
        }
        break;
      }

      case 'Tab': {
        // Rich rows: complete the input with the highlighted row (or the top row, when it offers a
        // completion such as `!g `) and keep typing — Tab never navigates.
        if (this.rows.length > 0) {
          const target = this.selectedSuggestionIndex >= 0 ? this.rows[this.selectedSuggestionIndex] : this.rows[0];
          const fill = target ? fillTextOf(target) : null;
          if (target && fill !== null && (this.selectedSuggestionIndex >= 0 || target.type === 'engine')) {
            e.preventDefault();
            input.value = fill;
            this.typedValue = fill;
            this.model.setDraft(fill);
          }
          break;
        }
        // Legacy string suggestions: accept the selected one.
        if (this.selectedSuggestionIndex >= 0) {
          const items = this.suggestionsContainer?.querySelectorAll('.nova-dropdown-item');
          const selected = items?.[this.selectedSuggestionIndex];
          if (selected) {
            e.preventDefault();
            const text = selected.textContent ?? '';
            input.value = text;
            this.model.setValue(text);
            input.blur();
            this.hideSuggestions();
          }
        }
        break;
      }

      case 'Delete': {
        // Shift+Delete on a highlighted history row removes that entry (the Chrome convention).
        const selected = this.selectedRow();
        if (e.shiftKey && selected && isDeletable(selected)) {
          e.preventDefault();
          input.value = this.typedValue; // the removed row's preview must not linger in the input
          this.rowActionHandler?.('delete', selected);
        }
        break;
      }

      case 'l':
      case 'L': {
        // Ctrl+L / Cmd+L: select all (handled here for focus context).
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.selectAll();
        }
        break;
      }
    }
  }

  private highlightSuggestion(items: NodeListOf<Element>): void {
    items.forEach((item, i) => {
      const el = item as HTMLElement;
      const selected = i === this.selectedSuggestionIndex;
      el.classList.toggle('nova-dropdown-item--selected', selected);
      el.setAttribute('aria-selected', selected ? 'true' : 'false');
      if (!selected || !this.inputElement) return;
      // Preview the selected row in the input. Rich rows say what to show (or nothing); legacy rows show their text.
      if (el.dataset.rich) {
        this.inputElement.value = el.dataset.fill ?? this.typedValue;
      } else {
        this.inputElement.value = el.textContent ?? '';
      }
      this.inputElement.setAttribute('aria-activedescendant', el.id);
      el.scrollIntoView?.({ block: 'nearest' });
    });
    if (this.selectedSuggestionIndex < 0) this.inputElement?.removeAttribute('aria-activedescendant');
  }

  private selectedRow(): OmniboxResult | null {
    return this.selectedSuggestionIndex >= 0 ? this.rows[this.selectedSuggestionIndex] ?? null : null;
  }

  // ── Private: global shortcuts ─────────────────────────────────────────────

  private installGlobalShortcuts(): void {
    this.boundGlobalKeyHandler = (e: KeyboardEvent) => {
      // Alt+Left: Go back.
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        this.navCallbacks.onBack?.();
        return;
      }
      // Alt+Right: Go forward.
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        this.navCallbacks.onForward?.();
        return;
      }
      // F5 / Ctrl+R: Reload.
      if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
        // Don't prevent default if the address bar is focused (let model handle it).
        if (document.activeElement !== this.inputElement) {
          e.preventDefault();
          this.navCallbacks.onReload?.();
        }
        return;
      }
      // Escape: Stop loading (when not focused on address bar).
      if (e.key === 'Escape' && document.activeElement !== this.inputElement) {
        this.navCallbacks.onStop?.();
        return;
      }
      // Ctrl+L / Cmd+L: Focus address bar from anywhere.
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        this.focus();
        return;
      }
    };
    document.addEventListener('keydown', this.boundGlobalKeyHandler);
  }

  private uninstallGlobalShortcuts(): void {
    if (this.boundGlobalKeyHandler) {
      document.removeEventListener('keydown', this.boundGlobalKeyHandler);
      this.boundGlobalKeyHandler = null;
    }
  }

  // ── Private: suggestions ──────────────────────────────────────────────────

  private renderSuggestions(suggestions: readonly string[]): void {
    if (!this.suggestionsContainer) return;

    const toShow = suggestions.slice(0, this.config.maxSuggestions);

    if (toShow.length === 0) {
      this.hideSuggestions();
      return;
    }

    this.suggestionsContainer.innerHTML = '';
    this.suggestionsContainer.style.display = 'block';
    this.inputElement?.setAttribute('aria-expanded', 'true');
    this.selectedSuggestionIndex = -1;
    this.rows = [];
    this.legacyShown = true;

    for (let i = 0; i < toShow.length; i++) {
      const suggestion = toShow[i]!;
      const item = document.createElement('div');
      item.className = 'nova-dropdown-item';
      item.textContent = suggestion;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      item.addEventListener('mousedown', (e: Event) => {
        e.preventDefault();
        this.model.setValue(suggestion);
        this.inputElement?.blur();
      });
      this.suggestionsContainer.appendChild(item);
    }
  }

  /** Renders the omnibox's rich rows: icon, highlighted title, description, hint, and section headers. */
  private renderResults(results: readonly OmniboxResult[]): void {
    const container = this.suggestionsContainer;
    if (!container) return;
    if (results.length === 0) {
      this.hideSuggestions();
      return;
    }

    const groups = groupResults(results.slice(0, this.config.maxSuggestions));
    this.rows = groups.flatMap((g) => g.rows);
    this.legacyShown = false;
    this.selectedSuggestionIndex = -1;
    this.inputElement?.removeAttribute('aria-activedescendant');

    const words = this.typedValue.toLowerCase().split(/\s+/).filter(Boolean);
    container.innerHTML = '';
    let index = 0;
    for (const group of groups) {
      if (groups.length > 1) {
        const header = document.createElement('div');
        header.className = 'nova-dropdown-header';
        header.setAttribute('role', 'presentation');
        header.textContent = group.label;
        container.appendChild(header);
      }
      for (const result of group.rows) container.appendChild(this.buildRow(result, index++, words));
    }
    container.style.display = 'block';
    this.inputElement?.setAttribute('aria-expanded', 'true');
  }

  private buildRow(result: OmniboxResult, index: number, words: readonly string[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'nova-dropdown-item nova-dropdown-item--rich';
    row.id = `address-bar-suggestion-${index}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.dataset.rich = '1';
    row.dataset.type = result.type;
    const fill = fillTextOf(result);
    if (fill !== null) row.dataset.fill = fill;

    const icon = document.createElement('span');
    icon.className = 'nova-dropdown-item__icon';
    const swatch = result.meta?.swatch;
    if (typeof swatch === 'string' && /^#[0-9a-f]{6}$/i.test(swatch)) {
      const chip = document.createElement('span');
      chip.className = 'nova-dropdown-swatch';
      chip.style.background = swatch;
      icon.appendChild(chip);
    } else {
      // Providers may carry an image URL in `icon`; only short (emoji/glyph) values are shown as text.
      icon.textContent = result.icon && result.icon.length <= 4 ? result.icon : DEFAULT_ICON[result.type];
    }
    row.appendChild(icon);

    const body = document.createElement('span');
    body.className = 'nova-dropdown-item__body';
    const title = document.createElement('span');
    title.className = 'nova-dropdown-item__text';
    // Instant answers and commands show their own text; everything else highlights what was typed.
    if (result.type === 'answer' || result.type === 'action' || result.type === 'ai') title.textContent = result.text;
    else appendHighlighted(title, result.text, words);
    body.appendChild(title);
    if (result.description && result.description !== result.text) {
      const desc = document.createElement('span');
      desc.className = 'nova-dropdown-item__desc';
      const ranges = result.meta?.highlights;
      if (result.type === 'archive' && Array.isArray(ranges)) appendRanges(desc, result.description, ranges as Array<[number, number]>);
      else desc.textContent = result.description;
      body.appendChild(desc);
    }
    row.appendChild(body);

    if (result.hint) {
      const hint = document.createElement('span');
      hint.className = 'nova-dropdown-item__hint';
      hint.textContent = result.hint;
      row.appendChild(hint);
    }

    const actions = this.buildRowActions(result);
    if (actions) row.appendChild(actions);

    // mousedown (not click) so the input's blur does not hide the row before it is chosen.
    row.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      this.activateRow(index, { newTab: e.button === 1 || e.ctrlKey || e.metaKey });
    });
    return row;
  }

  /** The hover buttons of a row (copy link, remove from history); null when the row offers none. */
  private buildRowActions(result: OmniboxResult): HTMLElement | null {
    if (!this.rowActionHandler) return null;
    const offered: Array<[RowAction, string, string]> = [];
    if (result.url && COPYABLE_TYPES.has(result.type)) offered.push(['copy', '⧉', 'Copy link']);
    if (isDeletable(result)) offered.push(['delete', '✕', 'Remove from history']);
    if (offered.length === 0) return null;

    const box = document.createElement('span');
    box.className = 'nova-dropdown-item__actions';
    for (const [action, glyph, label] of offered) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nova-dropdown-item__action';
      button.dataset.action = action;
      button.textContent = glyph;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.tabIndex = -1; // keyboard users have Shift+Delete; the input keeps focus
      // The row itself activates on mousedown, so the button must keep that (and the input's focus) to itself.
      button.addEventListener('mousedown', (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); });
      button.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        this.rowActionHandler?.(action, result);
        if (action === 'copy') { button.textContent = '✓'; button.title = 'Copied'; }
      });
      box.appendChild(button);
    }
    return box;
  }

  private activateRow(index: number, how: ActivationOptions): void {
    const result = this.rows[index];
    if (!result) return;
    if (result.action === 'fill') {
      this.fill(fillTextOf(result) ?? result.text);
      return;
    }
    this.hideSuggestions();
    this.inputElement?.blur();
    if (this.resultHandler) this.resultHandler(result, how);
    else this.model.setValue(result.url ?? result.text);
  }

  private hideSuggestions(): void {
    if (this.suggestionsContainer) {
      this.suggestionsContainer.style.display = 'none';
      this.suggestionsContainer.innerHTML = '';
    }
    this.selectedSuggestionIndex = -1;
    this.rows = [];
    this.legacyShown = false;
    this.inputElement?.setAttribute('aria-expanded', 'false');
    this.inputElement?.removeAttribute('aria-activedescendant');
  }

  // ── Private: dispatch ─────────────────────────────────────────────────────

  private dispatchEvent(event: AddressBarEventUnion): void {
    if (this.eventHandler) {
      this.eventHandler(event);
    }
  }

  // ── Dispose ────────────────────────────────────────────────────────────────

  dispose(): void {
    this.uninstallGlobalShortcuts();
    this.detach();
    this.eventHandler = null;
    this.navCallbacks = {};
  }
}

export { AddressBarView, DEFAULT_VIEW_CONFIG, fillTextOf, groupResults };
export type {
  IAddressBarView, AddressBarViewConfig, ActivationOptions, ResultHandler, SubmitInterceptor, QueryBadge, RowAction, RowActionHandler,
  AddressBarOffer,
};
