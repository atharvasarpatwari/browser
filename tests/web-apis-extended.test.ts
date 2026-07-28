import { describe, it, expect } from 'vitest';
import {
  createWebAssemblyObject, createWebAssemblyModuleStatic, createWebAssemblyInstanceConstructor,
  createWebAssemblyMemoryConstructor, createWebAssemblyTableConstructor,
  createWebAssemblyGlobalConstructor, createWebAssemblyTagConstructor, createWebAssemblyExceptionConstructor,
  createGPUObject, createXRSystemObject,
  createCompressionStreamConstructor, createDecompressionStreamConstructor,
  createSchedulerObject, createSharedStorageObject, createFencedFrameObject, createFenceObject,
  createAIAPIObject, createSpeculationRulesObject,
} from '../src/browser/js/web-apis';

function mockObj(label?: string) {
  const obj: any = { type: undefined, properties: new Map() };
  if (label) obj.properties.set('label', { value: label, writable: true, enumerable: true, configurable: true });
  return obj;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBASSEMBLY (WASM) API
// ═══════════════════════════════════════════════════════════════════════════════

describe('WebAssembly API', () => {
  it('WebAssembly exists with all methods', () => {
    const wasm = createWebAssemblyObject();
    expect(wasm.properties.has('validate')).toBe(true);
    expect(wasm.properties.has('compile')).toBe(true);
    expect(wasm.properties.has('instantiate')).toBe(true);
    expect(wasm.properties.has('compileStreaming')).toBe(true);
    expect(wasm.properties.has('instantiateStreaming')).toBe(true);
  });

  it('validate returns false for non-buffer', () => {
    const wasm = createWebAssemblyObject();
    const result = (wasm.properties.get('validate')!.value as any).nativeFn(null, [null]);
    expect(result).toBe(false);
  });

  it('validate returns true for valid WASM magic number', () => {
    const wasm = createWebAssemblyObject();
    const buffer = new Uint8Array([0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00]);
    const result = (wasm.properties.get('validate')!.value as any).nativeFn(null, [buffer]);
    expect(result).toBe(true);
  });

  it('validate returns false for invalid magic number', () => {
    const wasm = createWebAssemblyObject();
    const buffer = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const result = (wasm.properties.get('validate')!.value as any).nativeFn(null, [buffer]);
    expect(result).toBe(false);
  });

  it('compile returns a promise-like with Module', () => {
    const wasm = createWebAssemblyObject();
    const result = (wasm.properties.get('compile')!.value as any).nativeFn(null, [new Uint8Array(8)]);
    expect(result).toBeDefined();
    expect(result.properties.has('then')).toBe(true);
  });

  it('instantiate returns module and instance', async () => {
    const wasm = createWebAssemblyObject();
    const result = (wasm.properties.get('instantiate')!.value as any).nativeFn(null, [new Uint8Array(8)]);
    expect(result).toBeDefined();
    let resolved: any;
    result.properties.get('then').value.nativeFn(null, [(v: any) => { resolved = v; }]);
    expect(resolved).toBeDefined();
    expect(resolved.properties.has('module')).toBe(true);
    expect(resolved.properties.has('instance')).toBe(true);
  });

  it('Module constructor creates a module', () => {
    const Mod = createWebAssemblyModuleStatic();
    const mod = (Mod as any).nativeFn(null, [new Uint8Array(8)]);
    expect(mod).toBeDefined();
    expect(mod.properties.has('imports')).toBe(true);
    expect(mod.properties.has('exports')).toBe(true);
  });

  it('Module.imports returns array', () => {
    const Mod = createWebAssemblyModuleStatic();
    const mod = (Mod as any).nativeFn(null, [new Uint8Array(8)]);
    const imports = (mod.properties.get('imports').value as any).nativeFn(mod, []);
    expect(imports).toBeDefined();
    expect(imports.type).toBe('array');
  });

  it('Instance constructor creates an instance', () => {
    const Inst = createWebAssemblyInstanceConstructor();
    const mod = createWebAssemblyModuleStatic();
    const modObj = (mod as any).nativeFn(null, [new Uint8Array(8)]);
    const inst = (Inst as any).nativeFn(null, [modObj]);
    expect(inst).toBeDefined();
    expect(inst.properties.has('exports')).toBe(true);
  });

  it('Memory constructor creates a memory', () => {
    const Mem = createWebAssemblyMemoryConstructor();
    const mem = (Mem as any).nativeFn(null, [{ initial: 2 }]);
    expect(mem).toBeDefined();
    expect(mem.properties.has('buffer')).toBe(true);
    expect(mem.properties.has('grow')).toBe(true);
  });

  it('Memory.grow returns delta', () => {
    const Mem = createWebAssemblyMemoryConstructor();
    const mem = (Mem as any).nativeFn(null, [{ initial: 1 }]);
    const result = mem.properties.get('grow').value.nativeFn(mem, [4]);
    expect(result).toBe(4);
  });

  it('Table constructor creates a table', () => {
    const Tab = createWebAssemblyTableConstructor();
    const tab = (Tab as any).nativeFn(null, [{ initial: 10 }]);
    expect(tab).toBeDefined();
    expect(tab.properties.has('length')).toBe(true);
    expect(tab.properties.has('get')).toBe(true);
    expect(tab.properties.has('set')).toBe(true);
    expect(tab.properties.has('grow')).toBe(true);
  });

  it('Table.get returns null', () => {
    const Tab = createWebAssemblyTableConstructor();
    const tab = (Tab as any).nativeFn(null, [{ initial: 5 }]);
    const result = tab.properties.get('get').value.nativeFn(tab, [0]);
    expect(result).toBeNull();
  });

  it('Global constructor creates a global', () => {
    const Glob = createWebAssemblyGlobalConstructor();
    const g = (Glob as any).nativeFn(null, [{ value: 'i32', value: 42 }]);
    expect(g).toBeDefined();
    expect(g.properties.has('value')).toBe(true);
    expect(g.properties.has('valueOf')).toBe(true);
  });

  it('Global.valueOf returns current value', () => {
    const Glob = createWebAssemblyGlobalConstructor();
    const g = (Glob as any).nativeFn(null, [{ value: 'i32', value: 100 }]);
    const result = g.properties.get('valueOf').value.nativeFn(g, []);
    expect(result).toBe(100);
  });

  it('Tag constructor creates a tag', () => {
    const Tag = createWebAssemblyTagConstructor();
    const tag = (Tag as any).nativeFn(null, [mockObj()]);
    expect(tag).toBeDefined();
    expect(tag.properties.has('type')).toBe(true);
  });

  it('Exception constructor creates an exception', () => {
    const Exc = createWebAssemblyExceptionConstructor();
    const exc = (Exc as any).nativeFn(null, [mockObj()]);
    expect(exc).toBeDefined();
    expect(exc.properties.has('getArg')).toBe(true);
    expect(exc.properties.has('is')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WEBGPU API
// ═══════════════════════════════════════════════════════════════════════════════

describe('WebGPU API', () => {
  it('gpu object has requestAdapter and getPreferredCanvasFormat', () => {
    const gpu = createGPUObject();
    expect(gpu.properties.has('requestAdapter')).toBe(true);
    expect(gpu.properties.has('getPreferredCanvasFormat')).toBe(true);
  });

  it('getPreferredCanvasFormat returns bgra8unorm', () => {
    const gpu = createGPUObject();
    const result = (gpu.properties.get('getPreferredCanvasFormat')!.value as any).nativeFn(null, []);
    expect(result).toBe('bgra8unorm');
  });

  it('requestAdapter returns adapter with requestDevice', async () => {
    const gpu = createGPUObject();
    const result = (gpu.properties.get('requestAdapter')!.value as any).nativeFn(null, [null]);
    expect(result).toBeDefined();
    let adapter: any;
    result.properties.get('then').value.nativeFn(null, [(v: any) => { adapter = v; }]);
    expect(adapter).toBeDefined();
    expect(adapter.properties.has('requestDevice')).toBe(true);
    expect(adapter.properties.has('features')).toBe(true);
    expect(adapter.properties.has('limits')).toBe(true);
    expect(adapter.properties.has('info')).toBe(true);
  });

  it('requestDevice returns a device', async () => {
    const gpu = createGPUObject();
    const adapterResult = (gpu.properties.get('requestAdapter')!.value as any).nativeFn(null, [null]);
    let adapter: any;
    adapterResult.properties.get('then').value.nativeFn(null, [(v: any) => { adapter = v; }]);
    const deviceResult = adapter.properties.get('requestDevice').value.nativeFn(adapter, [null]);
    let device: any;
    deviceResult.properties.get('then').value.nativeFn(null, [(v: any) => { device = v; }]);
    expect(device).toBeDefined();
    expect(device.properties.has('destroy')).toBe(true);
    expect(device.properties.has('createBuffer')).toBe(true);
    expect(device.properties.has('createTexture')).toBe(true);
    expect(device.properties.has('createShaderModule')).toBe(true);
    expect(device.properties.has('createRenderPipeline')).toBe(true);
    expect(device.properties.has('createComputePipeline')).toBe(true);
    expect(device.properties.has('createBindGroupLayout')).toBe(true);
    expect(device.properties.has('createBindGroup')).toBe(true);
    expect(device.properties.has('createRenderPipelineLayout')).toBe(true);
    expect(device.properties.has('createCommandEncoder')).toBe(true);
    expect(device.properties.has('createQueue')).toBe(true);
  });

  it('device.createBuffer returns a buffer', async () => {
    const gpu = createGPUObject();
    const adapterResult = (gpu.properties.get('requestAdapter')!.value as any).nativeFn(null, [null]);
    let adapter: any;
    adapterResult.properties.get('then').value.nativeFn(null, [(v: any) => { adapter = v; }]);
    const deviceResult = adapter.properties.get('requestDevice').value.nativeFn(adapter, [null]);
    let device: any;
    deviceResult.properties.get('then').value.nativeFn(null, [(v: any) => { device = v; }]);

    const buf = device.properties.get('createBuffer').value.nativeFn(device, [mockObj()]);
    expect(buf).toBeDefined();
    expect(buf.properties.has('size')).toBe(true);
    expect(buf.properties.has('usage')).toBe(true);
    expect(buf.properties.has('destroy')).toBe(true);
  });

  it('device.createTexture returns a texture with createView', async () => {
    const gpu = createGPUObject();
    const adapterResult = (gpu.properties.get('requestAdapter')!.value as any).nativeFn(null, [null]);
    let adapter: any;
    adapterResult.properties.get('then').value.nativeFn(null, [(v: any) => { adapter = v; }]);
    const deviceResult = adapter.properties.get('requestDevice').value.nativeFn(adapter, [null]);
    let device: any;
    deviceResult.properties.get('then').value.nativeFn(null, [(v: any) => { device = v; }]);

    const tex = device.properties.get('createTexture').value.nativeFn(device, [mockObj()]);
    expect(tex).toBeDefined();
    expect(tex.properties.has('createView')).toBe(true);
    expect(tex.properties.has('destroy')).toBe(true);
    expect(tex.properties.has('width')).toBe(true);
    expect(tex.properties.has('height')).toBe(true);

    const view = tex.properties.get('createView').value.nativeFn(tex, []);
    expect(view).toBeDefined();
    expect(view.properties.has('label')).toBe(true);
  });

  it('device.createShaderModule returns a shader module', async () => {
    const gpu = createGPUObject();
    const adapterResult = (gpu.properties.get('requestAdapter')!.value as any).nativeFn(null, [null]);
    let adapter: any;
    adapterResult.properties.get('then').value.nativeFn(null, [(v: any) => { adapter = v; }]);
    const deviceResult = adapter.properties.get('requestDevice').value.nativeFn(adapter, [null]);
    let device: any;
    deviceResult.properties.get('then').value.nativeFn(null, [(v: any) => { device = v; }]);

    const shader = device.properties.get('createShaderModule').value.nativeFn(device, [{ label: 'my-shader' }]);
    expect(shader).toBeDefined();
    expect(shader.properties.has('getCompilationInfo')).toBe(true);
    expect(shader.properties.get('label').value).toBe('my-shader');
  });

  it('device.createQueue has submit and writeBuffer', async () => {
    const gpu = createGPUObject();
    const adapterResult = (gpu.properties.get('requestAdapter')!.value as any).nativeFn(null, [null]);
    let adapter: any;
    adapterResult.properties.get('then').value.nativeFn(null, [(v: any) => { adapter = v; }]);
    const deviceResult = adapter.properties.get('requestDevice').value.nativeFn(adapter, [null]);
    let device: any;
    deviceResult.properties.get('then').value.nativeFn(null, [(v: any) => { device = v; }]);

    const queue = device.properties.get('createQueue').value.nativeFn(device, []);
    expect(queue).toBeDefined();
    expect(queue.properties.has('submit')).toBe(true);
    expect(queue.properties.has('writeBuffer')).toBe(true);
    expect(queue.properties.has('writeTexture')).toBe(true);
    expect(queue.properties.has('onSubmittedWorkDone')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WEBXR API
// ═══════════════════════════════════════════════════════════════════════════════

describe('WebXR API', () => {
  it('xr has isSessionSupported and requestSession', () => {
    const xr = createXRSystemObject();
    expect(xr.properties.has('isSessionSupported')).toBe(true);
    expect(xr.properties.has('requestSession')).toBe(true);
  });

  it('isSessionSupported returns false', async () => {
    const xr = createXRSystemObject();
    const result = (xr.properties.get('isSessionSupported')!.value as any).nativeFn(null, ['immersive-vr']);
    let supported: any;
    result.properties.get('then').value.nativeFn(null, [(v: any) => { supported = v; }]);
    expect(supported).toBe(false);
  });

  it('requestSession returns an XRSession', async () => {
    const xr = createXRSystemObject();
    const result = (xr.properties.get('requestSession')!.value as any).nativeFn(null, ['immersive-vr']);
    let session: any;
    result.properties.get('then').value.nativeFn(null, [(v: any) => { session = v; }]);
    expect(session).toBeDefined();
    expect(session.properties.has('mode')).toBe(true);
    expect(session.properties.has('visibilityState')).toBe(true);
    expect(session.properties.has('renderState')).toBe(true);
    expect(session.properties.has('requestReferenceSpace')).toBe(true);
    expect(session.properties.has('requestAnimationFrame')).toBe(true);
    expect(session.properties.has('cancelAnimationFrame')).toBe(true);
    expect(session.properties.has('end')).toBe(true);
    expect(session.properties.has('updateRenderState')).toBe(true);
  });

  it('session.requestReferenceSpace returns a reference space', async () => {
    const xr = createXRSystemObject();
    const sessResult = (xr.properties.get('requestSession')!.value as any).nativeFn(null, ['immersive-vr']);
    let session: any;
    sessResult.properties.get('then').value.nativeFn(null, [(v: any) => { session = v; }]);

    const refResult = session.properties.get('requestReferenceSpace').value.nativeFn(session, ['local']);
    let refSpace: any;
    refResult.properties.get('then').value.nativeFn(null, [(v: any) => { refSpace = v; }]);
    expect(refSpace).toBeDefined();
    expect(refSpace.properties.has('getOffsetReferenceSpace')).toBe(true);
    expect(refSpace.properties.has('getViewerPose')).toBe(true);
  });

  it('referenceSpace.getViewerPose returns a pose with views', async () => {
    const xr = createXRSystemObject();
    const sessResult = (xr.properties.get('requestSession')!.value as any).nativeFn(null, ['immersive-vr']);
    let session: any;
    sessResult.properties.get('then').value.nativeFn(null, [(v: any) => { session = v; }]);

    const refResult = session.properties.get('requestReferenceSpace').value.nativeFn(session, ['local']);
    let refSpace: any;
    refResult.properties.get('then').value.nativeFn(null, [(v: any) => { refSpace = v; }]);

    const pose = refSpace.properties.get('getViewerPose').value.nativeFn(refSpace, [refSpace]);
    expect(pose).toBeDefined();
    expect(pose.properties.has('transform')).toBe(true);
    expect(pose.properties.has('views')).toBe(true);
  });

  it('session.end returns a promise', async () => {
    const xr = createXRSystemObject();
    const sessResult = (xr.properties.get('requestSession')!.value as any).nativeFn(null, ['immersive-vr']);
    let session: any;
    sessResult.properties.get('then').value.nativeFn(null, [(v: any) => { session = v; }]);

    const endResult = session.properties.get('end').value.nativeFn(session, []);
    expect(endResult).toBeDefined();
    expect(endResult.properties.has('then')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPRESSION STREAMS API
// ═══════════════════════════════════════════════════════════════════════════════

describe('Compression Streams API', () => {
  it('CompressionStream creates readable and writable', () => {
    const CS = createCompressionStreamConstructor();
    const cs = (CS as any).nativeFn(null, ['gzip']);
    expect(cs).toBeDefined();
    expect(cs.properties.has('readable')).toBe(true);
    expect(cs.properties.has('writable')).toBe(true);
    expect(cs.properties.get('__type').value).toBe('CompressionStream');
    expect(cs.properties.get('__format').value).toBe('gzip');
  });

  it('CompressionStream defaults to gzip', () => {
    const CS = createCompressionStreamConstructor();
    const cs = (CS as any).nativeFn(null, []);
    expect(cs.properties.get('__format').value).toBe('gzip');
  });

  it('CompressionStream supports deflate', () => {
    const CS = createCompressionStreamConstructor();
    const cs = (CS as any).nativeFn(null, ['deflate']);
    expect(cs.properties.get('__format').value).toBe('deflate');
  });

  it('CompressionStream supports deflate-raw', () => {
    const CS = createCompressionStreamConstructor();
    const cs = (CS as any).nativeFn(null, ['deflate-raw']);
    expect(cs.properties.get('__format').value).toBe('deflate-raw');
  });

  it('DecompressionStream creates readable and writable', () => {
    const DS = createDecompressionStreamConstructor();
    const ds = (DS as any).nativeFn(null, ['gzip']);
    expect(ds).toBeDefined();
    expect(ds.properties.has('readable')).toBe(true);
    expect(ds.properties.has('writable')).toBe(true);
    expect(ds.properties.get('__type').value).toBe('DecompressionStream');
    expect(ds.properties.get('__format').value).toBe('gzip');
  });

  it('readable has getReader method', () => {
    const CS = createCompressionStreamConstructor();
    const cs = (CS as any).nativeFn(null, ['gzip']);
    const readable = cs.properties.get('readable').value;
    expect(readable.properties.has('getReader')).toBe(true);
  });

  it('readable.getReader returns a reader with read and releaseLock', () => {
    const CS = createCompressionStreamConstructor();
    const cs = (CS as any).nativeFn(null, ['gzip']);
    const readable = cs.properties.get('readable').value;
    const reader = readable.properties.get('getReader').value.nativeFn(readable, []);
    expect(reader).toBeDefined();
    expect(reader.properties.has('read')).toBe(true);
    expect(reader.properties.has('releaseLock')).toBe(true);
  });

  it('writable has getWriter, close, abort methods', () => {
    const CS = createCompressionStreamConstructor();
    const cs = (CS as any).nativeFn(null, ['gzip']);
    const writable = cs.properties.get('writable').value;
    expect(writable.properties.has('getWriter')).toBe(true);
    expect(writable.properties.has('close')).toBe(true);
    expect(writable.properties.has('abort')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULER API
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scheduler API', () => {
  it('scheduler has postTask and yield', () => {
    const sched = createSchedulerObject();
    expect(sched.properties.has('postTask')).toBe(true);
    expect(sched.properties.has('yield')).toBe(true);
    expect(sched.properties.has('currentTask')).toBe(true);
  });

  it('scheduler.yield returns a promise-like', () => {
    const sched = createSchedulerObject();
    const result = (sched.properties.get('yield')!.value as any).nativeFn(null, []);
    expect(result).toBeDefined();
    expect(result.properties.has('then')).toBe(true);
  });

  it('scheduler.postTask returns a promise-like', () => {
    const sched = createSchedulerObject();
    const result = (sched.properties.get('postTask')!.value as any).nativeFn(null, [null, null]);
    expect(result).toBeDefined();
    expect(result.properties.has('then')).toBe(true);
  });

  it('scheduler.currentTask returns a task object', () => {
    const sched = createSchedulerObject();
    const task = (sched.properties.get('currentTask')!.value as any).nativeFn(null, []);
    expect(task).toBeDefined();
    expect(task.properties.has('priority')).toBe(true);
    expect(task.properties.has('name')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED STORAGE API
// ═══════════════════════════════════════════════════════════════════════════════

describe('Shared Storage API', () => {
  it('sharedStorage has all expected methods', () => {
    const ss = createSharedStorageObject();
    expect(ss.properties.has('selectURL')).toBe(true);
    expect(ss.properties.has('set')).toBe(true);
    expect(ss.properties.has('get')).toBe(true);
    expect(ss.properties.has('delete')).toBe(true);
    expect(ss.properties.has('clear')).toBe(true);
    expect(ss.properties.has('join')).toBe(true);
    expect(ss.properties.has('run')).toBe(true);
    expect(ss.properties.has('resolveaidauction')).toBe(true);
  });

  it('sharedStorage.set returns a promise', () => {
    const ss = createSharedStorageObject();
    const result = (ss.properties.get('set')!.value as any).nativeFn(null, ['key', 'value']);
    expect(result).toBeDefined();
    expect(result.properties.has('then')).toBe(true);
  });

  it('sharedStorage.get returns a promise with null', async () => {
    const ss = createSharedStorageObject();
    const result = (ss.properties.get('get')!.value as any).nativeFn(null, ['key']);
    let value: any;
    result.properties.get('then').value.nativeFn(null, [(v: any) => { value = v; }]);
    expect(value).toBeNull();
  });

  it('sharedStorage.selectURL returns a promise', () => {
    const ss = createSharedStorageObject();
    const result = (ss.properties.get('selectURL')!.value as any).nativeFn(null, ['key', createArray([])]);
    expect(result).toBeDefined();
    expect(result.properties.has('then')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FENCED FRAMES API
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fenced Frames API', () => {
  it('FencedFrameConfig has expected properties', () => {
    const ffc = createFencedFrameObject();
    expect(ffc.properties.has('url')).toBe(true);
    expect(ffc.properties.has('navigateTo')).toBe(true);
    expect(ffc.properties.has('adAuctionConfig')).toBe(true);
    expect(ffc.properties.has('deprecatedReplaceInURN')).toBe(true);
    expect(ffc.properties.has('executeQuery')).toBe(true);
    expect(ffc.properties.has('getName')).toBe(true);
    expect(ffc.properties.get('url').value).toBe('about:blank');
  });

  it('Fence has report, getJoiningOrigins, getSharedStorage, notifyEvent', () => {
    const fence = createFenceObject();
    expect(fence.properties.has('report')).toBe(true);
    expect(fence.properties.has('getJoiningOrigins')).toBe(true);
    expect(fence.properties.has('getSharedStorage')).toBe(true);
    expect(fence.properties.has('notifyEvent')).toBe(true);
  });

  it('fence.report returns a promise', () => {
    const fence = createFenceObject();
    const result = (fence.properties.get('report')!.value as any).nativeFn(fence, ['event']);
    expect(result).toBeDefined();
    expect(result.properties.has('then')).toBe(true);
  });

  it('fence.getJoiningOrigins returns empty array', async () => {
    const fence = createFenceObject();
    const result = (fence.properties.get('getJoiningOrigins')!.value as any).nativeFn(fence, []);
    let origins: any;
    result.properties.get('then').value.nativeFn(null, [(v: any) => { origins = v; }]);
    expect(origins).toBeDefined();
    expect(origins.type).toBe('array');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AI APIs
// ═══════════════════════════════════════════════════════════════════════════════

describe('AI APIs', () => {
  it('window.ai has canCreateTextSession and createTextSession', () => {
    const ai = createAIAPIObject();
    expect(ai.properties.has('canCreateTextSession')).toBe(true);
    expect(ai.properties.has('createTextSession')).toBe(true);
    expect(ai.properties.has('defaultTextSession')).toBe(true);
    expect(ai.properties.has('createTextSessionForPrompt')).toBe(true);
  });

  it('window.ai has language model methods', () => {
    const ai = createAIAPIObject();
    expect(ai.properties.has('canCreateLanguageModel')).toBe(true);
    expect(ai.properties.has('languageModel')).toBe(true);
    expect(ai.properties.has('languageModelFactory')).toBe(true);
  });

  it('window.ai has assistant, summarizer, writer, rewriter, translator', () => {
    const ai = createAIAPIObject();
    expect(ai.properties.has('assistant')).toBe(true);
    expect(ai.properties.has('summarizer')).toBe(true);
    expect(ai.properties.has('writer')).toBe(true);
    expect(ai.properties.has('rewriter')).toBe(true);
    expect(ai.properties.has('translator')).toBe(true);
  });

  it('canCreateTextSession returns readily', async () => {
    const ai = createAIAPIObject();
    const result = (ai.properties.get('canCreateTextSession')!.value as any).nativeFn(null, []);
    let status: any;
    result.properties.get('then').value.nativeFn(null, [(v: any) => { status = v; }]);
    expect(status).toBe('readily');
  });

  it('createTextSession returns a text session', async () => {
    const ai = createAIAPIObject();
    const result = (ai.properties.get('createTextSession')!.value as any).nativeFn(null, [null]);
    let session: any;
    result.properties.get('then').value.nativeFn(null, [(v: any) => { session = v; }]);
    expect(session).toBeDefined();
    expect(session.properties.has('prompt')).toBe(true);
    expect(session.properties.has('promptStreaming')).toBe(true);
    expect(session.properties.has('clone')).toBe(true);
    expect(session.properties.has('destroy')).toBe(true);
    expect(session.properties.has('maxTokens')).toBe(true);
    expect(session.properties.has('temperature')).toBe(true);
  });

  it('text session.prompt returns a promise', async () => {
    const ai = createAIAPIObject();
    const sessResult = (ai.properties.get('createTextSession')!.value as any).nativeFn(null, [null]);
    let session: any;
    sessResult.properties.get('then').value.nativeFn(null, [(v: any) => { session = v; }]);

    const promptResult = session.properties.get('prompt').value.nativeFn(session, ['hello']);
    expect(promptResult).toBeDefined();
    expect(promptResult.properties.has('then')).toBe(true);
  });

  it('text session.promptStreaming returns a readable stream', async () => {
    const ai = createAIAPIObject();
    const sessResult = (ai.properties.get('createTextSession')!.value as any).nativeFn(null, [null]);
    let session: any;
    sessResult.properties.get('then').value.nativeFn(null, [(v: any) => { session = v; }]);

    const stream = session.properties.get('promptStreaming').value.nativeFn(session, ['hello']);
    expect(stream).toBeDefined();
    expect(stream.properties.has('getReader')).toBe(true);
  });

  it('languageModel returns a language model', async () => {
    const ai = createAIAPIObject();
    const result = (ai.properties.get('languageModel')!.value as any).nativeFn(null, [null]);
    let lm: any;
    result.properties.get('then').value.nativeFn(null, [(v: any) => { lm = v; }]);
    expect(lm).toBeDefined();
    expect(lm.properties.has('prompt')).toBe(true);
    expect(lm.properties.has('promptStreaming')).toBe(true);
    expect(lm.properties.has('clone')).toBe(true);
    expect(lm.properties.has('destroy')).toBe(true);
    expect(lm.properties.has('addEventListener')).toBe(true);
    expect(lm.properties.has('topP')).toBe(true);
  });

  it('summarizer has summarize and summarizeStreaming', async () => {
    const ai = createAIAPIObject();
    const result = (ai.properties.get('summarizer')!.value as any).nativeFn(null, [null]);
    let summarizer: any;
    result.properties.get('then').value.nativeFn(null, [(v: any) => { summarizer = v; }]);
    expect(summarizer).toBeDefined();
    expect(summarizer.properties.has('summarize')).toBe(true);
    expect(summarizer.properties.has('summarizeStreaming')).toBe(true);
    expect(summarizer.properties.has('sharedContext')).toBe(true);
    expect(summarizer.properties.has('format')).toBe(true);
    expect(summarizer.properties.has('length')).toBe(true);
  });

  it('writer has write and writeStreaming', async () => {
    const ai = createAIAPIObject();
    const result = (ai.properties.get('writer')!.value as any).nativeFn(null, [null]);
    let writer: any;
    result.properties.get('then').value.nativeFn(null, [(v: any) => { writer = v; }]);
    expect(writer).toBeDefined();
    expect(writer.properties.has('write')).toBe(true);
    expect(writer.properties.has('writeStreaming')).toBe(true);
    expect(writer.properties.has('sharedContext')).toBe(true);
    expect(writer.properties.has('tone')).toBe(true);
    expect(writer.properties.has('length')).toBe(true);
  });

  it('rewriter has rewrite and rewriteStreaming', async () => {
    const ai = createAIAPIObject();
    const result = (ai.properties.get('rewriter')!.value as any).nativeFn(null, [null]);
    let rewriter: any;
    result.properties.get('then').value.nativeFn(null, [(v: any) => { rewriter = v; }]);
    expect(rewriter).toBeDefined();
    expect(rewriter.properties.has('rewrite')).toBe(true);
    expect(rewriter.properties.has('rewriteStreaming')).toBe(true);
    expect(rewriter.properties.has('tone')).toBe(true);
    expect(rewriter.properties.has('strength')).toBe(true);
  });

  it('translator has translate and translateStreaming', async () => {
    const ai = createAIAPIObject();
    const result = (ai.properties.get('translator')!.value as any).nativeFn(null, [null]);
    let translator: any;
    result.properties.get('then').value.nativeFn(null, [(v: any) => { translator = v; }]);
    expect(translator).toBeDefined();
    expect(translator.properties.has('translate')).toBe(true);
    expect(translator.properties.has('translateStreaming')).toBe(true);
    expect(translator.properties.has('sourceLanguage')).toBe(true);
    expect(translator.properties.has('targetLanguage')).toBe(true);
  });

  it('languageModelFactory.create returns a language model', async () => {
    const ai = createAIAPIObject();
    const factory = ai.properties.get('languageModelFactory').value;
    const result = factory.properties.get('create').value.nativeFn(factory, [null]);
    let lm: any;
    result.properties.get('then').value.nativeFn(null, [(v: any) => { lm = v; }]);
    expect(lm).toBeDefined();
    expect(lm.properties.has('prompt')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SPECULATION RULES API
// ═══════════════════════════════════════════════════════════════════════════════

describe('Speculation Rules API', () => {
  it('SpeculationRules has prerender and prefetch', () => {
    const sr = createSpeculationRulesObject();
    expect(sr.properties.has('prerender')).toBe(true);
    expect(sr.properties.has('prefetch')).toBe(true);
    expect(sr.properties.has('prerenders')).toBe(true);
  });

  it('prerender has expected properties', () => {
    const sr = createSpeculationRulesObject();
    const prerender = sr.properties.get('prerender').value;
    expect(prerender.properties.has('urls')).toBe(true);
    expect(prerender.properties.has('source')).toBe(true);
    expect(prerender.properties.has('requires')).toBe(true);
    expect(prerender.properties.has('eagerness')).toBe(true);
    expect(prerender.properties.get('source').value).toBe('list');
    expect(prerender.properties.get('eagerness').value).toBe('immediate');
  });

  it('prefetch has expected properties', () => {
    const sr = createSpeculationRulesObject();
    const prefetch = sr.properties.get('prefetch').value;
    expect(prefetch.properties.has('urls')).toBe(true);
    expect(prefetch.properties.has('source')).toBe(true);
    expect(prefetch.properties.has('requires')).toBe(true);
    expect(prefetch.properties.has('eagerness')).toBe(true);
    expect(prefetch.properties.get('source').value).toBe('list');
  });

  it('prerenders returns empty array', () => {
    const sr = createSpeculationRulesObject();
    const result = (sr.properties.get('prerenders')!.value as any).nativeFn(sr, []);
    expect(result).toBeDefined();
    expect(result.type).toBe('array');
  });
});

function createArray(vals: any[]) {
  const arr: any = { type: 'array', properties: new Map() };
  arr.properties.set('length', { value: vals.length, writable: true, enumerable: true, configurable: true });
  vals.forEach((v, i) => {
    arr.properties.set(String(i), { value: v, writable: true, enumerable: true, configurable: true });
  });
  return arr;
}
