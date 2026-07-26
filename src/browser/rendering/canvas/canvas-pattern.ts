/**
 * @file canvas/canvas-pattern.ts
 * CanvasPattern class — repeated image patterns for Canvas 2D.
 */

export type CanvasPatternRepetition = 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat';

export class CanvasPattern {
  readonly _imageData: ImageData | null;
  readonly _repetition: CanvasPatternRepetition;
  readonly _width: number;
  readonly _height: number;

  constructor(imageData: ImageData | null, repetition: CanvasPatternRepetition = 'repeat') {
    this._imageData = imageData;
    this._repetition = repetition;
    this._width = imageData?.width ?? 0;
    this._height = imageData?.height ?? 0;
  }

  /** Get the pixel color at a tiled position. Returns [r, g, b, a]. */
  getPixelAt(x: number, y: number): [number, number, number, number] {
    if (!this._imageData || this._width === 0 || this._height === 0) {
      return [0, 0, 0, 0];
    }

    // Apply repetition
    let px = Math.floor(x);
    let py = Math.floor(y);

    if (this._repetition === 'no-repeat') {
      if (px < 0 || px >= this._width || py < 0 || py >= this._height) {
        return [0, 0, 0, 0];
      }
    } else {
      if (this._repetition === 'repeat' || this._repetition === 'repeat-x') {
        px = ((px % this._width) + this._width) % this._width;
      } else {
        if (px < 0 || px >= this._width) return [0, 0, 0, 0];
      }
      if (this._repetition === 'repeat' || this._repetition === 'repeat-y') {
        py = ((py % this._height) + this._height) % this._height;
      } else {
        if (py < 0 || py >= this._height) return [0, 0, 0, 0];
      }
    }

    const idx = (py * this._width + px) * 4;
    const data = this._imageData.data;
    return [data[idx] ?? 0, data[idx + 1] ?? 0, data[idx + 2] ?? 0, data[idx + 3] ?? 0];
  }
}
