/** Build the official platform seed for the packaged-client import check. */
import { fileURLToPath } from 'node:url'

const outDir = process.env.DSH_COMMUNITY_SEED_OUT
if (!outDir) throw new Error('DSH_COMMUNITY_SEED_OUT is required')
export default {
  root: fileURLToPath(new URL('../../../web', import.meta.url)),
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('../../../../packages/client/web/src/seed.ts', import.meta.url)),
      name: '__DSH_COMMUNITY_SEED__',
      formats: ['iife'],
      fileName: () => 'seed.js',
    },
  },
}
