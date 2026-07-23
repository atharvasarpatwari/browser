import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      electron: 'data:text/javascript,export default {}',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: __dirname + '/index.html',
      },
    },
  },
  optimizeDeps: {
    exclude: ['pngjs', 'jpeg-js'],
  },
})
