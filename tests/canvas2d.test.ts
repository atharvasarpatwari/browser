/**
 * @file tests/canvas2d.test.ts
 * Comprehensive tests for Canvas 2D Graphics API.
 */

import { describe, it, expect } from 'vitest';
import {
  CanvasRenderingContext2D,
  HTMLCanvasElement,
  Path2D,
  CanvasGradient,
} from '../src/browser/rendering/canvas';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function ctx(w = 100, h = 100): CanvasRenderingContext2D {
  return new CanvasRenderingContext2D(w, h);
}

function getPixel(ctx: CanvasRenderingContext2D, x: number, y: number): [number, number, number, number] {
  const idx = (y * ctx._width + x) * 4;
  return [ctx._data[idx], ctx._data[idx + 1], ctx._data[idx + 2], ctx._data[idx + 3]];
}

// ─────────────────────────────────────────────────────────────────────────────
// HTMLCanvasElement
// ─────────────────────────────────────────────────────────────────────────────

describe('HTMLCanvasElement', () => {
  it('creates with default dimensions', () => {
    const canvas = new HTMLCanvasElement();
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
  });

  it('creates with custom dimensions', () => {
    const canvas = new HTMLCanvasElement(640, 480);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
  });

  it('getContext("2d") returns a context', () => {
    const canvas = new HTMLCanvasElement(100, 100);
    const ctx = canvas.getContext('2d');
    expect(ctx).toBeInstanceOf(CanvasRenderingContext2D);
  });

  it('getContext("2d") returns same instance', () => {
    const canvas = new HTMLCanvasElement(100, 100);
    const ctx1 = canvas.getContext('2d');
    const ctx2 = canvas.getContext('2d');
    expect(ctx1).toBe(ctx2);
  });

  it('getContext("webgl") returns null', () => {
    const canvas = new HTMLCanvasElement(100, 100);
    expect(canvas.getContext('webgl')).toBeNull();
  });

  it('width/height reset recreates context', () => {
    const canvas = new HTMLCanvasElement(100, 100);
    const ctx1 = canvas.getContext('2d');
    canvas.width = 200;
    const ctx2 = canvas.getContext('2d');
    expect(ctx1).not.toBe(ctx2);
  });

  it('getAttribute/setAttribute', () => {
    const canvas = new HTMLCanvasElement(100, 100);
    expect(canvas.getAttribute('width')).toBe('100');
    canvas.setAttribute('width', '200');
    expect(canvas.width).toBe(200);
  });

  it('toDataURL returns a data URL', () => {
    const canvas = new HTMLCanvasElement(10, 10);
    const url = canvas.toDataURL();
    expect(url).toMatch(/^data:image\/png;base64,/);
  });

  it('getPixelData returns the raw buffer', () => {
    const canvas = new HTMLCanvasElement(10, 10);
    const data = canvas.getPixelData();
    expect(data).toBeInstanceOf(Uint8ClampedArray);
    expect(data.length).toBe(10 * 10 * 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS CONTEXT — CONSTRUCTION
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasRenderingContext2D — Construction', () => {
  it('creates with specified dimensions', () => {
    const c = ctx(200, 150);
    expect(c.canvas.width).toBe(200);
    expect(c.canvas.height).toBe(150);
  });

  it('initial pixels are transparent', () => {
    const c = ctx(10, 10);
    const [r, g, b, a] = getPixel(c, 5, 5);
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(0);
    expect(a).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasRenderingContext2D — State', () => {
  it('save/restore fills style', () => {
    const c = ctx(10, 10);
    c.fillStyle = 'red';
    c.save();
    c.fillStyle = 'blue';
    expect(c.fillStyle).toBe('blue');
    c.restore();
    expect(c.fillStyle).toBe('red');
  });

  it('save/restore line width', () => {
    const c = ctx(10, 10);
    c.lineWidth = 5;
    c.save();
    c.lineWidth = 10;
    c.restore();
    expect(c.lineWidth).toBe(5);
  });

  it('save/restore global alpha', () => {
    const c = ctx(10, 10);
    c.globalAlpha = 0.5;
    c.save();
    c.globalAlpha = 0.8;
    c.restore();
    expect(c.globalAlpha).toBe(0.5);
  });

  it('save/restore path', () => {
    const c = ctx(10, 10);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(5, 5);
    c.save();
    c.beginPath();
    c.moveTo(10, 10);
    c.restore();
    // Path should be restored
    c.lineTo(0, 0);
    c.stroke();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RECTANGLES
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasRenderingContext2D — Rectangles', () => {
  it('fillRect fills pixels', () => {
    const c = ctx(10, 10);
    c.fillStyle = '#ff0000';
    c.fillRect(2, 2, 4, 4);
    const [r, g, b, a] = getPixel(c, 3, 3);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
    expect(a).toBe(255);
  });

  it('fillRect outside canvas does not crash', () => {
    const c = ctx(10, 10);
    c.fillStyle = 'red';
    c.fillRect(-20, -20, 5, 5);
    c.fillRect(100, 100, 5, 5);
  });

  it('clearRect clears to transparent', () => {
    const c = ctx(10, 10);
    c.fillStyle = '#ff0000';
    c.fillRect(0, 0, 10, 10);
    c.clearRect(2, 2, 3, 3);
    const [r, g, b, a] = getPixel(c, 3, 3);
    expect(a).toBe(0);
  });

  it('strokeRect draws outline', () => {
    const c = ctx(10, 10);
    c.strokeStyle = '#ff0000';
    c.lineWidth = 1;
    c.strokeRect(0, 0, 10, 10);
    // Top edge pixel
    const [r] = getPixel(c, 5, 0);
    expect(r).toBe(255);
  });

  it('fillRect with rgba color', () => {
    const c = ctx(10, 10);
    c.fillStyle = 'rgba(0, 255, 0, 0.5)';
    c.fillRect(0, 0, 10, 10);
    const [r, g, b, a] = getPixel(c, 5, 5);
    expect(r).toBe(0);
    expect(g).toBe(255);
    expect(b).toBe(0);
    expect(a).toBe(128); // ~50% alpha (128/255)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COLORS
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasRenderingContext2D — Colors', () => {
  it('fills with named color "red"', () => {
    const c = ctx(10, 10);
    c.fillStyle = 'red';
    c.fillRect(0, 0, 10, 10);
    const [r, g, b, a] = getPixel(c, 0, 0);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
    expect(a).toBe(255);
  });

  it('fills with hex color', () => {
    const c = ctx(10, 10);
    c.fillStyle = '#00ff00';
    c.fillRect(0, 0, 10, 10);
    const [r, g, b] = getPixel(c, 0, 0);
    expect(r).toBe(0);
    expect(g).toBe(255);
    expect(b).toBe(0);
  });

  it('fills with hsl color', () => {
    const c = ctx(10, 10);
    c.fillStyle = 'hsl(0, 100%, 50%)';
    c.fillRect(0, 0, 10, 10);
    const [r, g, b] = getPixel(c, 0, 0);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it('transparent color produces transparent pixels', () => {
    const c = ctx(10, 10);
    c.fillStyle = 'transparent';
    c.fillRect(0, 0, 10, 10);
    const [, , , a] = getPixel(c, 0, 0);
    expect(a).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATHS
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasRenderingContext2D — Paths', () => {
  it('fill closed triangle', () => {
    const c = ctx(20, 20);
    c.fillStyle = 'blue';
    c.beginPath();
    c.moveTo(10, 2);
    c.lineTo(18, 18);
    c.lineTo(2, 18);
    c.closePath();
    c.fill();
    // Center of triangle should be filled
    const [r, g, b] = getPixel(c, 10, 10);
    expect(b).toBe(255);
    // Outside should be empty
    const [, , , a] = getPixel(c, 0, 0);
    expect(a).toBe(0);
  });

  it('stroke draws lines', () => {
    const c = ctx(20, 20);
    c.strokeStyle = '#ff0000';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(19, 19);
    c.stroke();
    // Should have red pixels along diagonal
    const [r] = getPixel(c, 10, 10);
    expect(r).toBe(255);
  });

  it('fillRect (shortcut) works', () => {
    const c = ctx(10, 10);
    c.fillStyle = 'green';
    c.fillRect(0, 0, 10, 10);
    const [r, g, b] = getPixel(c, 5, 5);
    expect(g).toBe(128); // named "green" = #008000
  });

  it('arc draws circle', () => {
    const c = ctx(20, 20);
    c.fillStyle = 'red';
    c.beginPath();
    c.arc(10, 10, 5, 0, Math.PI * 2);
    c.closePath();
    c.fill();
    // Center should be red
    const [r] = getPixel(c, 10, 10);
    expect(r).toBe(255);
    // Far corner should be empty
    const [, , , a] = getPixel(c, 0, 0);
    expect(a).toBe(0);
  });

  it('bezierCurveTo draws curve', () => {
    const c = ctx(30, 30);
    c.strokeStyle = '#ff0000';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, 15);
    c.bezierCurveTo(10, 0, 20, 30, 30, 15);
    c.stroke();
    // Should have pixels along the curve
    const [r] = getPixel(c, 15, 15);
    expect(r).toBe(255);
  });

  it('quadraticCurveTo draws curve', () => {
    const c = ctx(30, 30);
    c.strokeStyle = '#ff0000';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, 20);
    c.quadraticCurveTo(15, 0, 30, 20);
    c.stroke();
    // Should have pixels
    const [r] = getPixel(c, 15, 10);
    expect(r).toBe(255);
  });

  it('fill a rectangle path', () => {
    const c = ctx(10, 10);
    c.fillStyle = 'purple';
    c.beginPath();
    c.rect(2, 2, 6, 6);
    c.fill();
    const [r, g, b] = getPixel(c, 4, 4);
    expect(r).toBe(128);
    expect(g).toBe(0);
    expect(b).toBe(128);
    const [, , , a] = getPixel(c, 0, 0);
    expect(a).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRANSFORMS
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasRenderingContext2D — Transforms', () => {
  it('translate moves drawing origin', () => {
    const c = ctx(20, 20);
    c.fillStyle = 'red';
    c.translate(5, 5);
    c.fillRect(0, 0, 5, 5);
    const [r] = getPixel(c, 7, 7);
    expect(r).toBe(255);
    const [, , , a] = getPixel(c, 2, 2);
    expect(a).toBe(0);
  });

  it('scale scales drawing', () => {
    const c = ctx(20, 20);
    c.fillStyle = 'red';
    c.scale(2, 2);
    c.fillRect(0, 0, 5, 5);
    // Should fill 10x10 area
    const [r] = getPixel(c, 8, 8);
    expect(r).toBe(255);
    const [, , , a] = getPixel(c, 11, 11);
    expect(a).toBe(0);
  });

  it('rotate rotates drawing', () => {
    const c = ctx(30, 30);
    c.fillStyle = 'red';
    c.translate(15, 15);
    c.rotate(Math.PI / 4); // 45 degrees
    c.fillRect(-5, -5, 10, 10);
    // Center should be red
    const [r] = getPixel(c, 15, 15);
    expect(r).toBe(255);
  });

  it('resetTransform restores identity', () => {
    const c = ctx(20, 20);
    c.fillStyle = 'red';
    c.translate(10, 10);
    c.resetTransform();
    c.fillRect(0, 0, 5, 5);
    const [r] = getPixel(c, 2, 2);
    expect(r).toBe(255);
    const [, , , a] = getPixel(c, 12, 12);
    expect(a).toBe(0);
  });

  it('setTransform sets absolute matrix', () => {
    const c = ctx(20, 20);
    c.fillStyle = 'red';
    c.setTransform(2, 0, 0, 2, 5, 5);
    c.fillRect(0, 0, 5, 5);
    // Should fill 10x10 starting at (5,5)
    const [r] = getPixel(c, 7, 7);
    expect(r).toBe(255);
  });

  it('save/restore preserves transform', () => {
    const c = ctx(20, 20);
    c.fillStyle = 'red';
    c.translate(5, 5);
    c.save();
    c.translate(5, 5);
    c.restore();
    c.fillRect(0, 0, 3, 3);
    const [r] = getPixel(c, 6, 6);
    expect(r).toBe(255);
    const [, , , a] = getPixel(c, 12, 12);
    expect(a).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL ALPHA
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasRenderingContext2D — Global Alpha', () => {
  it('semi-transparent fill', () => {
    const c = ctx(10, 10);
    c.globalAlpha = 0.5;
    c.fillStyle = 'white';
    c.fillRect(0, 0, 10, 10);
    const [r, g, b, a] = getPixel(c, 5, 5);
    expect(r).toBe(255);
    expect(g).toBe(255);
    expect(b).toBe(255);
    expect(a).toBe(128); // 50% of 255
  });

  it('alpha blending with existing content', () => {
    const c = ctx(10, 10);
    c.fillStyle = 'red';
    c.fillRect(0, 0, 10, 10);
    c.globalAlpha = 0.5;
    c.fillStyle = 'blue';
    c.fillRect(0, 0, 10, 10);
    const [r, g, b] = getPixel(c, 5, 5);
    // Source-over: src=blue(0,0,255,0.5) over dst=red(255,0,0,1)
    // outA = 0.5 + 1*(1-0.5) = 1.0
    // outR = (0*0.5 + 255*1*0.5) / 1.0 = 127.5 → 128
    expect(r).toBeGreaterThanOrEqual(127);
    expect(r).toBeLessThanOrEqual(128);
    expect(b).toBeGreaterThanOrEqual(127);
    expect(b).toBeLessThanOrEqual(255);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEXT
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasRenderingContext2D — Text', () => {
  it('fillText renders characters', () => {
    const c = ctx(80, 20);
    c.fillStyle = 'white';
    c.font = '8px sans-serif';
    c.fillText('Hi', 0, 8);
    // H at (0,0): row 0 bitmap 0x66 has columns 1,2,5,6 set
    const [r, g, b, a] = getPixel(c, 1, 0);
    expect(r).toBe(255);
    expect(g).toBe(255);
    expect(b).toBe(255);
    expect(a).toBe(255);
  });

  it('measureText returns width', () => {
    const c = ctx(100, 20);
    c.font = '10px sans-serif';
    const m = c.measureText('Hello');
    expect(m.width).toBeGreaterThan(0);
    expect(m.actualBoundingBoxAscent).toBeGreaterThan(0);
  });

  it('fillText with textAlign center', () => {
    const c = ctx(100, 20);
    c.fillStyle = 'white';
    c.font = '8px sans-serif';
    c.textAlign = 'center';
    c.fillText('A', 50, 10);
    // A at charX=46: row 0 bitmap 0x18 has columns 3,4 set → pixel (49,2) or (50,2)
    const [r] = getPixel(c, 49, 2);
    expect(r).toBe(255);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IMAGES (drawImage)
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasRenderingContext2D — Images', () => {
  it('drawImage blits source image', () => {
    const c = ctx(10, 10);
    // Create a 2x2 red image
    const img = { data: new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]), width: 2, height: 2 };
    c.drawImage(img, 0, 0);
    const [r, g, b, a] = getPixel(c, 0, 0);
    expect(r).toBe(255);
    expect(a).toBe(255);
  });

  it('drawImage with scaling', () => {
    const c = ctx(10, 10);
    const img = { data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 };
    c.drawImage(img, 0, 0, 10, 10);
    const [r] = getPixel(c, 5, 5);
    expect(r).toBe(255);
  });

  it('drawImage with source rect', () => {
    const c = ctx(10, 10);
    // 4x4 image with blue right half
    const data = new Uint8ClampedArray(4 * 4 * 4);
    // Left half: red
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 2; x++) {
        const i = (y * 4 + x) * 4;
        data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
      }
      // Right half: blue
      for (let x = 2; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 255; data[i + 3] = 255;
      }
    }
    const img = { data, width: 4, height: 4 };
    c.drawImage(img, 2, 0, 2, 4, 0, 0, 10, 10);
    const [r] = getPixel(c, 5, 5);
    expect(r).toBe(0); // Blue half
    const [, , b] = getPixel(c, 5, 5);
    expect(b).toBe(255);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PIXEL DATA
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasRenderingContext2D — Pixel Data', () => {
  it('getImageData returns correct pixels', () => {
    const c = ctx(10, 10);
    c.fillStyle = 'red';
    c.fillRect(0, 0, 5, 5);
    const imgData = c.getImageData(0, 0, 5, 5);
    expect(imgData.width).toBe(5);
    expect(imgData.height).toBe(5);
    expect(imgData.data[0]).toBe(255); // R
    expect(imgData.data[1]).toBe(0);   // G
    expect(imgData.data[2]).toBe(0);   // B
    expect(imgData.data[3]).toBe(255); // A
  });

  it('putImageData writes pixels', () => {
    const c = ctx(10, 10);
    const imgData = c.createImageData(3, 3);
    // Fill with green
    for (let i = 0; i < imgData.data.length; i += 4) {
      imgData.data[i] = 0;
      imgData.data[i + 1] = 255;
      imgData.data[i + 2] = 0;
      imgData.data[i + 3] = 255;
    }
    c.putImageData(imgData, 2, 2);
    const [r, g, b] = getPixel(c, 3, 3);
    expect(r).toBe(0);
    expect(g).toBe(255);
    expect(b).toBe(0);
  });

  it('createImageData returns blank data', () => {
    const c = ctx(10, 10);
    const imgData = c.createImageData(5, 5);
    expect(imgData.width).toBe(5);
    expect(imgData.height).toBe(5);
    expect(imgData.data.length).toBe(5 * 5 * 4);
    // All zeros
    expect(imgData.data[0]).toBe(0);
    expect(imgData.data[3]).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GRADIENTS
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasRenderingContext2D — Gradients', () => {
  it('createLinearGradient creates gradient', () => {
    const c = ctx(10, 10);
    const grad = c.createLinearGradient(0, 0, 9, 0);
    grad.addColorStop(0, 'red');
    grad.addColorStop(1, 'blue');
    c.fillStyle = grad;
    c.fillRect(0, 0, 10, 10);
    // Left side should be red
    const [r1] = getPixel(c, 0, 5);
    expect(r1).toBe(255);
    // Right side should be blue
    const [, , b2] = getPixel(c, 9, 5);
    expect(b2).toBe(255);
  });

  it('createRadialGradient creates gradient', () => {
    const c = ctx(20, 20);
    const grad = c.createRadialGradient(10, 10, 0, 10, 10, 10);
    grad.addColorStop(0, 'white');
    grad.addColorStop(1, 'black');
    c.fillStyle = grad;
    c.fillRect(0, 0, 20, 20);
    // Center should be white
    const [r] = getPixel(c, 10, 10);
    expect(r).toBe(255);
  });

  it('gradient with multiple stops', () => {
    const grad = new CanvasGradient('linear', 0, 0, 100, 0);
    grad.addColorStop(0, 'red');
    grad.addColorStop(0.5, 'green');
    grad.addColorStop(1, 'blue');
    expect(grad.stops.length).toBe(3);
    // Middle should be green
    const color = grad.getColorAt(0.5);
    expect(color).toContain('128'); // green = rgb(0,128,0)
  });

  it('gradient addColorStop throws on out of range', () => {
    const grad = new CanvasGradient('linear', 0, 0, 10, 10);
    expect(() => grad.addColorStop(-0.1, 'red')).toThrow();
    expect(() => grad.addColorStop(1.1, 'red')).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LINE DASH
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasRenderingContext2D — Line Dash', () => {
  it('setLineDash/getLineDash round-trip', () => {
    const c = ctx(10, 10);
    c.setLineDash([5, 3]);
    expect(c.getLineDash()).toEqual([5, 3]);
  });

  it('lineDashOffset property', () => {
    const c = ctx(10, 10);
    c.lineDashOffset = 10;
    expect(c.lineDashOffset).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Path2D
// ─────────────────────────────────────────────────────────────────────────────

describe('Path2D', () => {
  it('creates empty path', () => {
    const p = new Path2D();
    expect(p.isEmpty).toBe(true);
  });

  it('moveTo/lineTo/closePath', () => {
    const p = new Path2D();
    p.moveTo(0, 0);
    p.lineTo(10, 0);
    p.lineTo(10, 10);
    p.closePath();
    expect(p._commands.length).toBe(4);
    expect(p.isEmpty).toBe(false);
  });

  it('clone creates independent copy', () => {
    const p1 = new Path2D();
    p1.moveTo(0, 0);
    p1.lineTo(10, 10);
    const p2 = p1.clone();
    p2.lineTo(20, 20);
    expect(p1._commands.length).toBe(2);
    expect(p2._commands.length).toBe(3);
  });

  it('rect adds rect command', () => {
    const p = new Path2D();
    p.rect(0, 0, 10, 10);
    expect(p._commands.length).toBe(1);
    expect(p._commands[0]!.type).toBe('rect');
  });

  it('arc adds arc command', () => {
    const p = new Path2D();
    p.arc(10, 10, 5, 0, Math.PI * 2);
    expect(p._commands.length).toBe(2);
    expect(p._commands[0]!.type).toBe('moveTo');
    expect(p._commands[1]!.type).toBe('arc');
  });

  it('bezierCurveTo adds bezier command', () => {
    const p = new Path2D();
    p.moveTo(0, 0);
    p.bezierCurveTo(10, 0, 20, 10, 30, 10);
    expect(p._commands.length).toBe(2);
  });

  it('copy constructor copies path', () => {
    const p1 = new Path2D();
    p1.moveTo(5, 5);
    p1.lineTo(15, 15);
    const p2 = new Path2D(p1);
    expect(p2._commands.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TO DATA URL
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasRenderingContext2D — toDataURL', () => {
  it('returns valid data URL', () => {
    const c = ctx(10, 10);
    c.fillStyle = 'red';
    c.fillRect(0, 0, 10, 10);
    const url = c.toDataURL();
    expect(url).toMatch(/^data:image\/png;base64,/);
    // Base64 content should be non-empty
    const base64 = url.split(',')[1]!;
    expect(base64.length).toBeGreaterThan(0);
  });

  it('blank canvas produces valid data URL', () => {
    const c = ctx(5, 5);
    const url = c.toDataURL();
    expect(url).toMatch(/^data:image\/png;base64,/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLIPPING
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasRenderingContext2D — Clipping', () => {
  it('clip restricts drawing area', () => {
    const c = ctx(20, 20);
    c.beginPath();
    c.rect(5, 5, 10, 10);
    c.clip();
    c.fillStyle = 'red';
    c.fillRect(0, 0, 20, 20);
    // Should be red only within clip region
    const [r1] = getPixel(c, 7, 7);
    expect(r1).toBe(255);
    // Outside clip should be empty
    const [, , , a] = getPixel(c, 1, 1);
    expect(a).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPLEX SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasRenderingContext2D — Complex', () => {
  it('drawing after save/restore with transform', () => {
    const c = ctx(30, 30);
    c.fillStyle = 'red';
    c.translate(10, 10);
    c.save();
    c.fillStyle = 'blue';
    c.translate(5, 5);
    c.fillRect(0, 0, 5, 5);
    const [r, g, b] = getPixel(c, 17, 17);
    expect(b).toBe(255);
    c.restore();
    c.fillRect(0, 0, 5, 5);
    const [r2] = getPixel(c, 12, 12);
    expect(r2).toBe(255);
  });

  it('multiple layers of semi-transparent fills', () => {
    const c = ctx(10, 10);
    c.globalAlpha = 0.5;
    c.fillStyle = 'red';
    c.fillRect(0, 0, 10, 10);
    c.fillStyle = 'lime';
    c.fillRect(0, 0, 10, 10);
    const [r, g] = getPixel(c, 5, 5);
    // After red: alpha=0.5, r=255
    // After lime (src=0,255,0,0.5 over dst=255,0,0,0.5):
    // outA = 0.5 + 0.5*(1-0.5) = 0.75
    // outR = (0*0.5 + 255*0.5*0.5) / 0.75 = 85
    // outG = (255*0.5 + 0*0.5*0.5) / 0.75 = 170
    expect(r).toBeGreaterThanOrEqual(80);
    expect(r).toBeLessThanOrEqual(90);
    expect(g).toBeGreaterThanOrEqual(165);
    expect(g).toBeLessThanOrEqual(175);
  });

  it('stroke with round line caps', () => {
    const c = ctx(20, 10);
    c.strokeStyle = 'red';
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(2, 5);
    c.lineTo(18, 5);
    c.stroke();
    // End cap should extend beyond the line
    const [r] = getPixel(c, 1, 5);
    expect(r).toBe(255);
  });
});
