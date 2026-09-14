/** Build the product Host and its package-owned Typert/Remote contributions. */
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'lib/types/index.js' }, format: 'esm', platform: 'node', target: 'node22',
  outDir: 'lib', dts: false, clean: false, outExtensions: () => ({ js: '.js' }),
  deps: { neverBundle: [/^@deepseek-ai\//u, /^@earendil-works\//u, /^undici$/u, /^selfsigned$/u] },
})
