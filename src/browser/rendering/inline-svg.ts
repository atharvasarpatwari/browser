/**
 * Inline `<svg>` drawn through the platform's SVG decoder.
 *
 * The engine has no vector renderer, so inline SVG (logos, icons) painted nothing. Each outermost
 * `<svg>` with a box is serialized as a standalone image (case restored, `currentColor` and the
 * inherited fill/stroke resolved), rasterized at its box size × DPR by the same decoder `<img>`
 * uses, and painted as the element's image.
 * ponytail: redrawn when shown, resized or recoloured, but not when a script edits its children.
 */
import type { DomElement, DomNode } from './dom-tree';

/** HTML lowercases names; SVG needs them back (HTML spec, "adjust SVG attributes / tag names"). */
const CASED = new Map(
  ('attributeName attributeType baseFrequency baseProfile calcMode clipPathUnits diffuseConstant edgeMode filterUnits ' +
   'glyphRef gradientTransform gradientUnits kernelMatrix kernelUnitLength keyPoints keySplines keyTimes lengthAdjust ' +
   'limitingConeAngle markerHeight markerUnits markerWidth maskContentUnits maskUnits numOctaves pathLength ' +
   'patternContentUnits patternTransform patternUnits pointsAtX pointsAtY pointsAtZ preserveAlpha preserveAspectRatio ' +
   'primitiveUnits refX refY repeatCount repeatDur requiredExtensions requiredFeatures specularConstant ' +
   'specularExponent spreadMethod startOffset stdDeviation stitchTiles surfaceScale systemLanguage tableValues targetX ' +
   'targetY textLength viewBox viewTarget xChannelSelector yChannelSelector zoomAndPan ' +
   'altGlyph altGlyphDef altGlyphItem animateColor animateMotion animateTransform clipPath feBlend feColorMatrix ' +
   'feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow ' +
   'feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset ' +
   'fePointLight feSpecularLighting feSpotLight feTile feTurbulence foreignObject glyphRef linearGradient ' +
   'radialGradient textPath').split(' ').map((n) => [n.toLowerCase(), n] as const),
);
const cased = (name: string): string => CASED.get(name) ?? name;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function serializeChildren(el: DomElement): string {
  let out = '';
  for (const child of el.children) {
    if (child.nodeType === 'text') out += esc((child as DomNode & { text?: string }).text ?? '');
    else if (child.nodeType === 'element') out += serializeElement(child as DomElement);
  }
  return out;
}

function serializeElement(el: DomElement, extra = ''): string {
  const tag = cased(el.tagName.toLowerCase());
  if (tag === 'script' || tag === 'foreignObject') return '';
  let attrs = '';
  for (const [k, v] of el.attributes) attrs += ` ${cased(k)}="${esc(v)}"`;
  return `<${tag}${attrs}${extra}>${serializeChildren(el)}</${tag}>`;
}

/**
 * The `<svg>` as a standalone document `width` × `height` px. An image has no CSS context, so the
 * colour and the inherited fill/stroke the page gave it go on the root.
 */
export function serializeInlineSvg(svg: DomElement, width: number, height: number): string {
  const style = svg.computedStyle;
  const root: DomElement = {
    ...svg,
    attributes: new Map([...svg.attributes].filter(([k]) => !['width', 'height', 'style', 'xmlns', 'class'].includes(k))),
  };
  const css = ['color', 'fill', 'stroke', 'stroke-width', 'opacity']
    .map((p) => [p, style?.get(p)] as const)
    .filter(([, v]) => v && v !== 'initial')
    .map(([p, v]) => `${p}:${v}`).join(';');
  const extra = ` xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"${css ? ` style="${esc(css)}"` : ''}`;
  return serializeElement(root, extra);
}

/** Outermost `<svg>` elements in document order. */
function outermostSvgs(nodes: readonly DomNode[], out: DomElement[] = []): DomElement[] {
  for (const node of nodes) {
    if (node.nodeType !== 'element') continue;
    const el = node as DomElement;
    if (el.tagName.toLowerCase() === 'svg') out.push(el);
    else outermostSvgs(el.children, out);
  }
  return out;
}

export type SvgDecode = (markup: string) => Promise<{ data: Uint8ClampedArray; width: number; height: number } | null>;

/** The size and colour each svg was last rasterized at: it is redrawn when they change. */
const rasterKeys = new WeakMap<DomElement, string>();

/**
 * Rasterizes every laid-out inline `<svg>` into its `imageData`. Returns how many were drawn.
 * Called after load and after each reflow frame: svgs hidden at load (a theme button's other
 * icons), inserted by scripts, resized or recoloured (currentColor) were never drawn again.
 */
export async function renderInlineSvgs(root: readonly DomNode[], decode: SvgDecode, dpr: number): Promise<number> {
  const jobs = outermostSvgs(root).map(async (svg) => {
    const box = svg.layoutBox;
    if (!box || box.width <= 0 || box.height <= 0 || svg.computedStyle?.get('display') === 'none') return 0;
    const w = Math.max(1, Math.round((box.width - box.borderLeft - box.borderRight - box.paddingLeft - box.paddingRight) * dpr));
    const h = Math.max(1, Math.round((box.height - box.borderTop - box.borderBottom - box.paddingTop - box.paddingBottom) * dpr));
    const key = `${w}x${h} ${svg.computedStyle?.get('color') ?? ''}`;
    if (rasterKeys.get(svg) === key) return 0;
    rasterKeys.set(svg, key);
    try {
      const img = await decode(serializeInlineSvg(svg, w, h));
      if (!img) return 0;
      svg.imageData = { data: img.data as unknown as ImageDataArray, width: img.width, height: img.height, colorSpace: 'srgb' } as ImageData;
      svg.loadingState = 'loaded';
      svg._dirtyPaint = true;
      return 1;
    } catch {
      return 0; // an SVG the platform can't read stays blank, as before
    }
  });
  return (await Promise.all(jobs)).reduce<number>((a, b) => a + b, 0);
}
