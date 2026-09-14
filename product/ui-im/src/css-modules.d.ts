/** Build-owned class maps for package-local CSS Modules. */
declare module '*.module.css' { const classes: Record<string, string>; export default classes }
