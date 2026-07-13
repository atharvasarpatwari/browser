/**
 * @file src/browser/rendering/html5-tokenizer.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Stage 1 of the HTML5 parsing pipeline: convert a raw HTML string into a
 * flat token stream using the WHATWG-specified state machine. This replaces
 * the previous regex-based tokenizer with a spec-compliant implementation
 * covering all tokenizer states defined in the HTML5 specification.
 *
 * State categories implemented:
 *   • Data / RCDATA / RAWTEXT / Script Data / PLAINTEXT
 *   • Tag open / end-tag open / tag name / self-closing start tag
 *   • Before/after attribute name, attribute value (double/single/unquoted)
 *   • Bogus comment, markup declaration open
 *   • Comment start / start-dash / comment / end-dash / end / end-bang
 *   • DOCTYPE (before name, name, public/system identifiers, bogus)
 *   • CDATA section
 *   • Character reference (named, numeric decimal, numeric hex)
 *   • Script data escaped / double-escaped states
 *   • Null character replacement (U+FFFD)
 *   • Per-state EOF handling
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      Html5Tokenizer is the public entry point.
 *  Encapsulation    All state fields and handlers are private.
 *  Single-Resp.     This file tokenizes HTML only — no tree building.
 *  Open / Closed    New entity references: add to NAMED_CHAR_REFS map.
 *  Dependency-Inv.  No project dependencies — pure state machine.
 */

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN TYPES
// ─────────────────────────────────────────────────────────────────────────────

type TokenKind =
  | 'doctype' | 'open' | 'close' | 'selfclose'
  | 'text' | 'comment' | 'cdata' | 'pi' | 'eof';

