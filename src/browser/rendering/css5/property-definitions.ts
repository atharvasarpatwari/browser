/**
 * @file css5/property-definitions.ts
 * Comprehensive CSS property registry — inheritance, initial values, shorthand groups.
 *
 * Replaces the ad-hoc INHERITABLE set and setInitialValues() in cascade.ts with a
 * single authoritative source for property metadata.
 */

// ─────────────────────────────────────────────────────────────────────────────
// PROPERTY METADATA
// ─────────────────────────────────────────────────────────────────────────────

interface PropertyDef {
  /** Whether this property inherits by default. */
  readonly inherited: boolean;
  /** CSS initial value per spec (used when no rule, inheritance, or UA default applies). */
  readonly initialValue: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROPERTY REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
// Coverage: CSS Backgrounds & Borders, Color, Counter Styles, Display,
// Flexbox, Fonts, Generated Content, Grid, Images, Lists, Margins,
// Overflow, Padding, Paged Media, Positioning, Tables, Text, Transforms,
// UI, Writing Modes.

const PROPERTIES: Record<string, PropertyDef> = {
  // ── Display & Box Model ────────────────────────────────────────────────
  'display':            { inherited: false, initialValue: 'inline' },
  'position':           { inherited: false, initialValue: 'static' },
  'float':              { inherited: false, initialValue: 'none' },
  'clear':              { inherited: false, initialValue: 'none' },
  'box-sizing':         { inherited: false, initialValue: 'content-box' },
  'width':              { inherited: false, initialValue: 'auto' },
  'height':             { inherited: false, initialValue: 'auto' },
  'min-width':          { inherited: false, initialValue: 'auto' },
  'min-height':         { inherited: false, initialValue: 'auto' },
  'max-width':          { inherited: false, initialValue: 'none' },
  'max-height':         { inherited: false, initialValue: 'none' },
  'aspect-ratio':       { inherited: false, initialValue: 'auto' },

  // ── Margins ────────────────────────────────────────────────────────────
  'margin-top':         { inherited: false, initialValue: '0' },
  'margin-right':       { inherited: false, initialValue: '0' },
  'margin-bottom':      { inherited: false, initialValue: '0' },
  'margin-left':        { inherited: false, initialValue: '0' },

  // ── Padding ────────────────────────────────────────────────────────────
  'padding-top':        { inherited: false, initialValue: '0' },
  'padding-right':      { inherited: false, initialValue: '0' },
  'padding-bottom':     { inherited: false, initialValue: '0' },
  'padding-left':       { inherited: false, initialValue: '0' },

  // ── Borders ────────────────────────────────────────────────────────────
  'border-top-width':   { inherited: false, initialValue: 'medium' },
  'border-right-width': { inherited: false, initialValue: 'medium' },
  'border-bottom-width':{ inherited: false, initialValue: 'medium' },
  'border-left-width':  { inherited: false, initialValue: 'medium' },
  'border-top-style':   { inherited: false, initialValue: 'none' },
  'border-right-style': { inherited: false, initialValue: 'none' },
  'border-bottom-style':{ inherited: false, initialValue: 'none' },
  'border-left-style':  { inherited: false, initialValue: 'none' },
  'border-top-color':   { inherited: false, initialValue: 'currentcolor' },
  'border-right-color': { inherited: false, initialValue: 'currentcolor' },
  'border-bottom-color':{ inherited: false, initialValue: 'currentcolor' },
  'border-left-color':  { inherited: false, initialValue: 'currentcolor' },
  'border-top-left-radius':     { inherited: false, initialValue: '0' },
  'border-top-right-radius':    { inherited: false, initialValue: '0' },
  'border-bottom-right-radius': { inherited: false, initialValue: '0' },
  'border-bottom-left-radius':  { inherited: false, initialValue: '0' },
  'border-collapse':    { inherited: true,  initialValue: 'separate' },
  'border-spacing':     { inherited: true,  initialValue: '0' },

  // ── Positioning offsets ────────────────────────────────────────────────
  'top':                { inherited: false, initialValue: 'auto' },
  'right':              { inherited: false, initialValue: 'auto' },
  'bottom':             { inherited: false, initialValue: 'auto' },
  'left':               { inherited: false, initialValue: 'auto' },
  'z-index':            { inherited: false, initialValue: 'auto' },

  // ── Overflow & Visibility ──────────────────────────────────────────────
  'overflow':           { inherited: false, initialValue: 'visible' },
  'overflow-x':         { inherited: false, initialValue: 'visible' },
  'overflow-y':         { inherited: false, initialValue: 'visible' },
  'overflow-wrap':      { inherited: true,  initialValue: 'normal' },
  'word-break':         { inherited: true,  initialValue: 'normal' },
  'visibility':         { inherited: true,  initialValue: 'visible' },
  'opacity':            { inherited: false, initialValue: '1' },

  // ── Color & Background ────────────────────────────────────────────────
  'color':              { inherited: true,  initialValue: 'canvastext' },
  'background-color':   { inherited: false, initialValue: 'transparent' },
  'background-image':   { inherited: false, initialValue: 'none' },
  'background-repeat':  { inherited: false, initialValue: 'repeat' },
  'background-attachment': { inherited: false, initialValue: 'scroll' },
  'background-position':{ inherited: false, initialValue: '0% 0%' },
  'background-size':    { inherited: false, initialValue: 'auto' },
  'background-origin':  { inherited: false, initialValue: 'padding-box' },
  'background-clip':    { inherited: false, initialValue: 'border-box' },

  // ── Typography (inherited) ─────────────────────────────────────────────
  'font-family':        { inherited: true,  initialValue: 'sans-serif' },
  'font-size':          { inherited: true,  initialValue: 'medium' },
  'font-weight':        { inherited: true,  initialValue: 'normal' },
  'font-style':         { inherited: true,  initialValue: 'normal' },
  'font-variant':       { inherited: true,  initialValue: 'normal' },
  'font-size-adjust':   { inherited: true,  initialValue: 'none' },
  'font-stretch':       { inherited: true,  initialValue: 'normal' },
  'line-height':        { inherited: true,  initialValue: 'normal' },
  'letter-spacing':     { inherited: true,  initialValue: 'normal' },
  'word-spacing':       { inherited: true,  initialValue: 'normal' },
  'text-align':         { inherited: true,  initialValue: 'start' },
  'text-align-last':    { inherited: true,  initialValue: 'auto' },
  'text-decoration':    { inherited: false, initialValue: 'none solid currentcolor' },
  'text-decoration-line':  { inherited: false, initialValue: 'none' },
  'text-decoration-style': { inherited: false, initialValue: 'solid' },
  'text-decoration-color': { inherited: false, initialValue: 'currentcolor' },
  'text-transform':     { inherited: true,  initialValue: 'none' },
  'text-indent':        { inherited: true,  initialValue: '0' },
  'text-shadow':        { inherited: true,  initialValue: 'none' },
  'white-space':        { inherited: true,  initialValue: 'normal' },
  'direction':          { inherited: true,  initialValue: 'ltr' },
  'writing-mode':       { inherited: true,  initialValue: 'horizontal-tb' },
  'unicode-bidi':       { inherited: false, initialValue: 'normal' },
  'tab-size':           { inherited: true,  initialValue: '8' },
  'hyphens':            { inherited: true,  initialValue: 'manual' },
  'cursor':             { inherited: true,  initialValue: 'auto' },
  'color-scheme':       { inherited: true,  initialValue: 'normal' },
  'accent-color':       { inherited: true,  initialValue: 'auto' },

  // ── Lists ──────────────────────────────────────────────────────────────
  'list-style-type':    { inherited: true,  initialValue: 'disc' },
  'list-style-position':{ inherited: true,  initialValue: 'outside' },
  'list-style-image':   { inherited: true,  initialValue: 'none' },
  'counter-reset':      { inherited: false, initialValue: 'none' },
  'counter-increment':  { inherited: false, initialValue: 'none' },

  // ── Tables ─────────────────────────────────────────────────────────────
  'caption-side':       { inherited: true,  initialValue: 'top' },
  'empty-cells':        { inherited: true,  initialValue: 'show' },
  'table-layout':       { inherited: true,  initialValue: 'auto' },
  'vertical-align':     { inherited: true,  initialValue: 'baseline' },

  // ── Flexbox ────────────────────────────────────────────────────────────
  'flex-direction':     { inherited: false, initialValue: 'row' },
  'flex-wrap':          { inherited: false, initialValue: 'nowrap' },
  'flex-flow':          { inherited: false, initialValue: 'row nowrap' },
  'flex-grow':          { inherited: false, initialValue: '0' },
  'flex-shrink':        { inherited: false, initialValue: '1' },
  'flex-basis':         { inherited: false, initialValue: 'auto' },
  'flex':               { inherited: false, initialValue: '0 1 auto' },
  'justify-content':    { inherited: false, initialValue: 'stretch' },
  'align-items':        { inherited: false, initialValue: 'stretch' },
  'align-self':         { inherited: false, initialValue: 'auto' },
  'align-content':      { inherited: false, initialValue: 'stretch' },
  'order':              { inherited: false, initialValue: '0' },
  'gap':                { inherited: false, initialValue: 'normal' },
  'row-gap':            { inherited: false, initialValue: 'normal' },
  'column-gap':         { inherited: false, initialValue: 'normal' },

  // ── Grid ───────────────────────────────────────────────────────────────
  'grid-template-columns': { inherited: false, initialValue: 'none' },
  'grid-template-rows':    { inherited: false, initialValue: 'none' },
  'grid-template-areas':   { inherited: false, initialValue: 'none' },
  'grid-auto-columns':     { inherited: false, initialValue: 'auto' },
  'grid-auto-rows':        { inherited: false, initialValue: 'auto' },
  'grid-auto-flow':        { inherited: false, initialValue: 'row' },
  'grid-column':           { inherited: false, initialValue: 'auto' },
  'grid-row':              { inherited: false, initialValue: 'auto' },
  'grid-area':             { inherited: false, initialValue: 'auto' },

  // ── Transforms ─────────────────────────────────────────────────────────
  'transform':          { inherited: false, initialValue: 'none' },
  'transform-origin':   { inherited: false, initialValue: '50% 50%' },

  // ── Transitions & Animations ───────────────────────────────────────────
  'transition':         { inherited: false, initialValue: 'all 0s ease 0s' },
  'transition-property':{ inherited: false, initialValue: 'all' },
  'transition-duration':{ inherited: false, initialValue: '0s' },
  'transition-timing-function': { inherited: false, initialValue: 'ease' },
  'transition-delay':   { inherited: false, initialValue: '0s' },
  'animation':          { inherited: false, initialValue: 'none 0s ease 0s 1 normal none running' },
  'animation-name':     { inherited: false, initialValue: 'none' },
  'animation-duration': { inherited: false, initialValue: '0s' },
  'animation-timing-function': { inherited: false, initialValue: 'ease' },
  'animation-delay':    { inherited: false, initialValue: '0s' },
  'animation-iteration-count': { inherited: false, initialValue: '1' },
  'animation-direction':{ inherited: false, initialValue: 'normal' },
  'animation-fill-mode':{ inherited: false, initialValue: 'none' },
  'animation-play-state':{ inherited: false, initialValue: 'running' },

  // ── Misc ───────────────────────────────────────────────────────────────
  'content':            { inherited: false, initialValue: 'normal' },
  'resize':             { inherited: false, initialValue: 'none' },
  'outline-width':      { inherited: false, initialValue: 'medium' },
  'outline-style':      { inherited: false, initialValue: 'none' },
  'outline-color':      { inherited: false, initialValue: 'auto' },
  'box-shadow':         { inherited: false, initialValue: 'none' },
  'clip':               { inherited: false, initialValue: 'auto' },
  'clip-path':          { inherited: false, initialValue: 'none' },
  'filter':             { inherited: false, initialValue: 'none' },
  'backdrop-filter':    { inherited: false, initialValue: 'none' },

  // ── Multi-column ────────────────────────────────────────────────────
  'column-count':       { inherited: false, initialValue: 'auto' },
  'column-width':       { inherited: false, initialValue: 'auto' },
  'column-rule-width':  { inherited: false, initialValue: 'medium' },
  'column-rule-style':  { inherited: false, initialValue: 'none' },
  'column-rule-color':  { inherited: false, initialValue: 'currentcolor' },
  'column-fill':        { inherited: false, initialValue: 'balance' },
  'column-span':        { inherited: false, initialValue: 'none' },

  // ── Paged Media ────────────────────────────────────────────────────────
  'orphans':            { inherited: true,  initialValue: '2' },
  'widows':             { inherited: true,  initialValue: '2' },
  'page-break-before':  { inherited: false, initialValue: 'auto' },
  'page-break-after':   { inherited: false, initialValue: 'auto' },
  'page-break-inside':  { inherited: false, initialValue: 'auto' },

  // ── Container Queries ──────────────────────────────────────────────────
  'container-type':     { inherited: false, initialValue: 'normal' },
  'container-name':     { inherited: false, initialValue: 'none' },
  'container':          { inherited: false, initialValue: 'none' },

  // ── Quotes ─────────────────────────────────────────────────────────────
  'quotes':             { inherited: true,  initialValue: 'auto' },
};

// ─────────────────────────────────────────────────────────────────────────────
// SHORTHAND → LONGHAND MAPPING
// ─────────────────────────────────────────────────────────────────────────────

const SHORTHAND_LONGHANDS: Record<string, string[]> = {
  'margin':            ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  'padding':           ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  'border':            ['border-width', 'border-style', 'border-color'],
  'border-width':      ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  'border-style':      ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
  'border-color':      ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  'border-radius':     ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  'border-top':        ['border-top-width', 'border-top-style', 'border-top-color'],
  'border-right':      ['border-right-width', 'border-right-style', 'border-right-color'],
  'border-bottom':     ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
  'border-left':       ['border-left-width', 'border-left-style', 'border-left-color'],
  'background':        ['background-color', 'background-image', 'background-repeat', 'background-attachment', 'background-position', 'background-size', 'background-origin', 'background-clip'],
  'font':              ['font-style', 'font-variant', 'font-weight', 'font-size', 'line-height', 'font-family'],
  'list-style':        ['list-style-type', 'list-style-position', 'list-style-image'],
  'flex':              ['flex-grow', 'flex-shrink', 'flex-basis'],
  'flex-flow':         ['flex-direction', 'flex-wrap'],
  'grid-template':     ['grid-template-columns', 'grid-template-rows'],
  'grid-area':         ['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end'],
  'overflow':          ['overflow-x', 'overflow-y'],
  'transition':        ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'],
  'animation':         ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state'],
  'text-decoration':   ['text-decoration-line', 'text-decoration-style', 'text-decoration-color'],
  'border-collapse':   ['border-collapse'],
  'gap':               ['row-gap', 'column-gap'],
  'container':         ['container-type', 'container-name'],
};

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

const INHERITED_SET = new Set(
  Object.entries(PROPERTIES)
    .filter(([, def]) => def.inherited)
    .map(([prop]) => prop),
);

const INITIAL_VALUES: Record<string, string> = {};
for (const [prop, def] of Object.entries(PROPERTIES)) {
  INITIAL_VALUES[prop] = def.initialValue;
}

const SHORTHAND_SET = new Set(Object.keys(SHORTHAND_LONGHANDS));

/**
 * Returns true if the property inherits by default.
 */
export function isInheritedProperty(property: string): boolean {
  return INHERITED_SET.has(property.toLowerCase());
}

/**
 * Returns the CSS initial value for a property.
 * Falls back to `initial` if the property is unknown.
 */
export function getInitialValue(property: string): string {
  return INITIAL_VALUES[property.toLowerCase()] ?? 'initial';
}

/**
 * Returns true if the property is a shorthand (e.g. margin, padding, border).
 */
export function isShorthandProperty(property: string): boolean {
  return SHORTHAND_SET.has(property.toLowerCase());
}

/**
 * Returns the longhand properties for a shorthand.
 * Returns an empty array if the property is not a shorthand.
 */
export function getLonghands(property: string): readonly string[] {
  return SHORTHAND_LONGHANDS[property.toLowerCase()] ?? [];
}

/**
 * Returns true if the value is a CSS-wide keyword.
 */
export function isCSSWideKeyword(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === 'inherit' || v === 'initial' || v === 'unset' || v === 'revert' || v === 'revert-layer';
}

/**
 * Returns all inherited property names.
 */
export function getInheritedProperties(): readonly string[] {
  return [...INHERITED_SET];
}

/**
 * Returns all property definitions.
 */
export function getAllPropertyDefinitions(): Readonly<Record<string, PropertyDef>> {
  return PROPERTIES;
}
