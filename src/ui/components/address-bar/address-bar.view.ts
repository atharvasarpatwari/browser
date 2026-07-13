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
  }

  detach(): void {
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
    this.inputElement = null;
    this.securityIcon = null;
    this.suggestionsContainer = null;
    this.refreshButton = null;
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

  focus(): void {
    this.inputElement?.focus();
    this.selectAll();
  }

  blur(): void {
    this.inputElement?.blur();
  }

  selectAll(): void {
    this.inputElement?.select();
  }

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

    this.inputElement.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && this.inputElement) {
        const value = this.inputElement.value.trim();
        if (value) {
          this.model.setValue(value);
          this.inputElement.blur();
        }
      }
    });

    this.inputElement.addEventListener('focus', () => {
      this.selectAll();
    });

    this.inputElement.addEventListener('input', () => {
      if (this.inputElement) {
        // Real-time validation is handled by the model
      }
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
    this.suggestionsContainer.style.display = 'none';
    this.container.appendChild(this.suggestionsContainer);
  }

  private renderSuggestions(suggestions: readonly string[]): void {
    if (!this.suggestionsContainer) return;

    const toShow = suggestions.slice(0, this.config.maxSuggestions);

    if (toShow.length === 0) {
      this.suggestionsContainer.style.display = 'none';
      return;
    }

    this.suggestionsContainer.innerHTML = '';
    this.suggestionsContainer.style.display = 'block';

    for (const suggestion of toShow) {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.textContent = suggestion;
      item.addEventListener('mousedown', (e: Event) => {
        e.preventDefault();
        this.model.setValue(suggestion);
        this.inputElement?.blur();
      });
      this.suggestionsContainer.appendChild(item);
    }
  }

  private dispatchEvent(event: AddressBarEventUnion): void {
    if (this.eventHandler) {
      this.eventHandler(event);
    }
  }

  dispose(): void {
    this.detach();
    this.eventHandler = null;
  }
}

export { AddressBarView, DEFAULT_VIEW_CONFIG };
export type { IAddressBarView, AddressBarViewConfig };
