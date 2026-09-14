/** Resolve the Desktop auto-update channel and its Alibaba Cloud OSS destination. */

import { prerelease, valid } from 'semver'

/** Environment variable that selects the Desktop update deployment. */
export const DESKTOP_AUTO_UPDATE_ENV = 'DSH_DESKTOP_AUTO_UPDATE_ENV'

const UPDATE_ENVIRONMENTS = {
  test: {
    feedUrlEnvName: 'DESKTOP_RELEASE_TEST_FEED_URL',
    objectPrefixEnvName: 'DESKTOP_RELEASE_TEST_OSS_PREFIX',
  },
  production: {
    feedUrlEnvName: 'DESKTOP_RELEASE_PRODUCTION_FEED_URL',
    objectPrefixEnvName: 'DESKTOP_RELEASE_PRODUCTION_OSS_PREFIX',
  },
}

const OSS_BUCKET_ENV = 'DESKTOP_RELEASE_OSS_BUCKET'
const OSS_ENDPOINT_ENV = 'DESKTOP_RELEASE_OSS_ENDPOINT'
const ALIYUN_REGION_ENV = 'DESKTOP_RELEASE_ALIYUN_REGION'

const UPDATE_TARGETS = new Set(['mac-arm64', 'mac-x64', 'win-x64'])

/**
 * Resolve the update deployment, defaulting local release work to test.
 * @param {NodeJS.ProcessEnv} env - Packaging or upload environment.
 * @returns {'test' | 'production'} Validated deployment name.
 */
export function resolveDesktopAutoUpdateEnvironment(env) {
  const value = env[DESKTOP_AUTO_UPDATE_ENV]?.trim() || 'test'
  if (value !== 'test' && value !== 'production') {
    throw new Error(`desktop auto-update: ${DESKTOP_AUTO_UPDATE_ENV} must be "test" or "production"`)
  }
  return value
}

/**
 * Resolve one supported platform and architecture to its update directory.
 * @param {NodeJS.Platform} platform - Target Node.js platform.
 * @param {string} arch - Target Node.js architecture.
 * @returns {'mac-arm64' | 'mac-x64' | 'win-x64'} Update target directory.
 */
export function resolveDesktopAutoUpdateTarget(platform, arch) {
  const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform
  const target = `${os}-${arch}`
  if (!UPDATE_TARGETS.has(target)) {
    throw new Error(`desktop auto-update: unsupported target ${target}`)
  }
  return target
}

/**
 * Return the local completion record filename for one packaged target.
 * @param {'mac-arm64' | 'mac-x64' | 'win-x64'} target - Supported release target.
 * @returns {string} Filename stored beside electron-builder artifacts.
 */
export function desktopBuildRecordFilename(target) {
  if (!UPDATE_TARGETS.has(target)) {
    throw new Error(`desktop auto-update: unsupported target ${target}`)
  }
  return `${target}-release.json`
}

/**
 * Return the electron-builder channel metadata filename for an application version.
 * @param {string} version - Desktop semantic version.
 * @param {NodeJS.Platform} platform - Target platform.
 * @returns {string} Channel metadata filename emitted for the target.
 */
export function desktopUpdateMetadataFilename(version, platform) {
  if (valid(version) === null) {
    throw new Error(`desktop auto-update: invalid Desktop version ${JSON.stringify(version)}`)
  }
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error(`desktop auto-update: unsupported metadata platform ${platform}`)
  }
  const release = prerelease(version)
  const channel = release === null ? 'latest' : String(release[0])
  return `${channel}${platform === 'darwin' ? '-mac' : ''}.yml`
}

/**
 * Return the branded installer basename for one Desktop version and target.
 * @param {string} version - Desktop semantic version.
 * @param {'mac-arm64' | 'mac-x64' | 'win-x64'} target - Supported release target.
 * @returns {string} Filename without its installer extension.
 */
export function desktopReleaseArtifactBase(version, target) {
  if (valid(version) === null) {
    throw new Error(`desktop auto-update: invalid Desktop version ${JSON.stringify(version)}`)
  }
  if (!UPDATE_TARGETS.has(target)) {
    throw new Error(`desktop auto-update: unsupported target ${target}`)
  }
  if (target === 'win-x64') return `DeepSeekGestalt-Setup-${version}-x64`
  return `DeepSeek-Gestalt-${version}-${target === 'mac-arm64' ? 'arm64' : 'x64'}`
}

/**
 * Read one required release setting without accepting whitespace-only values.
 * @param {NodeJS.ProcessEnv} env - Packaging or upload environment.
 * @param {string} name - Environment variable to read.
 * @returns {string} Trimmed setting.
 */