interface Token {
  kind:     TokenKind;
  tagName?: string;
  attrs?:   Map<string, string>;
  data?:    string;
  offset:   number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKENIZER STATES  (WHATWG §13.2.5)
// ─────────────────────────────────────────────────────────────────────────────

const enum S {
  // ── Data states ──────────────────────────────────────────────────
  DATA, RCDATA, RAWTEXT, SCRIPT_DATA, PLAINTEXT,

  // ── RCDATA end-tag detection ─────────────────────────────────────
  RCDATA_LT, RCDATA_END_TAG_OPEN, RCDATA_END_TAG_NAME,

  // ── RAWTEXT end-tag detection ────────────────────────────────────
  RAWTEXT_LT, RAWTEXT_END_TAG_OPEN, RAWTEXT_END_TAG_NAME,

  // ── Tag states ───────────────────────────────────────────────────
  TAG_OPEN, END_TAG_OPEN, TAG_NAME, SELF_CLOSING_START_TAG,

  // ── Attribute states ─────────────────────────────────────────────
  BEFORE_ATTR_NAME, ATTR_NAME, AFTER_ATTR_NAME,
  BEFORE_ATTR_VALUE,
  ATTR_VALUE_DQ, ATTR_VALUE_SQ, ATTR_VALUE_UQ,
  AFTER_ATTR_VALUE_QUOTED,

  // ── Markup declaration ───────────────────────────────────────────
  MARKUP_DECLARATION_OPEN,

  // ── Comment states ───────────────────────────────────────────────
  COMMENT_START, COMMENT_START_DASH, COMMENT,
  COMMENT_END_DASH, COMMENT_END, COMMENT_END_BANG,
  BOGUS_COMMENT,

  // ── DOCTYPE states ───────────────────────────────────────────────
  DOCTYPE, BEFORE_DOCTYPE_NAME, DOCTYPE_NAME, AFTER_DOCTYPE_NAME,
  AFTER_DOCTYPE_PUBLIC_KEYWORD, BEFORE_DOCTYPE_PUBLIC_ID,
  DOCTYPE_PUBLIC_ID_DQ, DOCTYPE_PUBLIC_ID_SQ,
  AFTER_DOCTYPE_PUBLIC_ID, BETWEEN_DOCTYPE_IDS,
  AFTER_DOCTYPE_SYSTEM_KEYWORD, BEFORE_DOCTYPE_SYSTEM_ID,
  DOCTYPE_SYSTEM_ID_DQ, DOCTYPE_SYSTEM_ID_SQ,
  AFTER_DOCTYPE_SYSTEM_ID, BOGUS_DOCTYPE,

  // ── CDATA ────────────────────────────────────────────────────────
  CDATA_SECTION,

  // ── Character reference ──────────────────────────────────────────
  CHAR_REF, NAMED_CHAR_REF,
  NUMERIC_CHAR_REF, HEX_CHAR_REF_START, DEC_CHAR_REF_START,
  HEX_CHAR_REF, DEC_CHAR_REF,

  // ── Script data states ───────────────────────────────────────────
  SCRIPT_LT, SCRIPT_END_TAG_OPEN, SCRIPT_END_TAG_NAME,
  SCRIPT_ESCAPE_START, SCRIPT_ESCAPE_START_DASH,
  SCRIPT_ESCAPED, SCRIPT_ESCAPED_DASH, SCRIPT_ESCAPED_DASH_DASH,
  SCRIPT_ESCAPED_LT, SCRIPT_ESCAPED_END_TAG_OPEN, SCRIPT_ESCAPED_END_TAG_NAME,
  SCRIPT_DOUBLE_ESCAPE_START, SCRIPT_DOUBLE_ESCAPED,
  SCRIPT_DOUBLE_ESCAPED_DASH, SCRIPT_DOUBLE_ESCAPED_DASH_DASH,
  SCRIPT_DOUBLE_ESCAPED_LT, SCRIPT_DOUBLE_ESCAPE_END,
}

// ─────────────────────────────────────────────────────────────────────────────
// NAMED CHARACTER REFERENCES  (WHATWG §13.6)
// Subset of the 2000+ spec entries — covers all mandatory references plus
// the most commonly encountered web entities.
// ─────────────────────────────────────────────────────────────────────────────

const NAMED_CHAR_REFS: ReadonlyMap<string, string> = new Map<string, string>([
  // ── XML predefined ───────────────────────────────────────────────
  ['AElig', '\u00C6'], ['AMP', '&'], ['Aacute', '\u00C1'],
  ['Acirc', '\u00C2'], ['Agrave', '\u00C0'], ['Aring', '\u00C5'],
  ['Atilde', '\u00C3'], ['Auml', '\u00C4'], ['COPY', '\u00A9'],
  ['Ccedil', '\u00C7'], ['ETH', '\u00D0'], ['Eacute', '\u00C9'],
  ['Ecirc', '\u00CA'], ['Egrave', '\u00C8'], ['Euml', '\u00CB'],
  ['GT', '>'], ['Iacute', '\u00CD'], ['Icirc', '\u00CE'],
  ['Igrave', '\u00CC'], ['Iuml', '\u00CF'], ['LT', '<'],
  ['Ntilde', '\u00D1'], ['Oacute', '\u00D3'], ['Ocirc', '\u00D4'],
  ['Ograve', '\u00D2'], ['Oslash', '\u00D8'], ['Otilde', '\u00D5'],
  ['Ouml', '\u00D6'], ['QUOT', '"'], ['REG', '\u00AE'],
  ['THORN', '\u00DE'], ['Uacute', '\u00DA'], ['Ucirc', '\u00DB'],
  ['Ugrave', '\u00D9'], ['Uuml', '\u00DC'], ['Yacute', '\u00DD'],
  ['aacute', '\u00E1'], ['acirc', '\u00E2'], ['acute', '\u00B4'],
  ['aelig', '\u00E6'], ['agrave', '\u00E0'], ['amp', '&'],
  ['aring', '\u00E5'], ['atilde', '\u00E3'], ['auml', '\u00E4'],
  ['brvbar', '\u00A6'], ['bull', '\u2022'], ['ccedil', '\u00E7'],
  ['cedil', '\u00B8'], ['cent', '\u00A2'], ['circ', '\u02C6'],
  ['copy', '\u00A9'], ['curren', '\u00A4'], ['darr', '\u2193'],
  ['deg', '\u00B0'], ['divide', '\u00F7'], ['eacute', '\u00E9'],
  ['ecirc', '\u00EA'], ['egrave', '\u00E8'], ['empty', '\u2205'],
  ['emsp', '\u2003'], ['ensp', '\u2002'], ['eth', '\u00F0'],
  ['euml', '\u00EB'], ['euro', '\u20AC'], ['frac12', '\u00BD'],
  ['frac14', '\u00BC'], ['frac34', '\u00BE'], ['gt', '>'],
  ['hellip', '\u2026'], ['iacute', '\u00ED'], ['icirc', '\u00EE'],
  ['iexcl', '\u00A1'], ['igrave', '\u00EC'], ['iquest', '\u00BF'],
  ['iuml', '\u00EF'], ['laquo', '\u00AB'], ['larr', '\u2190'],
  ['ldquo', '\u201C'], ['lowast', '\u00B7'], ['loz', '\u25CA'],
  ['lrm', '\u200E'], ['lsaquo', '\u2039'], ['lsquo', '\u2018'],
  ['lt', '<'], ['macr', '\u00AF'], ['mdash', '\u2014'],
  ['micro', '\u00B5'], ['middot', '\u00B7'], ['nbsp', '\u00A0'],
  ['ndash', '\u2013'], ['not', '\u00AC'], ['ntilde', '\u00F1'],
  ['oacute', '\u00F3'], ['ocirc', '\u00F4'], ['ograve', '\u00F2'],
  ['ordf', '\u00AA'], ['ordm', '\u00BA'], ['oslash', '\u00F8'],
  ['otilde', '\u00F5'], ['ouml', '\u00F6'], ['para', '\u00B6'],
  ['permil', '\u2030'], ['plusmn', '\u00B1'], ['pound', '\u00A3'],
  ['prime', '\u2032'], ['prod', '\u220F'], ['prop', '\u221D'],
  ['quot', '"'], ['rarr', '\u2192'], ['raquo', '\u00BB'],
  ['rdquo', '\u201D'], ['real', '\u211C'], ['reg', '\u00AE'],
  ['rlm', '\u200F'], ['rsaquo', '\u203A'], ['rsquo', '\u2019'],
  ['sbquo', '\u201A'], ['sect', '\u00A7'], ['shy', '\u00AD'],
  ['sigmaf', '\u00DF'], ['sim', '\u223C'], ['spades', '\u2660'],
  ['sub', '\u2282'], ['sup', '\u2283'], ['sup1', '\u00B9'],
  ['sup2', '\u00B2'], ['sup3', '\u00B3'], ['szlig', '\u00DF'],
  ['thinsp', '\u2009'], ['thorn', '\u00FE'], ['tilde', '\u02DC'],
  ['times', '\u00D7'], ['trade', '\u2122'], ['uarr', '\u2191'],
  ['uacute', '\u00FA'], ['ucirc', '\u00FB'], ['ugrave', '\u00F9'],
  ['uml', '\u00A8'], ['uuml', '\u00FC'], ['weierp', '\u2118'],
  ['yacute', '\u00FD'], ['yen', '\u00A5'], ['yuml', '\u00FF'],
  ['zwj', '\u200D'], ['zwnj', '\u200C'],

  // ── Greek ────────────────────────────────────────────────────────
  ['Alpha', '\u0391'], ['Beta', '\u0392'], ['Gamma', '\u0393'],
  ['Delta', '\u0394'], ['Epsilon', '\u0395'], ['Zeta', '\u0396'],
  ['Eta', '\u0397'], ['Theta', '\u0398'], ['Iota', '\u0399'],
  ['Kappa', '\u039A'], ['Lambda', '\u039B'], ['Mu', '\u039C'],
  ['Nu', '\u039D'], ['Xi', '\u039E'], ['Omicron', '\u039F'],
  ['Pi', '\u03A0'], ['Rho', '\u03A1'], ['Sigma', '\u03A3'],
  ['Tau', '\u03A4'], ['Upsilon', '\u03A5'], ['Phi', '\u03A6'],
  ['Chi', '\u03A7'], ['Psi', '\u03A8'], ['Omega', '\u03A9'],
  ['alpha', '\u03B1'], ['beta', '\u03B2'], ['gamma', '\u03B3'],
  ['delta', '\u03B4'], ['epsilon', '\u03B5'], ['zeta', '\u03B6'],
  ['eta', '\u03B7'], ['theta', '\u03B8'], ['iota', '\u03B9'],
  ['kappa', '\u03BA'], ['lambda', '\u03BB'], ['mu', '\u03BC'],
  ['nu', '\u03BD'], ['xi', '\u03BE'], ['omicron', '\u03BF'],
  ['pi', '\u03C0'], ['rho', '\u03C1'], ['sigmaf', '\u03C2'],
  ['sigma', '\u03C3'], ['tau', '\u03C4'], ['upsilon', '\u03C5'],
  ['phi', '\u03C6'], ['chi', '\u03C7'], ['psi', '\u03C8'],
  ['omega', '\u03C9'], ['thetasym', '\u03D1'], ['upsih', '\u03D2'],
  ['piv', '\u03D6'],

  // ── Latin Extended / Symbols ─────────────────────────────────────
  ['OElig', '\u0152'], ['oelig', '\u0153'], ['Scaron', '\u0160'],
  ['scaron', '\u0161'], ['Yuml', '\u0178'], ['fnof', '\u0192'],
  ['circ', '\u02C6'], ['tilde', '\u02DC'],

  // ── Arrows ───────────────────────────────────────────────────────
  ['larr', '\u2190'], ['uarr', '\u2191'], ['rarr', '\u2192'],
  ['darr', '\u2193'], ['harr', '\u2194'], ['crarr', '\u21B5'],
  ['lArr', '\u21D0'], ['uArr', '\u21D1'], ['rArr', '\u21D2'],
  ['dArr', '\u21D3'], ['hArr', '\u21D4'],

  // ── Mathematical ─────────────────────────────────────────────────
  ['forall', '\u2200'], ['part', '\u2202'], ['exist', '\u2203'],
  ['empty', '\u2205'], ['nabla', '\u2207'], ['isin', '\u2208'],
  ['notin', '\u2209'], ['ni', '\u220B'], ['prod', '\u220F'],
  ['sum', '\u2211'], ['minus', '\u2212'], ['lowast', '\u00B7'],
  ['radic', '\u221A'], ['prop', '\u221D'], ['infin', '\u221E'],
  ['ang', '\u2220'], ['and', '\u2227'], ['or', '\u2228'],
  ['cap', '\u2229'], ['cup', '\u222A'], ['int', '\u222B'],
  ['there4', '\u2234'], ['sim', '\u223C'], ['cong', '\u2245'],
  ['asymp', '\u2248'], ['ne', '\u2260'], ['equiv', '\u2261'],
  ['le', '\u2264'], ['ge', '\u2265'], ['sub', '\u2282'],
  ['sup', '\u2283'], ['nsub', '\u2284'], ['sube', '\u2286'],
  ['supe', '\u2287'], ['oplus', '\u2295'], ['otimes', '\u2297'],
  ['perp', '\u22A5'], ['sdot', '\u22C5'],

  // ── Miscellaneous ────────────────────────────────────────────────
  ['lceil', '\u2308'], ['rceil', '\u2309'], ['lfloor', '\u230A'],
  ['rfloor', '\u230B'], ['lang', '\u2329'], ['rang', '\u232A'],
  ['loz', '\u25CA'], ['spades', '\u2660'], ['clubs', '\u2663'],
  ['hearts', '\u2665'], ['diams', '\u2666'],

  // ── Typographic ──────────────────────────────────────────────────
  ['ndash', '\u2013'], ['mdash', '\u2014'], ['lsquo', '\u2018'],
  ['rsquo', '\u2019'], ['ldquo', '\u201C'], ['rdquo', '\u201D'],
  ['dagger', '\u2020'], ['Dagger', '\u2021'], ['bull', '\u2022'],
  ['hellip', '\u2026'], ['permil', '\u2030'], ['prime', '\u2032'],
  ['Prime', '\u2033'], ['lsaquo', '\u2039'], ['rsaquo', '\u203A'],
  ['oline', '\u203E'], ['frasl', '\u2044'],

  // ── Currency ─────────────────────────────────────────────────────
  ['euro', '\u20AC'], ['pound', '\u00A3'], ['yen', '\u00A5'],
  ['cent', '\u00A2'], ['curren', '\u00A4'],

  // ── Technical ────────────────────────────────────────────────────
  ['image', '\u2111'], ['weierp', '\u2118'], ['real', '\u211C'],
  ['alefsym', '\u2135'], ['crarr', '\u21B5'],
]);

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const REPLACEMENT_CHAR = '\uFFFD';
const MAX_NAMED_REF_LEN = 40;

// ─────────────────────────────────────────────────────────────────────────────
// HTML5 TOKENIZER
// ─────────────────────────────────────────────────────────────────────────────

class Html5Tokenizer {
  // ── Input ────────────────────────────────────────────────────────
  private input  = '';
  private pos    = 0;
  private tokens: Token[] = [];

  // ── State ────────────────────────────────────────────────────────
  private state: S = S.DATA;

  // ── Text accumulation buffer ─────────────────────────────────────
  private charBuf   = '';
  private tokenStart = 0;

  // ── Current tag being constructed ────────────────────────────────
  private tagName    = '';
  private attrs      = new Map<string, string>();
  private attrName   = '';
  private attrValue  = '';
  private selfClosing = false;
  private endTagMode = false;

  // ── Comment ──────────────────────────────────────────────────────
  private commentBuf = '';

