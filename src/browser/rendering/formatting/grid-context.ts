import type { DomElement, LayoutBox } from '../dom-tree';

// ─────────────────────────────────────────────────────────────────────────────
// GRID TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type GridAutoFlow = 'row' | 'column' | 'row dense' | 'column dense';

export type GridAxisAlign =
  | 'start' | 'end' | 'center' | 'stretch';

export type GridSelfAlign =
  | 'auto' | 'start' | 'end' | 'center' | 'stretch';

/** A single grid track (column or row) with resolved size. */
export interface GridTrack {
  /** Minimum size (from min-content, 0, or fr-resolved base). */
  baseSize: number;
  /** Growth limit (from max-content or stretch). */
  growthLimit: number;
  /** Final resolved size after distribution. */
  size: number;
  /** The original track definition string for diagnostics. */
  def: string;
}

/** Placement for a single grid item. */
export interface GridPlacement {
  /** 1-based start column index (or -1 for auto). */
  columnStart: number;
  /** 1-based end column index (exclusive) (or -1 for auto). */
  columnEnd: number;
  /** 1-based start row index (or -1 for auto). */
  rowStart: number;
  /** 1-based end row index (exclusive) (or -1 for auto). */
  rowEnd: number;
  /** Whether the item spans a single cell in each axis. */
  isAutoColumn: boolean;
  isAutoRow: boolean;
  /** `span N` for an auto-placed axis (1 when absent). */
  columnSpan?: number;
  rowSpan?: number;
}

/** A positioned grid item with final offsets. */
export interface GridItem {
  element: DomElement;
  placement: GridPlacement;
  /** Resolved column offset (px). */
  colOffset: number;
  /** Resolved row offset (px). */
  rowOffset: number;
  /** Resolved width for the grid area (px). */
  areaWidth: number;
  /** Resolved height for the grid area (px). */
  areaHeight: number;
  /** Box model for the item. */
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  borderTop: number;
  borderRight: number;
  borderBottom: number;
  borderLeft: number;
  alignSelf: GridSelfAlign;
  justifySelf: GridSelfAlign;
  hasExplicitWidth: boolean;
  hasExplicitHeight: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACK LIST PARSER
// ─────────────────────────────────────────────────────────────────────────────

/** Represents one segment of a grid-template track list. */
interface TrackDef {
  type: 'size' | 'repeat' | 'auto-fill' | 'auto-fit' | 'minmax';
  value: string;
  sizes?: string[];
  count?: number;
  min?: string;
  max?: string;
}

/**
 * Parse a grid-template-columns or grid-template-rows value into track definitions.
 * Supports: <length>, <percentage>, <flex> (fr), auto, minmax(), repeat().
 */
export function parseTrackList(value: string): TrackDef[] {
  const defs: TrackDef[] = [];
  const tokens = value.trim().split(/\s+/);
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i]!;

    if (tok.startsWith('repeat')) {
      // repeat(<count>, <track-list>)
      const rest = tokens.slice(i).join(' ');
      const m = rest.match(/^repeat\(\s*(\d+|auto-fill|auto-fit)\s*,\s*(.+?)\)/);
      if (m) {
        const countOrAuto = m[1]!;
        const inner = m[2]!;
        const innerTokens = inner.split(/\s+/);
        const sizes: string[] = [];
        for (const s of innerTokens) {
          if (s) sizes.push(s);
        }
        if (countOrAuto === 'auto-fill' || countOrAuto === 'auto-fit') {
          defs.push({
            type: countOrAuto === 'auto-fill' ? 'auto-fill' : 'auto-fit',
            value: tok,
            sizes,
          });
        } else {
          const count = parseInt(countOrAuto, 10);
          for (let r = 0; r < count; r++) {
            for (const s of sizes) {
              defs.push({ type: 'size', value: s });
            }
          }
        }
        // Skip tokens consumed by repeat()
        const consumed = rest.substring(0, m[0]!.length).split(/\s+/).length;
        i += consumed;
      } else {
        defs.push({ type: 'size', value: tok });
        i++;
      }
    } else if (tok.startsWith('minmax(')) {
      const rest = tokens.slice(i).join(' ');
      const m = rest.match(/^minmax\(\s*(.+?)\s*,\s*(.+?)\)/);
      if (m) {
        defs.push({ type: 'minmax', value: tok, min: m[1], max: m[2] });
        const consumed = rest.substring(0, m[0]!.length).split(/\s+/).length;
        i += consumed;
      } else {
        defs.push({ type: 'size', value: tok });
        i++;
      }
    } else if (tok.startsWith('[')) {
      // Skip line names [...]
      while (i < tokens.length && !tokens[i]!.endsWith(']')) i++;
      i++; // skip closing ]
    } else if (tok === 'none') {
      i++;
    } else {
      defs.push({ type: 'size', value: tok });
      i++;
    }
  }

  return defs;
}

/** `value` split at top-level `sep` characters (inside (…) and […] they don't split). */
function splitTopLevel(value: string, sep: RegExp, limit = Infinity): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of value) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && sep.test(ch) && out.length < limit) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const isDefiniteTrack = (t: string): boolean => /^-?[\d.]+(px|r?em|%)$/.test(t);

