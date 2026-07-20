import type { GpuShaderModule } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// SHADER MODULES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages WGSL shader module compilation and caching.
 *
 * Responsibilities:
 * - Compile WGSL code into GPUShaderModule
 * - Cache compiled modules for reuse
 * - Provide shader code for common operations
 */
export class ShaderModules {
  private readonly device: GPUDevice;
  private readonly cache = new Map<string, GpuShaderModule>();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Get or compile a shader module from WGSL code.
   */
  getOrCreate(code: string, label?: string): GpuShaderModule {
    const key = this.hash(code);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const module = this.device.createShaderModule({
      code,
      label: label ?? `shader-${this.cache.size}`,
    });

    const entry = {
      module,
      code,
      entryPoints: this.extractEntryPoints(code),
    };

    this.cache.set(key, entry);
    return entry;
  }

  /**
   * Get a cached shader module by key, or null if not found.
   */
  get(key: string): GpuShaderModule | null {
    return this.cache.get(key) ?? null;
  }

  /**
   * Check if a shader module is cached.
   */
  has(code: string): boolean {
    return this.cache.has(this.hash(code));
  }

  /**
   * Clear the shader cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size.
   */
  size(): number {
    return this.cache.size;
  }

  // ── Built-in Shaders ────────────────────────────────────────────

  /**
   * Get the fill-rect compute shader.
   */
  getFillRectShader(): GpuShaderModule {
    return this.getOrCreate(FILL_RECT_SHADER, 'fill-rect');
  }

  /**
   * Get the clear-rect compute shader.
   */
  getClearRectShader(): GpuShaderModule {
    return this.getOrCreate(CLEAR_RECT_SHADER, 'clear-rect');
  }

  /**
   * Get the composite (alpha blending) compute shader.
   */
  getCompositeShader(): GpuShaderModule {
    return this.getOrCreate(COMPOSITE_SHADER, 'composite');
  }

  /**
   * Get the draw-image compute shader.
   */
  getDrawImageShader(): GpuShaderModule {
    return this.getOrCreate(DRAW_IMAGE_SHADER, 'draw-image');
  }

  /**
   * Get the fill-text compute shader.
   */
  getFillTextShader(): GpuShaderModule {
    return this.getOrCreate(FILL_TEXT_SHADER, 'fill-text');
  }

  // ── Private ─────────────────────────────────────────────────────

  private hash(code: string): string {
    // Simple hash for cache key
    let h = 0;
    for (let i = 0; i < code.length; i++) {
      h = ((h << 5) - h + code.charCodeAt(i)) | 0;
    }
    return h.toString(36);
  }

  private extractEntryPoints(code: string): string[] {
    const entryPoints: string[] = [];
    const regex = /@compute\s+@workgroup_size\([^)]*\)\s*\n\s*fn\s+(\w+)/g;
    let match;

    while ((match = regex.exec(code)) !== null) {
      entryPoints.push(match[1]);
    }

    // Also check for @vertex and @fragment entry points
    const vertexRegex = /@vertex\s*\n\s*fn\s+(\w+)/g;
    while ((match = vertexRegex.exec(code)) !== null) {
      entryPoints.push(match[1]);
    }

    const fragmentRegex = /@fragment\s*\n\s*fn\s+(\w+)/g;
    while ((match = fragmentRegex.exec(code)) !== null) {
      entryPoints.push(match[1]);
    }

