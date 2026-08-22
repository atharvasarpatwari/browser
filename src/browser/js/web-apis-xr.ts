/**
 * @file src/browser/js/web-apis-xr.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * WebXR API for the Nova JS engine's global environment:
 *
 * - XRSystem (isSessionSupported, requestSession)
 * - XRSession (mode, visibilityState, renderState, requestReferenceSpace,
 *   requestAnimationFrame, cancelAnimationFrame, end, updateRenderState)
 * - XRReferenceSpace (getOffsetReferenceSpace, getViewerPose)
 * - XRView (eye, projectionMatrix, transform, requestedViewport)
 * - XRPoint (x, y, z, w)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  createObject, createArray, createNativeFunction,
} from './values';
import { createPromiseLike } from './web-apis-helpers';

// ─────────────────────────────────────────────────────────────────────────────
// WEBXR API
// ─────────────────────────────────────────────────────────────────────────────

export function createXRSystemObject() {
  const xrObj = createObject(null);

  // navigator.xr.isSessionSupported(mode) → Promise<boolean>
  xrObj.properties.set('isSessionSupported', {
    value: createNativeFunction('isSessionSupported', (_this, args) => {
      return createPromiseLike(false);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // navigator.xr.requestSession(mode, options?) → Promise<XRSession>
  xrObj.properties.set('requestSession', {
    value: createNativeFunction('requestSession', (_this, args) => {
      const sessionObj = createXRSessionObject();
      return createPromiseLike(sessionObj);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  xrObj.properties.set('__type', { value: 'XRSystem', writable: false, enumerable: false, configurable: false });
  return xrObj;
}

function createXRSessionObject() {
  const sessionObj = createObject(null);
  sessionObj.properties.set('mode', { value: 'immersive-vr', writable: false, enumerable: true, configurable: false });
  sessionObj.properties.set('visibilityState', { value: 'visible', writable: false, enumerable: true, configurable: false });
  sessionObj.properties.set('renderState', {
    value: (() => {
      const rs = createObject(null);
      rs.properties.set('baseLayer', { value: null, writable: true, enumerable: true, configurable: true });
      return rs;
    })(),
    writable: false, enumerable: true, configurable: true,
  });
  sessionObj.properties.set('requestReferenceSpace', {
    value: createNativeFunction('requestReferenceSpace', (_this, args) => {
      const refSpace = createObject(null);
      refSpace.properties.set('getOffsetReferenceSpace', {
        value: createNativeFunction('getOffsetReferenceSpace', () => createXRReferenceSpaceObject()),
        writable: true, enumerable: true, configurable: true,
      });
      refSpace.properties.set('getViewerPose', {
        value: createNativeFunction('getViewerPose', (_t, a) => {
          const poseObj = createObject(null);
          poseObj.properties.set('transform', {
            value: (() => {
              const t = createObject(null);
              t.properties.set('position', { value: createXRPointObject(0, 0, 0), writable: true, enumerable: true, configurable: true });
              t.properties.set('orientation', { value: createXRPointObject(0, 0, 0, 1), writable: true, enumerable: true, configurable: true });
              t.properties.set('matrix', { value: createArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), writable: true, enumerable: true, configurable: true });
              return t;
            })(),
            writable: true, enumerable: true, configurable: true,
          });
          poseObj.properties.set('views', {
            value: createArray([createXRViewObject()]),
            writable: false, enumerable: true, configurable: true,
          });
          return poseObj;
        }),
        writable: true, enumerable: true, configurable: true,
      });
      return createPromiseLike(refSpace);
    }),
    writable: true, enumerable: true, configurable: true,
  });
  sessionObj.properties.set('requestAnimationFrame', {
    value: createNativeFunction('requestAnimationFrame', (_this, args) => Math.floor(Math.random() * 100000)),
    writable: true, enumerable: true, configurable: true,
  });
  sessionObj.properties.set('cancelAnimationFrame', {
    value: createNativeFunction('cancelAnimationFrame', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });
  sessionObj.properties.set('end', {
    value: createNativeFunction('end', () => createPromiseLike(undefined)),
    writable: true, enumerable: true, configurable: true,
  });
  sessionObj.properties.set('updateRenderState', {
    value: createNativeFunction('updateRenderState', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });
  sessionObj.properties.set('selectEvent', { value: createObject(null), writable: true, enumerable: true, configurable: true });
  sessionObj.properties.set('selectendEvent', { value: createObject(null), writable: true, enumerable: true, configurable: true });
  sessionObj.properties.set('inputsourceschangeEvent', { value: createObject(null), writable: true, enumerable: true, configurable: true });
  sessionObj.properties.set('__type', { value: 'XRSession', writable: false, enumerable: false, configurable: false });
  return sessionObj;
}

function createXRReferenceSpaceObject() {
  const refObj = createObject(null);
  refObj.properties.set('getOffsetReferenceSpace', {
    value: createNativeFunction('getOffsetReferenceSpace', () => createXRReferenceSpaceObject()),
    writable: true, enumerable: true, configurable: true,
  });
  refObj.properties.set('getViewerPose', {
    value: createNativeFunction('getViewerPose', (_t, a) => {
      const poseObj = createObject(null);
      poseObj.properties.set('transform', { value: createXRPointObject(0, 0, 0), writable: true, enumerable: true, configurable: true });
      poseObj.properties.set('views', { value: createArray([createXRViewObject()]), writable: false, enumerable: true, configurable: true });
      return poseObj;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  refObj.properties.set('__type', { value: 'XRReferenceSpace', writable: false, enumerable: false, configurable: false });
  return refObj;
}

function createXRViewObject() {
  const viewObj = createObject(null);
  viewObj.properties.set('eye', { value: 'none', writable: false, enumerable: true, configurable: false });
  viewObj.properties.set('projectionMatrix', {
    value: createArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    writable: true, enumerable: true, configurable: true,
  });
  viewObj.properties.set('transform', {
    value: (() => {
      const t = createObject(null);
      t.properties.set('position', { value: createXRPointObject(0, 0, 0), writable: true, enumerable: true, configurable: true });
      t.properties.set('orientation', { value: createXRPointObject(0, 0, 0, 1), writable: true, enumerable: true, configurable: true });
      t.properties.set('matrix', { value: createArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), writable: true, enumerable: true, configurable: true });
      return t;
    })(),
    writable: true, enumerable: true, configurable: true,
  });
  viewObj.properties.set('requestedViewport', {
    value: (() => {
      const vp = createObject(null);
      vp.properties.set('x', { value: 0, writable: true, enumerable: true, configurable: true });
      vp.properties.set('y', { value: 0, writable: true, enumerable: true, configurable: true });
      vp.properties.set('width', { value: 1920, writable: true, enumerable: true, configurable: true });
      vp.properties.set('height', { value: 1080, writable: true, enumerable: true, configurable: true });
      return vp;
    })(),
    writable: true, enumerable: true, configurable: true,
  });
  return viewObj;
}

function createXRPointObject(x: number, y: number, z: number, w?: number) {
  const p = createObject(null);
  p.properties.set('x', { value: x, writable: true, enumerable: true, configurable: true });
  p.properties.set('y', { value: y, writable: true, enumerable: true, configurable: true });
  p.properties.set('z', { value: z, writable: true, enumerable: true, configurable: true });
  if (w !== undefined) p.properties.set('w', { value: w, writable: true, enumerable: true, configurable: true });
  return p;
}
