/**
 * @file canvas/canvas-path.ts
 * Path2D class — stores path commands for Canvas 2D rendering.
 */

import type { PathCommand } from './canvas-types';

export class Path2D {
  readonly _commands: PathCommand[] = [];
  private _currentX = 0;
  private _currentY = 0;
  private _startX = 0;
  private _startY = 0;

  constructor(path?: Path2D | string) {
    if (path instanceof Path2D) {
      this._commands = [...path._commands];
      this._currentX = path._currentX;
      this._currentY = path._currentY;
      this._startX = path._startX;
      this._startY = path._startY;
    }
  }

  // ── Path commands ──

  moveTo(x: number, y: number): void {
    this._commands.push({ type: 'moveTo', x, y });
    this._currentX = x;
    this._currentY = y;
    this._startX = x;
    this._startY = y;
  }

  lineTo(x: number, y: number): void {
    this._commands.push({ type: 'lineTo', x, y });
    this._currentX = x;
    this._currentY = y;
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this._commands.push({ type: 'quadraticCurveTo', cpx, cpy, x, y });
    this._currentX = x;
    this._currentY = y;
  }

  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    this._commands.push({ type: 'bezierCurveTo', cp1x, cp1y, cp2x, cp2y, x, y });
    this._currentX = x;
    this._currentY = y;
  }

  arc(cx: number, cy: number, r: number, startAngle: number, endAngle: number, ccw = false): void {
    if (this._commands.length === 0) {
      const startX = cx + r * Math.cos(startAngle);
      const startY = cy + r * Math.sin(startAngle);
      this.moveTo(startX, startY);
    }
    this._commands.push({ type: 'arc', cx, cy, r, startAngle, endAngle, ccw });
    // Update current position to end of arc
    const endX = cx + r * Math.cos(endAngle);
    const endY = cy + r * Math.sin(endAngle);
    this._currentX = endX;
    this._currentY = endY;
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    this._commands.push({ type: 'arcTo', x1, y1, x2, y2, r });
    // Approximate end position
    this._currentX = x1;
    this._currentY = y1;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, rotation: number, startAngle: number, endAngle: number, ccw = false): void {
    if (this._commands.length === 0) {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const startX = cx + rx * Math.cos(startAngle) * cos - ry * Math.sin(startAngle) * sin;
      const startY = cy + rx * Math.cos(startAngle) * sin + ry * Math.sin(startAngle) * cos;
      this.moveTo(startX, startY);
    }
    this._commands.push({ type: 'ellipse', cx, cy, rx, ry, rotation, startAngle, endAngle, ccw });
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const endX = cx + rx * Math.cos(endAngle) * cos - ry * Math.sin(endAngle) * sin;
    const endY = cy + rx * Math.cos(endAngle) * sin + ry * Math.sin(endAngle) * cos;
    this._currentX = endX;
    this._currentY = endY;
  }

  rect(x: number, y: number, w: number, h: number): void {
    this._commands.push({ type: 'rect', x, y, w, h });
    this._currentX = x;
    this._currentY = y;
    this._startX = x;
    this._startY = y;
  }

  closePath(): void {
    this._commands.push({ type: 'closePath' });
    this._currentX = this._startX;
    this._currentY = this._startY;
  }

  // ── Helpers ──

  /** Get the current pen position. */
  get currentX(): number { return this._currentX; }
  get currentY(): number { return this._currentY; }

  /** Check if path has any commands. */
  get isEmpty(): boolean { return this._commands.length === 0; }

  /** Clone this path. */
  clone(): Path2D {
    const p = new Path2D();
    p._commands.push(...this._commands);
    p._currentX = this._currentX;
    p._currentY = this._currentY;
    p._startX = this._startX;
    p._startY = this._startY;
    return p;
  }
}
