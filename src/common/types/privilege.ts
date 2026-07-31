/**
 * @file src/common/types/privilege.ts
 *
 * Shared privilege/capability types used across layers (common, browser,
 * process). Defined here so the common IPC layer (capability-gate) does not
 * depend upward on browser code.
 */

/** Privilege tier — higher number = more privilege. */
export type PrivilegeLevel = 'sandboxed-content' | 'web-content' | 'trusted-extension' | 'browser-chrome';

/** An API surface that can be gated by privilege level. */
export type ApiSurface =
  | 'dom'                   /* DOM read/write */
  | 'dom-cross-origin'      /* Cross-origin DOM access */
  | 'fetch'                 /* Network fetch */
  | 'fetch-cross-origin'    /* Cross-origin fetch */
  | 'websocket'             /* WebSocket connections */
  | 'storage'               /* localStorage, sessionStorage */
  | 'indexed-db'            /* IndexedDB */
  | 'cookies'               /* Cookie access */
  | 'workers'               /* Web Workers */
  | 'shared-workers'        /* Shared Workers */
  | 'service-workers'       /* Service Workers */
  | 'notifications'         /* Push notifications */
  | 'geolocation'           /* Geolocation API */
  | 'camera'                /* Camera access */
  | 'microphone'            /* Microphone access */
  | 'screen-capture'        /* Screen capture */
  | 'payment'               /* Payment APIs */
  | 'midi'                  /* MIDI access */
  | 'bluetooth'             /* Bluetooth API */
  | 'usb'                   /* USB API */
  | 'nfc'                   /* NFC API */
  | 'file-system'           /* File System API (sandboxed) */
  | 'file-system-external'  /* Access to local file system */
  | 'process'               /* Process management */
  | 'native-messaging'      /* Native messaging host */
  | 'clipboard-read'        /* Read clipboard */
  | 'clipboard-write'       /* Write clipboard */
  | 'eval'                  /* eval() and new Function() */
  | 'timeout-string'        /* setTimeout with string argument */
  | 'navigation-top'        /* Top-level navigation */
  | 'popup'                 /* Window.open / popups */
  | 'pointer-lock'          /* Pointer lock API */
  | 'fullscreen'            /* Fullscreen API */
  | 'dialog'                /* alert/confirm/prompt */
  | 'print'                 /* window.print() */
