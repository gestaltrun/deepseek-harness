/** Isolated presentation fixture server; never attaches to a delivery profile. */
import { defineConfig } from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  optimizeDeps: { include: ['react', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives'] },
})
