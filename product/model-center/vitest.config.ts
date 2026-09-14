import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin } from '../../vitest.shared.ts'
const require = createRequire(import.meta.url)
export default defineConfig({ resolve: { alias: { react: dirname(require.resolve('react/package.json')), 'react-dom': dirname(require.resolve('react-dom/package.json')) } }, plugins: [standardDecoratorPlugin(), tsconfigPaths({ projects: ['../../tsconfig.base.json'] })],
  test: { include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'], testTimeout: 15000 } })