/** A track as one size the grid resolves: minmax(a, b) → b when it is fr or a length, else a. */
function simplifyTrack(track: string): string {
  const mm = /^minmax\((.*)\)$/i.exec(track);
  if (mm) {
    const [min = 'auto', max = 'auto'] = splitTopLevel(mm[1]!, /,/);
    return max.endsWith('fr') || isDefiniteTrack(max) ? max : isDefiniteTrack(min) ? min : 'auto';
  }
  if (/^fit-content\(/i.test(track) || track === 'min-content' || track === 'max-content') return 'auto';
  return track;
}

/** The smallest a track can be, in px, for counting auto-fill repetitions. */
function trackMinPx(track: string, fontSize: number, containerSize: number): number {
  const mm = /^minmax\((.*)\)$/i.exec(track);
  const t = mm ? splitTopLevel(mm[1]!, /,/)[0] ?? '' : track;
  const alt = mm ? splitTopLevel(mm[1]!, /,/)[1] ?? '' : '';
  if (isDefiniteTrack(t)) return resolveTrackBase(t, fontSize, containerSize).px;
  return isDefiniteTrack(alt) ? resolveTrackBase(alt, fontSize, containerSize).px : 0;
}

/**
 * A grid-template-columns/rows value as plain tracks: repeat(N, …) and repeat(auto-fill|auto-fit,
 * …) expanded, minmax()/fit-content() simplified, line names dropped. The whitespace tokenizer
 * cut `repeat(auto-fill,minmax(150px,1fr))` at the first ')' and nothing resolved minmax(), so
 * those tracks were 0px and responsive card grids piled up in the corner.
 * `autoFit` collects the indices of repeat(auto-fit, …) tracks, which collapse when empty.
 * ponytail: minmax keeps one bound.
 */
export function expandTrackList(value: string, available: number, gap: number, fontSize: number, autoFit?: number[]): string[] {
  const out: string[] = [];
  for (const tok of splitTopLevel(value, /\s/)) {
    if (tok.startsWith('[')) continue;
    const rep = /^repeat\((.*)\)$/i.exec(tok);
    if (!rep) { out.push(simplifyTrack(tok)); continue; }
    const [countRaw = '1', listRaw = ''] = splitTopLevel(rep[1]!, /,/, 1);
    const raw = splitTopLevel(listRaw, /\s/).filter((t) => !t.startsWith('['));
    if (raw.length === 0) continue;
    let count = Math.max(1, parseInt(countRaw, 10) || 1);
    if (/^auto-fi(ll|t)$/i.test(countRaw.trim())) {
      const per = raw.reduce((s, t) => s + trackMinPx(t, fontSize, available) + gap, 0);
      count = per > gap * raw.length ? Math.max(1, Math.floor((available + gap) / per)) : 1;
    }
    const list = expandTrackList(raw.join(' '), available, gap, fontSize);
    const fit = /^auto-fit$/i.test(countRaw.trim());
    for (let r = 0; r < count; r++) {
      for (const t of list) { if (fit) autoFit?.push(out.length); out.push(t); }
    }
  }
  return out;
}

/**
 * Resolve a single track definition to a base size in pixels.
 * fr units are resolved later during free space distribution.
 */
export function resolveTrackBase(
  def: string,
  fontSize: number,
  containerSize: number,
): { px: number; isFr: boolean; fr: number } {
  if (def.endsWith('fr')) {
    const fr = parseFloat(def);
    return { px: 0, isFr: true, fr: isNaN(fr) ? 1 : fr };
  }
  if (def === 'auto') {
    return { px: 0, isFr: false, fr: 0 };
  }
  if (def.endsWith('px')) {
    return { px: parseFloat(def) || 0, isFr: false, fr: 0 };
  }
  if (def.endsWith('%')) {
    const pct = parseFloat(def) / 100;
    return { px: containerSize * pct, isFr: false, fr: 0 };
  }
  if (def.endsWith('rem')) { // before em: '2rem' ends with 'em'
    return { px: 16 * parseFloat(def), isFr: false, fr: 0 };
  }
  if (def.endsWith('em')) {
    return { px: fontSize * parseFloat(def), isFr: false, fr: 0 };
  }
  return { px: parseFloat(def) || 0, isFr: false, fr: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// GRID FORMATTING CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

export interface GridFormattingContextOptions {
  /** Parsed grid-template-columns track list. */
  columns: string[];
  /** Parsed grid-template-rows track list. */
  rows: string[];
  /** Column gap in px. */
  columnGap: number;
  /** Row gap in px. */
  rowGap: number;
  /** Container available width (content area). */
  availableWidth: number;
  /** Container available height (content area), or null if auto. */
  availableHeight: number | null;
  /** Container font-size for resolving em/rem. */
  fontSize: number;
  /** justify-items for the grid container. */
  justifyItems: GridAxisAlign;
  /** align-items for the grid container. */
  alignItems: GridAxisAlign;
  /** align-content; normal/stretch (the default) grows auto rows to fill a definite height. */
  alignContent?: string;
  /** justify-content; normal/stretch grows auto columns to fill the width. */
  justifyContent?: string;
  /** grid-auto-flow: row (default), column, with optional dense. */
  autoFlow?: string;
  /** Size of implicit columns / rows (grid-auto-columns / grid-auto-rows). */
  autoColumns?: string;
  autoRows?: string;
  /** Indices of repeat(auto-fit, …) columns: collapsed when no item occupies them. */
  autoFitColumns?: ReadonlySet<number>;
  /** An item's max-content margin-box width (for auto/max-content columns). */
  measureWidth?: (item: GridItem) => number;
  /** An item's margin-box height when laid out at `width` (for auto rows). */
  measureHeight?: (item: GridItem, width: number) => number;
}

export class GridFormattingContext {
  private readonly options: GridFormattingContextOptions;
  private readonly items: GridItem[] = [];
  private colTracks: GridTrack[] = [];
  private rowTracks: GridTrack[] = [];
  private collapsedCols = new Set<number>();

  constructor(options: GridFormattingContextOptions) {
    this.options = options;
  }

  addItem(item: GridItem): void {
    this.items.push(item);
  }

  getItems(): readonly GridItem[] {
    return this.items;
  }

  getColTracks(): readonly GridTrack[] {
    return this.colTracks;
  }

  getRowTracks(): readonly GridTrack[] {
    return this.rowTracks;
  }

  /**
   * Main entry: resolve track sizes, auto-place items, compute positions.
   */
  resolve(): void {
    this.resolveExplicitTracks();
    this.autoPlaceItems();
    this.resolveTrackSizes();
    this.computeItemPositions();
  }

  /**
   * Total grid height for the container.
   */
  getTotalHeight(): number {
    let h = 0;
    for (const track of this.rowTracks) {
      h += track.size;
    }
    h += Math.max(0, this.rowTracks.length - 1) * this.options.rowGap;
    return h;
  }

  // ───────────────────────────────────────────────────────────────────────
  // PRIVATE
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Step 1: Parse grid-template-columns/rows into explicit tracks.
   */
  private resolveExplicitTracks(): void {
    const { columns, rows, fontSize, availableWidth } = this.options;
    const availableHeight = this.options.availableHeight ?? availableWidth;

    this.colTracks = this.buildTracks(columns, fontSize, availableWidth);
    this.rowTracks = this.buildTracks(rows, fontSize, availableHeight);
  }

  private buildTracks(defs: string[], fontSize: number, containerSize: number): GridTrack[] {
    return defs.map((d) => this.makeTrack(d, fontSize, containerSize));
  }

  private makeTrack(d: string, fontSize: number, containerSize: number): GridTrack {
    const { px, isFr } = resolveTrackBase(d, fontSize, containerSize);
    return { baseSize: px, growthLimit: isFr ? Infinity : px, size: 0, def: d };
  }

  /**
   * Step 2: place the items (CSS Grid §8.5). Items with both lines definite first, then those
   * locked to a row (column with column flow), then the rest by the auto-placement cursor, in
   * `order` order. `dense` restarts the search at the start for each item; column flow fills
   * columns first. Before, only row flow existed, definite lines ignored order and flow, and
   * spans past the explicit columns were cut.
   */
  private autoPlaceItems(): void {
    const colFlow = /column/.test(this.options.autoFlow ?? '');
    const dense = /dense/.test(this.options.autoFlow ?? '');
    const order = (it: GridItem) => parseInt(it.element.computedStyle?.get('order') ?? '0', 10) || 0;
    const items = this.items.map((it, i) => ({ it, i })).sort((a, b) => order(a.it) - order(b.it) || a.i - b.i).map((x) => x.it);
    // Major axis: rows for row flow (the cursor moves along columns, then down rows).
    const minorCount = Math.max(1, colFlow ? this.rowTracks.length : this.colTracks.length);
    const occupied = new Set<string>();
    const key = (c: number, r: number) => `${c},${r}`;
    const mark = (p: GridPlacement) => {
      for (let c = p.columnStart; c < p.columnEnd; c++) for (let r = p.rowStart; r < p.rowEnd; r++) occupied.add(key(c, r));
    };
    const free = (c0: number, c1: number, r0: number, r1: number) => {
      for (let c = c0; c < c1; c++) for (let r = r0; r < r1; r++) if (occupied.has(key(c, r))) return false;
      return true;
    };
    const span = (s: number, e: number, sp?: number) => (s > 0 && e > s ? e - s : Math.max(1, sp ?? 1));
    // Minor/major accessors so one loop serves both flows.
    const get = (p: GridPlacement) => colFlow
      ? { minS: p.rowStart, minE: p.rowEnd, minSpan: p.rowSpan, majS: p.columnStart, majE: p.columnEnd, majSpan: p.columnSpan }
      : { minS: p.columnStart, minE: p.columnEnd, minSpan: p.columnSpan, majS: p.rowStart, majE: p.rowEnd, majSpan: p.rowSpan };
    const set = (p: GridPlacement, minS: number, minN: number, majS: number, majN: number) => {
      if (colFlow) { p.rowStart = minS; p.rowEnd = minS + minN; p.columnStart = majS; p.columnEnd = majS + majN; }
      else { p.columnStart = minS; p.columnEnd = minS + minN; p.rowStart = majS; p.rowEnd = majS + majN; }
    };
    const fits = (minS: number, minN: number, majS: number, majN: number) => colFlow
      ? free(majS, majS + majN, minS, minS + minN) : free(minS, minS + minN, majS, majS + majN);
    const definite = (s: number) => s > 0;

    // 1. Both axes definite.
    for (const it of items) {
      const p = it.placement;
      if (definite(p.columnStart) && definite(p.rowStart)) {
        if (p.columnEnd <= p.columnStart) p.columnEnd = p.columnStart + 1;
        if (p.rowEnd <= p.rowStart) p.rowEnd = p.rowStart + 1;
        mark(p);
      }
    }
    // 2. Locked to a major-axis line (a row in row flow): first free minor position in it.
    for (const it of items) {
      const p = it.placement; const a = get(p);
      if (definite(a.minS) || !definite(a.majS)) continue;
      const majN = span(a.majS, a.majE, a.majSpan); const minN = Math.min(span(a.minS, a.minE, a.minSpan), minorCount);
      let m = 1;
      while (m + minN - 1 <= minorCount && !fits(m, minN, a.majS, majN)) m++;
      set(p, m, minN, a.majS, majN); mark(p);
    }
    // 3. The rest, by the cursor.
    let curMaj = 1, curMin = 1;
    for (const it of items) {
      const p = it.placement; const a = get(p);
      if (definite(a.majS)) continue;
      const majN = span(a.majS, a.majE, a.majSpan);
      if (dense) { curMaj = 1; curMin = 1; }
      if (definite(a.minS)) {
        // Fixed minor line (a column in row flow): the first major line where it fits.
        const minN = span(a.minS, a.minE, a.minSpan);
        if (a.minS < curMin && !dense) curMaj++;
        while (!fits(a.minS, minN, curMaj, majN)) curMaj++;
        set(p, a.minS, minN, curMaj, majN); mark(p);
        curMin = a.minS + minN;
        continue;
      }
      const minN = Math.min(span(a.minS, a.minE, a.minSpan), minorCount);
      for (let guard = 0; guard < 100000; guard++) {
        if (curMin + minN - 1 > minorCount) { curMin = 1; curMaj++; }
        if (fits(curMin, minN, curMaj, majN)) break;
        curMin++;
      }
      set(p, curMin, minN, curMaj, majN); mark(p);
      curMin += minN;
    }

    // Implicit tracks (grid-auto-rows / grid-auto-columns) for anything placed past the grid.
    let maxRow = 0, maxCol = 0;
    for (const it of this.items) {
      maxRow = Math.max(maxRow, it.placement.rowEnd - 1);
      maxCol = Math.max(maxCol, it.placement.columnEnd - 1);
    }
    const { fontSize, availableWidth } = this.options;
    const firstOf = (list: string | undefined) => (list ? expandTrackList(list, availableWidth, 0, fontSize)[0] : undefined) ?? 'auto';
    while (this.rowTracks.length < maxRow) this.rowTracks.push(this.makeTrack(firstOf(this.options.autoRows), fontSize, this.options.availableHeight ?? availableWidth));
    while (this.colTracks.length < maxCol) this.colTracks.push(this.makeTrack(firstOf(this.options.autoColumns), fontSize, availableWidth));

    // repeat(auto-fit, …) columns nothing occupies collapse to nothing, gaps included.
    this.collapsedCols = new Set([...(this.options.autoFitColumns ?? [])].filter((c) =>
      !this.items.some((it) => it.placement.columnStart - 1 <= c && c < it.placement.columnEnd - 1)));
  }

  /**
   * Step 3: track sizes (simplified CSS Grid §11): fixed tracks keep their size; auto tracks take
   * their items' content size (max-content width, height at the column width); fr tracks share the
   * leftover space (in an indefinite height, an fr row is content-sized); with justify/align-content
   * normal or stretch, auto tracks share what is still left. Rows used only items' explicit heights,
   * so text-only grids had 0-height rows and the content after them overlapped.
   */
  private resolveTrackSizes(): void {
    const { availableWidth, columnGap, rowGap, availableHeight } = this.options;
    for (const c of this.collapsedCols) { const t = this.colTracks[c]; if (t) { t.baseSize = 0; t.def = '0px'; } }

    this.sizeAxis(this.colTracks, 'width', availableWidth, columnGap, this.options.justifyContent, this.collapsedCols);
    // Rows need the columns: an item's height depends on the width it gets.
    this.sizeAxis(this.rowTracks, 'height', availableHeight, rowGap, this.options.alignContent, new Set());
  }

  private sizeAxis(tracks: GridTrack[], axis: 'width' | 'height', container: number | null, gap: number, content: string | undefined, collapsed: ReadonlySet<number>): void {
    const isFr = (t: GridTrack) => t.def.trim().endsWith('fr');
    const isAuto = (t: GridTrack) => t.def.trim() === 'auto';
    const range = (it: GridItem) => axis === 'width'
      ? [it.placement.columnStart - 1, it.placement.columnEnd - 1] as const
      : [it.placement.rowStart - 1, it.placement.rowEnd - 1] as const;
    const contribution = (it: GridItem): number => {
      const st = it.element.computedStyle ?? new Map<string, string>();
      const raw = st.get(axis);
      const margins = axis === 'width' ? it.marginLeft + it.marginRight : it.marginTop + it.marginBottom;
      if (raw && raw !== 'auto' && !raw.endsWith('%')) return this.resolveLength(raw) + margins;
      if (axis === 'width') return this.options.measureWidth?.(it) ?? 0;
      return this.options.measureHeight?.(it, this.areaSize(it, 'width')) ?? 0;
    };

    // Content-sized tracks (auto, and fr in an indefinite axis): the largest single-span item.
    const indefinite = container == null;
    for (const it of this.items) {
      const [s, e] = range(it);
      if (e - s !== 1) continue;
      const t = tracks[s];
      if (!t || collapsed.has(s)) continue;
      if (isAuto(t) || (isFr(t) && indefinite)) {
        t.baseSize = Math.max(t.baseSize, contribution(it));
      } else if (!isFr(t)) {
        // A fixed track still grows to an explicit item size larger than itself (as before).
        const st = it.element.computedStyle?.get(axis);
        if (st && st !== 'auto' && !st.endsWith('%')) t.baseSize = Math.max(t.baseSize, this.resolveLength(st));
      }
    }
    // Items spanning several tracks: spread what they still need over the auto tracks they cross.
    for (const it of this.items) {
      const [s, e] = range(it);
      if (e - s < 2) continue;
      const spanned = tracks.slice(s, e);
      const autos = spanned.filter((t) => isAuto(t) || (isFr(t) && indefinite));
      if (autos.length === 0 || spanned.some((t) => isFr(t) && !indefinite)) continue;
      const have = spanned.reduce((n, t) => n + t.baseSize, 0) + gap * (e - s - 1);
      const need = contribution(it) - have;
      if (need > 0) for (const t of autos) t.baseSize += need / autos.length;
    }

    const visible = tracks.filter((_, i) => !collapsed.has(i)).length;
    const gaps = Math.max(0, visible - 1) * gap;
    if (container != null) {
      // Content-sized auto tracks don't push the grid past a definite container: they shrink
      // together to the room the fixed tracks leave (max-content is their limit, not their floor).
      const autoIdx = tracks.map((t, i) => (isAuto(t) && !collapsed.has(i) ? i : -1)).filter((i) => i >= 0);
      const autoSum = autoIdx.reduce((n, i) => n + tracks[i]!.baseSize, 0);
      const room = container - gaps - tracks.reduce((n, t, i) => n + (autoIdx.includes(i) || isFr(t) ? 0 : t.baseSize), 0);
      if (autoSum > room && autoSum > 0) for (const i of autoIdx) tracks[i]!.baseSize *= Math.max(0, room) / autoSum;
      // fr tracks share the leftover space (an fr track is never smaller than its base size).
      const frs = tracks.filter(isFr);
      if (frs.length > 0) {
        let fixed = tracks.filter((t) => !isFr(t)).reduce((n, t) => n + t.baseSize, 0);
        let pool = frs.slice();
        for (let pass = 0; pass < 4; pass++) {
          const totalFr = pool.reduce((n, t) => n + (parseFloat(t.def) || 1), 0);
          const per = Math.max(0, container - gaps - fixed) / (totalFr || 1);
          const tooSmall = pool.filter((t) => (parseFloat(t.def) || 1) * per < t.baseSize);
          if (tooSmall.length === 0) { for (const t of pool) t.baseSize = (parseFloat(t.def) || 1) * per; break; }
          for (const t of tooSmall) fixed += t.baseSize;
          pool = pool.filter((t) => !tooSmall.includes(t));
        }
      } else if (!content || content === 'normal' || content === 'stretch') {
        // No fr tracks: auto tracks stretch over the remaining space.
        const autos = tracks.filter((t, i) => isAuto(t) && !collapsed.has(i));
        const left = container - gaps - tracks.reduce((n, t) => n + t.baseSize, 0);
        if (autos.length > 0 && left > 0) for (const t of autos) t.baseSize += left / autos.length;
      }
    } else {
      // Indefinite: fr tracks take the same size per fr, enough for the largest.
      const frs = tracks.filter(isFr);
      const perFr = frs.reduce((m, t) => Math.max(m, t.baseSize / (parseFloat(t.def) || 1)), 0);
      for (const t of frs) t.baseSize = perFr * (parseFloat(t.def) || 1);
    }
    for (const t of tracks) t.size = t.baseSize;
  }

  /** Start offset of every track along an axis, with justify-/align-content distribution. */
  private trackOffsets(axis: 'width' | 'height'): number[] {
    const tracks = axis === 'width' ? this.colTracks : this.rowTracks;
    const gap = axis === 'width' ? this.options.columnGap : this.options.rowGap;
    const collapsed = axis === 'width' ? this.collapsedCols : new Set<number>();
    const container = axis === 'width' ? this.options.availableWidth : this.options.availableHeight;
    const content = (axis === 'width' ? this.options.justifyContent : this.options.alignContent) ?? 'normal';
    const visible = tracks.map((_, i) => i).filter((i) => !collapsed.has(i));
    const used = visible.reduce((n, i) => n + tracks[i]!.size, 0) + Math.max(0, visible.length - 1) * gap;
    const free = container != null ? Math.max(0, container - used) : 0;
    let start = 0, extra = 0;
    const n = visible.length;
    switch (content) {
      case 'center': start = free / 2; break;
      case 'end': case 'flex-end': case 'right': start = free; break;
      case 'space-between': extra = n > 1 ? free / (n - 1) : 0; break;
      case 'space-around': extra = n > 0 ? free / n : 0; start = extra / 2; break;
      case 'space-evenly': extra = free / (n + 1); start = extra; break;
    }
    const offsets: number[] = [];
    let pos = start;
    for (let i = 0; i < tracks.length; i++) {
      offsets.push(pos);
      if (collapsed.has(i)) continue;
      pos += tracks[i]!.size + gap + extra;
    }
    return offsets;
  }

  /** The size of an item's grid area along an axis. */
  private areaSize(item: GridItem, axis: 'width' | 'height'): number {
    const tracks = axis === 'width' ? this.colTracks : this.rowTracks;
    const gap = axis === 'width' ? this.options.columnGap : this.options.rowGap;
    const collapsed = axis === 'width' ? this.collapsedCols : new Set<number>();
    const s = (axis === 'width' ? item.placement.columnStart : item.placement.rowStart) - 1;
    const e = (axis === 'width' ? item.placement.columnEnd : item.placement.rowEnd) - 1;
    let size = 0, count = 0;
    for (let i = s; i < e && i < tracks.length; i++) {
      if (collapsed.has(i)) continue;
      size += tracks[i]!.size; count++;
    }
    return size + Math.max(0, count - 1) * gap;
  }

  /**
   * Step 4: Compute final positions for each item.
   * colOffset/rowOffset = desired BORDER BOX position relative to contentX/contentY.
   * The engine will call layoutNode then reposition the box to this exact position.
   */
  private computeItemPositions(): void {
    const { alignItems, justifyItems } = this.options;
    const colOffsets = this.trackOffsets('width');
    const rowOffsets = this.trackOffsets('height');

    for (const item of this.items) {
      const p = item.placement;
      const areaW = this.areaSize(item, 'width');
      const areaH = this.areaSize(item, 'height');
      item.areaWidth = areaW;
      item.areaHeight = areaH;

      // Track start positions
      const trackStartX = colOffsets[p.columnStart - 1] ?? 0;
      const trackStartY = rowOffsets[p.rowStart - 1] ?? 0;

      // Compute margin box dimensions
      const marginBoxW = item.marginLeft + item.borderLeft + item.paddingLeft
        + (item.hasExplicitWidth
          ? (item.element.computedStyle?.get('width')
              ? this.resolveLength(item.element.computedStyle!.get('width')!)
              : areaW - item.marginLeft - item.marginRight
                - item.borderLeft - item.borderRight
                - item.paddingLeft - item.paddingRight)
          : areaW - item.marginLeft - item.marginRight
            - item.borderLeft - item.borderRight
            - item.paddingLeft - item.paddingRight)
        + item.paddingRight + item.borderRight + item.marginRight;

      const marginBoxH = item.marginTop + item.borderTop + item.paddingTop
        + (item.hasExplicitHeight
          ? (item.element.computedStyle?.get('height')
              ? this.resolveLength(item.element.computedStyle!.get('height')!)
              : areaH - item.marginTop - item.marginBottom
                - item.borderTop - item.borderBottom
                - item.paddingTop - item.paddingBottom)
          : areaH - item.marginTop - item.marginBottom
            - item.borderTop - item.borderBottom
            - item.paddingTop - item.paddingBottom)
        + item.paddingBottom + item.borderBottom + item.marginBottom;

      // Apply justify-self → compute desired border box X
      const effectiveJustify = item.justifySelf === 'auto' ? justifyItems : item.justifySelf;
      let desiredX: number;
      switch (effectiveJustify) {
        case 'end':
          desiredX = trackStartX + areaW - marginBoxW + item.marginLeft;
          break;
        case 'center':
          desiredX = trackStartX + (areaW - marginBoxW) / 2 + item.marginLeft;
          break;
        case 'stretch':
          // stretch: item fills available space, starts at track start + margin
          desiredX = trackStartX + item.marginLeft;
          break;
        case 'start':
        default:
          desiredX = trackStartX + item.marginLeft;
          break;
      }

      // Apply align-self → compute desired border box Y
      const effectiveAlign = item.alignSelf === 'auto' ? alignItems : item.alignSelf;
      let desiredY: number;
      switch (effectiveAlign) {
        case 'end':
          desiredY = trackStartY + areaH - marginBoxH + item.marginTop;
          break;
        case 'center':
          desiredY = trackStartY + (areaH - marginBoxH) / 2 + item.marginTop;
          break;
        case 'stretch':
          desiredY = trackStartY + item.marginTop;
          break;
        case 'start':
        default:
          desiredY = trackStartY + item.marginTop;
          break;
      }

      item.colOffset = desiredX;
      item.rowOffset = desiredY;
    }
  }

  /**
   * After layoutNode is called and actual sizes are known, recompute
   * alignment for auto-sized items with center/end justify/align.
   * Call this after layoutNode has run for all items.
   */
  recomputeAlignmentForAutoSize(): void {
    const { alignItems, justifyItems } = this.options;
    const colOffsets = this.trackOffsets('width');
    const rowOffsets = this.trackOffsets('height');

    for (const item of this.items) {
      const box = item.element.layoutBox;
      if (!box) continue;

      const p = item.placement;
      const areaW = this.areaSize(item, 'width');
      const areaH = this.areaSize(item, 'height');
      item.areaWidth = areaW;
      item.areaHeight = areaH;

      const trackStartX = colOffsets[p.columnStart - 1] ?? 0;
      const trackStartY = rowOffsets[p.rowStart - 1] ?? 0;

      // Actual margin box size from laid-out box
      const actualMarginBoxW = box.marginLeft + box.width + box.marginRight;
      const actualMarginBoxH = box.marginTop + box.height + box.marginBottom;

      const effectiveJustify = item.justifySelf === 'auto' ? justifyItems : item.justifySelf;
      switch (effectiveJustify) {
        case 'end':
          item.colOffset = trackStartX + areaW - actualMarginBoxW + box.marginLeft;
          break;
        case 'center':
          item.colOffset = trackStartX + (areaW - actualMarginBoxW) / 2 + box.marginLeft;
          break;
        default:
          item.colOffset = trackStartX + box.marginLeft;
          break;
      }

      const effectiveAlign = item.alignSelf === 'auto' ? alignItems : item.alignSelf;
      switch (effectiveAlign) {
        case 'end':
          item.rowOffset = trackStartY + areaH - actualMarginBoxH + box.marginTop;
          break;
        case 'center':
          item.rowOffset = trackStartY + (areaH - actualMarginBoxH) / 2 + box.marginTop;
          break;
        default:
          item.rowOffset = trackStartY + box.marginTop;
          break;
      }
    }
  }

  private resolveLength(raw: string): number {
    return resolveTrackBase(raw, this.options.fontSize, this.options.availableWidth).px;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GRID ITEM PLACEMENT PARSER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse grid-column, grid-row, or grid-area values into a GridPlacement.
 */
export function parseGridPlacement(
  value: string | undefined,
  isRow: boolean,
): { start: number; end: number; span?: number } {
  if (!value || value === 'auto') return { start: -1, end: -1 };
  // `span N` (CSS Grid §8.3): `span 2`, `1 / span 2`, `span 2 / 4`. It parsed as auto, so the
  // item took one cell (a wide card or a full-width header in a grid stayed one column wide).
  const spanOf = (s: string | undefined): number | null => {
    const m = /^span\s+(\d+)$/.exec((s ?? '').trim());
    return m ? Math.max(1, parseInt(m[1]!, 10)) : null;
  };
  const halves = value.split('/').map((s) => s.trim());
  if (halves.length <= 2) {
    const [a, b] = halves;
    const sa = spanOf(a), sb = spanOf(b);
    if (sa !== null || sb !== null) {
      if (sa !== null && b === undefined) return { start: -1, end: -1, span: sa };
      if (sb !== null) { const start = parseGridLine(a!); return start > 0 ? { start, end: start + sb } : { start: -1, end: -1, span: sb }; }
      const end = parseGridLine(b!); return end > 0 ? { start: Math.max(1, end - sa!), end } : { start: -1, end: -1, span: sa! };
    }
  }

  // grid-area: row-start / col-start / row-end / col-end
  const parts = value.split('/').map(s => s.trim());
  if (parts.length === 4) {
    const idx = isRow ? 0 : 1;
    const start = parseGridLine(parts[idx]!);
    const end = parseGridLine(parts[idx + 2]!);
    return { start, end };
  }
  if (parts.length === 3) {
    // row-start / col-start / row-end (col-end is auto)
    const idx = isRow ? 0 : 1;
    const start = parseGridLine(parts[idx]!);
    const end = isRow ? parseGridLine(parts[2]!) : -1;
    return { start, end };
  }
  if (parts.length === 2) {
    // start / end
    const start = parseGridLine(parts[0]!);
    const end = parseGridLine(parts[1]!);
    return { start, end };
  }
  if (parts.length === 1) {
    // single value: grid-column: 2 means start=2, end=3
    const start = parseGridLine(parts[0]!);
    return { start, end: start > 0 ? start + 1 : -1 };
  }
  return { start: -1, end: -1 };
}

function parseGridLine(s: string): number {
  s = s.trim();
  if (s === 'auto' || s === '') return -1;
  const n = parseInt(s, 10);
  return isNaN(n) ? -1 : n;
}

/**
 * Parse grid-template-areas into row/column arrays.
 * Returns { rows: string[][], columns: number } where rows[r][c] is the area name.
 */
export function parseGridTemplateAreas(value: string): { rows: string[][]; columns: number } {
  if (!value || value === 'none') return { rows: [], columns: 0 };

  // Single-quoted rows are valid CSS strings too; only "…" rows were read.
  const lines = value.match(/"[^"]*"|'[^']*'/g);
  if (!lines) return { rows: [], columns: 0 };

  const rows: string[][] = [];
  let columns = 0;
  for (const line of lines) {
    const inner = line.slice(1, -1).trim();
    const cells = inner.split(/\s+/);
    rows.push(cells);
    columns = Math.max(columns, cells.length);
  }
  return { rows, columns };
}

/**
 * Given grid-template-areas, find the placement for a named area.
 * Returns { colStart, colEnd, rowStart, rowEnd } (1-based, end exclusive).
 */
export function findAreaPlacement(
  areaName: string,
  templateAreas: { rows: string[][]; columns: number },
): { colStart: number; colEnd: number; rowStart: number; rowEnd: number } | null {
  const { rows } = templateAreas;
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  let found = false;

  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r]!.length; c++) {
      if (rows[r]![c] === areaName) {
        found = true;
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minC = Math.min(minC, c);
        maxC = Math.max(maxC, c);
      }
    }
  }

  if (!found) return null;

  return {
    colStart: minC + 1,
    colEnd: maxC + 2,
    rowStart: minR + 1,
    rowEnd: maxR + 2,
  };
}

/**
 * Named lines of a track list: `[a b] 100px [c] 1fr` names line 1 `a`/`b` and line 2 `c`.
 * ponytail: names inside repeat() are not counted.
 */
export function gridLineNames(trackList: string | undefined, available: number, gap: number, fontSize: number): Map<string, number[]> {
  const names = new Map<string, number[]>();
  if (!trackList) return names;
  let line = 1;
  for (const tok of splitTopLevel(trackList, /\s/)) {
    if (tok.startsWith('[')) {
      for (const n of tok.slice(1, -1).trim().split(/\s+/)) if (n) names.set(n, [...(names.get(n) ?? []), line]);
      continue;
    }
    line += /^repeat\(/i.test(tok) ? expandTrackList(tok, available, gap, fontSize).length : 1;
  }
  return names;
}

/** grid-template-areas give implicit `<area>-start` / `<area>-end` line names on each axis. */
export function addAreaLineNames(names: Map<string, number[]>, areas: { rows: string[][] }, axis: 'column' | 'row'): void {
  const seen = new Set(areas.rows.flat().filter((n) => n !== '.'));
  for (const area of seen) {
    const p = findAreaPlacement(area, { rows: areas.rows, columns: 0 });
    if (!p) continue;
    const [s, e] = axis === 'column' ? [p.colStart, p.colEnd] : [p.rowStart, p.rowEnd];
    if (!names.has(`${area}-start`)) names.set(`${area}-start`, [s]);
    if (!names.has(`${area}-end`)) names.set(`${area}-end`, [e]);
  }
}

/**
 * One axis of an item's placement from its start/end values (CSS Grid §8.3): line numbers (negative
 * count from the end of the explicit grid), line names (an area name means its -start/-end line),
 * `span N`, `auto`. Returns 1-based lines, -1 for auto, and the span of an auto-placed axis.
 * Negative and named lines were read as auto, so `grid-column: 1 / -1` (full-width rows) and
 * `grid-column: content` layouts collapsed to one cell.
 */
export function resolveGridAxis(
  startRaw: string | undefined, endRaw: string | undefined, names: Map<string, number[]>, trackCount: number,
): { start: number; end: number; span?: number } {
  type V = { line?: number; span?: number };
  const parse = (raw: string | undefined, side: 'start' | 'end'): V => {
    const t = (raw ?? 'auto').trim();
    if (t === '' || t === 'auto') return {};
    const sp = /^span\s+(\d+)$/i.exec(t);
    if (sp) return { span: Math.max(1, parseInt(sp[1]!, 10)) };
    if (/^span\s+/i.test(t)) return { span: 1 };
    const n = /^-?\d+$/.test(t) ? parseInt(t, 10) : NaN;
    if (!isNaN(n) && n !== 0) return { line: n > 0 ? n : trackCount + 2 + n };
    const named = names.get(`${t}-${side}`)?.[0] ?? names.get(t)?.[0];
    return named !== undefined ? { line: named } : {};
  };
  const a = parse(startRaw, 'start'), b = parse(endRaw, 'end');
  if (a.line !== undefined && b.line !== undefined) {
    const [s, e] = a.line <= b.line ? [a.line, b.line] : [b.line, a.line];
    return { start: Math.max(1, s), end: e === s ? s + 1 : e };
  }
  if (a.line !== undefined) return { start: Math.max(1, a.line), end: Math.max(1, a.line) + (b.span ?? 1) };
  if (b.line !== undefined) return { start: Math.max(1, b.line - (a.span ?? 1)), end: Math.max(2, b.line) };
  return { start: -1, end: -1, span: a.span ?? b.span };
}