  // ── DOCTYPE ──────────────────────────────────────────────────────
  private doctypeName       = '';
  private doctypePublicId   = '';
  private doctypeSystemId   = '';
  private doctypeForceQuirks = false;

  // ── CDATA ────────────────────────────────────────────────────────
  private cdataBuf = '';

  // ── Character reference ──────────────────────────────────────────
  private charRefBuf: string        = '';
  private charRefCode: number       = 0;
  private charRefReturnState: S     = S.DATA;
  private charRefSeenSemicolon = false;

  // ── Script end-tag name buffer ───────────────────────────────────
  private scriptEndBuf = '';

  // ── RAWTEXT / RCDATA end-tag name buffer ────────────────────────
  private rawEndBuf = '';

  // ── Raw text tag name (the tag whose content we're inside) ──────
  private rawTextTag = '';

  // ──────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────────────────────────

  tokenize(input: string): Token[] {
    this.input  = input;
    this.pos    = 0;
    this.tokens = [];
    this.state  = S.DATA;
    this.charBuf = '';
    this.tokenStart = 0;
    this.attrs  = new Map();
    this.attrName = '';
    this.attrValue = '';
    this.tagName = '';
    this.selfClosing = false;
    this.endTagMode = false;
    this.commentBuf = '';
    this.doctypeName = '';
    this.doctypePublicId = '';
    this.doctypeSystemId = '';
    this.doctypeForceQuirks = false;
    this.cdataBuf = '';
    this.charRefBuf = '';
    this.charRefCode = 0;
    this.charRefReturnState = S.DATA;
    this.charRefSeenSemicolon = false;
    this.scriptEndBuf = '';
    this.rawEndBuf = '';
    this.rawTextTag = '';

    while (this.pos < this.input.length) {
      this.process();
    }
    this.handleEOF();
    return this.tokens;
  }

  // ──────────────────────────────────────────────────────────────────
  // MAIN DISPATCH
  // ──────────────────────────────────────────────────────────────────

  private process(): void {
    const ch = this.input[this.pos]!;

    switch (this.state) {
      // ── Data states ──────────────────────────────────────────────
      case S.DATA:             this.handleData(ch); break;
      case S.RCDATA:           this.handleRcdata(ch); break;
      case S.RAWTEXT:          this.handleRawtext(ch); break;
      case S.SCRIPT_DATA:      this.handleScriptData(ch); break;
      case S.PLAINTEXT:        this.handlePlaintext(ch); break;

      // ── RCDATA end-tag detection ─────────────────────────────────
      case S.RCDATA_LT:        this.handleRcdataLT(ch); break;
      case S.RCDATA_END_TAG_OPEN: this.handleRcdataEndTagOpen(ch); break;
      case S.RCDATA_END_TAG_NAME: this.handleRcdataEndTagName(ch); break;

      // ── RAWTEXT end-tag detection ────────────────────────────────
      case S.RAWTEXT_LT:       this.handleRawtextLT(ch); break;
      case S.RAWTEXT_END_TAG_OPEN: this.handleRawtextEndTagOpen(ch); break;
      case S.RAWTEXT_END_TAG_NAME: this.handleRawtextEndTagName(ch); break;

      // ── Tag states ───────────────────────────────────────────────
      case S.TAG_OPEN:          this.handleTagOpen(ch); break;
      case S.END_TAG_OPEN:      this.handleEndTagOpen(ch); break;
      case S.TAG_NAME:          this.handleTagName(ch); break;
      case S.SELF_CLOSING_START_TAG: this.handleSelfClosingStartTag(ch); break;

      // ── Attribute states ─────────────────────────────────────────
      case S.BEFORE_ATTR_NAME:  this.handleBeforeAttrName(ch); break;
      case S.ATTR_NAME:         this.handleAttrName(ch); break;
      case S.AFTER_ATTR_NAME:   this.handleAfterAttrName(ch); break;
      case S.BEFORE_ATTR_VALUE: this.handleBeforeAttrValue(ch); break;
      case S.ATTR_VALUE_DQ:     this.handleAttrValueDQ(ch); break;
      case S.ATTR_VALUE_SQ:     this.handleAttrValueSQ(ch); break;
      case S.ATTR_VALUE_UQ:     this.handleAttrValueUQ(ch); break;
      case S.AFTER_ATTR_VALUE_QUOTED: this.handleAfterAttrValueQuoted(ch); break;

      // ── Markup declaration ───────────────────────────────────────
      case S.MARKUP_DECLARATION_OPEN: this.handleMarkupDeclOpen(ch); break;

      // ── Comment states ───────────────────────────────────────────
      case S.COMMENT_START:      this.handleCommentStart(ch); break;
      case S.COMMENT_START_DASH: this.handleCommentStartDash(ch); break;
      case S.COMMENT:            this.handleComment(ch); break;
      case S.COMMENT_END_DASH:   this.handleCommentEndDash(ch); break;
      case S.COMMENT_END:        this.handleCommentEnd(ch); break;
      case S.COMMENT_END_BANG:   this.handleCommentEndBang(ch); break;
      case S.BOGUS_COMMENT:      this.handleBogusComment(ch); break;

      // ── DOCTYPE states ───────────────────────────────────────────
      case S.DOCTYPE:                 this.handleDoctype(ch); break;
      case S.BEFORE_DOCTYPE_NAME:     this.handleBeforeDoctypeName(ch); break;
      case S.DOCTYPE_NAME:            this.handleDoctypeName(ch); break;
      case S.AFTER_DOCTYPE_NAME:      this.handleAfterDoctypeName(ch); break;
      case S.AFTER_DOCTYPE_PUBLIC_KEYWORD: this.handleAfterDoctypePublicKeyword(ch); break;
      case S.BEFORE_DOCTYPE_PUBLIC_ID: this.handleBeforeDoctypePublicId(ch); break;
      case S.DOCTYPE_PUBLIC_ID_DQ:    this.handleDoctypePublicIdDQ(ch); break;
      case S.DOCTYPE_PUBLIC_ID_SQ:    this.handleDoctypePublicIdSQ(ch); break;
      case S.AFTER_DOCTYPE_PUBLIC_ID: this.handleAfterDoctypePublicId(ch); break;
      case S.BETWEEN_DOCTYPE_IDS:     this.handleBetweenDoctypeIds(ch); break;
      case S.AFTER_DOCTYPE_SYSTEM_KEYWORD: this.handleAfterDoctypeSystemKeyword(ch); break;
      case S.BEFORE_DOCTYPE_SYSTEM_ID: this.handleBeforeDoctypeSystemId(ch); break;
      case S.DOCTYPE_SYSTEM_ID_DQ:    this.handleDoctypeSystemIdDQ(ch); break;
      case S.DOCTYPE_SYSTEM_ID_SQ:    this.handleDoctypeSystemIdSQ(ch); break;
      case S.AFTER_DOCTYPE_SYSTEM_ID: this.handleAfterDoctypeSystemId(ch); break;
      case S.BOGUS_DOCTYPE:           this.handleBogusDoctype(ch); break;

      // ── CDATA ────────────────────────────────────────────────────
      case S.CDATA_SECTION: this.handleCdata(ch); break;

      // ── Character reference ──────────────────────────────────────
      case S.CHAR_REF:                     this.handleCharRef(ch); break;
      case S.NAMED_CHAR_REF:               this.handleNamedCharRef(ch); break;
      case S.NUMERIC_CHAR_REF:             this.handleNumericCharRef(ch); break;
      case S.HEX_CHAR_REF_START:           this.handleHexCharRefStart(ch); break;
      case S.DEC_CHAR_REF_START:           this.handleDecCharRefStart(ch); break;
      case S.HEX_CHAR_REF:                 this.handleHexCharRef(ch); break;
      case S.DEC_CHAR_REF:                 this.handleDecCharRef(ch); break;

      // ── Script data states ───────────────────────────────────────
      case S.SCRIPT_LT:              this.handleScriptLT(ch); break;
      case S.SCRIPT_END_TAG_OPEN:    this.handleScriptEndTagOpen(ch); break;
      case S.SCRIPT_END_TAG_NAME:    this.handleScriptEndTagName(ch); break;
      case S.SCRIPT_ESCAPE_START:    this.handleScriptEscapeStart(ch); break;
      case S.SCRIPT_ESCAPE_START_DASH: this.handleScriptEscapeStartDash(ch); break;
      case S.SCRIPT_ESCAPED:         this.handleScriptEscaped(ch); break;
      case S.SCRIPT_ESCAPED_DASH:    this.handleScriptEscapedDash(ch); break;
      case S.SCRIPT_ESCAPED_DASH_DASH: this.handleScriptEscapedDashDash(ch); break;
      case S.SCRIPT_ESCAPED_LT:      this.handleScriptEscapedLT(ch); break;
      case S.SCRIPT_ESCAPED_END_TAG_OPEN: this.handleScriptEscapedEndTagOpen(ch); break;
      case S.SCRIPT_ESCAPED_END_TAG_NAME: this.handleScriptEscapedEndTagName(ch); break;
      case S.SCRIPT_DOUBLE_ESCAPE_START: this.handleScriptDoubleEscapeStart(ch); break;
      case S.SCRIPT_DOUBLE_ESCAPED:  this.handleScriptDoubleEscaped(ch); break;
      case S.SCRIPT_DOUBLE_ESCAPED_DASH: this.handleScriptDoubleEscapedDash(ch); break;
      case S.SCRIPT_DOUBLE_ESCAPED_DASH_DASH: this.handleScriptDoubleEscapedDashDash(ch); break;
      case S.SCRIPT_DOUBLE_ESCAPED_LT: this.handleScriptDoubleEscapedLT(ch); break;
      case S.SCRIPT_DOUBLE_ESCAPE_END: this.handleScriptDoubleEscapeEnd(ch); break;
    }

    this.pos++;
  }

