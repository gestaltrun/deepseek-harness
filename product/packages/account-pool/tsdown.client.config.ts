/** Emit the existing public module-loader factory for the product's browser code. */
import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

const id = '@gestaltrun/dsh-account-pool'
const shared = /^(?:react(?:-dom)?(?:\/|$)|@deepseek-ai\/(?:cordis|dsh-client-[a-z-]+|dsh-api-[a-z-]+)(?:\/|$))/u
export default defineConfig({
  entry: { client: 'src/client/index.ts' }, format: 'cjs', platform: 'browser', target: 'es2022',
  outDir: 'lib', dts: false, clean: false, outExtensions: () => ({ js: '.js' }),
  deps: { alwaysBundle: [/./u], neverBundle: [shared] },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{
    name: 'account-pool-client-css',
    resolveId(source, importer) {
      if (!source.endsWith('.module.css')) return null
      const path = resolve(importer === undefined ? '.' : dirname(importer), source)
      return '\0account-pool-css:' + relative(import.meta.dirname, path).split(sep).join('/') + '.mjs'
    },
    async load(moduleId) {
      if (!moduleId.startsWith('\0account-pool-css:')) return null
      const relativePath = moduleId.slice('\0account-pool-css:'.length, -4)
      const path = resolve(import.meta.dirname, relativePath)
      this.addWatchFile(path)
      const result = transform({ filename: relativePath, code: await readFile(path), cssModules: true, minify: true })
      const classes = Object.fromEntries(Object.entries(result.exports ?? {}).map(([key, value]) => [key, value.name]))
      const tag = `${id}/${relativePath}`
      return `const key=${JSON.stringify(tag)}; if(!document.querySelector('style[data-plugin-css='+JSON.stringify(key)+']')){const style=document.createElement('style');style.dataset.plugin=${JSON.stringify(id)};style.dataset.pluginCss=key;style.textContent=${JSON.stringify(result.code.toString())};document.head.append(style)};export default ${JSON.stringify(classes)};`
    },
  }],
  outputOptions: {
    banner: `window.__ModuleLoader__.load({id:${JSON.stringify(id)},factory:(require)=>{const module={exports:{}};const exports=module.exports;`,
    footer: 'return module.exports;}});',
  },
})
