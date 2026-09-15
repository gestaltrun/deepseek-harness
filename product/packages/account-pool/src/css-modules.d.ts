declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

/** Styles imported by the published Markdown primitive. */
declare module 'katex/dist/katex.min.css'
