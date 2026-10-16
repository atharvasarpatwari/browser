/**
 * @file src/browser/networking/cookie-service.ts
 *
 * Wires CookieJar into the engine:
 *  - CookieService: the persistent normal-browsing jar (localStorage) plus a
 *    throwaway jar per incognito session.
 *  - CookieAwareHttpClient: attaches/stores cookies on every IHttpClient.send(),
 *    i.e. every hop of ResourceLoader's redirect loop (login 302s keep their cookies).
 *  - The ScriptCookieProvider registry `document.cookie` reads through. On Android
 *    the native HttpURLConnection layer owns cookies, so main.ts registers a
 *    provider backed by the NovaCookies bridge there instead.
 */

import { CookieJar } from './cookie-jar';
import type { HttpRequestSpec, HttpResponseSpec, IHttpClient } from './request-manager';

/** What `document.cookie` reads and writes. HttpOnly cookies never cross this boundary. */
interface ScriptCookieProvider {
  get(url: string): string;
  set(url: string, cookieString: string): void;
}

/** Minimal Storage surface (window.localStorage in the app, a fake in tests). */
type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

const STORAGE_KEY = 'nova-cookie-jar';
const SAVE_DEBOUNCE_MS = 500;

class CookieService implements ScriptCookieProvider {
  private readonly normal: CookieJar;
  private privateJar: CookieJar | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly storage?: KeyValueStorage) {
    this.normal = new CookieJar(() => this.scheduleSave());
    try {
      const saved = storage?.getItem(STORAGE_KEY);
      if (saved) this.normal.restore(saved);
    } catch { /* storage unavailable: start empty */ }
  }

  /** The jar for the current session: incognito gets its own, never persisted. */
  get jar(): CookieJar {
    return this.privateJar ?? this.normal;
  }

  /** Each incognito session starts empty and is discarded on exit. */
  setIncognito(enabled: boolean): void {
    if (enabled === (this.privateJar !== null)) return;
    this.privateJar = enabled ? new CookieJar() : null;
  }

  get(url: string): string {
    return this.jar.getScriptCookieString(url);
  }

  set(url: string, cookieString: string): void {
    this.jar.setFromScript(url, cookieString);
  }

  /** Writes the normal jar now (session cookies are never written). */
  flush(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    try { this.storage?.setItem(STORAGE_KEY, this.normal.serialize()); } catch { /* quota / unavailable */ }
  }

  private scheduleSave(): void {
    if (!this.storage || this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush(); }, SAVE_DEBOUNCE_MS);
  }
}

/** IHttpClient decorator: Cookie on the way out, Set-Cookie on the way back, per hop. */
class CookieAwareHttpClient implements IHttpClient {
  constructor(private readonly inner: IHttpClient, private readonly cookies: CookieService) {}

  async send(request: HttpRequestSpec, signal: AbortSignal): Promise<HttpResponseSpec> {
    // ponytail: no SameSite enforcement (the client layer doesn't know the initiating
    // site); pass the initiator through HttpRequestSpec to add it.
    const jar = this.cookies.jar;
    let outgoing = request;
    const hasCookie = [...request.headers.keys()].some((k) => k.toLowerCase() === 'cookie');
    const header = hasCookie ? '' : jar.getCookieHeader(request.url);
    if (header) {
      const headers = new Map(request.headers);
      headers.set('cookie', header);
      outgoing = { ...request, headers };
    }
    const res = await this.inner.send(outgoing, signal);
    const setCookies = res.setCookies ?? (res.headers.has('set-cookie') ? [res.headers.get('set-cookie')!] : []);
    if (setCookies.length > 0) jar.setFromResponse(request.url, setCookies);
    return res;
  }
}

// ── document.cookie provider registry ───────────────────────────────────────

let scriptCookieProvider: ScriptCookieProvider | null = null;
let activeCookieService: CookieService | null = null;

function setScriptCookieProvider(provider: ScriptCookieProvider | null): void {
  scriptCookieProvider = provider;
}

function getScriptCookieProvider(): ScriptCookieProvider | null {
  return scriptCookieProvider;
}

/** The engine-side service (desktop / plain browser); null on Android, where native owns cookies. */
function setActiveCookieService(service: CookieService | null): void {
  activeCookieService = service;
}

/** Called when the browser enters/leaves incognito. Android handles this natively. */
function setCookieIncognito(enabled: boolean): void {
  activeCookieService?.setIncognito(enabled);
}

export {
  CookieService,
  CookieAwareHttpClient,
  setScriptCookieProvider,
  getScriptCookieProvider,
  setActiveCookieService,
  setCookieIncognito,
};
export type { ScriptCookieProvider, KeyValueStorage };
