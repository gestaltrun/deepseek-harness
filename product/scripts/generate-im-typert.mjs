/** Build-only entry for the product IM Host and Remote Client artifacts. */
import { resolve } from 'node:path'
import { generateImTypert } from './typert-build.mjs'

const result = generateImTypert(resolve(import.meta.dirname, '..'))
console.log(`Generated ${result.files.length} Typert files for ${result.package}`)
