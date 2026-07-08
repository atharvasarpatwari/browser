import type { IDisposable } from '../../../app/dependency-container';
import type { IUrlParser, ValidationResult } from '../../../browser/navigation/url-parser';
import { UrlParser } from '../../../browser/navigation/url-parser';

type AddressBarEventType =
  | 'navigate' | 'inputChanged' | 'focus' | 'blur'
  | 'search' | 'reload' | 'stop';

interface AddressBarEvent {
  readonly kind: AddressBarEventType;
}

interface NavigateEvent extends AddressBarEvent {
  readonly kind: 'navigate';
  readonly url: string;
}

interface InputChangedEvent extends AddressBarEvent {
  readonly kind: 'inputChanged';
  readonly value: string;
  readonly validation: ValidationResult;
}

interface SearchEvent extends AddressBarEvent {
  readonly kind: 'search';
  readonly query: string;
}

type AddressBarEventUnion =
  | NavigateEvent
  | InputChangedEvent
  | SearchEvent
  | AddressBarEvent;

interface AddressBarState {
  readonly value: string;
  readonly focused: boolean;
  readonly validation: ValidationResult;
  readonly loading: boolean;
  readonly secure: boolean;
  readonly hostname: string;
  readonly suggestions: readonly string[];
}

interface IAddressBar extends IDisposable {
  readonly state: AddressBarState;
  setValue(value: string): void;
  setLoading(loading: boolean): void;
  setSecure(secure: boolean): void;
  setSuggestions(suggestions: readonly string[]): void;
  focus(): void;
  blur(): void;
  clear(): void;
  on(type: AddressBarEventType, handler: (event: AddressBarEventUnion) => void): void;
  off(type: AddressBarEventType, handler: (event: AddressBarEventUnion) => void): void;
}

type AddressBarEventHandler = (event: AddressBarEventUnion) => void;

class AddressBarEventBus {
  private readonly channels = new Map<AddressBarEventType, Set<AddressBarEventHandler>>();

  on(type: AddressBarEventType, handler: AddressBarEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: AddressBarEventType, handler: AddressBarEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: AddressBarEventUnion): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[AddressBar] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

class AddressBar implements IAddressBar {
  private readonly parser: IUrlParser;
  private readonly bus = new AddressBarEventBus();

  private _value = '';
  private _focused = false;
  private _loading = false;
  private _secure = false;
  private _hostname = '';
  private _suggestions: readonly string[] = [];

  constructor(parser: IUrlParser = new UrlParser()) {
    this.parser = parser;
  }

  get state(): AddressBarState {
    return {
      value: this._value,
      focused: this._focused,
      validation: this.parser.validate(this._value),
      loading: this._loading,
      secure: this._secure,
      hostname: this._hostname,
      suggestions: [...this._suggestions],
    };
  }

  setValue(value: string): void {
    this._value = value;
    const validation = this.parser.validate(value);

    try {
      const parsed = this.parser.parse(value);
      this._hostname = parsed.hostname;
      this._secure = parsed.isSecure;
    } catch {
      this._hostname = '';
      this._secure = false;
    }

    this.bus.emit({ kind: 'inputChanged', value, validation });

    if (validation.valid && value.length > 0) {
      this.bus.emit({ kind: 'navigate', url: validation.normalized ?? value });
    }
  }

  setLoading(loading: boolean): void {
    this._loading = loading;
  }

  setSecure(secure: boolean): void {
    this._secure = secure;
  }

  setSuggestions(suggestions: readonly string[]): void {
    this._suggestions = suggestions;
  }

  focus(): void {
    this._focused = true;
    this.bus.emit({ kind: 'focus' });
  }

  blur(): void {
    this._focused = false;
    this.bus.emit({ kind: 'blur' });
  }

  clear(): void {
    this.setValue('');
    this._suggestions = [];
  }

  on(type: AddressBarEventType, handler: AddressBarEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: AddressBarEventType, handler: AddressBarEventHandler): void {
    this.bus.off(type, handler);
  }

  dispose(): void {
    this.bus.dispose();
    this._suggestions = [];
  }
}

export { AddressBar, AddressBarEventBus };
export type { IAddressBar, AddressBarState, AddressBarEventUnion, AddressBarEventType };
