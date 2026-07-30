import type { RGBA } from './rasterizer';
import { parseColor } from './rasterizer';
import { parseGradient, isGradientValue, evaluateGradient } from './css-gradients';

export interface BackgroundLayer {
  image: string;
  color: string;
  positionX: string;
  positionY: string;
  size: string;
  repeat: string;
  attachment: string;
  clip: string;
  origin: string;
}

export interface BackgroundsInfo {
  layers: BackgroundLayer[];
  color: RGBA;
}

export function parseBackgroundShorthand(value: string): BackgroundsInfo {
  return parseBackgrounds(value);
}

export function parseBackgrounds(bgValue: string, bgColor?: string): BackgroundsInfo {
  const color = bgColor ? parseColor(bgColor) : { r: 0, g: 0, b: 0, a: 0 };
  const layers: BackgroundLayer[] = [];

  if (!bgValue || bgValue === 'none' || bgValue === 'transparent') {
    return { layers: [{ image: 'none', color: 'transparent', positionX: '0%', positionY: '0%', size: 'auto', repeat: 'repeat', attachment: 'scroll', clip: 'border-box', origin: 'padding-box' }], color };
  }

  const parts = bgValue.split(',');
  for (const part of parts) {
    const s = part.trim();
    const layer: BackgroundLayer = { image: 'none', color: 'transparent', positionX: '0%', positionY: '0%', size: 'auto', repeat: 'repeat', attachment: 'scroll', clip: 'border-box', origin: 'padding-box' };

    if (isGradientValue(s)) {
      layer.image = s;
    } else if (s.startsWith('url(')) {
      const urlMatch = s.match(/url\(['"]?([^'")]+)['"]?\)/);
      if (urlMatch) layer.image = urlMatch[1];
    } else if (s === 'none') {
      layer.image = 'none';
    } else {
      const colorMatch = s.match(/[a-z]+|#[0-9a-f]+|rgba?\([^)]+\)/i);
      if (colorMatch) layer.color = colorMatch[0];
    }

    if (s.includes('repeat-x') || s.includes('repeat-y') || s.includes('no-repeat') || s.includes('space') || s.includes('round')) {
      const rm = s.match(/(repeat-x|repeat-y|no-repeat|repeat|space|round)/);
      if (rm) layer.repeat = rm[1];
    }
    const clipMatch = s.match(/(border-box|padding-box|content-box)/);
    if (clipMatch) layer.clip = clipMatch[1];

    layers.push(layer);
  }

  if (layers.length === 0) {
    layers.push({ image: 'none', color: 'transparent', positionX: '0%', positionY: '0%', size: 'auto', repeat: 'repeat', attachment: 'scroll', clip: 'border-box', origin: 'padding-box' });
  }

  return { layers, color };
}

export function evaluateBackground(buffer: ImageData, bg: BackgroundsInfo, x: number, y: number, w: number, h: number): void {
  const data = buffer.data;

  const fillSolid = (color: RGBA) => {
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = ((py + y) * buffer.width + (px + x)) * 4;
        const a = color.a;
        data[idx] = data[idx] * (1 - a) + color.r * a;
        data[idx + 1] = data[idx + 1] * (1 - a) + color.g * a;
        data[idx + 2] = data[idx + 2] * (1 - a) + color.b * a;
        data[idx + 3] = Math.max(data[idx + 3], a * 255);
      }
    }
  };

  fillSolid(bg.color);

  for (const layer of bg.layers) {
    if (layer.image === 'none') continue;
    if (isGradientValue(layer.image)) {
      const grad = parseGradient(layer.image);
      if (grad) {
        evaluateGradientOnBuffer(buffer, grad, x, y, w, h);
      }
    }
  }
}

function evaluateGradientOnBuffer(buffer: ImageData, grad: ReturnType<typeof parseGradient>, x: number, y: number, w: number, h: number): void {
  if (!grad) return;
  const data = buffer.data;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const color = evaluateGradient(grad, px, py, w, h);
      const idx = ((py + y) * buffer.width + (px + x)) * 4;
      const a = color.a;
      const invA = 1 - a;
      data[idx] = data[idx] * invA + color.r * a;
      data[idx + 1] = data[idx + 1] * invA + color.g * a;
      data[idx + 2] = data[idx + 2] * invA + color.b * a;
      data[idx + 3] = Math.max(data[idx + 3], a * 255);
    }
  }
}
