/**
 * @file src/browser/js/web-apis-wasm.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * WebAssembly API for the Nova JS engine's global environment:
 *
 * - WebAssembly (Module, Instance, Memory, Table, Global, Tag, Exception,
 *   compile, compileStreaming, instantiate, instantiateStreaming, validate)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  createObject, createArray, createNativeFunction,
  toNumber,
} from './values';
import { createPromiseLike, toJSValueShallow } from './web-apis-helpers';

// ─────────────────────────────────────────────────────────────────────────────
// WEBASSEMBLY (WASM) API
// ─────────────────────────────────────────────────────────────────────────────

export function createWebAssemblyObject() {
  const wasmObj = createObject(null);

  // WebAssembly.validate(bufferSource) → boolean
  wasmObj.properties.set('validate', {
    value: createNativeFunction('validate', (_this, args) => {
      const buffer = args[0];
      if (!buffer || typeof buffer !== 'object') return false;
      try {
        let bytes: Uint8Array;
        if (buffer instanceof ArrayBuffer || (buffer as any).buffer instanceof ArrayBuffer) {
          bytes = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : (buffer as any).buffer);
        } else {
          return false;
        }
        // Magic number check: first 4 bytes must be 0x00 0x61 0x73 0x6D (\0asm)
        if (bytes.length < 4) return false;
        return bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6D;
      } catch {
        return false;
      }
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // WebAssembly.compile(bufferSource) → Promise<Module>
  wasmObj.properties.set('compile', {
    value: createNativeFunction('compile', (_this, args) => {
      const buffer = args[0];
      if (!buffer) {
        return createPromiseLike({ error: new Error('Expected bufferSource') });
      }
      const modObj = createObject(null);
      modObj.properties.set('__type', { value: 'Module', writable: false, enumerable: false, configurable: false });
      modObj.properties.set('__bytes', {
        value: buffer,
        writable: false, enumerable: false, configurable: false,
      });
      // Module.prototype.imports()
      modObj.properties.set('imports', {
        value: createNativeFunction('imports', () => createArray([])),
        writable: true, enumerable: true, configurable: true,
      });
      // Module.prototype.exports()
      modObj.properties.set('exports', {
        value: createNativeFunction('exports', () => createArray([])),
        writable: true, enumerable: true, configurable: true,
      });
      // Module.prototype.customSections(name)
      modObj.properties.set('customSections', {
        value: createNativeFunction('customSections', () => createArray([])),
        writable: true, enumerable: true, configurable: true,
      });
      return createPromiseLike(modObj);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // WebAssembly.instantiate(bufferSource, importObject?) → Promise<{module, instance}>
  // WebAssembly.instantiate(module, importObject?) → Promise<Instance>
  wasmObj.properties.set('instantiate', {
    value: createNativeFunction('instantiate', (_this, args) => {
      const bufferOrModule = args[0];
      const imports = args[1];
      if (!bufferOrModule) {
        return createPromiseLike({ error: new Error('Expected bufferSource or Module') });
      }

      // If it's already a Module object
      if (typeof bufferOrModule === 'object' && (bufferOrModule as any).properties?.get('__type')?.value === 'Module') {
        const instObj = createObject(null);
        instObj.properties.set('exports', { value: createObject(null), writable: true, enumerable: true, configurable: true });
        instObj.properties.set('imports', { value: imports ?? createObject(null), writable: true, enumerable: true, configurable: true });
        return createPromiseLike(instObj);
      }

      // Compile then instantiate
      const modObj = createObject(null);
      modObj.properties.set('__type', { value: 'Module', writable: false, enumerable: false, configurable: false });
      modObj.properties.set('__bytes', { value: bufferOrModule, writable: false, enumerable: false, configurable: false });
      modObj.properties.set('imports', {
        value: createNativeFunction('imports', () => createArray([])),
        writable: true, enumerable: true, configurable: true,
      });
      modObj.properties.set('exports', {
        value: createNativeFunction('exports', () => createArray([])),
        writable: true, enumerable: true, configurable: true,
      });
      modObj.properties.set('customSections', {
        value: createNativeFunction('customSections', () => createArray([])),
        writable: true, enumerable: true, configurable: true,
      });

      const instObj = createObject(null);
      instObj.properties.set('exports', { value: createObject(null), writable: true, enumerable: true, configurable: true });
      instObj.properties.set('imports', { value: imports ?? createObject(null), writable: true, enumerable: true, configurable: true });

      const resultObj = createObject(null);
      resultObj.properties.set('module', { value: modObj, writable: true, enumerable: true, configurable: true });
      resultObj.properties.set('instance', { value: instObj, writable: true, enumerable: true, configurable: true });
      return createPromiseLike(resultObj);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // WebAssembly.compileStreaming(source, imports?) → Promise<Module>
  wasmObj.properties.set('compileStreaming', {
    value: createNativeFunction('compileStreaming', (_this, args) => {
      const modObj = createObject(null);
      modObj.properties.set('__type', { value: 'Module', writable: false, enumerable: false, configurable: false });
      modObj.properties.set('imports', {
        value: createNativeFunction('imports', () => createArray([])),
        writable: true, enumerable: true, configurable: true,
      });
      modObj.properties.set('exports', {
        value: createNativeFunction('exports', () => createArray([])),
        writable: true, enumerable: true, configurable: true,
      });
      modObj.properties.set('customSections', {
        value: createNativeFunction('customSections', () => createArray([])),
        writable: true, enumerable: true, configurable: true,
      });
      return createPromiseLike(modObj);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // WebAssembly.instantiateStreaming(source, imports?) → Promise<{module, instance}>
  wasmObj.properties.set('instantiateStreaming', {
    value: createNativeFunction('instantiateStreaming', (_this, args) => {
      const imports = args[1];
      const modObj = createObject(null);
      modObj.properties.set('__type', { value: 'Module', writable: false, enumerable: false, configurable: false });
      modObj.properties.set('imports', {
        value: createNativeFunction('imports', () => createArray([])),
        writable: true, enumerable: true, configurable: true,
      });
      modObj.properties.set('exports', {
        value: createNativeFunction('exports', () => createArray([])),
        writable: true, enumerable: true, configurable: true,
      });
      modObj.properties.set('customSections', {
        value: createNativeFunction('customSections', () => createArray([])),
        writable: true, enumerable: true, configurable: true,
      });

      const instObj = createObject(null);
      instObj.properties.set('exports', { value: createObject(null), writable: true, enumerable: true, configurable: true });
      instObj.properties.set('imports', { value: imports ?? createObject(null), writable: true, enumerable: true, configurable: true });

      return createPromiseLike({ module: modObj, instance: instObj });
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return wasmObj;
}

// WebAssembly.Module constructor
export function createWebAssemblyModuleConstructor() {
  return createNativeFunction('Module', (_this, args) => {
    const buffer = args[0];
    const modObj = createObject(null);
    modObj.properties.set('__type', { value: 'Module', writable: false, enumerable: false, configurable: false });
    modObj.properties.set('__bytes', { value: buffer, writable: false, enumerable: false, configurable: false });
    modObj.properties.set('imports', {
      value: createNativeFunction('imports', () => createArray([])),
      writable: true, enumerable: true, configurable: true,
    });
    modObj.properties.set('exports', {
      value: createNativeFunction('exports', () => createArray([])),
      writable: true, enumerable: true, configurable: true,
    });
    modObj.properties.set('customSections', {
      value: createNativeFunction('customSections', () => createArray([])),
      writable: true, enumerable: true, configurable: true,
    });
    return modObj;
  });
}

// WebAssembly.Module.customSections (static)
export function createWebAssemblyModuleStatic() {
  const modFn = createWebAssemblyModuleConstructor();
  const wrapper = createObject(null);
  wrapper.type = 'function';
  wrapper.callable = true;
  wrapper.nativeFn = modFn.nativeFn;
  wrapper.properties.set('customSections', {
    value: createNativeFunction('customSections', () => createArray([])),
    writable: true, enumerable: true, configurable: true,
  });
  wrapper.properties.set('imports', {
    value: createNativeFunction('imports', () => createArray([])),
    writable: true, enumerable: true, configurable: true,
  });
  wrapper.properties.set('exports', {
    value: createNativeFunction('exports', () => createArray([])),
    writable: true, enumerable: true, configurable: true,
  });
  return wrapper;
}

// WebAssembly.Instance constructor
export function createWebAssemblyInstanceConstructor() {
  return createNativeFunction('Instance', (_this, args) => {
    const module = args[0];
    const imports = args[1];
    const instObj = createObject(null);
    instObj.properties.set('exports', { value: createObject(null), writable: true, enumerable: true, configurable: true });
    instObj.properties.set('imports', { value: imports ?? createObject(null), writable: true, enumerable: true, configurable: true });
    instObj.properties.set('module', { value: module, writable: false, enumerable: true, configurable: false });
    return instObj;
  });
}

// WebAssembly.Memory constructor
export function createWebAssemblyMemoryConstructor() {
  return createNativeFunction('Memory', (_this, args) => {
    const opts = args[0];
    const memoryObj = createObject(null);
    const getProp = (name: string, def: any) => {
      if (opts && typeof opts === 'object') {
        if (name in opts) return (opts as any)[name];
        if ((opts as any).properties && typeof (opts as any).properties.get === 'function') {
          const desc = (opts as any).properties.get(name);
          if (desc) return desc.value;
        }
      }
      return def;
    };
    const initial = getProp('initial', 1) as number;
    const maximum = getProp('maximum', undefined) as number | undefined;
    const buffer = new ArrayBuffer(initial * 65536);

    memoryObj.properties.set('buffer', { value: toJSValueShallow({ buffer }), writable: true, enumerable: true, configurable: true });
    memoryObj.properties.set('grow', {
      value: createNativeFunction('grow', (_t, a) => {
        const delta = toNumber(a[0]);
        const prev = memoryObj.properties.get('grow') ? initial : 0;
        return delta;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    memoryObj.properties.set('max', { value: maximum, writable: false, enumerable: true, configurable: false });
    memoryObj.properties.set('__type', { value: 'Memory', writable: false, enumerable: false, configurable: false });
    return memoryObj;
  });
}

// WebAssembly.Table constructor
export function createWebAssemblyTableConstructor() {
  return createNativeFunction('Table', (_this, args) => {
    const tableObj = createObject(null);
    const getProp = (name: string, def: any) => {
      const opts = args[0];
      if (opts && typeof opts === 'object') {
        if (name in opts) return (opts as any)[name];
        if ((opts as any).properties && typeof (opts as any).properties.get === 'function') {
          const desc = (opts as any).properties.get(name);
          if (desc) return desc.value;
        }
      }
      return def;
    };
    const initial = getProp('initial', 0) as number;
    tableObj.properties.set('length', { value: initial, writable: true, enumerable: true, configurable: true });
    tableObj.properties.set('grow', {
      value: createNativeFunction('grow', (_t, a) => toNumber(a[0])),
      writable: true, enumerable: true, configurable: true,
    });
    tableObj.properties.set('get', {
      value: createNativeFunction('get', () => null),
      writable: true, enumerable: true, configurable: true,
    });
    tableObj.properties.set('set', {
      value: createNativeFunction('set', () => undefined),
      writable: true, enumerable: true, configurable: true,
    });
    tableObj.properties.set('max', {
      value: getProp('maximum', undefined),
      writable: false, enumerable: true, configurable: false,
    });
    tableObj.properties.set('__type', { value: 'Table', writable: false, enumerable: false, configurable: false });
    return tableObj;
  });
}

// WebAssembly.Global constructor
export function createWebAssemblyGlobalConstructor() {
  return createNativeFunction('Global', (_this, args) => {
    const globalObj = createObject(null);
    const getProp = (name: string, def: any) => {
      const opts = args[0];
      if (opts && typeof opts === 'object') {
        if (name in opts) return (opts as any)[name];
        if ((opts as any).properties && typeof (opts as any).properties.get === 'function') {
          const desc = (opts as any).properties.get(name);
          if (desc) return desc.value;
        }
      }
      return def;
    };
    const valueType = getProp('value', 'i32') as string;
    const initialValue = getProp('value', 0);

    globalObj.properties.set('value', {
      value: initialValue,
      writable: true, enumerable: true, configurable: true,
    });
    globalObj.properties.set('valueOf', {
      value: createNativeFunction('valueOf', () => globalObj.properties.get('value')?.value),
      writable: true, enumerable: true, configurable: true,
    });
    globalObj.properties.set('toValue', {
      value: createNativeFunction('toValue', () => globalObj.properties.get('value')?.value),
      writable: true, enumerable: true, configurable: true,
    });
    globalObj.properties.set('__type', { value: 'Global', writable: false, enumerable: false, configurable: false });
    globalObj.properties.set('__valueType', { value: valueType, writable: false, enumerable: false, configurable: false });
    return globalObj;
  });
}

// WebAssembly.Tag constructor (exception handling)
export function createWebAssemblyTagConstructor() {
  return createNativeFunction('Tag', (_this, args) => {
    const tagObj = createObject(null);
    tagObj.properties.set('__type', { value: 'Tag', writable: false, enumerable: false, configurable: false });
    tagObj.properties.set('type', {
      value: createNativeFunction('type', () => args[0] ?? createObject(null)),
      writable: true, enumerable: true, configurable: true,
    });
    return tagObj;
  });
}

// WebAssembly.Exception constructor
export function createWebAssemblyExceptionConstructor() {
  return createNativeFunction('Exception', (_this, args) => {
    const excObj = createObject(null);
    excObj.properties.set('__type', { value: 'Exception', writable: false, enumerable: false, configurable: false });
    excObj.properties.set('getArg', {
      value: createNativeFunction('getArg', (_t, a) => {
        const tag = a[0];
        const index = toNumber(a[1]);
        return null;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    excObj.properties.set('is', {
      value: createNativeFunction('is', (_t, a) => false),
      writable: true, enumerable: true, configurable: true,
    });
    return excObj;
  });
}
