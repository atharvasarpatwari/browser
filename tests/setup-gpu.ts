/**
 * WebGPU globals for test environment.
 *
 * happy-dom does not provide WebGPU APIs. This setup file
 * provides the GPU constants needed for tests to run.
 */

// GPUBufferUsage constants
if (typeof globalThis.GPUBufferUsage === 'undefined') {
  (globalThis as any).GPUBufferUsage = {
    MAP_READ: 0x0001,
    MAP_WRITE: 0x0002,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080,
    INDIRECT: 0x0100,
    QUERY_RESOLVE: 0x0200,
  };
}

// GPUMapMode constants
if (typeof globalThis.GPUMapMode === 'undefined') {
  (globalThis as any).GPUMapMode = {
    READ: 0x0001,
    WRITE: 0x0002,
  };
}

// GPUColorWrite constants
if (typeof globalThis.GPUColorWrite === 'undefined') {
  (globalThis as any).GPUColorWrite = {
    RED: 0x0001,
    GREEN: 0x0002,
    BLUE: 0x0004,
    ALPHA: 0x0008,
    ALL: 0x000f,
  };
}

// GPUShaderStage constants
if (typeof globalThis.GPUShaderStage === 'undefined') {
  (globalThis as any).GPUShaderStage = {
    VERTEX: 0x0001,
    FRAGMENT: 0x0002,
    COMPUTE: 0x0004,
  };
}
