/** Package the IM Client assembly in the official module-loader format. */
import { defineConfig } from 'tsdown'
const id = '@gestaltrun/dsh-api-im'
export default defineConfig({ entry: { client: 'lib/types/client/index.js' }, format: 'cjs', platform: 'browser', target: 'es2022', outDir: 'lib', dts: false, clean: false, outExtensions: () => ({ js: '.js' }), deps: { alwaysBundle: [/./u], neverBundle: [/^@deepseek-ai\/(?:cordis|dsh-client-store)(?:\/|$)/u, '@deepseek-ai/dsh-api-gateway/client'] }, outputOptions: { banner: `window.__ModuleLoader__.load({id:${JSON.stringify(id)},factory:(require)=>{const module={exports:{}};const exports=module.exports;`, footer: 'return module.exports;}});' } })
