/** Focused Host behavior tests against this product's installed public dependencies. */
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/backend/*.spec.ts', 'tests/quota/*.spec.ts'], testTimeout: 15000, hookTimeout: 15000 } })