function requiredEnvironmentValue(env, name) {
  const value = env[name]?.trim()
  if (value === undefined || value === '') {
    throw new Error(`desktop auto-update: ${name} must be set to a non-empty value`)
  }
  return value
}

/**
 * Normalize an HTTPS base URL and reject credentials, queries, or fragments.
 * @param {string} value - Candidate origin.
 * @param {string} name - Environment variable used in diagnostics.
 * @returns {string} Normalized HTTPS origin without a trailing slash.
 */
function httpsBaseUrl(value, name) {
  let parsed
  try {
    parsed = new URL(value)
  }
  catch {
    throw new Error(`desktop auto-update: ${name} must be an absolute HTTPS URL`)
  }
  if (parsed.protocol !== 'https:'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.search !== ''
    || parsed.hash !== '') {
    throw new Error(`desktop auto-update: ${name} must be an absolute HTTPS URL without credentials, query, or fragment`)
  }
  return parsed.href.replace(/\/+$/u, '')
}

function httpsEndpoint(value, name) {
  const url = httpsBaseUrl(value, name)
  const parsed = new URL(url)
  if (parsed.pathname !== '/') {
    throw new Error(`desktop auto-update: ${name} must be an HTTPS origin without a path`)
  }
  return parsed.origin
}

/**
 * Normalize an OSS object prefix without permitting ambiguous path segments.
 * @param {string} value - Candidate object prefix.
 * @param {string} name - Environment variable used in diagnostics.
 * @returns {string} Normalized non-empty prefix without outer slashes.
 */
function objectPrefix(value, name) {
  const normalized = value.replace(/^\/+|\/+$/gu, '')
  const segments = normalized.split('/')
  if (normalized === ''
    || segments.some(segment => segment === '' || segment === '.' || segment === '..')
    || !/^[A-Za-z0-9._/-]+$/u.test(normalized)) {
    throw new Error(`desktop auto-update: ${name} must be a non-empty OSS object prefix without empty, ".", or ".." segments`)
  }
  return normalized
}

function ossRegion(value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/u.test(value) || value.startsWith('oss-')) {
    throw new Error(`desktop auto-update: ${ALIYUN_REGION_ENV} must use the Alibaba Cloud region ID form, such as "cn-hangzhou"`)
  }
  return `oss-${value}`
}

/**
 * Resolve the public updater URL for one release target.
 * @param {NodeJS.ProcessEnv} env - Packaging or upload environment.
 * @param {NodeJS.Platform} platform - Target Node.js platform.
 * @param {string} arch - Target Node.js architecture.
 * @returns {{ environment: 'test' | 'production', target: 'mac-arm64' | 'mac-x64' | 'win-x64', feedBaseUrl: string, publicUrl: string }} Resolved updater configuration.
 * @throws {Error} When the selected deployment lacks a valid HTTPS feed URL.
 */
export function resolveDesktopAutoUpdateConfig(env, platform, arch) {
  const environment = resolveDesktopAutoUpdateEnvironment(env)
  const target = resolveDesktopAutoUpdateTarget(platform, arch)
  const deployment = UPDATE_ENVIRONMENTS[environment]
  const feedBaseUrl = httpsBaseUrl(
    requiredEnvironmentValue(env, deployment.feedUrlEnvName),
    deployment.feedUrlEnvName,
  )
  return {
    environment,
    target,
    feedBaseUrl,
    publicUrl: `${feedBaseUrl}/${target}/`,
  }
}

/**
 * Resolve the public updater URL and private OSS destination for one upload target.
 * @param {NodeJS.ProcessEnv} env - Upload environment.
 * @param {NodeJS.Platform} platform - Target Node.js platform.
 * @param {string} arch - Target Node.js architecture.
 * @returns {{ environment: 'test' | 'production', target: 'mac-arm64' | 'mac-x64' | 'win-x64', feedBaseUrl: string, publicUrl: string, keyPrefix: string, bucket: string, endpoint: string, region: string }} Resolved upload configuration.
 * @throws {Error} When the selected deployment lacks a valid feed URL or OSS setting.
 */
export function resolveDesktopUploadConfig(env, platform, arch) {
  const update = resolveDesktopAutoUpdateConfig(env, platform, arch)
  const deployment = UPDATE_ENVIRONMENTS[update.environment]
  return {
    ...update,
    keyPrefix: `${objectPrefix(
      requiredEnvironmentValue(env, deployment.objectPrefixEnvName),
      deployment.objectPrefixEnvName,
    )}/${update.target}`,
    bucket: requiredEnvironmentValue(env, OSS_BUCKET_ENV),
    endpoint: httpsEndpoint(requiredEnvironmentValue(env, OSS_ENDPOINT_ENV), OSS_ENDPOINT_ENV),
    region: ossRegion(requiredEnvironmentValue(env, ALIYUN_REGION_ENV)),
  }
}
