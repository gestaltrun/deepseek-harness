/** Git index ownership for gates which also discover working-tree files. */

import { execFileSync } from 'node:child_process'

/**
 * Discover separate repository roots from resolved Git index entries.
 * @param root - Git working directory used to resolve relative paths.
 * @returns Stage-zero gitlink paths, including uninitialized submodules.
 */
export function gitSubmoduleRoots(root: string): string[] {
  const entries = execFileSync('git', ['-C', root, 'ls-files', '--stage', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return entries.split('\0').flatMap(entry => /^160000 [0-9a-f]+ 0\t([\s\S]+)$/.exec(entry)?.[1] ?? [])
}
