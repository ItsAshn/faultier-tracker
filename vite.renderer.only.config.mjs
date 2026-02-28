// Standalone Vite config used by the Claude preview tool.
// Serves only the renderer with mock bridge stubs — no Electron needed.
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default {
  root: resolve(__dirname, 'src/renderer'),
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  plugins: [react()],
}
