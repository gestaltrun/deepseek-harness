/** Remove only this package's generated build output before compiling a release archive. */
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
rmSync(fileURLToPath(new URL('../lib', import.meta.url)), { recursive: true, force: true })
