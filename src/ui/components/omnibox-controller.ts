import type { IDisposable } from '../../app/dependency-container';
import type { IAddressBar, AddressBarEventUnion } from './address-bar/address-bar';
import { fillTextOf } from './address-bar/address-bar.view';
import type { ActivationOptions, ResultHandler, SubmitInterceptor } from './address-bar/address-bar.view';
import type { IOmnibox, OmniboxResult, OmniboxRoute } from '../../browser/omnibox/omnibox';
import { classifyQuery } from '../../browser/omnibox/query-classifier';
import type { ClassifiedQuery, QueryIntent } from '../../browser/omnibox/query-classifier';
import type { BangRegistry } from '../../browser/omnibox/bangs';
import { stripTrackingParams } from '../../browser/search/tracking-params';
import type { SpeculativeLoader } from '../../browser/search/speculative-loader';

/** What the omnibox can make the browser do. Implemented by the window that owns tabs and navigation. */
interface OmniboxActions {
  open(url: string, how: ActivationOptions): void;
  /** Plain-text search with the default engine. */
  search(query: string, how: ActivationOptions): void;
  switchTab(tabId: string): void;
  runAction(actionId: string): void;
  research(query: string): void;
  copy(text: string): void;
  /** Put `text` in the address bar as if typed. */
  fill(text: string): void;
}

interface OmniboxViewPort {
  setSubmitInterceptor(interceptor: SubmitInterceptor): void;
  setResultHandler(handler: ResultHandler): void;
}

interface OmniboxControllerDeps {
  readonly addressBar: Pick<IAddressBar, 'on' | 'off' | 'setResults'>;
  readonly view: OmniboxViewPort;
  readonly omnibox: IOmnibox;
  readonly bangs: Pick<BangRegistry, 'has' | 'get' | 'resolve'>;
  readonly actions: OmniboxActions;
  /** Typed text → URL (adds https://, resolves aliases). */
  normalizeUrl(raw: string): string;
  /** Command id for text that exactly names a browser command, else null. */
  resolveAction(text: string): string | null;
  /** Provider names that serve each `@scope`. */
  readonly scopeProviders: Readonly<Record<string, readonly string[]>>;
  /** Providers that only run for their own scope/keyword and never for ordinary typing. */
  readonly scopeOnlyProviders: readonly string[];
  readonly scopes?: readonly string[];
  readonly actionPhrases?: ReadonlySet<string>;
  readonly stripTracking?: () => boolean;
  readonly speculative?: Pick<SpeculativeLoader, 'consider'>;
  readonly maxResults?: number;
}

/** A history row's own (frecency × 10) score; only clearly frecent pages may hijack Enter. */
const STRONG_HISTORY_SCORE = 100;
const NAVIGATIONAL_RANK: Readonly<Partial<Record<OmniboxResult['type'], number>>> = { tab: 3, bookmark: 2, history: 1 };

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function startsWithTyped(r: OmniboxResult, typed: string): boolean {
  return hostOf(r.url ?? '').startsWith(typed) || r.text.toLowerCase().startsWith(typed);
}

/**
 * The row Enter should take when nothing is selected and the input is an ordinary query: a tab,
 * bookmark or frequently visited page whose title or host starts with what was typed. Otherwise null
 * (the caller then searches).
 */
function pickDefault(results: readonly OmniboxResult[], text: string, intent: QueryIntent): OmniboxResult | null {
  const typed = text.trim().toLowerCase();
  if (intent !== 'GENERAL_SEARCH' || typed.length < 2) return null;
  let best: OmniboxResult | null = null;
  for (const r of results) {
    const rank = NAVIGATIONAL_RANK[r.type];
    if (!rank || !r.url || !startsWithTyped(r, typed)) continue;
    if (r.type === 'history' && Number(r.meta?.rawScore ?? r.score) < STRONG_HISTORY_SCORE) continue;
    if (!best || rank > NAVIGATIONAL_RANK[best.type]! || (rank === NAVIGATIONAL_RANK[best.type] && r.score > best.score)) best = r;
  }
  return best;
}

/**
 * Final dropdown order. Rows arrive already on one scale (see `tiered`); the row Enter will take is
 * lifted just under the instant answer so what is highlighted first is what Enter does.
 */
function arrangeResults(results: readonly OmniboxResult[], text: string, intent: QueryIntent): OmniboxResult[] {
  const def = pickDefault(results, text, intent);
  return results.map((r) => (r === def ? { ...r, score: 99 } : r)).sort((a, b) => b.score - a.score);
}

/**
 * Connects the address bar to the omnibox: typing → classify → route → providers → rows, and Enter /
 * row activation → the right browser action. Stale results never reappear after a submission.
 */
class OmniboxController implements IDisposable {
  private readonly unsubscribe: Array<() => void> = [];
  private lastText = '';
  private lastIntent: QueryIntent = 'GENERAL_SEARCH';
  private lastRaw: readonly OmniboxResult[] = [];
  /** Set by a submission; keeps late provider results from re-opening the dropdown until the next keystroke. */
  private suppress = false;
  private readonly maxResults: number;

