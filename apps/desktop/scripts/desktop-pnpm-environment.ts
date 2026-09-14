/** Select the bounded package-manager environment used to materialize Desktop runtime packages. */

const NETWORK_SETTINGS = [
  'PNPM_CONFIG_NETWORK_CONCURRENCY',
  'PNPM_CONFIG_FETCH_TIMEOUT',
] as const

function positiveInteger(environment: NodeJS.ProcessEnv, name: typeof NETWORK_SETTINGS[number]): string | undefined {
  const raw = environment[name]
  if (raw === undefined) return undefined
  const value = raw.trim()
  if (value === '') return undefined
  const parsed = Number(value)
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(parsed)) {
    throw new Error(`desktop runtime: ${name} must be a positive integer`)
  }
  return value
}

/**
 * Preserve ordinary process settings and the two validated pnpm network controls.
 * @param environment - Parent packaging environment.
 * @param owned - Runtime-project paths and registry fixed by Desktop packaging.
 * @returns Scrubbed child environment for bundled pnpm.
 */
export function desktopPnpmEnvironment(
  environment: NodeJS.ProcessEnv,
  owned: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(Object.entries(environment).filter(([name]) => (
    name !== 'NODE_OPTIONS'
    && name !== 'NODE_PATH'
    && !/^DSH_DESKTOP_/u.test(name)
    && !/^(?:npm|pnpm|corepack)_/iu.test(name)
  )))
  const network = Object.fromEntries(NETWORK_SETTINGS.flatMap((name) => {
    const value = positiveInteger(environment, name)
    return value === undefined ? [] : [[name, value]]
  }))
  return { ...inherited, ...network, ...owned }
}
