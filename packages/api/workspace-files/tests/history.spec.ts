/**
 * The `history` endpoint and its `git log` parser: git runs through the
 * subprocess seam, and every empty-history answer stays an answer, not a failure.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { parseGitLog } from '../src/index.ts'
import { failureOf, openWorkspace, signal, type Harness } from './harness.ts'

/** The field separator the Host's `git log` format uses. */
const SEP = '\u001f'

/** One `git log` record line, exactly as `GIT_LOG_FORMAT` prints it. */
function record(hash: string, shortHash: string, author: string, date: string, subject: string): string {
  return [hash, shortHash, author, date, subject].join(SEP)
}

/** Representative `git log --numstat` stdout: blank separators, counts, and a binary change. */
const LOG = [
  '',
  record('a'.repeat(40), 'aaaaaaa', 'Ada Lovelace', '2024-05-01T10:00:00+02:00', 'Add the parser'),
  '',
  '12\t3\tsrc/index.ts',
  record('b'.repeat(40), 'bbbbbbb', 'Grace Hopper', '2024-04-02T09:30:00+02:00', 'Rename the module'),
  '',
  '4\t2\tsrc/old.ts',
  '-\t-\tassets/logo.png',
  record('c'.repeat(40), 'ccccccc', 'Alan Turing', '2024-03-03T08:00:00Z', 'Initial import'),
  '',
  '7\t0\tsrc/index.ts',
  '',
].join('\n')

/** A scripted subprocess handle: one collected stdout stream and one outcome. */
function fakeHandle(options: {
  exitCode: number | null
  stdout?: string
  lossy?: boolean
  collected?: boolean
  done?: Promise<SubprocessOutcome>
}): SubprocessHandle {
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: options.collected === false
      ? {}
      : {
        stdout: {
          readFrom: () => ({ text: options.stdout ?? '', nextOffset: 0, lossy: options.lossy ?? false }),
        },
      },
    done: options.done ?? Promise.resolve({ exitCode: options.exitCode, signal: null }),
    terminate: () => {},
    waitForExit: async () => true,
  }
}

describe('parseGitLog', () => {
  it('reads one entry per record, summing the numstat lines and zeroing binary changes', () => {
    expect(parseGitLog(LOG)).toEqual([
      {
        hash: 'a'.repeat(40),
        shortHash: 'aaaaaaa',
        author: 'Ada Lovelace',
        date: '2024-05-01T10:00:00+02:00',
        subject: 'Add the parser',
        additions: 12,
        deletions: 3,
      },
      {
        hash: 'b'.repeat(40),
        shortHash: 'bbbbbbb',
        author: 'Grace Hopper',
        date: '2024-04-02T09:30:00+02:00',
        subject: 'Rename the module',
        additions: 4,
        deletions: 2,
      },
      {
        hash: 'c'.repeat(40),
        shortHash: 'ccccccc',
        author: 'Alan Turing',
        date: '2024-03-03T08:00:00Z',
        subject: 'Initial import',
        additions: 7,
        deletions: 0,
      },
    ])
  })

  it('tolerates a truncated record line and keeps separators inside a subject', () => {
    expect(parseGitLog(`abc${SEP}short`)).toEqual([
      { hash: 'abc', shortHash: 'short', author: '', date: '', subject: '', additions: 0, deletions: 0 },
    ])
    expect(parseGitLog(record('h', 's', 'a', 'd', `sub${SEP}ject`))[0]?.subject).toBe(`sub${SEP}ject`)
  })

  it('returns nothing for empty output', () => {
    expect(parseGitLog('')).toEqual([])
  })
})