  // ──────────────────────────────────────────────────────────────────
  // DATA STATE  (§13.2.5.1)
  // ──────────────────────────────────────────────────────────────────

  private handleData(ch: string): void {
    switch (ch) {
      case '&':
        this.flushText();
        this.tokenStart = this.pos;
        this.charRefReturnState = S.DATA;
        this.state = S.CHAR_REF;
        break;
      case '<':
        this.flushText();
        this.state = S.TAG_OPEN;
        break;
      case '\0':
        this.appendChar(REPLACEMENT_CHAR);
        break;
      default:
        this.appendChar(ch);
        break;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // RCDATA STATE  (§13.2.5.3)  — <textarea>, <title>
  // ──────────────────────────────────────────────────────────────────

  private handleRcdata(ch: string): void {
    switch (ch) {
      case '&':
        this.flushText();
        this.tokenStart = this.pos;
        this.charRefReturnState = S.RCDATA;
        this.state = S.CHAR_REF;
        break;
      case '<':
        this.flushText();
        this.state = S.RCDATA_LT;
        break;
      case '\0':
        this.appendChar(REPLACEMENT_CHAR);
        break;
      default:
        this.appendChar(ch);
        break;
    }
  }

  private handleRcdataLT(ch: string): void {
    if (ch === '/') {
      this.rawEndBuf = '';
      this.state = S.RCDATA_END_TAG_OPEN;
    } else {
      this.appendChar('<');
      this.state = S.RCDATA;
      this.pos--; // reconsume
    }
  }

  private handleRcdataEndTagOpen(ch: string): void {
    if (isAsciiAlpha(ch)) {
      this.endTagMode = true;
      this.tagName = ch.toLowerCase();
      this.rawEndBuf = ch.toLowerCase();
      this.state = S.RCDATA_END_TAG_NAME;
    } else {
      this.appendChar('<');
      this.appendChar('/');
      this.state = S.RCDATA;
      this.pos--; // reconsume
    }
  }

  private handleRcdataEndTagName(ch: string): void {
    if (isAsciiAlpha(ch)) {
      this.rawEndBuf += ch.toLowerCase();
      this.tagName += ch.toLowerCase();
    } else if (ch === '>' || ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') {
      if (this.tagName === this.rawTextTag) {
        this.flushText();
        this.state = ch === '>' ? S.DATA : S.BEFORE_ATTR_NAME;
        this.selfClosing = false;
        this.endTagMode = false;
        this.emitCloseTag();
        return;
      }
      this.appendChar('<');
      this.appendChar('/');
      this.appendString(this.rawEndBuf);
      this.state = S.RCDATA;
      this.pos--; // reconsume
    } else {
      this.appendChar('<');
      this.appendChar('/');
      this.appendString(this.rawEndBuf);
      this.state = S.RCDATA;
      this.pos--; // reconsume
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // RAWTEXT STATE  (§13.2.5.37)  — <style>
  // ──────────────────────────────────────────────────────────────────

  private handleRawtext(ch: string): void {
    switch (ch) {
      case '<':
        this.flushText();
        this.state = S.RAWTEXT_LT;
        break;
      case '\0':
        this.appendChar(REPLACEMENT_CHAR);
        break;
      default:
        this.appendChar(ch);
        break;
    }
  }

  private handleRawtextLT(ch: string): void {
    if (ch === '/') {
      this.rawEndBuf = '';
      this.state = S.RAWTEXT_END_TAG_OPEN;
    } else {
      this.appendChar('<');
      this.state = S.RAWTEXT;
      this.pos--;
    }
  }

  private handleRawtextEndTagOpen(ch: string): void {
    if (isAsciiAlpha(ch)) {
      this.endTagMode = true;
      this.tagName = ch.toLowerCase();
      this.rawEndBuf = ch.toLowerCase();
      this.state = S.RAWTEXT_END_TAG_NAME;
    } else {
      this.appendChar('<');
      this.appendChar('/');
      this.state = S.RAWTEXT;
      this.pos--;
    }
  }

  private handleRawtextEndTagName(ch: string): void {
    if (isAsciiAlpha(ch)) {
      this.rawEndBuf += ch.toLowerCase();
      this.tagName += ch.toLowerCase();
    } else if (ch === '>' || ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') {
      if (this.tagName === this.rawTextTag) {
        this.flushText();
        this.state = ch === '>' ? S.DATA : S.BEFORE_ATTR_NAME;
        this.selfClosing = false;
        this.endTagMode = false;
        this.emitCloseTag();
        return;
      }
      this.appendChar('<');
      this.appendChar('/');
      this.appendString(this.rawEndBuf);
      this.state = S.RAWTEXT;
      this.pos--;
    } else {
      this.appendChar('<');
      this.appendChar('/');
      this.appendString(this.rawEndBuf);
      this.state = S.RAWTEXT;
      this.pos--;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // PLAINTEXT STATE  (§13.2.5.6)
  // ──────────────────────────────────────────────────────────────────

  private handlePlaintext(ch: string): void {
    if (ch === '\0') {
      this.appendChar(REPLACEMENT_CHAR);
    } else {
      this.appendChar(ch);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // TAG OPEN STATE  (§13.2.5.8)
  // ──────────────────────────────────────────────────────────────────

  private handleTagOpen(ch: string): void {
    if (ch === '!') {
      this.state = S.MARKUP_DECLARATION_OPEN;
    } else if (ch === '/') {
      this.state = S.END_TAG_OPEN;
    } else if (isAsciiAlpha(ch)) {
      this.startTag(ch.toLowerCase());
      this.state = S.TAG_NAME;
    } else if (ch === '?') {
      // Treat as bogus comment (HTML5 spec: anything else → parse error)
      this.commentBuf = '';
      this.tokenStart = this.pos;
      this.state = S.BOGUS_COMMENT;
    } else {
      this.appendChar('<');
      this.state = S.DATA;
      this.pos--; // reconsume
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // END TAG OPEN STATE  (§13.2.5.9)
  // ──────────────────────────────────────────────────────────────────

  private handleEndTagOpen(ch: string): void {
    if (isAsciiAlpha(ch)) {
      this.startEndTag(ch.toLowerCase());
      this.state = S.TAG_NAME;
    } else if (ch === '>') {
      // Parse error — empty end tag
      this.state = S.DATA;
    } else {
      this.commentBuf = '';
      this.tokenStart = this.pos - 2;
      this.appendChar('<');
      this.appendChar('/');
      this.state = S.BOGUS_COMMENT;
      this.pos--; // reconsume
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // TAG NAME STATE  (§13.2.5.10)
  // ──────────────────────────────────────────────────────────────────

  private handleTagName(ch: string): void {
    switch (ch) {
      case '\t': case '\n': case '\f': case ' ':
        this.state = S.BEFORE_ATTR_NAME;
        break;
      case '/':
        this.state = S.SELF_CLOSING_START_TAG;
        break;
      case '>':
        this.emitTag();
        break;
      case '\0':
        this.tagName += REPLACEMENT_CHAR;
        break;
      default:
        this.tagName += ch.toLowerCase();
        break;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // SELF-CLOSING START TAG STATE  (§13.2.5.34)
  // ──────────────────────────────────────────────────────────────────

  private handleSelfClosingStartTag(ch: string): void {
    if (ch === '>') {
      this.selfClosing = true;
      this.emitTag();
    } else {
      this.state = S.BEFORE_ATTR_NAME;
      this.pos--; // reconsume
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // ATTRIBUTE STATES  (§13.2.5.31–33, 35, 36)
  // ──────────────────────────────────────────────────────────────────

  private handleBeforeAttrName(ch: string): void {
    switch (ch) {
      case '\t': case '\n': case '\f': case ' ':
        break; // ignore whitespace
      case '/': case '>':
        this.pos--; this.state = S.TAG_NAME; break;
      case '=':
        this.attrName = '=';
        this.state = S.ATTR_NAME;
        break;
      default:
        this.attrName = ch.toLowerCase();
        this.state = S.ATTR_NAME;
        break;
    }
  }

  private handleAttrName(ch: string): void {
    switch (ch) {
      case '\t': case '\n': case '\f': case ' ':
        this.state = S.AFTER_ATTR_NAME;
        break;
      case '/': case '>':
        this.pos--; this.state = S.TAG_NAME; break;
      case '=':
        this.state = S.BEFORE_ATTR_VALUE;
        break;
      case '\0':
        this.attrName += REPLACEMENT_CHAR;
        break;
      default:
        this.attrName += ch.toLowerCase();
        break;
    }
  }

  private handleAfterAttrName(ch: string): void {
    switch (ch) {
      case '\t': case '\n': case '\f': case ' ':
        break;
      case '/': case '>':
        this.pos--; this.state = S.TAG_NAME; break;
      case '=':
        this.state = S.BEFORE_ATTR_VALUE;
        break;
      default:
        this.commitAttr();
        this.attrName = ch.toLowerCase();
        this.state = S.ATTR_NAME;
        break;
    }
  }

  private handleBeforeAttrValue(ch: string): void {
    switch (ch) {
      case '\t': case '\n': case '\f': case ' ':
        break;
      case '"':
        this.attrValue = '';
        this.state = S.ATTR_VALUE_DQ;
        break;
      case "'":
        this.attrValue = '';
        this.state = S.ATTR_VALUE_SQ;
        break;
      case '>':
        this.commitAttr();
        this.emitTag();
        break;
      default:
        this.attrValue = ch;
        this.state = S.ATTR_VALUE_UQ;
        break;
    }
  }

  private handleAttrValueDQ(ch: string): void {
    switch (ch) {
      case '"':
        this.commitAttr();
        this.state = S.AFTER_ATTR_VALUE_QUOTED;
        break;
      case '&':
        this.tokenStart = this.pos;
        this.charRefReturnState = S.ATTR_VALUE_DQ;
        this.state = S.CHAR_REF;
        break;
      case '\0':
        this.attrValue += REPLACEMENT_CHAR;
        break;
      default:
        this.attrValue += ch;
        break;
    }
  }

  private handleAttrValueSQ(ch: string): void {
    switch (ch) {
      case "'":
        this.commitAttr();
        this.state = S.AFTER_ATTR_VALUE_QUOTED;
        break;
      case '&':
        this.tokenStart = this.pos;
        this.charRefReturnState = S.ATTR_VALUE_SQ;
        this.state = S.CHAR_REF;
        break;
      case '\0':
        this.attrValue += REPLACEMENT_CHAR;
        break;
      default:
        this.attrValue += ch;
        break;
    }
  }

  private handleAttrValueUQ(ch: string): void {
    switch (ch) {
      case '\t': case '\n': case '\f': case ' ':
        this.commitAttr();
        this.state = S.BEFORE_ATTR_NAME;
        break;
      case '&':
        this.tokenStart = this.pos;
        this.charRefReturnState = S.ATTR_VALUE_UQ;
        this.state = S.CHAR_REF;
        break;
      case '>':
        this.commitAttr();
        this.emitTag();
        break;
      case '\0':
        this.attrValue += REPLACEMENT_CHAR;
        break;
      default:
        this.attrValue += ch;
        break;
    }
  }

  private handleAfterAttrValueQuoted(ch: string): void {
    switch (ch) {
      case '\t': case '\n': case '\f': case ' ':
        this.state = S.BEFORE_ATTR_NAME;
        break;
      case '/':
        this.state = S.SELF_CLOSING_START_TAG;
        break;
      case '>':
        this.emitTag();
        break;
      default:
        this.state = S.BEFORE_ATTR_NAME;
        this.pos--; // reconsume
        break;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // MARKUP DECLARATION OPEN STATE  (§13.2.5.22)
  // ──────────────────────────────────────────────────────────────────

  private handleMarkupDeclOpen(ch: string): void {
    if (ch === '-') {
      if (this.peek(1) === '-') {
        this.pos += 1; // consume second '-'; auto-increment advances to comment body
        this.commentBuf = '';
        this.tokenStart = this.pos - 3;
        this.state = S.COMMENT_START;
      } else {
        this.emitBogusComment('<!-');
      }
    } else if (ch.toUpperCase() === 'D' && this.input.substring(this.pos, this.pos + 7).toUpperCase() === 'DOCTYPE') {
      this.pos += 6; // consume 'OCTYPE'; auto-increment advances past 'D'
      this.tokenStart = this.pos - 8;
      this.state = S.DOCTYPE;
    } else if (ch === '[' && this.input.substring(this.pos + 1, this.pos + 7) === 'CDATA[') {
      this.pos += 5; // consume 'CDATA[' minus one; auto-increment advances past last char
      this.cdataBuf = '';
      this.tokenStart = this.pos - 7;
      this.state = S.CDATA_SECTION;
    } else if (ch === '?') {
      this.commentBuf = '';
      this.tokenStart = this.pos - 2;
      this.state = S.BOGUS_COMMENT;
    } else {
      this.emitBogusComment('<!');
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // COMMENT STATES  (§13.2.5.23–28)
  // ──────────────────────────────────────────────────────────────────

  private handleCommentStart(ch: string): void {
    switch (ch) {
      case '-':
        this.state = S.COMMENT_START_DASH;
        break;
      case '\0':
        this.commentBuf += REPLACEMENT_CHAR;
        this.state = S.COMMENT;
        break;
      case '>':
        this.state = S.DATA;
        this.emitComment();
        break;
      default:
        this.commentBuf += ch;
        this.state = S.COMMENT;
        break;
    }
  }

  private handleCommentStartDash(ch: string): void {
    switch (ch) {
      case '-':
        this.commentBuf += '-';
        this.state = S.COMMENT_END_DASH;
        break;
      case '\0':
        this.commentBuf += '-';
        this.commentBuf += REPLACEMENT_CHAR;
        this.state = S.COMMENT;
        break;
      case '>':
        this.state = S.DATA;
        this.emitComment();
        break;
      default:
        this.commentBuf += '-';
        this.commentBuf += ch;
        this.state = S.COMMENT;
        break;
    }
  }

  private handleComment(ch: string): void {
    switch (ch) {
      case '-':
        this.state = S.COMMENT_END_DASH;
        break;
      case '\0':
        this.commentBuf += REPLACEMENT_CHAR;
        break;
      default:
        this.commentBuf += ch;
        break;
    }
  }

  private handleCommentEndDash(ch: string): void {
    switch (ch) {
      case '-':
        this.state = S.COMMENT_END;
        break;
      case '\0':
        this.commentBuf += '-';
        this.commentBuf += REPLACEMENT_CHAR;
        this.state = S.COMMENT;
        break;
      default:
        this.commentBuf += '-';
        this.commentBuf += ch;
        this.state = S.COMMENT;
        break;
    }
  }

  private handleCommentEnd(ch: string): void {
    switch (ch) {
      case '>':
        this.state = S.DATA;
        this.emitComment();
        break;
      case '-':
        this.commentBuf += '-';
        break;
      case '\0':
        this.commentBuf += '-';
        this.commentBuf += REPLACEMENT_CHAR;
        this.state = S.COMMENT;
        break;
      default:
        this.commentBuf += '-';
        this.commentBuf += ch;
        this.state = S.COMMENT;
        break;
    }
  }

  private handleCommentEndBang(ch: string): void {
    switch (ch) {
      case '>':
        this.state = S.DATA;
        this.emitComment();
        break;
      case '-':
        this.commentBuf += '--!';
        this.state = S.COMMENT_END_DASH;
        break;
      default:
        this.commentBuf += '--!';
        this.commentBuf += ch;
        this.state = S.COMMENT;
        break;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // BOGUS COMMENT STATE  (§13.2.5.29)
  // ──────────────────────────────────────────────────────────────────

  private handleBogusComment(ch: string): void {
    if (ch === '>') {
      this.state = S.DATA;
      this.emitComment();
    } else if (ch === '\0') {
      this.commentBuf += REPLACEMENT_CHAR;
    } else {
      this.commentBuf += ch;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // DOCTYPE STATES  (§13.2.5.30–51)
  // ──────────────────────────────────────────────────────────────────

  private handleDoctype(ch: string): void {
    if (ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') {
      this.state = S.BEFORE_DOCTYPE_NAME;
    } else {
      this.state = S.BEFORE_DOCTYPE_NAME;
      this.pos--; // reconsume
    }
  }

  private handleBeforeDoctypeName(ch: string): void {
    if (ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') return;
    if (ch === '>') {
      this.doctypeForceQuirks = true;
      this.state = S.DATA;
      this.emitDoctype();
      return;
    }
    if (ch === '\0') {
      this.doctypeName = REPLACEMENT_CHAR;
    } else {
      this.doctypeName = ch.toLowerCase();
    }
    this.state = S.DOCTYPE_NAME;
  }

  private handleDoctypeName(ch: string): void {
    if (ch === '>') {
      this.state = S.DATA;
      this.emitDoctype();
    } else if (ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') {
      this.state = S.AFTER_DOCTYPE_NAME;
    } else if (ch === '\0') {
      this.doctypeName += REPLACEMENT_CHAR;
    } else {
      this.doctypeName += ch.toLowerCase();
    }
  }

  private handleAfterDoctypeName(ch: string): void {
    if (ch === '>') {
      this.state = S.DATA;
      this.emitDoctype();
    } else if (ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') return;
    else if (ch.toUpperCase() === 'P') {
      if (this.input.substring(this.pos, this.pos + 6).toUpperCase() === 'PUBLIC') {
        this.pos += 5; // auto-increment advances past last char of PUBLIC
        this.state = S.AFTER_DOCTYPE_PUBLIC_KEYWORD;
      } else {
        this.doctypeForceQuirks = true;
        this.state = S.BOGUS_DOCTYPE;
      }
    } else if (ch.toUpperCase() === 'S') {
      if (this.input.substring(this.pos, this.pos + 6).toUpperCase() === 'SYSTEM') {
        this.pos += 5; // auto-increment advances past last char of SYSTEM
        this.state = S.AFTER_DOCTYPE_SYSTEM_KEYWORD;
      } else {
        this.doctypeForceQuirks = true;
        this.state = S.BOGUS_DOCTYPE;
      }
    } else {
      this.doctypeForceQuirks = true;
      this.state = S.BOGUS_DOCTYPE;
    }
  }

  private handleAfterDoctypePublicKeyword(ch: string): void {
    if (ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') return;
    if (ch === '"') { this.doctypePublicId = ''; this.state = S.DOCTYPE_PUBLIC_ID_DQ; }
    else if (ch === "'") { this.doctypePublicId = ''; this.state = S.DOCTYPE_PUBLIC_ID_SQ; }
    else if (ch === '>') { this.doctypeForceQuirks = true; this.state = S.DATA; this.emitDoctype(); }
    else { this.doctypeForceQuirks = true; this.state = S.BOGUS_DOCTYPE; this.pos--; }
  }

  private handleBeforeDoctypePublicId(ch: string): void {
    if (ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') return;
    if (ch === '"') { this.doctypePublicId = ''; this.state = S.DOCTYPE_PUBLIC_ID_DQ; }
    else if (ch === "'") { this.doctypePublicId = ''; this.state = S.DOCTYPE_PUBLIC_ID_SQ; }
    else if (ch === '>') { this.doctypeForceQuirks = true; this.state = S.DATA; this.emitDoctype(); }
    else { this.doctypeForceQuirks = true; this.state = S.BOGUS_DOCTYPE; this.pos--; }
  }

  private handleDoctypePublicIdDQ(ch: string): void {
    if (ch === '"') { this.state = S.AFTER_DOCTYPE_PUBLIC_ID; }
    else if (ch === '\0') { this.doctypePublicId += REPLACEMENT_CHAR; }
    else { this.doctypePublicId += ch; }
  }

  private handleDoctypePublicIdSQ(ch: string): void {
    if (ch === "'") { this.state = S.AFTER_DOCTYPE_PUBLIC_ID; }
    else if (ch === '\0') { this.doctypePublicId += REPLACEMENT_CHAR; }
    else { this.doctypePublicId += ch; }
  }

  private handleAfterDoctypePublicId(ch: string): void {
    if (ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') return;
    if (ch === '>') { this.state = S.DATA; this.emitDoctype(); }
    else if (ch === '"') { this.state = S.DOCTYPE_PUBLIC_ID_DQ; this.doctypePublicId = ''; }
    else if (ch === "'") { this.state = S.DOCTYPE_PUBLIC_ID_SQ; this.doctypePublicId = ''; }
    else if (ch === 'S' && this.input.substring(this.pos, this.pos + 6).toUpperCase() === 'SYSTEM') {
      this.pos += 5; // auto-increment advances past last char of SYSTEM
      this.state = S.AFTER_DOCTYPE_SYSTEM_KEYWORD;
    }
    else { this.doctypeForceQuirks = true; this.state = S.BOGUS_DOCTYPE; this.pos--; }
  }

  private handleBetweenDoctypeIds(ch: string): void {
    if (ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') return;
    if (ch === '>') { this.state = S.DATA; this.emitDoctype(); }
    else if (ch === '"') { this.doctypeSystemId = ''; this.state = S.DOCTYPE_SYSTEM_ID_DQ; }
    else if (ch === "'") { this.doctypeSystemId = ''; this.state = S.DOCTYPE_SYSTEM_ID_SQ; }
    else { this.doctypeForceQuirks = true; this.state = S.BOGUS_DOCTYPE; this.pos--; }
  }

  private handleAfterDoctypeSystemKeyword(ch: string): void {
    if (ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') return;
    if (ch === '"') { this.doctypeSystemId = ''; this.state = S.DOCTYPE_SYSTEM_ID_DQ; }
    else if (ch === "'") { this.doctypeSystemId = ''; this.state = S.DOCTYPE_SYSTEM_ID_SQ; }
    else if (ch === '>') { this.doctypeForceQuirks = true; this.state = S.DATA; this.emitDoctype(); }
    else { this.doctypeForceQuirks = true; this.state = S.BOGUS_DOCTYPE; this.pos--; }
  }

  private handleBeforeDoctypeSystemId(ch: string): void {
    if (ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') return;
    if (ch === '"') { this.doctypeSystemId = ''; this.state = S.DOCTYPE_SYSTEM_ID_DQ; }
    else if (ch === "'") { this.doctypeSystemId = ''; this.state = S.DOCTYPE_SYSTEM_ID_SQ; }
    else if (ch === '>') { this.doctypeForceQuirks = true; this.state = S.DATA; this.emitDoctype(); }
    else { this.doctypeForceQuirks = true; this.state = S.BOGUS_DOCTYPE; this.pos--; }
  }

  private handleDoctypeSystemIdDQ(ch: string): void {
    if (ch === '"') { this.state = S.AFTER_DOCTYPE_SYSTEM_ID; }
    else if (ch === '\0') { this.doctypeSystemId += REPLACEMENT_CHAR; }
    else { this.doctypeSystemId += ch; }
  }

  private handleDoctypeSystemIdSQ(ch: string): void {
    if (ch === "'") { this.state = S.AFTER_DOCTYPE_SYSTEM_ID; }
    else if (ch === '\0') { this.doctypeSystemId += REPLACEMENT_CHAR; }
    else { this.doctypeSystemId += ch; }
  }

  private handleAfterDoctypeSystemId(ch: string): void {
    if (ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') return;
    if (ch === '>') { this.state = S.DATA; this.emitDoctype(); }
    else { this.doctypeForceQuirks = true; this.state = S.BOGUS_DOCTYPE; this.pos--; }
  }

  private handleBogusDoctype(ch: string): void {
    if (ch === '>') { this.state = S.DATA; this.emitDoctype(); }
  }

  // ──────────────────────────────────────────────────────────────────
  // CDATA SECTION STATE  (§13.2.5.5)
  // ──────────────────────────────────────────────────────────────────

  private handleCdata(ch: string): void {
    if (ch === ']' && this.input.substring(this.pos, this.pos + 3) === ']]>') {
      this.pos += 2; // auto-increment advances past third char of ]]>
      this.state = S.DATA;
      this.tokens.push({ kind: 'cdata', data: this.cdataBuf, offset: this.tokenStart });
      this.cdataBuf = '';
    } else if (ch === '\0') {
      this.cdataBuf += REPLACEMENT_CHAR;
    } else {
      this.cdataBuf += ch;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // CHARACTER REFERENCE STATES  (§13.6.1)
  // ──────────────────────────────────────────────────────────────────

  private handleCharRef(ch: string): void {
    if (ch === '#') {
      this.charRefCode = 0;
      this.state = S.NUMERIC_CHAR_REF;
    } else if (isAsciiAlpha(ch)) {
      this.charRefBuf = ch;
      this.state = S.NAMED_CHAR_REF;
    } else {
      this.appendChar('&');
      this.state = this.charRefReturnState;
      this.pos--; // reconsume
    }
  }

  private handleNamedCharRef(ch: string): void {
    if (isAsciiAlphanumeric(ch) && this.charRefBuf.length < MAX_NAMED_REF_LEN) {
      this.charRefBuf += ch;
      return;
    }

    // Try to match the accumulated buffer against known references.
    const matched = this.resolveNamedRef(ch);
    if (matched) {
      this.state = this.charRefReturnState;
    } else {
      // No match — emit '&' and the buffered characters literally.
      this.appendChar('&');
      this.appendString(this.charRefBuf);
      this.state = this.charRefReturnState;
      this.pos--; // reconsume the non-matching character
    }
    this.charRefBuf = '';
  }

  private resolveNamedRef(following: string): boolean {
    // Try the full buffer first, then progressively shorter.
    for (let len = this.charRefBuf.length; len > 0; len--) {
      const candidate = this.charRefBuf.slice(0, len);
      const code = NAMED_CHAR_REFS.get(candidate);
      if (code) {
        const rest = this.charRefBuf.slice(len);
        this.appendString(code);
        if (rest.length > 0) {
          this.appendString(rest);
        }
        // If followed by ';' it's a consumed reference; otherwise ambiguous ampersand.
        if (len === this.charRefBuf.length && following !== ';') {
          // Ambiguous — do not consume the following char.
        }
        return true;
      }
    }
    return false;
  }

  private handleNumericCharRef(ch: string): void {
    this.charRefCode = 0;
    this.charRefSeenSemicolon = false;
    if (ch === 'x' || ch === 'X') {
      this.state = S.HEX_CHAR_REF_START;
    } else if (isAsciiDigit(ch)) {
      this.charRefCode = ch.charCodeAt(0) - 0x30;
      this.state = S.DEC_CHAR_REF;
    } else {
      this.appendChar('&#');
      this.state = this.charRefReturnState;
      this.pos--; // reconsume
    }
  }

  private handleHexCharRefStart(ch: string): void {
    if (isAsciiHexDigit(ch)) {
      this.charRefCode = hexValue(ch);
      this.state = S.HEX_CHAR_REF;
    } else {
      this.appendChar('&#x');
      this.state = this.charRefReturnState;
      this.pos--;
    }
  }

  private handleDecCharRefStart(ch: string): void {
    if (isAsciiDigit(ch)) {
      this.charRefCode = ch.charCodeAt(0) - 0x30;
      this.state = S.DEC_CHAR_REF;
    } else {
      this.appendChar('&#');
      this.state = this.charRefReturnState;
      this.pos--;
    }
  }

  private handleHexCharRef(ch: string): void {
    if (ch === ';') {
      this.charRefSeenSemicolon = true;
      this.flushNumericCharRef();
    } else if (isAsciiHexDigit(ch)) {
      this.charRefCode = this.charRefCode * 16 + hexValue(ch);
    } else {
      this.flushNumericCharRef();
      this.state = this.charRefReturnState;
      this.pos--; // reconsume
    }
  }

  private handleDecCharRef(ch: string): void {
    if (ch === ';') {
      this.charRefSeenSemicolon = true;
      this.flushNumericCharRef();
    } else if (isAsciiDigit(ch)) {
      this.charRefCode = this.charRefCode * 10 + (ch.charCodeAt(0) - 0x30);
    } else {
      this.flushNumericCharRef();
      this.state = this.charRefReturnState;
      this.pos--; // reconsume
    }
  }

  private flushNumericCharRef(): void {
    const code = this.charRefCode;
    // Replacement character for null, noncharacter, or out of range.
    if (code === 0 || code > 0x10FFFF ||
        (code >= 0xD800 && code <= 0xDFFF) ||
        (code >= 0xFDD0 && code <= 0xFDEF) ||
        (code & 0xFFFE) === 0xFFFE) {
      this.appendChar(REPLACEMENT_CHAR);
    } else {
      this.appendChar(String.fromCodePoint(code));
    }
    this.charRefCode = 0;
  }

  // ──────────────────────────────────────────────────────────────────
  // SCRIPT DATA STATES  (§13.2.5.17–31)
  // ──────────────────────────────────────────────────────────────────

  private handleScriptData(ch: string): void {
    switch (ch) {
      case '<':
        this.flushText();
        this.state = S.SCRIPT_LT;
        break;
      case '\0':
        this.appendChar(REPLACEMENT_CHAR);
        break;
      default:
        this.appendChar(ch);
        break;
    }
  }

  private handleScriptLT(ch: string): void {
    if (ch === '/') {
      this.scriptEndBuf = '';
      this.state = S.SCRIPT_END_TAG_OPEN;
    } else if (ch === '!') {
      this.state = S.SCRIPT_ESCAPE_START;
    } else {
      this.appendChar('<');
      this.state = S.SCRIPT_DATA;
      this.pos--;
    }
  }

  private handleScriptEndTagOpen(ch: string): void {
    if (isAsciiAlpha(ch)) {
      this.endTagMode = true;
      this.tagName = ch.toLowerCase();
      this.scriptEndBuf = ch.toLowerCase();
      this.state = S.SCRIPT_END_TAG_NAME;
    } else {
      this.appendChar('<');
      this.appendChar('/');
      this.state = S.SCRIPT_DATA;
      this.pos--;
    }
  }

  private handleScriptEndTagName(ch: string): void {
    if (isAsciiAlpha(ch)) {
      this.scriptEndBuf += ch.toLowerCase();
      this.tagName += ch.toLowerCase();
    } else if (ch === '>' || ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') {
      if (this.tagName === 'script') {
        this.flushText();
        this.state = ch === '>' ? S.DATA : S.BEFORE_ATTR_NAME;
        this.selfClosing = false;
        this.endTagMode = false;
        this.emitCloseTag();
        return;
      }
      this.appendChar('<');
      this.appendChar('/');
      this.appendString(this.scriptEndBuf);
      this.state = S.SCRIPT_DATA;
      this.pos--;
    } else {
      this.appendChar('<');
      this.appendChar('/');
      this.appendString(this.scriptEndBuf);
      this.state = S.SCRIPT_DATA;
      this.pos--;
    }
  }

  private handleScriptEscapeStart(ch: string): void {
    if (ch === '-') {
      this.state = S.SCRIPT_ESCAPE_START_DASH;
    } else {
      this.appendChar('<');
      this.appendChar('!');
      this.state = S.SCRIPT_DATA;
      this.pos--;
    }
  }

  private handleScriptEscapeStartDash(ch: string): void {
    if (ch === '-') {
      this.state = S.SCRIPT_ESCAPED_DASH_DASH;
    } else {
      this.appendChar('<');
      this.appendChar('!');
      this.appendChar('-');
      this.state = S.SCRIPT_DATA;
      this.pos--;
    }
  }

  private handleScriptEscaped(ch: string): void {
    switch (ch) {
      case '-':
        this.state = S.SCRIPT_ESCAPED_DASH;
        break;
      case '\0':
        this.appendChar(REPLACEMENT_CHAR);
        break;
      default:
        this.appendChar(ch);
        break;
    }
  }

  private handleScriptEscapedDash(ch: string): void {
    switch (ch) {
      case '-':
        this.state = S.SCRIPT_ESCAPED_DASH_DASH;
        break;
      case '<':
        this.state = S.SCRIPT_ESCAPED_LT;
        break;
      case '\0':
        this.appendChar(REPLACEMENT_CHAR);
        this.state = S.SCRIPT_ESCAPED;
        break;
      default:
        this.appendChar(ch);
        this.state = S.SCRIPT_ESCAPED;
        break;
    }
  }

  private handleScriptEscapedDashDash(ch: string): void {
    switch (ch) {
      case '-':
        this.appendChar('-');
        break;
      case '<':
        this.state = S.SCRIPT_ESCAPED_LT;
        break;
      case '>':
        this.appendChar('>');
        this.state = S.SCRIPT_DATA;
        break;
      case '\0':
        this.appendChar(REPLACEMENT_CHAR);
        this.state = S.SCRIPT_ESCAPED;
        break;
      default:
        this.appendChar(ch);
        this.state = S.SCRIPT_ESCAPED;
        break;
    }
  }

  private handleScriptEscapedLT(ch: string): void {
    if (isAsciiAlpha(ch)) {
      this.scriptEndBuf = ch.toLowerCase();
      this.tagName = ch.toLowerCase();
      this.state = S.SCRIPT_ESCAPED_END_TAG_NAME;
    } else if (ch === '!') {
      this.state = S.SCRIPT_DOUBLE_ESCAPE_START;
    } else {
      this.appendChar('<');
      this.state = S.SCRIPT_ESCAPED;
      this.pos--;
    }
  }

  private handleScriptEscapedEndTagOpen(ch: string): void {
    if (isAsciiAlpha(ch)) {
      this.scriptEndBuf = ch.toLowerCase();
      this.tagName = ch.toLowerCase();
      this.state = S.SCRIPT_ESCAPED_END_TAG_NAME;
    } else {
      this.appendChar('<');
      this.appendChar('/');
      this.state = S.SCRIPT_ESCAPED;
      this.pos--;
    }
  }

  private handleScriptEscapedEndTagName(ch: string): void {
    if (isAsciiAlpha(ch)) {
      this.scriptEndBuf += ch.toLowerCase();
      this.tagName += ch.toLowerCase();
    } else if (ch === '>' || ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') {
      if (this.tagName === 'script') {
        this.flushText();
        this.state = ch === '>' ? S.DATA : S.BEFORE_ATTR_NAME;
        this.selfClosing = false;
        this.endTagMode = false;
        this.emitCloseTag();
        return;
      }
      this.appendChar('<');
      this.appendChar('/');
      this.appendString(this.scriptEndBuf);
      this.state = S.SCRIPT_ESCAPED;
      this.pos--;
    } else {
      this.appendChar('<');
      this.appendChar('/');
      this.appendString(this.scriptEndBuf);
      this.state = S.SCRIPT_ESCAPED;
      this.pos--;
    }
  }

  private handleScriptDoubleEscapeStart(ch: string): void {
    if (isAsciiAlpha(ch)) {
      this.scriptEndBuf = ch.toLowerCase();
      if (this.scriptEndBuf === 'script') {
        this.state = S.SCRIPT_DOUBLE_ESCAPED;
      } else {
        this.appendChar('<');
        this.appendChar('!');
        this.appendString(this.scriptEndBuf);
        this.state = S.SCRIPT_ESCAPED;
      }
    } else {
      this.appendChar('<');
      this.appendChar('!');
      this.state = S.SCRIPT_ESCAPED;
      this.pos--;
    }
  }

  private handleScriptDoubleEscaped(ch: string): void {
    switch (ch) {
      case '-':
        this.state = S.SCRIPT_DOUBLE_ESCAPED_DASH;
        break;
      case '\0':
        this.appendChar(REPLACEMENT_CHAR);
        break;
      default:
        this.appendChar(ch);
        break;
    }
  }

  private handleScriptDoubleEscapedDash(ch: string): void {
    switch (ch) {
      case '-':
        this.state = S.SCRIPT_DOUBLE_ESCAPED_DASH_DASH;
        break;
      case '<':
        this.state = S.SCRIPT_DOUBLE_ESCAPED_LT;
        break;
      case '\0':
        this.appendChar(REPLACEMENT_CHAR);
        this.state = S.SCRIPT_DOUBLE_ESCAPED;
        break;
      default:
        this.appendChar(ch);
        this.state = S.SCRIPT_DOUBLE_ESCAPED;
        break;
    }
  }

  private handleScriptDoubleEscapedDashDash(ch: string): void {
    switch (ch) {
      case '-':
        this.appendChar('-');
        break;
      case '<':
        this.state = S.SCRIPT_DOUBLE_ESCAPED_LT;
        break;
      case '>':
        this.appendChar('>');
        this.state = S.SCRIPT_DATA;
        break;
      case '\0':
        this.appendChar(REPLACEMENT_CHAR);
        this.state = S.SCRIPT_DOUBLE_ESCAPED;
        break;
      default:
        this.appendChar(ch);
        this.state = S.SCRIPT_DOUBLE_ESCAPED;
        break;
    }
  }

  private handleScriptDoubleEscapedLT(ch: string): void {
    if (isAsciiAlpha(ch)) {
      this.scriptEndBuf = ch.toLowerCase();
      if (this.scriptEndBuf === 'script') {
        this.state = S.SCRIPT_DOUBLE_ESCAPE_END;
      } else {
        this.appendChar('<');
        this.appendString(this.scriptEndBuf);
        this.state = S.SCRIPT_DOUBLE_ESCAPED;
      }
    } else {
      this.appendChar('<');
      this.state = S.SCRIPT_DOUBLE_ESCAPED;
      this.pos--;
    }
  }

  private handleScriptDoubleEscapeEnd(ch: string): void {
    if (isAsciiAlpha(ch)) {
      this.scriptEndBuf += ch.toLowerCase();
    } else if (ch === '>' || ch === '\t' || ch === '\n' || ch === '\f' || ch === ' ') {
      if (this.scriptEndBuf === 'script') {
        this.state = S.SCRIPT_DATA;
      } else {
        this.appendString(this.scriptEndBuf);
        this.state = S.SCRIPT_DOUBLE_ESCAPED;
        this.pos--;
      }
    } else {
      this.appendString(this.scriptEndBuf);
      this.state = S.SCRIPT_DOUBLE_ESCAPED;
      this.pos--;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // EOF HANDLING (per-state)
  // ──────────────────────────────────────────────────────────────────

  private handleEOF(): void {
    // Flush any remaining text.
    this.flushText();

    // Close any open tags (implicit close).
    while (this.tagName) {
      this.tagName = '';
    }

    // Emit EOF.
    this.tokens.push({ kind: 'eof', offset: this.pos });
  }

  // ──────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────

  private peek(offset = 0): string {
    return this.input[this.pos + offset] ?? '';
  }

  private appendChar(ch: string): void {
    this.charBuf += ch;
  }

  private appendString(s: string): void {
    this.charBuf += s;
  }

  private flushText(): void {
    if (this.charBuf.length > 0) {
      this.tokens.push({ kind: 'text', data: this.charBuf, offset: this.tokenStart });
      this.charBuf = '';
    }
    this.tokenStart = this.pos + 1;
  }

  private startTag(ch: string): void {
    this.flushText();
    this.tokenStart = this.pos - 1;
    this.tagName = ch;
    this.attrs = new Map();
    this.selfClosing = false;
    this.endTagMode = false;
  }

  private startEndTag(ch: string): void {
    this.flushText();
    this.tokenStart = this.pos - 2;
    this.tagName = ch;
    this.attrs = new Map();
    this.selfClosing = false;
    this.endTagMode = true;
  }

  private commitAttr(): void {
    this.attrs.set(this.attrName, this.attrValue);
    this.attrName = '';
    this.attrValue = '';
  }

  private emitTag(): void {
    if (this.tagName) {
      this.commitAttr();
      const kind: TokenKind = this.endTagMode
        ? 'close'
        : this.selfClosing ? 'selfclose' : 'open';
      this.tokens.push({
        kind,
        tagName: this.tagName,
        attrs:   this.attrs,
        offset:  this.tokenStart,
      });

      // Enter RAWTEXT/RCDATA/SCRIPT/PLAINTEXT if appropriate.
      if (!this.endTagMode) {
        this.setupRawTextMode(this.tagName);
      }
    }
    this.tagName = '';
    this.attrs = new Map();
    this.selfClosing = false;
    this.endTagMode = false;
    this.state = S.DATA;
  }

  private emitCloseTag(): void {
    this.tokens.push({
      kind: 'close',
      tagName: this.tagName,
      offset:  this.tokenStart,
    });
    this.tagName = '';
    this.state = S.DATA;
  }

  private emitComment(): void {
    this.tokens.push({ kind: 'comment', data: this.commentBuf, offset: this.tokenStart });
    this.commentBuf = '';
  }

  private emitDoctype(): void {
    this.tokens.push({
      kind:    'doctype',
      tagName: this.doctypeName || 'html',
      data:    `${this.doctypeName} ${this.doctypePublicId} ${this.doctypeSystemId}`.trim(),
      offset:  this.tokenStart,
    });
    this.doctypeName = '';
    this.doctypePublicId = '';
    this.doctypeSystemId = '';
    this.doctypeForceQuirks = false;
  }

  private emitBogusComment(prefix: string): void {
    this.commentBuf = '';
    this.tokenStart = this.pos - prefix.length;
    this.commentBuf += prefix.slice(2); // skip '<!'
    this.state = S.BOGUS_COMMENT;
  }

  /**
   * After emitting an open tag, switch the tokenizer to the appropriate
   * raw-text state if the element requires it.
   */
  private setupRawTextMode(tagName: string): void {
    if (tagName === 'script') {
      this.rawTextTag = 'script';
      this.state = S.SCRIPT_DATA;
    } else if (tagName === 'style' || tagName === 'xmp' || tagName === 'iframe' ||
               tagName === 'noembed' || tagName === 'noframes') {
      this.rawTextTag = tagName;
      this.state = S.RAWTEXT;
    } else if (tagName === 'textarea' || tagName === 'title') {
      this.rawTextTag = tagName;
      this.state = S.RCDATA;
    } else if (tagName === 'plaintext') {
      this.state = S.PLAINTEXT;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTER CLASS HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function isAsciiAlpha(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A);
}

function isAsciiDigit(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= 0x30 && c <= 0x39;
}

function isAsciiAlphanumeric(ch: string): boolean {
  return isAsciiAlpha(ch) || isAsciiDigit(ch);
}

function isAsciiHexDigit(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return isAsciiDigit(ch) ||
    (c >= 0x41 && c <= 0x46) || // A-F
    (c >= 0x61 && c <= 0x66);   // a-f
}

function hexValue(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { Html5Tokenizer, NAMED_CHAR_REFS };
export type { Token, TokenKind };
