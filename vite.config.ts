import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { novaDevProxyPlugin } from './vite-plugins/nova-dev-proxy'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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
        'util',
      ],
    },
  },
  optimizeDeps: {
    exclude: ['pngjs', 'jpeg-js'],
  },
})
