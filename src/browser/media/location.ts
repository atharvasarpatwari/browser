import type { IDisposable } from '../../app/dependency-container';

interface ILocationService extends IDisposable {
  href: string;
  readonly origin: string;
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  assign(url: string): void;
  replace(url: string): void;
  reload(): void;
  toString(): string;
  onEvent(handler: LocationEventHandler): () => void;
}

interface LocationEvent {
  readonly kind: LocationEventKind;
  readonly data?: Record<string, unknown>;
}

type LocationEventKind = 'navigate' | 'hashchange' | 'reload';
type LocationEventHandler = (event: LocationEvent) => void;

function parseUrl(url: string): URL {
  try { return new URL(url); } catch { return new URL(url, 'http://localhost'); }
}

class LocationService implements ILocationService {
  private _url: URL;
  private _handlers = new Set<LocationEventHandler>();

  constructor(url = 'http://localhost/') {
    this._url = parseUrl(url);
  }

  get href(): string { return this._url.href; }
  set href(value: string) {
    this.navigateTo(value);
  }

  get origin(): string { return this._url.origin; }
  get protocol(): string { return this._url.protocol; }
  set protocol(value: string) {
    this._url.protocol = value;
  }

  get host(): string { return this._url.host; }
  set host(value: string) {
    this._url.host = value;
  }

  get hostname(): string { return this._url.hostname; }
  set hostname(value: string) {
    this._url.hostname = value;
  }

  get port(): string { return this._url.port; }
  set port(value: string) {
    this._url.port = value;
  }

  get pathname(): string { return this._url.pathname; }
  set pathname(value: string) {
    this._url.pathname = value;
  }

  get search(): string { return this._url.search; }
  set search(value: string) {
    this._url.search = value;
    this.emit({ kind: 'hashchange', data: { search: this.search } });
  }

  get hash(): string { return this._url.hash; }
  set hash(value: string) {
    this._url.hash = value;
    this.emit({ kind: 'hashchange', data: { hash: this.hash } });
  }

  assign(url: string): void {
    this.navigateTo(url);
  }

  replace(url: string): void {
    this._url = parseUrl(url);
    this.emit({ kind: 'navigate', data: { url: this.href, replace: true } });
  }

  reload(): void {
    this.emit({ kind: 'reload', data: { url: this.href } });
  }

  toString(): string {
    return this._url.href;
  }

  private navigateTo(url: string): void {
    const old = this._url.href;
    this._url = parseUrl(url);
    if (this._url.hash !== parseUrl(old).hash) {
      this.emit({ kind: 'hashchange', data: { hash: this.hash } });
    }
    this.emit({ kind: 'navigate', data: { url: this.href } });
  }

  onEvent(handler: LocationEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: LocationEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
  }
}

export { LocationService };
export type { ILocationService, LocationEvent, LocationEventKind, LocationEventHandler };
