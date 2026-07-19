 /**
 * @file html5/constants.ts
 * Element category sets, insertion mode enum, and constants
 * for the HTML5 tree builder.
 */

import { Namespace } from './dom';

// ─────────────────────────────────────────────────────────────────────────────
// INSERTION MODES  (§13.2.6)
// ─────────────────────────────────────────────────────────────────────────────

const enum Im {
  INITIAL,
  BEFORE_HTML,
  BEFORE_HEAD,
  IN_HEAD,
  IN_HEAD_NOSCRIPT,
  AFTER_HEAD,
  IN_BODY,
  TEXT,
  IN_TABLE,
  IN_TABLE_TEXT,
  IN_CAPTION,
  IN_COLUMN_GROUP,
  IN_TABLE_BODY,
  IN_ROW,
  IN_CELL,
  IN_SELECT,
  IN_SELECT_IN_TABLE,
  IN_TEMPLATE,
  AFTER_BODY,
  IN_FRAMESET,
  AFTER_FRAMESET,
  AFTER_AFTER_BODY,
  AFTER_AFTER_FRAMESET,
}

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT CATEGORY SETS
// ─────────────────────────────────────────────────────────────────────────────

/** Elements that are self-closing by definition (WHATWG void elements). */
const VOID_ELEMENTS: ReadonlySet<string> = new Set<string>([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Elements whose content is treated as raw text (not parsed as child HTML). */
const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set<string>([
  'script', 'style', 'textarea', 'title',
]);

/** Elements that are "special" for scope/stack operations (§13.2.6.1). */
const SPECIAL_ELEMENTS: ReadonlySet<string> = new Set<string>([
  'address', 'applet', 'area', 'article', 'aside', 'base', 'basefont',
  'bgsound', 'blockquote', 'body', 'br', 'button', 'caption', 'center',
  'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt',
  'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame',
  'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
  'hr', 'html', 'iframe', 'img', 'input', 'isindex', 'li', 'link',
  'listing', 'main', 'menu', 'menuitem', 'meta', 'nav', 'noembed',
  'noframes', 'noscript', 'object', 'ol', 'optgroup', 'option', 'p',
  'param', 'plaintext', 'pre', 'script', 'section', 'select', 'source',
  'style', 'summary', 'table', 'tbody', 'td', 'template', 'textarea',
  'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul', 'wbr', 'xmp',
]);

/** Elements with scoping semantics for default scope checks (§13.2.6.1). */
const SCOPING_ELEMENTS: ReadonlySet<string> = new Set<string>([
  'applet', 'caption', 'html', 'marquee', 'object', 'select', 'table',
  'td', 'th',
]);

/** Elements that participate in the active formatting elements list. */
const FORMATTING_ELEMENTS: ReadonlySet<string> = new Set<string>([
  'a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr',
  's', 'small', 'strike', 'strong', 'tt', 'u',
]);

/** Heading elements. */
const HEADING_ELEMENTS: ReadonlySet<string> = new Set<string>([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

/** All table-related elements. */
const TABLE_ELEMENTS: ReadonlySet<string> = new Set<string>([
  'caption', 'col', 'colgroup', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'tr', 'table',
]);

/** Elements that represent table body context. */
const TABLE_BODY_CONTEXT: ReadonlySet<string> = new Set<string>([
  'tbody', 'tfoot', 'thead', 'template',
]);

/** Elements that trigger foster parenting when they are the current node. */
const FOSTER_PARENT_CONTEXT: ReadonlySet<string> = new Set<string>([
  'table', 'tbody', 'tfoot', 'thead', 'tr',
]);

/** Elements that have implied end tags (standard). */
const IMPLIED_END_TAG_ELEMENTS: ReadonlySet<string> = new Set<string>([
  'dd', 'dt', 'li', 'optgroup', 'option', 'p', 'rb', 'rp', 'rt', 'rtc',
]);

/** Elements that have thorough implied end tags (includes table elements). */
const THOROUGH_IMPLIED_END_TAG_ELEMENTS: ReadonlySet<string> = new Set<string>([
  'caption', 'colgroup', 'dd', 'dt', 'li', 'optgroup', 'option',
  'p', 'rb', 'rp', 'rt', 'rtc', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
]);

/** Elements that trigger void adjustment in foreign content. */
const VOID_ADJUSTMENT_ELEMENTS: ReadonlySet<string> = new Set<string>([
  'image', 'input', 'keygen',
]);

// ─────────────────────────────────────────────────────────────────────────────
// SVG INTEGRATION (tag name + attribute name adjustments)
// ─────────────────────────────────────────────────────────────────────────────

/** SVG tag name adjustments when foreign content integration. */
const SVG_TAG_ADJUSTMENTS: ReadonlyMap<string, string> = new Map([
  ['altglyph',       'altGlyph'],
  ['altglyphdef',    'altGlyphDef'],
  ['altglyphitem',   'altGlyphItem'],
  ['animatecolor',   'animateColor'],
  ['animatemotion',  'animateMotion'],
  ['animatetransform', 'animateTransform'],
  ['clippath',       'clipPath'],
  ['feblend',        'feBlend'],
  ['fecolormatrix',  'feColorMatrix'],
  ['fecomponenttransfer', 'feComponentTransfer'],
  ['fecomposite',    'feComposite'],
  ['feconvolvematrix', 'feConvolveMatrix'],
  ['fediffuselighting', 'feDiffuseLighting'],
  ['fedisplacementmap', 'feDisplacementMap'],
  ['fedistantlight', 'feDistantLight'],
  ['fedropshadow',   'feDropShadow'],
  ['feflood',        'feFlood'],
  ['fefunca',        'feFuncA'],
  ['fefuncb',        'feFuncB'],
  ['fefuncg',        'feFuncG'],
  ['fefuncr',        'feFuncR'],
  ['fegaussianblur', 'feGaussianBlur'],
  ['feimage',        'feImage'],
  ['femerge',        'feMerge'],
  ['femergenode',    'feMergeNode'],
  ['femorphology',   'feMorphology'],
  ['feoffset',       'feOffset'],
  ['fepointlight',   'fePointLight'],
  ['fespecularlighting', 'feSpecularLighting'],
  ['fespotlight',    'feSpotLight'],
  ['fetile',         'feTile'],
  ['feturbulence',   'feTurbulence'],
  ['foreignobject',  'foreignObject'],
  ['glyphref',       'glyphRef'],
  ['lineargradient', 'linearGradient'],
  ['radialgradient', 'radialGradient'],
  ['textpath',       'textPath'],
]);

/** SVG attribute name adjustments. */
const SVG_ATTR_ADJUSTMENTS: ReadonlyMap<string, string> = new Map([
  ['attributename',        'attributeName'],
  ['attributetype',        'attributeType'],
  ['basefrequency',        'baseFrequency'],
  ['baseprofile',          'baseProfile'],
  ['calcmode',             'calcMode'],
  ['clippathunits',        'clipPathUnits'],
  ['diffuseconstant',      'diffuseConstant'],
  ['edgemode',             'edgeMode'],
  ['filterunits',          'filterUnits'],
  ['glyphref',             'glyphRef'],
  ['gradienttransform',    'gradientTransform'],
  ['gradientunits',        'gradientUnits'],
  ['kernelmatrix',         'kernelMatrix'],
  ['kernelunitlength',     'kernelUnitLength'],
  ['keypoints',            'keyPoints'],
  ['keysplines',           'keySplines'],
  ['keytimes',             'keyTimes'],
  ['lengthadjust',         'lengthAdjust'],
  ['lightingcolor',        'lightingColor'],
  ['limitingconeangle',    'limitingConeAngle'],
  ['markerheight',         'markerHeight'],
  ['markerunits',          'markerUnits'],
  ['markerwidth',          'markerWidth'],
  ['maskcontentunits',     'maskContentUnits'],
  ['maskunits',            'maskUnits'],
  ['numoctaves',           'numOctaves'],
  ['pathlength',           'pathLength'],
  ['patterncontentunits',  'patternContentUnits'],
  ['patterntransform',     'patternTransform'],
  ['patternunits',         'patternUnits'],
  ['pointsatx',            'pointsAtX'],
  ['pointsaty',            'pointsAtY'],
  ['pointsatz',            'pointsAtZ'],
  ['preservealpha',        'preserveAlpha'],
  ['preserveaspectratio',  'preserveAspectRatio'],
  ['primitiveunits',       'primitiveUnits'],
  ['refx',                 'refX'],
  ['refy',                 'refY'],
  ['repeatcount',          'repeatCount'],
  ['repeatdur',            'repeatDur'],
  ['requiredextensions',   'requiredExtensions'],
  ['requiredfeatures',     'requiredFeatures'],
  ['specularconstant',     'specularConstant'],
  ['specularexponent',     'specularExponent'],
  ['spreadmethod',         'spreadMethod'],
  ['startoffset',          'startOffset'],
  ['stddeviation',         'stdDeviation'],
  ['stitchtiles',          'stitchTiles'],
  ['surfacescale',         'surfaceScale'],
  ['systemlanguage',       'systemLanguage'],
  ['tablevalues',          'tableValues'],
  ['targetx',              'targetX'],
  ['targety',              'targetY'],
  ['textlength',           'textLength'],
  ['viewbox',              'viewBox'],
  ['viewtarget',           'viewTarget'],
  ['xchannelselector',     'xChannelSelector'],
  ['ychannelselector',     'yChannelSelector'],
  ['zoomandpan',           'zoomAndPan'],
]);

// ─────────────────────────────────────────────────────────────────────────────
// MATHML ELEMENTS
// ─────────────────────────────────────────────────────────────────────────────

/** Elements that are MathML text integration points. */
const MATHML_TEXT_INTEGRATION_POINTS: ReadonlySet<string> = new Set<string>([
  'mi', 'mo', 'mn', 'ms', 'mtext',
]);

/** Elements that are HTML integration points inside MathML/SVG. */
const HTML_INTEGRATION_POINTS: ReadonlySet<string> = new Set<string>([
  'annotation-xml',
]);

// ─────────────────────────────────────────────────────────────────────────────
// LINK REL → RESOURCE KIND MAPPING
// ─────────────────────────────────────────────────────────────────────────────

import type { DiscoveredResourceKind } from './dom';

const LINK_REL_MAP: ReadonlyMap<string, DiscoveredResourceKind> = new Map([
  ['stylesheet',    'stylesheet'],
  ['preload',       'preload'],
  ['prefetch',      'prefetch'],
  ['preconnect',    'preconnect'],
  ['modulepreload', 'script'],
  ['icon',          'other'],
  ['shortcut icon', 'other'],
  ['manifest',      'other'],
]);

// ─────────────────────────────────────────────────────────────────────────────
// MARKER SENTINEL (for active formatting elements list)
// ─────────────────────────────────────────────────────────────────────────────

const MARKER: unique symbol = Symbol('marker');

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  VOID_ELEMENTS,
  RAW_TEXT_ELEMENTS,
  SPECIAL_ELEMENTS,
  SCOPING_ELEMENTS,
  FORMATTING_ELEMENTS,
  HEADING_ELEMENTS,
  TABLE_ELEMENTS,
  TABLE_BODY_CONTEXT,
  FOSTER_PARENT_CONTEXT,
  IMPLIED_END_TAG_ELEMENTS,
  THOROUGH_IMPLIED_END_TAG_ELEMENTS,
  VOID_ADJUSTMENT_ELEMENTS,
  SVG_TAG_ADJUSTMENTS,
  SVG_ATTR_ADJUSTMENTS,
  MATHML_TEXT_INTEGRATION_POINTS,
  HTML_INTEGRATION_POINTS,
  LINK_REL_MAP,
  MARKER,
};

export { Im, Namespace };
export type { DiscoveredResourceKind };
