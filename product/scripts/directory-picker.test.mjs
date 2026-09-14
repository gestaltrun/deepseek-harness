/** Verify product platform choices against the published picker and Remote API. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { DirectoryPickerController } from '@deepseek-ai/dsh-api-workspace-controller'
import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import BrowsePicker from '@deepseek-ai/dsh-host-directory-picker-browse'
import NativePicker from '@deepseek-ai/dsh-host-directory-picker-native'

test('Web browse pairing lists a real directory through the public Remote controller', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-im-picker-'))
  const ctx = new Context()
  try {
    await mkdir(join(root, 'workspace-a'))
    await ctx.plugin(BrowsePicker)
    await ctx.plugin(DirectoryPickerController)
    assert.equal(ctx.directoryPicker.capability().kind, 'browse')
    const listing = await ctx.directoryPickerController.list(root, new AbortController().signal)
    assert.ok(listing.entries.some(entry => entry.name === 'workspace-a'))
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('Desktop native pairing exposes native capability and refuses a browse-only call', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(NativePicker)
    await ctx.plugin(DirectoryPickerController)
    assert.equal(ctx.directoryPicker.capability().kind, 'native')
    await assert.rejects(ctx.directoryPickerController.list(undefined, new AbortController().signal),
      error => error.code === 'directory-picker/unavailable' && error.message.includes('native'))
  } finally {
    await ctx.fiber.dispose()
  }
})

test('an unsupported picker extension fails the requested interaction explicitly', async () => {
  class ExternalPicker extends DirectoryPicker {
    capability() { return { kind: 'external-test-picker' } }
  }
  const ctx = new Context()
  try {
    await ctx.plugin(ExternalPicker)
    await ctx.plugin(DirectoryPickerController)
    await assert.rejects(ctx.directoryPickerController.list(undefined, new AbortController().signal),
      error => error.code === 'directory-picker/unavailable' && error.message.includes('external-test-picker'))
  } finally {
    await ctx.fiber.dispose()
  }
})
