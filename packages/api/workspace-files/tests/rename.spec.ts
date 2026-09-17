/** The `rename` endpoint: one name change inside the workspace, never across directories. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { failureOf, openWorkspace, signal, type Harness } from './harness.ts'

let harness: Harness

beforeEach(async () => {
  harness = await openWorkspace('dsh-workspace-files-rename-')
})

afterEach(async () => {
  await harness.dispose()
})

/** The absolute path a direct call answers with for a path the backend resolves. */
async function absoluteOf(path: string): Promise<string> {
  return harness.ctx.fs.processPath(await harness.ctx.fs.resolve(path))
}

describe('workspaceFiles.rename — the happy path', () => {
  it('renames a file and returns its new absolute path', async () => {
    await writeFile(join(harness.workspace, 'a.txt'), 'content', 'utf8')
    const result = await harness.endpoint().rename(harness.scope, 'a.txt', 'b.txt', signal())
    expect(result.absolutePath).toBe(await absoluteOf(join(harness.workspace, 'b.txt')))
    expect(await readFile(join(harness.workspace, 'b.txt'), 'utf8')).toBe('content')
    await expect(stat(join(harness.workspace, 'a.txt'))).rejects.toThrow()
  })

  it('renames a directory with everything below it', async () => {
    await mkdir(join(harness.workspace, 'src', 'nested'), { recursive: true })
    await writeFile(join(harness.workspace, 'src', 'nested', 'a.ts'), 'x', 'utf8')
    const result = await harness.endpoint().rename(harness.scope, join(harness.workspace, 'src'), 'lib', signal())
    expect(result.absolutePath).toBe(await absoluteOf(join(harness.workspace, 'lib')))
    expect(await readFile(join(harness.workspace, 'lib', 'nested', 'a.ts'), 'utf8')).toBe('x')
  })

  it('renames inside a nested directory named by a workspace-relative path', async () => {
    await mkdir(join(harness.workspace, 'src'))
    await writeFile(join(harness.workspace, 'src', 'old.ts'), 'x', 'utf8')
    const result = await harness.endpoint().rename(harness.scope, 'src/old.ts', 'new.ts', signal())
    expect(result.absolutePath).toBe(await absoluteOf(join(harness.workspace, 'src', 'new.ts')))
    expect(await readFile(join(harness.workspace, 'src', 'new.ts'), 'utf8')).toBe('x')
  })
})

describe('workspaceFiles.rename — gates', () => {
  it.each(['', ' ', ' a', 'a ', '.', '..', 'a/b', 'a\\b', `a${String.fromCharCode(0)}b`])(
    'refuses newName %j as a bad request',
    async (newName) => {
      await writeFile(join(harness.workspace, 'a.txt'), 'x', 'utf8')
      const failure = await failureOf(harness.endpoint().rename(harness.scope, 'a.txt', newName, signal()))
      expect(failure.code).toBe('gateway/bad-request')
      expect(await readFile(join(harness.workspace, 'a.txt'), 'utf8')).toBe('x')
    },
  )

  it('refuses an entry outside the workspace', async () => {
    await writeFile(join(harness.outside, 'secret.txt'), 'x', 'utf8')
    const failure = await failureOf(
      harness.endpoint().rename(harness.scope, join(harness.outside, 'secret.txt'), 'renamed.txt', signal()),
    )
    expect(failure.code).toBe('workspace-file/outside-workspace')
    expect(await readFile(join(harness.outside, 'secret.txt'), 'utf8')).toBe('x')
  })

  it('refuses the workspace root, whose new parent would leave the workspace', async () => {
    const failure = await failureOf(harness.endpoint().rename(harness.scope, harness.workspace, 'renamed', signal()))
    expect(failure.code).toBe('workspace-file/outside-workspace')
  })

  it('reports a missing source as not found', async () => {
    const failure = await failureOf(harness.endpoint().rename(harness.scope, 'nope.txt', 'x.txt', signal()))
    expect(failure.code).toBe('workspace-file/not-found')
  })

  it('refuses an empty source path as a bad request', async () => {
    const failure = await failureOf(harness.endpoint().rename(harness.scope, '', 'x.txt', signal()))
    expect(failure.code).toBe('gateway/bad-request')
  })
})
