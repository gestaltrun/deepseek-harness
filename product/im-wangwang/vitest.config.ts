import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin } from '../../vitest.shared.ts'

export default defineConfig({
  plugins: [standardDecoratorPlugin(), tsconfigPaths({ projects: ['../tsconfig.base.json', './tsconfig.json'] })],
  test: { include: ['tests/**/*.spec.ts'], testTimeout: 15_000 },
})
