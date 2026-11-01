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
 * ponytail: auto-fit is auto-fill (empty tracks aren't collapsed); minmax keeps one bound.
 */
export function expandTrackList(value: string, available: number, gap: number, fontSize: number): string[] {
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
    for (let r = 0; r < count; r++) out.push(...list);
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
}

export class GridFormattingContext {
  private readonly options: GridFormattingContextOptions;
  private readonly items: GridItem[] = [];
  private colTracks: GridTrack[] = [];
  private rowTracks: GridTrack[] = [];

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
    const tracks: GridTrack[] = [];
    for (const d of defs) {
      const { px, isFr, fr } = resolveTrackBase(d, fontSize, containerSize);
      tracks.push({
        baseSize: px,
        growthLimit: isFr ? Infinity : px,
        size: 0,
        def: d,
      });
    }
    return tracks;
  }

  /**
   * Step 2: Auto-place items that have auto grid-column/grid-row.
   */
  private autoPlaceItems(): void {
    const { columns, rows } = this.options;
    const explicitColCount = this.colTracks.length;
    const explicitRowCount = this.rowTracks.length;

    // Occupy grid: occupied[col][row] = true
    const occupied: boolean[][] = [];
    for (let c = 0; c < explicitColCount + 50; c++) {
      occupied[c] = [];
    }

    // Mark explicit placements
    for (const item of this.items) {
      const p = item.placement;
      if (p.columnStart > 0 && p.rowStart > 0) {
        const cs = p.columnStart - 1;
        const ce = p.columnEnd > 0 ? p.columnEnd - 1 : cs + 1;
        const rs = p.rowStart - 1;
        const re = p.rowEnd > 0 ? p.rowEnd - 1 : rs + 1;
        for (let c = cs; c < ce; c++) {
          for (let r = rs; r < re; r++) {
            if (!occupied[c]) occupied[c] = [];
            occupied[c]![r] = true;
          }
        }
      }
    }

    // Auto-place remaining items
    let autoRow = 0;
    let autoCol = 0;

    for (const item of this.items) {
      const p = item.placement;
      if (p.columnStart > 0 && p.rowStart > 0) continue; // already placed

      // Find next free run of cells as wide (and tall) as the item's spans
      const colSpan = p.columnStart <= 0 ? Math.min(p.columnSpan ?? 1, Math.max(1, explicitColCount)) : 1;
      const rowSpan = p.rowStart <= 0 ? (p.rowSpan ?? 1) : 1;
      const fits = (c0: number, r0: number): boolean => {
        for (let c = c0; c < c0 + colSpan; c++) for (let r = r0; r < r0 + rowSpan; r++) if (occupied[c]?.[r]) return false;
        return true;
      };
      let placed = false;
      while (!placed && autoRow < 1000) {
        if (autoCol + colSpan > Math.max(explicitColCount, colSpan)) {
          autoCol = 0;
          autoRow++;
        }
        if (autoRow >= occupied.length) break;
        if (fits(autoCol, autoRow)) {
          // Place here — only set axes that are auto
          if (p.columnStart <= 0) {
            p.columnStart = autoCol + 1;
            p.columnEnd = autoCol + 1 + colSpan;
          } else if (p.columnEnd <= 0) {
            p.columnEnd = p.columnStart + 1;
          }
          if (p.rowStart <= 0) {
            p.rowStart = autoRow + 1;
            p.rowEnd = autoRow + 1 + rowSpan;
          } else if (p.rowEnd <= 0) {
            p.rowEnd = p.rowStart + 1;
          }
          // Mark occupied
          const cs = p.columnStart - 1;
          const ce = p.columnEnd - 1;
          const rs = p.rowStart - 1;
          const re = p.rowEnd - 1;
          for (let c = cs; c < ce; c++) {
            for (let r = rs; r < re; r++) {
              if (!occupied[c]) occupied[c] = [];
              occupied[c]![r] = true;
            }
          }
          autoCol = ce;
          placed = true;
        } else {
          autoCol++;
        }
      }

      // If not placed (grid full), extend implicit tracks
      if (!placed) {
        if (p.rowStart <= 0) {
          autoRow++;
          p.rowStart = autoRow + 1;
          p.rowEnd = autoRow + 2;
        }
        if (p.columnStart <= 0) {
          p.columnStart = 1;
          p.columnEnd = 2;
        }
      }
    }

    // Ensure we have enough implicit row tracks
    let maxRow = 0;
    let maxCol = 0;
    for (const item of this.items) {
      maxRow = Math.max(maxRow, item.placement.rowEnd - 1);
      maxCol = Math.max(maxCol, item.placement.columnEnd - 1);
    }
    while (this.rowTracks.length < maxRow) {
      this.rowTracks.push({ baseSize: 0, growthLimit: Infinity, size: 0, def: 'auto' });
    }
    while (this.colTracks.length < maxCol) {
      this.colTracks.push({ baseSize: 0, growthLimit: Infinity, size: 0, def: 'auto' });
    }
  }

  /**
   * Step 3: Resolve final track sizes.
   * Simplified grid sizing: use item intrinsic sizes + distribute fr space.
   */
  private resolveTrackSizes(): void {
    const { availableWidth, columnGap, rowGap, fontSize, availableHeight } = this.options;

    // Gather column intrinsic sizes from items
    this.resolveTrackIntrinsics(this.colTracks, availableWidth, columnGap, 'width');
    this.resolveTrackIntrinsics(this.rowTracks, availableHeight ?? availableWidth, rowGap, 'height');

    // Distribute fr units
    this.distributeFrUnits(this.colTracks, availableWidth, columnGap);
    this.distributeFrUnits(this.rowTracks, availableHeight ?? availableWidth, rowGap);

    // Final pass: assign sizes
    for (const t of this.colTracks) {
      t.size = t.baseSize;
    }
    for (const t of this.rowTracks) {
      t.size = t.baseSize;
    }

    // align-content: normal/stretch shares a definite height's leftover space among auto rows
    // (CSS Grid §12.8). Rows stayed content-sized, so `place-items: center` in a fixed-height
    // button left the icon at the top (httpforever's theme button).
    const ac = this.options.alignContent ?? 'normal';
    if (availableHeight != null && (ac === 'normal' || ac === 'stretch')) {
      const autos = this.rowTracks.filter((t) => t.def.trim() === 'auto');
      const used = this.rowTracks.reduce((s, t) => s + t.size, 0) + rowGap * Math.max(0, this.rowTracks.length - 1);
      const extra = availableHeight - used;
      if (autos.length > 0 && extra > 0) for (const t of autos) t.size += extra / autos.length;
    }
  }

  private resolveTrackIntrinsics(
    tracks: GridTrack[],
    containerSize: number,
    gap: number,
    axis: 'width' | 'height',
  ): void {
    // For each track, find the maximum intrinsic size of items in that track
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]!;
      let maxIntrinsic = 0;

      for (const item of this.items) {
        const inTrack = axis === 'width'
          ? (item.placement.columnStart - 1 <= i && i < item.placement.columnEnd - 1)
          : (item.placement.rowStart - 1 <= i && i < item.placement.rowEnd - 1);
        if (!inTrack) continue;

        const elStyle = item.element.computedStyle ?? new Map();
        const rawSize = axis === 'width'
          ? elStyle.get('width')
          : elStyle.get('height');
        if (rawSize && rawSize !== 'auto') {
          const sz = this.resolveLength(rawSize);
          maxIntrinsic = Math.max(maxIntrinsic, sz);
        }
      }

      if (!track.def.endsWith('fr') && track.def !== 'auto') {
        track.baseSize = Math.max(track.baseSize, maxIntrinsic);
      } else if (maxIntrinsic > track.baseSize) {
        track.baseSize = maxIntrinsic;
      }
    }
  }

  private distributeFrUnits(tracks: GridTrack[], containerSize: number, gap: number): void {
    const totalGaps = Math.max(0, tracks.length - 1) * gap;
    const usedSpace = tracks.reduce((s, t) => s + t.baseSize, 0) + totalGaps;
    const freeSpace = containerSize - usedSpace;

    if (freeSpace <= 0) return;

    let totalFr = 0;
    for (const t of tracks) {
      if (t.def.endsWith('fr')) {
        totalFr += parseFloat(t.def) || 1;
      }
    }
    if (totalFr <= 0) return;

    for (const t of tracks) {
      if (t.def.endsWith('fr')) {
        const fr = parseFloat(t.def) || 1;
        t.baseSize += (fr / totalFr) * freeSpace;
      }
    }
  }

  /**
   * Step 4: Compute final positions for each item.
   * colOffset/rowOffset = desired BORDER BOX position relative to contentX/contentY.
   * The engine will call layoutNode then reposition the box to this exact position.
   */
  private computeItemPositions(): void {
    const { columnGap, rowGap, alignItems, justifyItems } = this.options;

    // Compute column offsets (track start positions)
    const colOffsets: number[] = [];
    let cx = 0;
    for (let i = 0; i < this.colTracks.length; i++) {
      colOffsets.push(cx);
      cx += this.colTracks[i]!.size;
      if (i < this.colTracks.length - 1) cx += columnGap;
    }

    // Compute row offsets (track start positions)
    const rowOffsets: number[] = [];
    let ry = 0;
    for (let i = 0; i < this.rowTracks.length; i++) {
      rowOffsets.push(ry);
      ry += this.rowTracks[i]!.size;
      if (i < this.rowTracks.length - 1) ry += rowGap;
    }

    for (const item of this.items) {
      const p = item.placement;
      const cs = p.columnStart - 1;
      const ce = p.columnEnd - 1;
      const rs = p.rowStart - 1;
      const re = p.rowEnd - 1;

      // Sum track sizes spanning the item
      let areaW = 0;
      for (let c = cs; c < ce && c < this.colTracks.length; c++) {
        areaW += this.colTracks[c]!.size;
      }
      areaW += Math.max(0, ce - cs - 1) * columnGap;

      let areaH = 0;
      for (let r = rs; r < re && r < this.rowTracks.length; r++) {
        areaH += this.rowTracks[r]!.size;
      }
      areaH += Math.max(0, re - rs - 1) * rowGap;

      item.areaWidth = areaW;
      item.areaHeight = areaH;

      // Track start positions
      const trackStartX = colOffsets[cs] ?? 0;
      const trackStartY = rowOffsets[rs] ?? 0;

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
    const { columnGap, rowGap, alignItems, justifyItems } = this.options;

    const colOffsets: number[] = [];
    let cx = 0;
    for (let i = 0; i < this.colTracks.length; i++) {
      colOffsets.push(cx);
      cx += this.colTracks[i]!.size;
      if (i < this.colTracks.length - 1) cx += columnGap;
    }
    const rowOffsets: number[] = [];
    let ry = 0;
    for (let i = 0; i < this.rowTracks.length; i++) {
      rowOffsets.push(ry);
      ry += this.rowTracks[i]!.size;
      if (i < this.rowTracks.length - 1) ry += rowGap;
    }

    for (const item of this.items) {
      const box = item.element.layoutBox;
      if (!box) continue;

      const p = item.placement;
      const cs = p.columnStart - 1;
      const ce = p.columnEnd - 1;
      const rs = p.rowStart - 1;
      const re = p.rowEnd - 1;

      let areaW = 0;
      for (let c = cs; c < ce && c < this.colTracks.length; c++) {
        areaW += this.colTracks[c]!.size;
      }
      areaW += Math.max(0, ce - cs - 1) * columnGap;

      let areaH = 0;
      for (let r = rs; r < re && r < this.rowTracks.length; r++) {
        areaH += this.rowTracks[r]!.size;
      }
      areaH += Math.max(0, re - rs - 1) * rowGap;

      item.areaWidth = areaW;
      item.areaHeight = areaH;

      const trackStartX = colOffsets[cs] ?? 0;
      const trackStartY = rowOffsets[rs] ?? 0;

      // Actual margin box size from laid-out box
      const actualMarginBoxW = box.marginLeft + box.borderLeft + box.paddingLeft
        + box.width + box.paddingRight + box.borderRight + box.marginRight;
      const actualMarginBoxH = box.marginTop + box.borderTop + box.paddingTop
        + box.height + box.paddingBottom + box.borderBottom + box.marginBottom;

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
