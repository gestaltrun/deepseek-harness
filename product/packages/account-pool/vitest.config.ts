/** Test product code against published dependencies without repository source aliases. */
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { defineConfig } from 'vitest/config'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

const require = createRequire(import.meta.url)
export default defineConfig({
  resolve: { alias: {
    react: dirname(require.resolve('react/package.json')),
    'react-dom': dirname(require.resolve('react-dom/package.json')),
  } },
  plugins: [typertPlugin({ mode: 'package', faces: ['host'] })],
  test: { server: { deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives'] } }, include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'], testTimeout: 15000 },
})
