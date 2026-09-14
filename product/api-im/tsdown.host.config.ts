/** Bundle only emitted Host JavaScript; public Cordis identities stay external. */
import { defineConfig } from 'tsdown'
export default defineConfig({ entry: { index: 'lib/types/index.js' }, format: 'esm', platform: 'node', target: 'node22', outDir: 'lib', dts: false, clean: false, deps: { neverBundle: [/^@deepseek-ai\//u, /^@gestaltrun\//u] } })
