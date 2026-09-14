/** Build the DingTalk transport package. */
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'lib',
  dts: false,
  clean: false,
  outExtensions: () => ({ js: '.js' }),
  deps: { neverBundle: [/^@deepseek-ai\//u, /^@gestaltrun\//u] },
})