describe('workspaceFiles.history', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await openWorkspace('dsh-workspace-files-history-')
  })

  afterEach(async () => {
    await harness.dispose()
  })

  /** The absolute path a direct call answers with for a path the backend resolves. */
  async function absoluteOf(path: string): Promise<string> {
    return harness.ctx.fs.processPath(await harness.ctx.fs.resolve(path))
  }

  it('runs git in the file\'s directory and returns the parsed history', async () => {
    const file = join(harness.workspace, 'notes.txt')
    await writeFile(file, 'x', 'utf8')
    harness.subprocess.answer = () => fakeHandle({ exitCode: 0, stdout: LOG })
    const result = await harness.endpoint().history(harness.scope, 'notes.txt', signal())
    expect(result).toEqual({ path: await absoluteOf(file), entries: parseGitLog(LOG) })
    expect(harness.subprocess.spawns).toHaveLength(1)
    expect(harness.subprocess.spawns[0]?.argv).toEqual([
      'git', '-C', dirname(await absoluteOf(file)), 'log', '--follow', '-n', '50',
      '--date=iso-strict', `--format=%H${SEP}%h${SEP}%an${SEP}%ad${SEP}%s`, '--numstat', '--', 'notes.txt',
    ])
    expect(harness.subprocess.spawns[0]?.cwd).toBe(dirname(await absoluteOf(file)))
    expect(harness.subprocess.spawns[0]?.stdio).toEqual({
      stdin: 'ignore',
      stdout: { maxBytes: 1024 * 1024 },
      stderr: { maxBytes: 64 * 1024 },
    })
    expect(harness.subprocess.spawns[0]?.graceMs).toBeGreaterThan(0)
  })

  it('answers for a file outside the workspace', async () => {
    const file = join(harness.outside, 'secret.txt')
    await writeFile(file, 'x', 'utf8')
    harness.subprocess.answer = () => fakeHandle({ exitCode: 0, stdout: LOG })
    const result = await harness.endpoint().history(harness.scope, file, signal())
    expect(result.path).toBe(await absoluteOf(file))
    expect(result.entries).toHaveLength(3)
  })

  it('reports a missing file as not found without spawning git', async () => {
    const failure = await failureOf(harness.endpoint().history(harness.scope, 'nope.txt', signal()))
    expect(failure.code).toBe('workspace-file/not-found')
    expect(harness.subprocess.spawns).toEqual([])
  })

  it('refuses a directory, which has no file history', async () => {
    await mkdir(join(harness.workspace, 'src'))
    const failure = await failureOf(harness.endpoint().history(harness.scope, 'src', signal()))
    expect(failure.code).toBe('workspace-file/not-regular-file')
  })

  it('reports an empty history when git exits non-zero', async () => {
    await writeFile(join(harness.workspace, 'notes.txt'), 'x', 'utf8')
    harness.subprocess.answer = () => fakeHandle({ exitCode: 128, stdout: 'fatal: not a git repository' })
    const result = await harness.endpoint().history(harness.scope, 'notes.txt', signal())
    expect(result.entries).toEqual([])
    expect(result.path).toBe(await absoluteOf(join(harness.workspace, 'notes.txt')))
  })

  it('reports an empty history when git cannot start', async () => {
    await writeFile(join(harness.workspace, 'notes.txt'), 'x', 'utf8')
    harness.subprocess.answer = () => {
      throw new Error('spawn git ENOENT')
    }
    expect((await harness.endpoint().history(harness.scope, 'notes.txt', signal())).entries).toEqual([])
  })

  it('reports an empty history when the outcome rejects', async () => {
    await writeFile(join(harness.workspace, 'notes.txt'), 'x', 'utf8')
    harness.subprocess.answer = () => fakeHandle({ exitCode: 0, done: Promise.reject(new Error('provider failure')) })
    expect((await harness.endpoint().history(harness.scope, 'notes.txt', signal())).entries).toEqual([])
  })

  it('reports an empty history without a collected stdout stream', async () => {
    await writeFile(join(harness.workspace, 'notes.txt'), 'x', 'utf8')
    harness.subprocess.answer = () => fakeHandle({ exitCode: 0, collected: false })
    expect((await harness.endpoint().history(harness.scope, 'notes.txt', signal())).entries).toEqual([])
  })

  it('reports an empty history when the retained stdout was truncated', async () => {
    await writeFile(join(harness.workspace, 'notes.txt'), 'x', 'utf8')
    harness.subprocess.answer = () => fakeHandle({ exitCode: 0, stdout: LOG, lossy: true })
    expect((await harness.endpoint().history(harness.scope, 'notes.txt', signal())).entries).toEqual([])
  })

  it('propagates a caller abort that reaches the spawn itself', async () => {
    await writeFile(join(harness.workspace, 'notes.txt'), 'x', 'utf8')
    const controller = new AbortController()
    const failure = new Error('spawn aborted')
    harness.subprocess.answer = () => {
      controller.abort()
      throw failure
    }
    await expect(harness.endpoint().history(harness.scope, 'notes.txt', controller.signal)).rejects.toBe(failure)
  })

  it('propagates a caller abort that reaches the outcome', async () => {
    await writeFile(join(harness.workspace, 'notes.txt'), 'x', 'utf8')
    const controller = new AbortController()
    const failure = new Error('outcome aborted')
    harness.subprocess.answer = () => {
      controller.abort()
      return fakeHandle({ exitCode: 0, done: Promise.reject(failure) })
    }
    await expect(harness.endpoint().history(harness.scope, 'notes.txt', controller.signal)).rejects.toBe(failure)
  })

  it('propagates a caller abort observed after a normal outcome', async () => {
    await writeFile(join(harness.workspace, 'notes.txt'), 'x', 'utf8')
    const controller = new AbortController()
    harness.subprocess.answer = () => fakeHandle({
      exitCode: 0,
      done: new Promise((resolve) => {
        controller.abort()
        resolve({ exitCode: 0, signal: null })
      }),
    })
    const caught = await harness.endpoint().history(harness.scope, 'notes.txt', controller.signal)
      .then(() => undefined, (error: unknown) => error)
    expect(caught).toBe(controller.signal.reason)
  })
})
