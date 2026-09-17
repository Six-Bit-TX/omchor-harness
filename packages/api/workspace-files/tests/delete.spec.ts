/** The `delete` endpoint: permanent deletion of one entry inside the workspace. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { failureOf, openWorkspace, signal, type Harness } from './harness.ts'

let harness: Harness

beforeEach(async () => {
  harness = await openWorkspace('dsh-workspace-files-delete-')
})

afterEach(async () => {
  await harness.dispose()
})

/** The absolute path a direct call answers with for a path the backend resolves. */
async function absoluteOf(path: string): Promise<string> {
  return harness.ctx.fs.processPath(await harness.ctx.fs.resolve(path))
}

describe('workspaceFiles.delete — the happy path', () => {
  it('removes a file and returns its absolute path', async () => {
    await writeFile(join(harness.workspace, 'a.txt'), 'x', 'utf8')
    const result = await harness.endpoint().delete(harness.scope, 'a.txt', signal())
    expect(result.absolutePath).toBe(await absoluteOf(join(harness.workspace, 'a.txt')))
    await expect(stat(join(harness.workspace, 'a.txt'))).rejects.toThrow()
  })

  it('removes a directory with everything below it', async () => {
    await mkdir(join(harness.workspace, 'src', 'nested'), { recursive: true })
    await writeFile(join(harness.workspace, 'src', 'nested', 'a.ts'), 'x', 'utf8')
    const result = await harness.endpoint().delete(harness.scope, 'src', signal())
    expect(result.absolutePath).toBe(await absoluteOf(join(harness.workspace, 'src')))
    await expect(stat(join(harness.workspace, 'src'))).rejects.toThrow()
  })

  it('leaves a sibling entry in place', async () => {
    await writeFile(join(harness.workspace, 'a.txt'), 'a', 'utf8')
    await writeFile(join(harness.workspace, 'b.txt'), 'b', 'utf8')
    await harness.endpoint().delete(harness.scope, join(harness.workspace, 'a.txt'), signal())
    expect(await readFile(join(harness.workspace, 'b.txt'), 'utf8')).toBe('b')
  })
})

describe('workspaceFiles.delete — gates', () => {
  it('refuses the workspace root', async () => {
    const failure = await failureOf(harness.endpoint().delete(harness.scope, harness.workspace, signal()))
    expect(failure.code).toBe('gateway/bad-request')
    expect(await stat(harness.workspace)).toBeDefined()
  })

  it('refuses the workspace root named by a relative path', async () => {
    const failure = await failureOf(harness.endpoint().delete(harness.scope, '.', signal()))
    expect(failure.code).toBe('gateway/bad-request')
  })

  it('refuses an entry outside the workspace', async () => {
    await writeFile(join(harness.outside, 'secret.txt'), 'x', 'utf8')
    const failure = await failureOf(harness.endpoint().delete(harness.scope, join(harness.outside, 'secret.txt'), signal()))
    expect(failure.code).toBe('workspace-file/outside-workspace')
    expect(await readFile(join(harness.outside, 'secret.txt'), 'utf8')).toBe('x')
  })

  it('reports a missing path as not found', async () => {
    const failure = await failureOf(harness.endpoint().delete(harness.scope, 'nope.txt', signal()))
    expect(failure.code).toBe('workspace-file/not-found')
  })

  it('refuses an empty path as a bad request', async () => {
    const failure = await failureOf(harness.endpoint().delete(harness.scope, '', signal()))
    expect(failure.code).toBe('gateway/bad-request')
  })
})
