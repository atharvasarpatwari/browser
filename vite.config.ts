import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { novaDevProxyPlugin } from './vite-plugins/nova-dev-proxy'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Node built-ins statically `require()`d by bundled CJS libraries (pngjs).
// Rolldown otherwise externalizes these to an empty `__vite-browser-external`
// shim, breaking the packaged build. The shims below lazy-load the real Node
// module (available in the Electron renderer via nodeIntegration).
const nodeBuiltinShim = (file: string) => fileURLToPath(new URL(`./src/platform/shared/node-builtin-shims/${file}`, import.meta.url))

export default defineConfig({
  root: '.',
  base: './',
  publicDir: 'public',
  plugins: [novaDevProxyPlugin()],
  server: {
    port: 5173,
    fs: {
      allow: [
        '.',
        './native',
        './src/native',
      ],
    },
  },
  resolve: {
    alias: {
      electron: fileURLToPath(new URL('./src/platform/shared/electron-stub.ts', import.meta.url)),
      // Node built-ins for bundled CJS libraries
      zlib: nodeBuiltinShim('zlib.cts'),
      buffer: nodeBuiltinShim('buffer.cts'),
      assert: nodeBuiltinShim('assert.cts'),
      stream: nodeBuiltinShim('stream.cts'),
      util: nodeBuiltinShim('util.cts'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: __dirname + '/index.html',
      },
      external: [
        'module',
        'dns',
        'https',
        'http',
      ],
    },
  },
  optimizeDeps: {
    exclude: ['pngjs', 'jpeg-js'],
  },
})