  constructor(private readonly deps: OmniboxControllerDeps) {
    this.maxResults = deps.maxResults ?? 8;

    const onTyping = (e: AddressBarEventUnion): void => { void this.update((e as { readonly value: string }).value); };
    deps.addressBar.on('typing', onTyping);
    this.unsubscribe.push(() => deps.addressBar.off('typing', onTyping));
    this.unsubscribe.push(deps.omnibox.onEvent((e) => {
      if (e.kind === 'resultsChanged') this.show(e.results ?? []);
    }));

    deps.view.setSubmitInterceptor((value, selected, how) => this.submit(value, selected, how));
    deps.view.setResultHandler((result, how) => this.activate(result, how));
  }

  /** Called on Enter. Returns false only for empty input (the legacy path then does nothing). */
  submit(value: string, selected: OmniboxResult | null, how: ActivationOptions): boolean {
    const text = value.trim();
    if (!text) return false;
    this.suppress = true;
    if (selected) { this.activate(selected, how); return true; }

    const c = this.classify(text);
    switch (c.intent) {
      case 'BANG_SEARCH': this.submitBang(c, how); break;
      case 'SCOPED_SEARCH': this.submitScoped(c, text, how); break;
      case 'DIRECT_URL': this.open(this.deps.normalizeUrl(c.query), how); break;
      case 'BROWSER_ACTION': {
        const id = this.deps.resolveAction(c.query);
        if (id) this.deps.actions.runAction(id);
        else this.deps.actions.search(text, how);
        break;
      }
      default: {
        const def = this.lastText === text ? pickDefault(this.lastRaw, text, c.intent) : null;
        if (def) this.activate(def, how);
        else this.deps.actions.search(text, how);
      }
    }
    return true;
  }

  /** Performs the action behind a chosen row. */
  activate(result: OmniboxResult, how: ActivationOptions): void {
    this.suppress = true;
    switch (result.action) {
      case 'navigate':
      case 'search':
        this.open(result.url ?? result.text, how);
        break;
      case 'switch-tab':
        if (result.id) this.deps.actions.switchTab(result.id);
        else if (result.url) this.open(result.url, how);
        break;
      case 'run-action':
        if (result.id) this.deps.actions.runAction(result.id);
        break;
      case 'research':
        this.deps.actions.research(String(result.meta?.query ?? result.text));
        break;
      case 'copy':
        this.deps.actions.copy(result.text);
        break;
      case 'fill':
        this.suppress = false;
        this.deps.actions.fill(fillTextOf(result) ?? result.text);
        break;
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
  }

  private classify(text: string): ClassifiedQuery {
    return classifyQuery(text, {
      isBang: (keyword) => this.deps.bangs.has(keyword),
      scopes: this.deps.scopes,
      actionPhrases: this.deps.actionPhrases,
    });
  }

  private async update(value: string): Promise<void> {
    this.suppress = false;
    const text = value.trim();
    if (!text) {
      this.lastText = '';
      await this.deps.omnibox.onInputChanged('', this.maxResults); // emits an empty list → hides the dropdown
      return;
    }
    const c = this.classify(text);
    this.lastText = text;
    this.lastIntent = c.intent;
    await this.deps.omnibox.onInputChanged(text, this.maxResults, this.routeFor(c));
  }

  private routeFor(c: ClassifiedQuery): OmniboxRoute {
    switch (c.intent) {
      case 'SCOPED_SEARCH':
        if (c.scope) return { providers: this.deps.scopeProviders[c.scope] ?? [], query: c.query };
        return { providers: ['scope-hints'] };
      case 'BANG_SEARCH':
        return { providers: ['bangs'] };
      default: {
        const scopeOnly = new Set(this.deps.scopeOnlyProviders);
        return { providers: this.deps.omnibox.getProviders().map((p) => p.name).filter((n) => !scopeOnly.has(n)) };
      }
    }
  }

  private show(raw: readonly OmniboxResult[]): void {
    if (this.suppress) return;
    this.lastRaw = raw;
    const arranged = arrangeResults(raw, this.lastText, this.lastIntent);
    this.deps.addressBar.setResults(arranged);
    this.deps.speculative?.consider(arranged[0]);
  }

  private open(url: string, how: ActivationOptions): void {
    const clean = this.deps.stripTracking?.() === false ? url : stripTrackingParams(url);
    this.deps.actions.open(clean, how);
  }

  private submitBang(c: ClassifiedQuery, how: ActivationOptions): void {
    const keyword = c.bang ?? '';
    if (c.query) {
      const url = this.deps.bangs.resolve(keyword, c.query);
      if (url) { this.open(url, how); return; }
    } else {
      // A bare `!yt` opens the site itself.
      const bang = this.deps.bangs.get(keyword);
      if (bang) {
        try { this.open(`${new URL(bang.url.replace(/\{[^}]*\}|%s/g, 'x')).origin}/`, how); return; } catch { /* fall through */ }
      }
    }
    this.deps.actions.search(c.raw.trim(), how);
  }

  private submitScoped(c: ClassifiedQuery, text: string, how: ActivationOptions): void {
    if (c.scope === 'ai' || c.scope === 'research') {
      if (c.query) this.deps.actions.research(c.query);
      return;
    }
    if (!c.scope) return; // still typing the @scope itself
    const providers = this.deps.scopeProviders[c.scope] ?? [];
    void this.deps.omnibox.onInputChanged(text, 1, { providers, query: c.query }).then((rows) => {
      if (rows[0]) this.activate(rows[0], how);
    });
  }
}

export { OmniboxController, pickDefault, arrangeResults, STRONG_HISTORY_SCORE };
export type { OmniboxActions, OmniboxControllerDeps, OmniboxViewPort };
