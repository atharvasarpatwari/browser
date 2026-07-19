import type { IDisposable } from '../../../app/dependency-container';
import type { IAddressBar, AddressBarState, AddressBarEventUnion } from './address-bar';

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
  maxSuggestions: 6,
};

interface IAddressBarView extends IDisposable {
  readonly element: HTMLElement | null;
  attach(container: HTMLElement): void;
  detach(): void;
  update(state: AddressBarState): void;
  setEventHandler(handler: (event: AddressBarEventUnion) => void): void;
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

class AddressBarView implements IAddressBarView {
  private readonly config: AddressBarViewConfig;
  private readonly model: IAddressBar;
  private container: HTMLElement | null = null;
  private inputElement: HTMLInputElement | null = null;
  private securityIcon: HTMLElement | null = null;
  private suggestionsContainer: HTMLElement | null = null;
  private refreshButton: HTMLElement | null = null;
  private eventHandler: ((event: AddressBarEventUnion) => void) | null = null;
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
  }

  detach(): void {
    this.uninstallGlobalShortcuts();
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
    this.inputElement = null;
    this.securityIcon = null;
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
      this.securityIcon.textContent = state.secure ? '🔒' : '🔓';
      this.securityIcon.className = state.secure ? 'secure' : 'insecure';
    }

    this.renderSuggestions(state.suggestions);
  }

  setEventHandler(handler: (event: AddressBarEventUnion) => void): void {
    this.eventHandler = handler;
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
    this.container.className = 'address-bar';

    const wrapper = document.createElement('div');
    wrapper.className = 'address-bar-inner';

    if (this.config.showSecurityIcon) {
      this.securityIcon = document.createElement('span');
      this.securityIcon.className = 'security-icon';
      this.securityIcon.textContent = '🔓';
      wrapper.appendChild(this.securityIcon);
    }

    this.inputElement = document.createElement('input');
    this.inputElement.type = 'text';
    this.inputElement.className = 'address-input';
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
      this.selectAll();
    });

    this.inputElement.addEventListener('blur', () => {
      // Delay to allow suggestion click to register.
      setTimeout(() => this.hideSuggestions(), 150);
    });

    this.inputElement.addEventListener('input', () => {
      this.selectedSuggestionIndex = -1;
    });

    wrapper.appendChild(this.inputElement);

    if (this.config.showRefreshButton) {
      this.refreshButton = document.createElement('button');
      this.refreshButton.className = 'refresh-button';
      this.refreshButton.textContent = '↻';
      this.refreshButton.title = 'Reload current page';
      this.refreshButton.addEventListener('click', () => {
        this.dispatchEvent({ kind: 'reload' });
      });
      wrapper.appendChild(this.refreshButton);
    }

    this.container.appendChild(wrapper);

    this.suggestionsContainer = document.createElement('div');
    this.suggestionsContainer.className = 'suggestions-dropdown';
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
          this.model.setValue(value);
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
        const items = this.suggestionsContainer?.querySelectorAll('.suggestion-item');
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
        const items = this.suggestionsContainer?.querySelectorAll('.suggestion-item');
        if (items && items.length > 0) {
          this.selectedSuggestionIndex = Math.max(this.selectedSuggestionIndex - 1, -1);
          if (this.selectedSuggestionIndex === -1) {
            input.value = this.previousValue;
          }
          this.highlightSuggestion(items);
        }
        break;
      }

      case 'Tab': {
        // Accept the selected suggestion on Tab.
        if (this.selectedSuggestionIndex >= 0) {
          const items = this.suggestionsContainer?.querySelectorAll('.suggestion-item');
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
      if (i === this.selectedSuggestionIndex) {
        el.style.background = 'var(--bg-overlay, rgba(255,255,255,0.08))';
        el.setAttribute('aria-selected', 'true');
        // Update input value to the selected suggestion.
        if (this.inputElement) {
          this.inputElement.value = el.textContent ?? '';
        }
      } else {
        el.style.background = '';
        el.setAttribute('aria-selected', 'false');
      }
    });
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

    for (let i = 0; i < toShow.length; i++) {
      const suggestion = toShow[i]!;
      const item = document.createElement('div');
      item.className = 'suggestion-item';
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

  private hideSuggestions(): void {
    if (this.suggestionsContainer) {
      this.suggestionsContainer.style.display = 'none';
      this.suggestionsContainer.innerHTML = '';
    }
    this.selectedSuggestionIndex = -1;
    this.inputElement?.setAttribute('aria-expanded', 'false');
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

export { AddressBarView, DEFAULT_VIEW_CONFIG };
export type { IAddressBarView, AddressBarViewConfig };
