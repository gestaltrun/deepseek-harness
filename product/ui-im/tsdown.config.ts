/** Build the product Host entry and the official client module-loader factory. */
import { readFile } from 'node:fs/promises'
import { basename, relative, resolve, sep } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

const id = '@gestaltrun/dsh-ui-im'
const shared = /^(?:react(?:-dom)?(?:\/|$)|@deepseek-ai\/(?:cordis|dsh-client-[a-z-]+)(?:\/|$))/u
export default defineConfig([
  { entry: { index: 'src/index.ts' }, format: 'esm', platform: 'node', target: 'node22',
    outDir: 'lib', dts: false, clean: false, outExtensions: () => ({ js: '.js' }), deps: { neverBundle: [/^@deepseek-ai\//u] } },
  { entry: { client: 'src/client/index.ts' }, format: 'cjs', platform: 'browser', target: 'es2022',
    outDir: 'lib', dts: false, clean: false, outExtensions: () => ({ js: '.js' }),
    deps: { alwaysBundle: [/./u], neverBundle: [shared] },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'product-client-css',
      resolveId(source, importer) {
        if (!source.endsWith('.module.css')) return null
        const file = resolve(importer === undefined ? '.' : resolve(importer, '..'), source)
        return '\0ui-im-css:' + relative(import.meta.dirname, file).split(sep).join('/') + '.mjs'
      },
      async load(moduleId) {
        if (!moduleId.startsWith('\0ui-im-css:')) return null
        const relativePath = moduleId.slice('\0ui-im-css:'.length, -4)
        const path = resolve(import.meta.dirname, relativePath)
        this.addWatchFile(path)
        const result = transform({ filename: relativePath, code: await readFile(path), cssModules: true, minify: true })
        const entries = Object.entries(result.exports ?? {})
          .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        const classes = Object.fromEntries(entries.map(([key, value]) => [key, value.name]))
        const tag = `${id}/${basename(path)}`
        return `const key=${JSON.stringify(tag)}; if(!document.querySelector('style[data-plugin-css='+JSON.stringify(key)+']')){const s=document.createElement('style');s.dataset.plugin=${JSON.stringify(id)};s.dataset.pluginCss=key;s.textContent=${JSON.stringify(result.code.toString())};document.head.append(s)};export default ${JSON.stringify(classes)};`
      },
    }],
    outputOptions: {
      banner: `window.__ModuleLoader__.load({id:${JSON.stringify(id)},factory:(require)=>{const module={exports:{}};const exports=module.exports;`,
      footer: 'return module.exports;}});',
    },
  },
])
