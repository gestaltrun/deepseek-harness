/** Build the product IM Host runtime. */
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', types: 'src/types.ts', tools: 'src/tools.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'lib',
  dts: false,
  clean: false,
  outExtensions: () => ({ js: '.js' }),
  deps: { neverBundle: [/^@deepseek-ai\//u] },
})
