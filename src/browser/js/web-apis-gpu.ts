/**
 * @file src/browser/js/web-apis-gpu.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * WebGPU API for the Nova JS engine's global environment:
 *
 * - GPU (GPUAdapter, GPUDevice, GPUBuffer, GPUTexture, GPURenderPipeline,
 *   GPUBindGroupLayout, GPUCommandEncoder, GPUQueue, GPUShaderModule, etc.)
 * - GPUBuffer constants (MAP_READ, MAP_WRITE, COPY_SRC, etc.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  createObject, createArray, createNativeFunction,
} from './values';
import { createPromiseLike } from './web-apis-helpers';

// ─────────────────────────────────────────────────────────────────────────────
// WEBGPU API
// ─────────────────────────────────────────────────────────────────────────────

export function createGPUObject() {
  const gpuObj = createObject(null);

  // GPU.requestAdapter() → Promise<GPUAdapter | null>
  gpuObj.properties.set('requestAdapter', {
    value: createNativeFunction('requestAdapter', (_this, args) => {
      const adapterObj = createObject(null);
      adapterObj.properties.set('requestDevice', {
        value: createNativeFunction('requestDevice', (_this, args) => {
          const deviceObj = createObject(null);
          deviceObj.properties.set('label', { value: 'default-device', writable: true, enumerable: true, configurable: true });
          deviceObj.properties.set('lost', {
            value: createPromiseLike({ reason: 'destroyed', message: 'none' }),
            writable: false, enumerable: true, configurable: true,
          });
          deviceObj.properties.set('destroy', {
            value: createNativeFunction('destroy', () => undefined),
            writable: true, enumerable: true, configurable: true,
          });
          deviceObj.properties.set('createBuffer', {
            value: createNativeFunction('createBuffer', (_t, a) => {
              const bufObj = createObject(null);
              bufObj.properties.set('size', { value: (a[0] as any)?.properties?.get('size')?.value ?? 0, writable: true, enumerable: true, configurable: true });
              bufObj.properties.set('usage', { value: (a[0] as any)?.properties?.get('usage')?.value ?? 0, writable: true, enumerable: true, configurable: true });
              bufObj.properties.set('destroy', {
                value: createNativeFunction('destroy', () => undefined),
                writable: true, enumerable: true, configurable: true,
              });
              bufObj.properties.set('label', { value: (a[0] as any)?.properties?.get('label')?.value ?? '', writable: true, enumerable: true, configurable: true });
              return bufObj;
            }),
            writable: true, enumerable: true, configurable: true,
          });
          deviceObj.properties.set('createTexture', {
            value: createNativeFunction('createTexture', (_t, a) => {
              const texObj = createObject(null);
              texObj.properties.set('label', { value: (a[0] as any)?.properties?.get('label')?.value ?? '', writable: true, enumerable: true, configurable: true });
              texObj.properties.set('width', { value: (a[0] as any)?.properties?.get('width')?.value ?? 0, writable: true, enumerable: true, configurable: true });
              texObj.properties.set('height', { value: (a[0] as any)?.properties?.get('height')?.value ?? 0, writable: true, enumerable: true, configurable: true });
              texObj.properties.set('destroy', {
                value: createNativeFunction('destroy', () => undefined),
                writable: true, enumerable: true, configurable: true,
              });
              texObj.properties.set('createView', {
                value: createNativeFunction('createView', () => {
                  const viewObj = createObject(null);
                  viewObj.properties.set('label', { value: '', writable: true, enumerable: true, configurable: true });
                  return viewObj;
                }),
                writable: true, enumerable: true, configurable: true,
              });
              texObj.properties.set('usage', { value: (a[0] as any)?.properties?.get('usage')?.value ?? 0, writable: true, enumerable: true, configurable: true });
              texObj.properties.set('format', { value: (a[0] as any)?.properties?.get('format')?.value ?? 'bgra8unorm', writable: true, enumerable: true, configurable: true });
              return texObj;
            }),
            writable: true, enumerable: true, configurable: true,
          });
          deviceObj.properties.set('createBindGroupLayout', {
            value: createNativeFunction('createBindGroupLayout', (_t, a) => {
              const layoutObj = createObject(null);
              layoutObj.properties.set('label', { value: (a[0] as any)?.properties?.get('label')?.value ?? '', writable: true, enumerable: true, configurable: true });
              return layoutObj;
            }),
            writable: true, enumerable: true, configurable: true,
          });
          deviceObj.properties.set('createBindGroup', {
            value: createNativeFunction('createBindGroup', (_t, a) => {
              const bgObj = createObject(null);
              bgObj.properties.set('label', { value: (a[0] as any)?.properties?.get('label')?.value ?? '', writable: true, enumerable: true, configurable: true });
              return bgObj;
            }),
            writable: true, enumerable: true, configurable: true,
          });
          deviceObj.properties.set('createRenderPipelineLayout', {
            value: createNativeFunction('createRenderPipelineLayout', (_t, a) => {
              const plObj = createObject(null);
              plObj.properties.set('label', { value: (a[0] as any)?.properties?.get('label')?.value ?? '', writable: true, enumerable: true, configurable: true });
              return plObj;
            }),
            writable: true, enumerable: true, configurable: true,
          });
          deviceObj.properties.set('createRenderPipeline', {
            value: createNativeFunction('createRenderPipeline', (_t, a) => {
              const pipeObj = createObject(null);
              pipeObj.properties.set('label', { value: (a[0] as any)?.properties?.get('label')?.value ?? '', writable: true, enumerable: true, configurable: true });
              pipeObj.properties.set('getBindGroupLayout', {
                value: createNativeFunction('getBindGroupLayout', () => {
                  const layoutObj = createObject(null);
                  return layoutObj;
                }),
                writable: true, enumerable: true, configurable: true,
              });
              return pipeObj;
            }),
            writable: true, enumerable: true, configurable: true,
          });
          deviceObj.properties.set('createComputePipeline', {
            value: createNativeFunction('createComputePipeline', (_t, a) => {
              const pipeObj = createObject(null);
              pipeObj.properties.set('label', { value: (a[0] as any)?.properties?.get('label')?.value ?? '', writable: true, enumerable: true, configurable: true });
              pipeObj.properties.set('getBindGroupLayout', {
                value: createNativeFunction('getBindGroupLayout', () => createObject(null)),
                writable: true, enumerable: true, configurable: true,
              });
              return pipeObj;
            }),
            writable: true, enumerable: true, configurable: true,
          });
          deviceObj.properties.set('createCommandEncoder', {
            value: createNativeFunction('createCommandEncoder', () => {
              const encObj = createObject(null);
              encObj.properties.set('beginRenderPass', {
                value: createNativeFunction('beginRenderPass', () => {
                  const passObj = createObject(null);
                  passObj.properties.set('setPipeline', { value: createNativeFunction('setPipeline', () => undefined), writable: true, enumerable: true, configurable: true });
                  passObj.properties.set('setBindGroup', { value: createNativeFunction('setBindGroup', () => undefined), writable: true, enumerable: true, configurable: true });
                  passObj.properties.set('draw', { value: createNativeFunction('draw', () => undefined), writable: true, enumerable: true, configurable: true });
                  passObj.properties.set('end', { value: createNativeFunction('end', () => undefined), writable: true, enumerable: true, configurable: true });
                  return passObj;
                }),
                writable: true, enumerable: true, configurable: true,
              });
              encObj.properties.set('beginComputePass', {
                value: createNativeFunction('beginComputePass', () => {
                  const passObj = createObject(null);
                  passObj.properties.set('setPipeline', { value: createNativeFunction('setPipeline', () => undefined), writable: true, enumerable: true, configurable: true });
                  passObj.properties.set('setBindGroup', { value: createNativeFunction('setBindGroup', () => undefined), writable: true, enumerable: true, configurable: true });
                  passObj.properties.set('dispatchWorkgroups', { value: createNativeFunction('dispatchWorkgroups', () => undefined), writable: true, enumerable: true, configurable: true });
                  passObj.properties.set('end', { value: createNativeFunction('end', () => undefined), writable: true, enumerable: true, configurable: true });
                  return passObj;
                }),
                writable: true, enumerable: true, configurable: true,
              });
              encObj.properties.set('finish', {
                value: createNativeFunction('finish', () => {
                  const cmdObj = createObject(null);
                  cmdObj.properties.set('label', { value: '', writable: true, enumerable: true, configurable: true });
                  return cmdObj;
                }),
                writable: true, enumerable: true, configurable: true,
              });
              return encObj;
            }),
            writable: true, enumerable: true, configurable: true,
          });
          deviceObj.properties.set('createQueue', {
            value: createNativeFunction('createQueue', () => {
              const queueObj = createObject(null);
              queueObj.properties.set('label', { value: '', writable: true, enumerable: true, configurable: true });
              queueObj.properties.set('submit', { value: createNativeFunction('submit', () => undefined), writable: true, enumerable: true, configurable: true });
              queueObj.properties.set('writeBuffer', { value: createNativeFunction('writeBuffer', () => undefined), writable: true, enumerable: true, configurable: true });
              queueObj.properties.set('writeTexture', { value: createNativeFunction('writeTexture', () => undefined), writable: true, enumerable: true, configurable: true });
              queueObj.properties.set('onSubmittedWorkDone', { value: createNativeFunction('onSubmittedWorkDone', () => createPromiseLike(undefined)), writable: true, enumerable: true, configurable: true });
              return queueObj;
            }),
            writable: true, enumerable: true, configurable: true,
          });
          deviceObj.properties.set('createShaderModule', {
            value: createNativeFunction('createShaderModule', (_t, a) => {
              const shaderObj = createObject(null);
              const shaderOpts = a[0] as any;
              const shaderLabel = shaderOpts?.properties?.get('label')?.value ?? shaderOpts?.label ?? '';
              shaderObj.properties.set('label', { value: shaderLabel, writable: true, enumerable: true, configurable: true });
              shaderObj.properties.set('getCompilationInfo', {
                value: createNativeFunction('getCompilationInfo', () => createPromiseLike({ messages: [] })),
                writable: true, enumerable: true, configurable: true,
              });
              return shaderObj;
            }),
            writable: true, enumerable: true, configurable: true,
          });
          return createPromiseLike(deviceObj);
        }),
        writable: true, enumerable: true, configurable: true,
      });
      adapterObj.properties.set('features', { value: createArray([]), writable: false, enumerable: true, configurable: true });
      adapterObj.properties.set('limits', {
        value: (() => {
          const limObj = createObject(null);
          limObj.properties.set('maxTextureDimension1D', { value: 8192, writable: false, enumerable: true, configurable: false });
          limObj.properties.set('maxTextureDimension2D', { value: 8192, writable: false, enumerable: true, configurable: false });
          limObj.properties.set('maxTextureDimension3D', { value: 2048, writable: false, enumerable: true, configurable: false });
          limObj.properties.set('maxBufferSize', { value: 134217728, writable: false, enumerable: true, configurable: false });
          return limObj;
        })(),
        writable: false, enumerable: true, configurable: true,
      });
      adapterObj.properties.set('info', {
        value: (() => {
          const infoObj = createObject(null);
          infoObj.properties.set('vendor', { value: 'nova', writable: false, enumerable: true, configurable: false });
          infoObj.properties.set('device', { value: 'nova-gpu', writable: false, enumerable: true, configurable: false });
          infoObj.properties.set('description', { value: 'Nova WebGPU Adapter', writable: false, enumerable: true, configurable: false });
          return infoObj;
        })(),
        writable: false, enumerable: true, configurable: true,
      });
      return createPromiseLike(adapterObj);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // GPU.getPreferredCanvasFormat()
  gpuObj.properties.set('getPreferredCanvasFormat', {
    value: createNativeFunction('getPreferredCanvasFormat', () => 'bgra8unorm'),
    writable: true, enumerable: true, configurable: true,
  });

  // GPU.wgslShaderDefines
  gpuObj.properties.set('wgslShaderDefines', {
    value: createObject(null),
    writable: false, enumerable: true, configurable: false,
  });

  gpuObj.properties.set('__type', { value: 'GPU', writable: false, enumerable: false, configurable: false });
  return gpuObj;
}

// GPUBuffer constants
export function createGPUConstants() {
  const constants = createObject(null);
  const consts: Record<string, number> = {
    MAP_READ: 0x0001, MAP_WRITE: 0x0002, COPY_SRC: 0x0004, COPY_DST: 0x0008,
    INDEX: 0x0010, VERTEX: 0x0020, UNIFORM: 0x0040, STORAGE: 0x0080,
    INDIRECT: 0x0100, QUERY_RESOLVE: 0x0200, STORAGE_READ_ONLY: 0x8000,
  };
  for (const [k, v] of Object.entries(consts)) {
    constants.properties.set(k, { value: v, writable: false, enumerable: true, configurable: false });
  }
  return constants;
}
