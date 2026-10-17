import { detectInstantAnswer } from './instant-answers';

type QueryIntent =
  | 'DIRECT_URL'
  | 'BANG_SEARCH'
  | 'SCOPED_SEARCH'
  | 'BROWSER_ACTION'
  | 'CALCULATION_OR_CONVERSION'
  | 'GENERAL_SEARCH';

interface ClassifiedQuery {
  readonly intent: QueryIntent;
  readonly raw: string;
  /** The payload with any bang or scope prefix removed (what the target should search for). */
  readonly query: string;
  /** Bang keyword without the `!` (BANG_SEARCH only). */
  readonly bang?: string;
  /** Complete `@scope` token without the `@` (SCOPED_SEARCH only). */
  readonly scope?: string;
  /** True while the user is still typing the `@scope` token itself (e.g. `@ta`). */
  readonly scopeIncomplete?: boolean;
}

interface ClassifyOptions {
  /** Recognises bang keywords. Without it, `!foo` is just text. */
  readonly isBang?: (keyword: string) => boolean;
  /** Valid `@scope` names. */
  readonly scopes?: readonly string[];
  /** Exact (lower-cased, single-spaced) browser command phrases. */
  readonly actionPhrases?: ReadonlySet<string>;
}

const DEFAULT_SCOPES: readonly string[] = ['tabs', 'history', 'bookmarks', 'archive', 'ai', 'research'];

// ponytail: static TLD allow-list (not the full public-suffix list). Omits TLDs that collide with
// common file extensions (py rs md sh so zip mov). Swap in a PSL lookup if misclassification shows up.
const KNOWN_TLDS: ReadonlySet<string> = new Set((
  'com org net edu gov mil int info biz name pro mobi io ai app dev co me tv xyz site online tech store ' +
  'blog cloud news page wiki shop club live link fun top vip one art design studio agency digital network ' +
  'systems solutions space website world today life email media group company center zone social team ' +
  'tools works chat run codes games bio ' +
  'ac ad ae af ag al am ao ar as at au az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ca cd cf ' +
  'cg ch ci ck cl cm cn cr cu cv cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fm fo fr ga gd ge gg ' +
  'gh gi gl gm gn gr gt gu gy hk hn hr ht hu id ie il im in iq ir is it je jm jo jp ke kg kh ki km kn kr ' +
  'kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc mg mk ml mm mn mo mq mr ms mt mu mv mw mx my mz na nc ' +
  'ne ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw qa re ro ru rw sa sb sc sd se sg ' +
  'si sk sl sm sn sr st su sv sy sz tc td tg th tj tk tl tm tn to tr tt tw tz ua ug uk us uy uz va vc ve ' +
  'vg vi vn vu ws ye za zm zw'
).split(' '));

const TAIL = String.raw`(?::\d{1,5})?(?:[/?#]\S*)?`;
const SCHEME_URL_RE = /^(?:https?|ftp|file|nova|wss?):\/\/\S+$/i;
const ABOUT_RE = /^about:[a-z0-9_\-/]+$/i;
const LOCALHOST_RE = new RegExp(`^localhost${TAIL}$`, 'i');
const IPV4_RE = new RegExp(String.raw`^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})${TAIL}$`);
const IPV6_RE = new RegExp(String.raw`^\[[0-9a-f:.]+\]${TAIL}$`, 'i');
const HOST_RE = new RegExp(String.raw`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24})${TAIL}$`, 'i');
const HOST_PORT_RE = /^[a-z][a-z0-9-]*:\d{2,5}(?:[/?#]\S*)?$/i;

function isDirectUrl(input: string): boolean {
  if (/\s/.test(input)) return false;
  if (SCHEME_URL_RE.test(input) || ABOUT_RE.test(input)) return true;
  if (LOCALHOST_RE.test(input) || IPV6_RE.test(input) || HOST_PORT_RE.test(input)) return true;

  const ip = IPV4_RE.exec(input);
  if (ip) return [ip[1], ip[2], ip[3], ip[4]].every((o) => Number(o) <= 255);

  const host = HOST_RE.exec(input);
  return host !== null && KNOWN_TLDS.has(host[1]!.toLowerCase());
}

const BANG_PREFIX_RE = /^!([a-z0-9]{1,12})(?:\s+(.*))?$/i;
const BANG_SUFFIX_RE = /^(.+?)\s+!([a-z0-9]{1,12})$/i;
const SCOPE_RE = /^@([a-z]+)(?:\s+(.*))?$/i;

/** Pure and synchronous (regex only) so it can run on every keystroke. */
function classifyQuery(input: string, options: ClassifyOptions = {}): ClassifiedQuery {
  const raw = input;
  const text = input.trim().replace(/\s+/g, ' ');
  const general = (): ClassifiedQuery => ({ intent: 'GENERAL_SEARCH', raw, query: text });
  if (!text) return general();

  const scopes = options.scopes ?? DEFAULT_SCOPES;
  const scoped = SCOPE_RE.exec(text);
  if (scoped) {
    const token = scoped[1]!.toLowerCase();
    if (scopes.includes(token)) {
      return { intent: 'SCOPED_SEARCH', raw, query: (scoped[2] ?? '').trim(), scope: token };
    }
    if (scoped[2] === undefined && scopes.some((s) => s.startsWith(token))) {
      return { intent: 'SCOPED_SEARCH', raw, query: '', scopeIncomplete: true };
    }
    return general();
  }
  if (text === '@') return { intent: 'SCOPED_SEARCH', raw, query: '', scopeIncomplete: true };

  const isBang = options.isBang;
  if (isBang) {
    const prefix = BANG_PREFIX_RE.exec(text);
    if (prefix && isBang(prefix[1]!.toLowerCase())) {
      return { intent: 'BANG_SEARCH', raw, query: (prefix[2] ?? '').trim(), bang: prefix[1]!.toLowerCase() };
    }
    const suffix = BANG_SUFFIX_RE.exec(text);
    if (suffix && isBang(suffix[2]!.toLowerCase())) {
      return { intent: 'BANG_SEARCH', raw, query: suffix[1]!.trim(), bang: suffix[2]!.toLowerCase() };
    }
  }

  if (isDirectUrl(text)) return { intent: 'DIRECT_URL', raw, query: text };
  if (detectInstantAnswer(text)) return { intent: 'CALCULATION_OR_CONVERSION', raw, query: text };
  if (options.actionPhrases?.has(text.toLowerCase())) return { intent: 'BROWSER_ACTION', raw, query: text };
  return general();
}

export { classifyQuery, isDirectUrl, DEFAULT_SCOPES, KNOWN_TLDS };
export type { QueryIntent, ClassifiedQuery, ClassifyOptions };
