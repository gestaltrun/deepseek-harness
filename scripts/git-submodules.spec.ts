/** Repository gates retain first-party coverage beside independently owned gitlinks. */

import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitSubmoduleRoots } from './git-submodules.ts'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'
import { gitBlobHash } from './translation-pairing-git.ts'
import { renderTranslationPairingRecord, translationPairPaths } from './translation-pairing-record.ts'

const workspaceRoot = join(import.meta.dirname, '..')
const modulePath = 'community/plugin[1]{a,b}'

interface Fixture {
  root: string
  env: NodeJS.ProcessEnv
  moduleCommit: string
}

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

function git(root: string, args: string[], env: NodeJS.ProcessEnv): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env }).trim()
}

function initializeFixture(root: string): Fixture {
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  Object.assign(env, {
    GIT_AUTHOR_EMAIL: 'ownership@example.test',
    GIT_AUTHOR_NAME: 'Ownership Test',
    GIT_COMMITTER_EMAIL: 'ownership@example.test',
    GIT_COMMITTER_NAME: 'Ownership Test',
    GIT_CONFIG_GLOBAL: join(root, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_DEFAULT_HASH: 'sha1',
  })
  git(root, ['init', '--quiet'], env)
  write(root, 'package.json', '{"type":"module"}\n')
  write(root, 'scripts/translation-pairing.manifest.json', '{"excluded":[]}\n')
  for (const file of [
    'verify-translation-pairing.ts', 'translation-pairing.ts', 'translation-pairing-record.ts',
    'translation-pairing-git.ts', 'translation-links.ts', 'markdown.ts', 'git-submodules.ts', 'run-oxlint.ts',
  ]) copyFileSync(join(workspaceRoot, 'scripts', file), join(root, 'scripts', file))
  symlinkSync(join(workspaceRoot, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  write(root, `${modulePath}/README.md`, '# External plugin\n')
  write(root, `${modulePath}/module.js`, 'debugger;\n')
  const nested = join(root, modulePath)
  git(nested, ['init', '--quiet'], env)
  git(nested, ['add', 'README.md', 'module.js'], env)
  git(nested, ['commit', '--quiet', '-m', 'external plugin'], env)
  return { root, env, moduleCommit: git(nested, ['rev-parse', 'HEAD'], env) }
}

function registerSubmodule(fixture: Fixture): void {
  git(fixture.root, ['update-index', '--add', '--cacheinfo', `160000,${fixture.moduleCommit},${modulePath}`], fixture.env)
}

function gate(fixture: Fixture, script: string, args: string[] = []) {
  const result = spawnSync(process.execPath, [join(fixture.root, 'scripts', script), ...args], {
    cwd: fixture.root,
    env: fixture.env,
    encoding: 'utf8',
  })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  return result
}

function writeReadmePair(root: string): void {
  const source = '# Harness\n\nEnglish | [中文](README.zh.md)\n\nA guide.\n'
  const zh = '# 框架\n\n[English](README.md) | 中文\n\n使用指南。\n'
  write(root, 'README.md', source)
  write(root, 'README.zh.md', zh)
  write(root, 'README.i18n.yaml', renderTranslationPairingRecord(translationPairPaths('README.md'), {
    sourceHash: gitBlobHash(Buffer.from(source)),
    zhHash: gitBlobHash(Buffer.from(zh)),
  }))
}

describe('Git submodule gate ownership', () => {
  it('checks ordinary README pairs while excluding only registered gitlinks from discovery and writes', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-pairing-ownership-')))
    try {
      const fixture = initializeFixture(root)
      writeReadmePair(root)
      expect(gitSubmoduleRoots(root)).toEqual([])
      const beforeRegistration = gate(fixture, 'verify-translation-pairing.ts')
      expect(beforeRegistration.status).toBe(1)
      expect(beforeRegistration.stderr).toContain(`${modulePath}/README.md`)

      registerSubmodule(fixture)
      expect(gitSubmoduleRoots(root)).toEqual([modulePath])
      expect(gate(fixture, 'verify-translation-pairing.ts').status).toBe(0)
      const rejectedWrite = gate(fixture, 'verify-translation-pairing.ts', ['--write', `${modulePath}/README.md`])
      expect(rejectedWrite.status).toBe(2)
      expect(rejectedWrite.stderr).toContain('not an in-scope pair')
      expect(readFileSync(join(root, modulePath, 'README.md'), 'utf8')).toBe('# External plugin\n')

      write(root, `${modulePath}-local/README.md`, '# Main repository plugin\n')
      const firstParty = gate(fixture, 'verify-translation-pairing.ts')
      expect(firstParty.status).toBe(1)
      expect(firstParty.stderr).toContain(`${modulePath}-local/README.md`)
      expect(firstParty.stderr).not.toContain(`${modulePath}/README.md`)
    } finally {
      removeFixtureSafely(root)
    }
  })

  it('keeps full and explicit-path lint errors in first-party files beside a gitlink', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-oxlint-ownership-')))
    try {
      const fixture = initializeFixture(root)
      unlinkSync(join(root, 'node_modules'))
      mkdirSync(join(root, 'node_modules'))
      symlinkSync(join(workspaceRoot, 'node_modules', 'oxlint'), join(root, 'node_modules', 'oxlint'), process.platform === 'win32' ? 'junction' : 'dir')
      write(root, '.oxlintrc.json', '{"ignorePatterns":["**/node_modules/**"],"rules":{"no-debugger":"error"}}\n')
      write(root, 'main.js', 'export const value = 1;\n')
      const args = ['--config', '.oxlintrc.json', '.']
      const beforeRegistration = gate(fixture, 'run-oxlint.ts', args)
      expect(beforeRegistration.status).toBe(1)
      expect(beforeRegistration.stdout + beforeRegistration.stderr).toContain('module.js')

      registerSubmodule(fixture)
      expect(gate(fixture, 'run-oxlint.ts', args).status).toBe(0)
      const local = `${modulePath}-local/first-party.js`
      write(root, local, 'debugger;\n')
      for (const paths of [['.'], [local]]) {
        const result = gate(fixture, 'run-oxlint.ts', ['--config', '.oxlintrc.json', ...paths])
        expect(result.status).toBe(1)
        expect(result.stdout + result.stderr).toContain('first-party.js')
        expect(result.stdout + result.stderr).not.toContain('module.js')
      }
    } finally {
      removeFixtureSafely(root)
    }
  })
})