    return entryPoints;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN SHADER CODE
// ─────────────────────────────────────────────────────────────────────────────

const FILL_RECT_SHADER = `
// Fill Rectangle Compute Shader
// Fills a rectangular region of the pixel buffer with a solid color

@group(0) @binding(0) var<storage, read_write> pixels: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct Uniforms {
  rectX: u32,
  rectY: u32,
  rectWidth: u32,
  rectHeight: u32,
  colorR: u32,
  colorG: u32,
  colorB: u32,
  colorA: u32,
  viewportWidth: u32,
  viewportHeight: u32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = uniforms.rectX + id.x;
  let y = uniforms.rectY + id.y;

  // Bounds check
  if (x >= uniforms.rectX + uniforms.rectWidth ||
      y >= uniforms.rectY + uniforms.rectHeight ||
      x >= uniforms.viewportWidth ||
      y >= uniforms.viewportHeight) {
    return;
  }

  let idx = y * uniforms.viewportWidth + x;

  // Pack RGBA into single u32 (ABGR format for little-endian)
  let r = uniforms.colorR;
  let g = uniforms.colorG;
  let b = uniforms.colorB;
  let a = uniforms.colorA;

  pixels[idx] = (a << 24u) | (b << 16u) | (g << 8u) | r;
}
`;

const CLEAR_RECT_SHADER = `
// Clear Rectangle Compute Shader
// Clears a rectangular region to transparent black

@group(0) @binding(0) var<storage, read_write> pixels: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct Uniforms {
  rectX: u32,
  rectY: u32,
  rectWidth: u32,
  rectHeight: u32,
  viewportWidth: u32,
  viewportHeight: u32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = uniforms.rectX + id.x;
  let y = uniforms.rectY + id.y;

  // Bounds check
  if (x >= uniforms.rectX + uniforms.rectWidth ||
      y >= uniforms.rectY + uniforms.rectHeight ||
      x >= uniforms.viewportWidth ||
      y >= uniforms.viewportHeight) {
    return;
  }

  let idx = y * uniforms.viewportWidth + x;
  pixels[idx] = 0u; // Transparent black
}
`;

const COMPOSITE_SHADER = `
// Alpha Composite Compute Shader
// Performs source-over alpha compositing

@group(0) @binding(0) var<storage, read_write> pixels: array<u32>;
@group(0) @binding(1) var<storage> src: array<u32>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

struct Uniforms {
  width: u32,
  height: u32,
}

fn unpackRgba(packed: u32) -> vec4<f32> {
  let r = f32(packed & 0xFFu);
  let g = f32((packed >> 8u) & 0xFFu);
  let b = f32((packed >> 16u) & 0xFFu);
  let a = f32((packed >> 24u) & 0xFFu) / 255.0;
  return vec4<f32>(r / 255.0, g / 255.0, b / 255.0, a);
}

fn packRgba(color: vec4<f32>) -> u32 {
  let r = u32(color.r * 255.0);
  let g = u32(color.g * 255.0);
  let b = u32(color.b * 255.0);
  let a = u32(color.a * 255.0);
  return (a << 24u) | (b << 16u) | (g << 8u) | r;
}

fn sourceOver(dst: vec4<f32>, src: vec4<f32>) -> vec4<f32> {
  let outA = src.a + dst.a * (1.0 - src.a);
  if (outA <= 0.0) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }
  let invA = 1.0 / outA;
  return vec4<f32>(
    (src.r * src.a + dst.r * dst.a * (1.0 - src.a)) * invA,
    (src.g * src.a + dst.g * dst.a * (1.0 - src.a)) * invA,
    (src.b * src.a + dst.b * dst.a * (1.0 - src.a)) * invA,
    outA
  );
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x;
  let y = id.y;

  if (x >= uniforms.width || y >= uniforms.height) {
    return;
  }

  let idx = y * uniforms.width + x;
  let dstColor = unpackRgba(pixels[idx]);
  let srcColor = unpackRgba(src[idx]);

  let result = sourceOver(dstColor, srcColor);
  pixels[idx] = packRgba(result);
}
`;

const DRAW_IMAGE_SHADER = `
// Draw Image Compute Shader
// Renders a source image buffer onto the pixel buffer with nearest-neighbor scaling

@group(0) @binding(0) var<storage, read_write> pixels: array<u32>;
@group(0) @binding(1) var<storage, read> image: array<u32>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

struct Uniforms {
  dstX: u32,
  dstY: u32,
  dstWidth: u32,
  dstHeight: u32,
  srcWidth: u32,
  srcHeight: u32,
  viewportWidth: u32,
  viewportHeight: u32,
  globalAlpha: f32,
}

fn unpackRgba(packed: u32) -> vec4<f32> {
  let r = f32(packed & 0xFFu);
  let g = f32((packed >> 8u) & 0xFFu);
  let b = f32((packed >> 16u) & 0xFFu);
  let a = f32((packed >> 24u) & 0xFFu) / 255.0;
  return vec4<f32>(r / 255.0, g / 255.0, b / 255.0, a);
}

fn packRgba(color: vec4<f32>) -> u32 {
  let r = u32(clamp(color.r * 255.0, 0.0, 255.0));
  let g = u32(clamp(color.g * 255.0, 0.0, 255.0));
  let b = u32(clamp(color.b * 255.0, 0.0, 255.0));
  let a = u32(clamp(color.a * 255.0, 0.0, 255.0));
  return (a << 24u) | (b << 16u) | (g << 8u) | r;
}

fn sourceOver(dst: vec4<f32>, src: vec4<f32>) -> vec4<f32> {
  let outA = src.a + dst.a * (1.0 - src.a);
  if (outA <= 0.0) { return vec4<f32>(0.0); }
  let invA = 1.0 / outA;
  return vec4<f32>(
    (src.r * src.a + dst.r * dst.a * (1.0 - src.a)) * invA,
    (src.g * src.a + dst.g * dst.a * (1.0 - src.a)) * invA,
    (src.b * src.a + dst.b * dst.a * (1.0 - src.a)) * invA,
    outA
  );
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let px = uniforms.dstX + id.x;
  let py = uniforms.dstY + id.y;

  if (px >= uniforms.dstX + uniforms.dstWidth ||
      py >= uniforms.dstY + uniforms.dstHeight ||
      px >= uniforms.viewportWidth ||
      py >= uniforms.viewportHeight) {
    return;
  }

  // Nearest-neighbor sampling from source
  let srcX = min(u32(f32(px - uniforms.dstX) * f32(uniforms.srcWidth) / f32(uniforms.dstWidth)), uniforms.srcWidth - 1u);
  let srcY = min(u32(f32(py - uniforms.dstY) * f32(uniforms.srcHeight) / f32(uniforms.dstHeight)), uniforms.srcHeight - 1u);
  let srcIdx = srcY * uniforms.srcWidth + srcX;

  let srcColor = unpackRgba(image[srcIdx]);
  let alpha = srcColor.a * uniforms.globalAlpha;

  if (alpha <= 0.0) { return; }

  let dstIdx = py * uniforms.viewportWidth + px;
  let dstColor = unpackRgba(pixels[dstIdx]);
  let result = sourceOver(dstColor, vec4<f32>(srcColor.rgb, alpha));
  pixels[dstIdx] = packRgba(result);
}
`;

const FILL_TEXT_SHADER = `
// Fill Text Compute Shader
// Renders bitmap font characters onto the pixel buffer
// Each character is 8x8 pixels from a font atlas

@group(0) @binding(0) var<storage, read_write> pixels: array<u32>;
@group(0) @binding(1) var<storage, read> textChars: array<u32>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;
@group(0) @binding(3) var<storage, read> fontAtlas: array<u32>;

struct Uniforms {
  baseX: u32,
  baseY: u32,
  charCount: u32,
  fontSize: f32,
  textAlign: u32,
  colorR: u32,
  colorG: u32,
  colorB: u32,
  colorA: u32,
  globalAlpha: f32,
  viewportWidth: u32,
  viewportHeight: u32,
}

const FONT_W: u32 = 8u;
const FONT_H: u32 = 8u;
const FONT_DATA_SIZE: u32 = 8u;

fn unpackRgba(packed: u32) -> vec4<f32> {
  let r = f32(packed & 0xFFu);
  let g = f32((packed >> 8u) & 0xFFu);
  let b = f32((packed >> 16u) & 0xFFu);
  let a = f32((packed >> 24u) & 0xFFu) / 255.0;
  return vec4<f32>(r / 255.0, g / 255.0, b / 255.0, a);
}

fn packRgba(color: vec4<f32>) -> u32 {
  let r = u32(clamp(color.r * 255.0, 0.0, 255.0));
  let g = u32(clamp(color.g * 255.0, 0.0, 255.0));
  let b = u32(clamp(color.b * 255.0, 0.0, 255.0));
  let a = u32(clamp(color.a * 255.0, 0.0, 255.0));
  return (a << 24u) | (b << 16u) | (g << 8u) | r;
}

fn sourceOver(dst: vec4<f32>, src: vec4<f32>) -> vec4<f32> {
  let outA = src.a + dst.a * (1.0 - src.a);
  if (outA <= 0.0) { return vec4<f32>(0.0); }
  let invA = 1.0 / outA;
  return vec4<f32>(
    (src.r * src.a + dst.r * dst.a * (1.0 - src.a)) * invA,
    (src.g * src.a + dst.g * dst.a * (1.0 - src.a)) * invA,
    (src.b * src.a + dst.b * dst.a * (1.0 - src.a)) * invA,
    outA
  );
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let charIdx = id.x;
  if (charIdx >= uniforms.charCount) { return; }

  let charCode = textChars[charIdx];
  // Only printable ASCII (32..126)
  if (charCode < 32u || charCode > 126u) { return; }

  let charOffset = charCode - 32u;

  // Calculate character position with alignment
  let scale = uniforms.fontSize / f32(FONT_H);
  let charW = f32(FONT_W) * scale;
  var startX = f32(uniforms.baseX);

  if (uniforms.textAlign == 1u) { // center
    startX = f32(uniforms.baseX) - (f32(uniforms.charCount) * charW) / 2.0;
  } else if (uniforms.textAlign == 2u) { // right/end
    startX = f32(uniforms.baseX) - f32(uniforms.charCount) * charW;
  }

  let baseY = f32(uniforms.baseY) - uniforms.fontSize * 0.8;
  let chX = startX + f32(charIdx) * charW;

  // Render the 8x8 bitmap with scaling
  let color = vec4<f32>(
    f32(uniforms.colorR) / 255.0,
    f32(uniforms.colorG) / 255.0,
    f32(uniforms.colorB) / 255.0,
    f32(uniforms.colorA) / 255.0 * uniforms.globalAlpha
  );

  if (color.a <= 0.0) { return; }

  for (var row: u32 = 0u; row < FONT_H; row = row + 1u) {
    let bmpRow = fontAtlas[charOffset * FONT_DATA_SIZE + row];
    for (var col: u32 = 0u; col < FONT_W; col = col + 1u) {
      let bit = 7u - col;
      if ((bmpRow & (1u << bit)) == 0u) { continue; }

      // Scaled pixel position
      let px = u32(chX + f32(col) * scale);
      let py = u32(baseY + f32(row) * scale);

      if (px >= uniforms.viewportWidth || py >= uniforms.viewportHeight) { continue; }

      let idx = py * uniforms.viewportWidth + px;
      let dstColor = unpackRgba(pixels[idx]);
      let result = sourceOver(dstColor, color);
      pixels[idx] = packRgba(result);
    }
  }
}
`;
