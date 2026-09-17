/**
 * Workspace file service: file previews, directory listings, workspace-confined
 * rename and removal, file history, and the filesystem-observation change feed,
 * exposed as `workspaceFiles`.
 *
 * File reads follow the composed filesystem's read access, including paths
 * outside the workspace, and so do directory listings. The selected Session
 * header supplies the base for relative paths, with the sandbox policy root as
 * its no-cwd fallback, not a read-containment restriction. `rename` and
 * `delete` are deliberately workspace-confined, and they call `node:fs`
 * directly because the `ctx.fs` seam exposes no rename or remove operation.
 * `history` reads a file's `git log` through the subprocess seam. Change
 * observations remain workspace-scoped. File-kind checks and configured read
 * caps apply to every preview.
 *
 * A page is cut from `streamText`, which decodes and rejects non-UTF-8 as it
 * goes, so the file is read only up to the first character past the page and
 * never held whole in memory; the NUL scan runs on the page itself.
 *
 * This is NOT modelled on `session.openWorkspacePath`. That endpoint hands a
 * path to the local opener and leaves the effect on the machine; this one sends
 * file content across the wire, which is a different level of exposure.
 */

import { rename, rm } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-fs'
import type { FsDirEntry, FsInfo, FsPathInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { Remote, RemoteError, TypertRemoteService, type TypertLookup } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceChangeFeed } from './changes.ts'
import type {
  WorkspaceByteRange,
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryListing,
  WorkspaceFileBytes,
  WorkspaceFileHistory,
  WorkspaceFileHistoryEntry,
  WorkspaceFileMutation,
  WorkspaceFileRange,
  WorkspaceFileStat,
  WorkspaceFileText,
  WorkspaceFileWatchFrame,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `workspaceFiles` Remote namespace. */
    workspaceFiles: WorkspaceFiles
  }
}

/** Header-derived file resolution context for one Session identity. */
export interface WorkspaceFileScope {
  /** Session identity received on the wire. */
  readonly sessionId: SessionId
  /** Session workspace root, or the deployment fallback when its header has no cwd. */
  readonly workspaceRoot: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap {
    /** Resolve a Session id to its workspace root without loading its event body or activating an Agent. */
    workspaceFileScope: TypertLookup<WorkspaceFileScope, SessionId>
  }
}

/** Deployment caps on one page or one listing. */
export interface Config {
  /**
   * Inclusive byte cap on one page's text and on one byte window.
   *
   * A page above this fails; it is not shortened, because a silently cut page
   * reads as the whole page. A byte window asking for more is refused the same
   * way. The file itself has no size cap: a caller pages through it.
   */
  readonly maxBytes: number
  /** Inclusive byte cap on a complete-file read; larger files are refused, never truncated. */
  readonly maxFileBytes: number
  /** Default and largest page size in lines; a request asking for more is refused. */
  readonly maxLines: number
  /** Cap on returned directory entries; the rest is dropped and reported cut. */
  readonly maxEntries: number
}

/** One page cut from a decoded text stream. */
interface Page {
  readonly text: string
  /** Lines in `text`; `0` for a page past the last line. */
  readonly lines: number
  readonly eof: boolean
}

/** The byte text never carries: its presence marks a page as binary. */
const NUL = String.fromCharCode(0)

/** The unit-separator byte `GIT_LOG_FORMAT` joins one commit's fields with. */
const GIT_LOG_FIELD_SEPARATOR = '\u001f'

/** `git log` record format: full hash, short hash, author, ISO-8601 author date, subject. */
const GIT_LOG_FORMAT = `%H${GIT_LOG_FIELD_SEPARATOR}%h${GIT_LOG_FIELD_SEPARATOR}%an${GIT_LOG_FIELD_SEPARATOR}%ad${GIT_LOG_FIELD_SEPARATOR}%s`

/** Commit cap on one file's history: the newest records the timeline shows. */
const GIT_LOG_LIMIT = 50

/** Retained `git log` stdout cap; the bounded record count stays far below it. */
const GIT_LOG_MAX_BYTES = 1024 * 1024

/** Retained `git log` stderr tail cap; the tail is diagnostic and never read. */
const GIT_LOG_STDERR_MAX_BYTES = 64 * 1024

/**
 * Terminate-escalation grace for one `git log` call. Fixed: it bounds how long
 * a terminating child may take, and is not a deployment policy.
 */
const GIT_LOG_GRACE_MS = 5_000

/** Refuse anything the wire schema admits as a number but a window cannot use: only safe integers index a file. */
function integerAtLeast(value: number, min: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RemoteError('gateway/bad-request', `${name} must be a safe integer of at least ${min}`, {})
  }
  return value
}

/**
 * Validate one rename name as a single path segment: a rename may not move an
 * entry to another directory. Rejects an empty or whitespace-padded name, any
 * separator or NUL byte, and the `.` / `..` entries.
 * @param newName - the requested basename on the wire.
 * @returns the accepted name, unchanged.
 */
function segmentName(newName: string): string {
  if (
    newName.length === 0
    || newName !== newName.trim()
    || newName === '.'
    || newName === '..'
    || newName.includes('/')
    || newName.includes('\\')
    || newName.includes(NUL)
  ) {
    throw new RemoteError('gateway/bad-request', `"${newName}" must be a single path segment`, {})
  }
  return newName
}

/**
 * One numstat field as a line count: a decimal count, or 0 when git reports the
 * change as binary (`-`).
 * @param text - the additions or deletions field of one numstat line.
 * @returns the parsed count, or 0 when the field is not a number.
 */
function lineCount(text: string): number {
  const count = Number(text)
  return Number.isFinite(count) ? count : 0
}

/**
 * One field of a split line, empty when the line carried fewer fields.
 * @param fields - the line split on its separator.
 * @param index - zero-based field index.
 * @returns the field, or an empty string when the line is short.
 */
function field(fields: readonly string[], index: number): string {
  return fields[index] ?? ''
}

/**
 * Parse the stdout of the `git log` invocation `history` runs: one entry per
 * commit, in git's output order. A record line carries five unit-separated
 * fields, and the tab-separated numstat lines that follow it — one per changed
 * path, or none — supply the line counts. Blank lines separate records and are
 * ignored.
 * @param stdout - complete raw stdout of `git log --format=… --numstat`.
 * @returns one entry per record, in the order git printed them.
 */
export function parseGitLog(stdout: string): WorkspaceFileHistoryEntry[] {
  const entries: WorkspaceFileHistoryEntry[] = []
  let record: {
    hash: string
    shortHash: string
    author: string
    date: string
    subject: string
    additions: number
    deletions: number
  } | undefined
  for (const line of stdout.split('\n')) {
    if (line.includes(GIT_LOG_FIELD_SEPARATOR)) {
      const fields = line.split(GIT_LOG_FIELD_SEPARATOR)
      record = {
        hash: field(fields, 0),
        shortHash: field(fields, 1),
        author: field(fields, 2),
        date: field(fields, 3),
        subject: fields.slice(4).join(GIT_LOG_FIELD_SEPARATOR),
        additions: 0,
        deletions: 0,
      }
      entries.push(record)
      continue
    }
    const counts = line.split('\t')
    if (record === undefined || counts.length < 3) continue
    record.additions += lineCount(field(counts, 0))
    record.deletions += lineCount(field(counts, 1))
  }
  return entries
}

/**
 * Cut lines `offset` through `offset + limit - 1` from decoded chunks, stopping
 * at the first character past the page so the rest of the file is never read.
 * Lines before the page are counted, not kept, and the page is refused the
 * moment its bytes exceed `maxBytes`, so one giant line cannot grow memory past
 * the cap either.
 */
async function cutPage(
  chunks: AsyncIterable<string>,
  offset: number,
  limit: number,
  maxBytes: number,
  path: string,
): Promise<Page> {
  const last = offset + limit - 1
  const lines: string[] = []
  let current = ''
  let bytes = 0
  let lineNumber = 1
  const admit = (size: number): void => {
    bytes += size
    if (bytes > maxBytes) {
      throw new RemoteError(
        'workspace-file/too-large',
        `lines ${offset}-${last} of "${path}" exceed the ${maxBytes} byte cap`,
        { path, limit: maxBytes },
      )
    }
  }
  const complete = (): void => {
    if (lines.length > 0) admit(1)
    lines.push(current)
    current = ''
  }
  for await (const chunk of chunks) {
    let position = 0
    while (position < chunk.length) {
      if (lineNumber > last) return { text: lines.join('\n'), lines: lines.length, eof: false }
      const newline = chunk.indexOf('\n', position)
      const segment = newline === -1 ? chunk.slice(position) : chunk.slice(position, newline)
      if (lineNumber >= offset) {
        admit(Buffer.byteLength(segment, 'utf8'))
        current += segment
      }
      if (newline === -1) break
      if (lineNumber >= offset) complete()
      lineNumber += 1
      position = newline + 1
    }
  }
  // Only an in-page line can be pending here: earlier lines were never kept,
  // and a character past the page returned above.
  if (current.length > 0) complete()
  return { text: lines.join('\n'), lines: lines.length, eof: true }
}

/**
 * Workspace path of `target` relative to `root`, derived from the two canonical
 * `file:` URIs so the answer is `/`-joined on every platform. Empty for the root.
 */
function workspacePathOf(rootUrl: string, targetUrl: string): string {
  const root = new URL(rootUrl).pathname.replace(/\/+$/, '')
  const target = new URL(targetUrl).pathname
  if (target === root) return ''
  return target.slice(root.length + 1).split('/').map(decodeURIComponent).join('/')
}

/**
 * The path implementation matching one backend process path: POSIX when the
 * path is `/`-rooted, Windows otherwise. The host platform may differ from the
 * execution platform the process path belongs to.
 * @param absolute - an absolute path in the filesystem's execution world.
 * @returns the matching `node:path` implementation.
 */
function processPathsFor(absolute: string): typeof posix {
  return absolute.startsWith('/') ? posix : win32
}

/** Strip the resolved child target: the wire carries names and metadata only. */
function directoryEntry(child: FsDirEntry): WorkspaceDirectoryEntry {
  return {
    name: child.name,
    type: child.type,
    ...child.size === undefined ? {} : { size: child.size },
  }
}

/**
 * Host Remote file reads, directory listings, workspace-confined rename and
 * removal, per-file git history, and the instrumented filesystem change feed.
 *
 * `rename` and `delete` are confined to the Session's workspace root and call
 * `node:fs` because the `ctx.fs` seam exposes neither operation; every other
 * path-taking method uses `ctx.fs`, whose access rules then apply.
 */
export class WorkspaceFiles extends TypertRemoteService {
  static inject = ['fs', 'sandboxPolicy', 'sessions', 'typert', 'subprocess']

  static Config: z<Config> = z.object({
    maxBytes: z.number().step(1).min(1).default(2 * 1024 * 1024),
    maxFileBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER - 1).default(32 * 1024 * 1024),
    maxLines: z.number().step(1).min(1).default(5000),
    maxEntries: z.number().step(1).min(1).default(2000),
  })

  private readonly feed: WorkspaceChangeFeed

  /**
   * @param ctx - Host context carrying the filesystem and the sandbox policy.
   * @param config - deployment caps on one page or one listing.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'workspaceFiles')
    this.feed = new WorkspaceChangeFeed(ctx)
    ctx.inject(['sessions', 'typert'], (scope) => {
      scope.typert.lookups.register('workspaceFileScope', {
        parameter: 'workspaceFileScope',
        wire: 'workspaceFileScopeId',
        hostTypeSymbol: '@deepseek-ai/dsh-api-workspace-files#WorkspaceFileScope',
        wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
        resolve: async (sessionId) => {
          const live = scope.sessions.get(sessionId)?.header
          const stored = live === undefined
            ? await scope.get('sessionPersistence')?.stat(sessionId)
            : undefined
          const header = live ?? stored?.header
          if (header === undefined) return undefined
          return {
            sessionId,
            workspaceRoot: header.cwd ?? scope.sandboxPolicy.workspaceRoot,
          }
        },
      })
    })
  }

  /**
   * Read one page of lines from a UTF-8 file readable by the filesystem backend.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - absolute path or path relative to the workspace root; files outside it are allowed.
   * @param range - the line window; omitted fields take the page defaults.
   * @param signal - caller cancellation.
   * @returns the page, the file's version at the stat before it, and whether it reaches the last line.
   */
  @Remote
  async read(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    range: WorkspaceFileRange,
    signal: AbortSignal,
  ): Promise<WorkspaceFileText> {
    const { offset, limit } = this.resolvePage(range)
    const { target, info } = await this.locateFile(workspaceFileScope, path, signal)
    const page = await this.cutPage(target, offset, limit, signal, path)
    if (page.text.includes(NUL)) {
      throw new RemoteError('workspace-file/not-text', `"${path}" contains NUL bytes`, { path })
    }
    return { ...this.statOf(target, info), offset, text: page.text, lines: page.lines, eof: page.eof }
  }

  /**
   * Read one byte window of a regular file readable by the filesystem backend: raw
   * bytes, no text decoding and no binary rejection.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - absolute path or path relative to the workspace root; files outside it are allowed.
   * @param range - the byte window; omitted fields take the window defaults.
   * @param signal - caller cancellation.
   * @returns the window in base64, the file's version and size at the stat before it, and whether it reaches the last byte.
   */
  @Remote
  async readBytes(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    range: WorkspaceByteRange,
    signal: AbortSignal,
  ): Promise<WorkspaceFileBytes> {
    const { offset, length } = this.resolveWindow(range, path)
    const { target, info } = await this.locateFile(workspaceFileScope, path, signal)
    const data = await this.ctx.fs.readByteRange(target, { offset, length }, signal)
    const eof = info.size === undefined ? data.length < length : offset + data.length >= info.size
    return { ...this.statOf(target, info), offset, data: Buffer.from(data).toString('base64'), eof }
  }

  /**
   * Read a complete regular file as bytes, subject to the configured full-file cap.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - absolute or workspace-relative file path.
   * @param signal - caller cancellation.
   * @returns one complete base64 window with offset zero and eof true; oversized files fail with too-large.
   */
  @Remote
  async readAll(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<WorkspaceFileBytes> {
    const { target, info } = await this.locateFile(workspaceFileScope, path, signal)
    const limit = this.config.maxFileBytes
    if (info.size !== undefined && info.size > limit) {
      throw new RemoteError('workspace-file/too-large', `"${path}" exceeds the ${limit} byte full-file cap`, { path, limit })
    }
    const data = await this.ctx.fs.readByteRange(target, { offset: 0, length: limit + 1 }, signal)
    if (data.length > limit) {
      throw new RemoteError('workspace-file/too-large', `"${path}" exceeds the ${limit} byte full-file cap`, { path, limit })
    }
    return { ...this.statOf(target, info), offset: 0, data: Buffer.from(data).toString('base64'), eof: true }
  }

  /**
   * Read a complete file relative to another file's directory, including outside the workspace.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - base file, absolute or workspace-relative.
   * @param relativePath - relative filesystem path, not a URL or absolute path.
   * @param signal - caller cancellation.
   * @returns the complete related file using the ordinary file-size and access checks.
   */
  @Remote
  async readRelated(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    relativePath: string,
    signal: AbortSignal,
  ): Promise<WorkspaceFileBytes> {
    const relative = relativePath.replace(/\\/g, '/')
    if (relative.length === 0 || relative.startsWith('/') || /^[a-z][a-z\d+.-]*:/iu.test(relative) || relative.includes(NUL)) {
      throw new RemoteError('gateway/bad-request', 'relativePath must be a relative filesystem path', {})
    }
    const { target } = await this.locateFile(workspaceFileScope, path, signal)
    const absolute = this.ctx.fs.processPath(target)
    const paths = processPathsFor(absolute)
    return this.readAll(workspaceFileScope, paths.resolve(paths.dirname(absolute), relative), signal)
  }

  /**
   * Report one regular file's identity, version, and size without its content.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - absolute path or path relative to the workspace root; files outside it are allowed.
   * @param signal - caller cancellation.
   * @returns the file's absolute path, current version, and byte size.
   */
  @Remote
  async stat(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<WorkspaceFileStat> {
    const { target, info } = await this.locateFile(workspaceFileScope, path, signal)
    return this.statOf(target, info)
  }

  /**
   * List the direct children of one existing directory readable by the
   * filesystem backend, anywhere that backend can reach.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - absolute path or path relative to the workspace root; directories outside it are allowed.
   * @param signal - caller cancellation.
   * @returns the directory's children in the backend's stable name order, bounded by the entry
   *   cap, and the listed directory as a workspace path or, outside the root, as its absolute path.
   */
  @Remote
  async list(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<WorkspaceDirectoryListing> {
    const { root, workspaceRoot, entry } = await this.inspect(workspaceFileScope, path, signal)
    if (entry.type !== 'directory') {
      throw new RemoteError(
        'workspace-file/not-directory',
        `"${path}" is a ${entry.type}`,
        { path, kind: entry.type },
      )
    }
    const target = await this.ctx.fs.resolve(path, { cwd: workspaceRoot, signal })
    const children = await this.ctx.fs.listDir(target, signal)
    return {
      path: this.listingPathOf(root, target),
      entries: children.slice(0, this.config.maxEntries).map(directoryEntry),
      truncated: children.length > this.config.maxEntries,
    }
  }

  /**
   * Rename one entry inside the Session's workspace to a new name in the same
   * directory. The rename itself runs through `node:fs`, because the `ctx.fs`
   * seam exposes no rename operation; the destination directory is still
   * checked with `ctx.fs`.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - absolute path or path relative to the workspace root of the entry to rename.
   * @param newName - the entry's new name: one path segment, without separators, `.` or `..`.
   * @param signal - caller cancellation.
   * @returns the renamed entry's absolute path.
   */
  @Remote
  async rename(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    newName: string,
    signal: AbortSignal,
  ): Promise<WorkspaceFileMutation> {
    const name = segmentName(newName)
    const { root, workspaceRoot } = await this.inspect(workspaceFileScope, path, signal)
    const source = await this.ctx.fs.resolve(path, { cwd: workspaceRoot, signal })
    const absolute = this.ctx.fs.processPath(source)
    const paths = processPathsFor(absolute)
    const directory = paths.dirname(absolute)
    const parent = await this.ctx.fs.resolve(directory, { cwd: workspaceRoot, signal })
    if (!this.ctx.fs.contains(root, parent)) {
      throw new RemoteError('workspace-file/outside-workspace', `"${path}" is outside the workspace`, { path })
    }
    const destination = paths.join(directory, name)
    await rename(absolute, destination)
    return { absolutePath: destination }
  }

  /**
   * Permanently delete one entry inside the Session's workspace: a regular
   * file, a symlink, or a directory with everything below it. The deletion runs
   * through `node:fs`, because the `ctx.fs` seam exposes no remove operation;
   * the workspace root check still uses `ctx.fs`.
   *
   * The wire name is `delete`, not `remove`: the generated namespace service
   * reserves `remove` for its own member, and a Remote method that shadows it
   * is refused when the namespace installs on the Client.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - absolute path or path relative to the workspace root of the entry to delete.
   * @param signal - caller cancellation.
   * @returns the deleted entry's absolute path.
   */
  @Remote
  async delete(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<WorkspaceFileMutation> {
    const { root, workspaceRoot } = await this.inspect(workspaceFileScope, path, signal)
    const target = await this.confine(root, workspaceRoot, path, signal)
    if (this.ctx.fs.fileUrl(target) === this.ctx.fs.fileUrl(root)) {
      throw new RemoteError('gateway/bad-request', 'the workspace root cannot be removed', {})
    }
    const absolute = this.ctx.fs.processPath(target)
    await rm(absolute, { recursive: true, force: false })
    return { absolutePath: absolute }
  }

  /**
   * Report one file's git history, newest commit first, by running `git log`
   * through the subprocess seam. The file may be inside or outside the
   * workspace. A directory that is not a repository, a file git never
   * committed, and a missing git executable all report an empty history
   * instead of failing; caller cancellation still propagates.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - absolute path or path relative to the workspace root of the file.
   * @param signal - caller cancellation.
   * @returns the file's absolute path and its commits, empty when git reports none.
   */
  @Remote
  async history(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<WorkspaceFileHistory> {
    const { target } = await this.locateFile(workspaceFileScope, path, signal)
    const absolute = this.ctx.fs.processPath(target)
    const paths = processPathsFor(absolute)
    return { path: absolute, entries: await this.gitLog(paths.dirname(absolute), paths.basename(absolute), signal) }
  }

  /**
   * Stream every `fs/observed` observation of a file inside the Session's
   * workspace. Only instrumented filesystem operations report here; the OS is
   * not watched.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param signal - generation cancellation.
   * @returns `ready` once the Host observation queue is active and the workspace
   *   root is resolved, then queued and live observations in emission order.
   */
  @Remote({ mode: 'stream' })
  changes(workspaceFileScope: WorkspaceFileScope, signal: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame> {
    return this.feed.follow(workspaceFileScope.workspaceRoot, signal)
  }

  /** Apply the page defaults and caps here, so the request never carries them implicitly. */
  private resolvePage(range: WorkspaceFileRange): { offset: number; limit: number } {
    const offset = range.offset === undefined ? 1 : integerAtLeast(range.offset, 1, 'offset')
    const limit = range.limit === undefined ? this.config.maxLines : integerAtLeast(range.limit, 1, 'limit')
    if (limit > this.config.maxLines) {
      throw new RemoteError('gateway/bad-request', `limit must be at most ${this.config.maxLines}`, {})
    }
    return { offset, limit }
  }

  /** Apply the byte-window defaults and cap; a window above the cap is refused, not shortened. */
  private resolveWindow(range: WorkspaceByteRange, path: string): { offset: number; length: number } {
    const offset = range.offset === undefined ? 0 : integerAtLeast(range.offset, 0, 'offset')
    const length = range.length === undefined ? this.config.maxBytes : integerAtLeast(range.length, 1, 'length')
    if (offset + length > Number.MAX_SAFE_INTEGER) {
      throw new RemoteError('gateway/bad-request', 'offset plus length must stay a safe integer', {})
    }
    if (length > this.config.maxBytes) {
      throw new RemoteError(
        'workspace-file/too-large',
        `${length} bytes of "${path}" exceed the ${this.config.maxBytes} byte cap`,
        { path, limit: this.config.maxBytes },
      )
    }
    return { offset, length }
  }
  /**
   * Inspect the requested path itself before resolution follows its final
   * component. Containment is checked separately by the two mutations.
   */
  private async inspect(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    signal: AbortSignal,
  ): Promise<{ root: FsTarget; workspaceRoot: string; entry: FsPathInfo }> {
    if (path.length === 0) throw new RemoteError('gateway/bad-request', 'path is required', {})
    const { workspaceRoot } = workspaceFileScope
    const root = await this.ctx.fs.resolve(workspaceRoot, { signal })
    // Gate on the path itself before anything follows it.
    const entry = await this.ctx.fs.lstat(path, { cwd: workspaceRoot }, signal)
    if (entry === undefined) {
      throw new RemoteError('workspace-file/not-found', `no entry at "${path}"`, { path })
    }
    return { root, workspaceRoot, entry }
  }

  /** Resolve an inspected path and refuse it unless the workspace contains it. */
  private async confine(root: FsTarget, workspaceRoot: string, path: string, signal: AbortSignal): Promise<FsTarget> {
    const target = await this.ctx.fs.resolve(path, { cwd: workspaceRoot, signal })
    if (!this.ctx.fs.contains(root, target)) {
      throw new RemoteError('workspace-file/outside-workspace', `"${path}" is outside the workspace`, { path })
    }
    return target
  }

  /**
   * The listed directory's workspace path when the workspace root contains it,
   * and its absolute path otherwise, so a listing outside the root stays
   * addressable.
   */
  private listingPathOf(root: FsTarget, target: FsTarget): string {
    return this.ctx.fs.contains(root, target)
      ? workspacePathOf(this.ctx.fs.fileUrl(root), this.ctx.fs.fileUrl(target))
      : this.ctx.fs.processPath(target)
  }

  /**
   * Run one bounded `git log` for a file and parse it. Every failure that is
   * not caller cancellation reports an empty history: a directory outside a
   * repository, a path git never committed, and a missing git executable are
   * ordinary answers for a timeline, not service failures.
   * @param directory - the file's directory, used as both the working directory and the `-C` argument.
   * @param name - the file's basename, the pathspec after `--`.
   * @param signal - caller cancellation; an abort propagates instead of reporting an empty history.
   * @returns the parsed commits, newest first.
   */
  private async gitLog(directory: string, name: string, signal: AbortSignal): Promise<WorkspaceFileHistoryEntry[]> {
    let handle: SubprocessHandle
    try {
      handle = this.ctx.subprocess.spawn({
        argv: [
          'git', '-C', directory, 'log', '--follow', '-n', String(GIT_LOG_LIMIT),
          '--date=iso-strict', `--format=${GIT_LOG_FORMAT}`, '--numstat', '--', name,
        ],
        cwd: directory,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: GIT_LOG_MAX_BYTES },
          stderr: { maxBytes: GIT_LOG_STDERR_MAX_BYTES },
        },
        graceMs: GIT_LOG_GRACE_MS,
        signal,
      } satisfies SubprocessSpawnSpec)
    } catch (error: unknown) {
      if (signal.aborted) throw error
      return []
    }
    let outcome: SubprocessOutcome
    try {
      outcome = await handle.done
    } catch (error: unknown) {
      if (signal.aborted) throw error
      return []
    }
    if (signal.aborted) throw signal.reason
    const stdout = handle.collected.stdout?.readFrom(0)
    if (outcome.exitCode !== 0 || stdout === undefined || stdout.lossy) return []
    return parseGitLog(stdout.text)
  }

  /**
   * All gates for a regular file, ending in the one stat that names its version
   * and size. The stat re-checks what `lstat` saw: the file may have gone or
   * changed kind in between.
   */
  private async locateFile(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    signal: AbortSignal,
  ): Promise<{ target: FsTarget; info: FsInfo }> {
    const { workspaceRoot, entry } = await this.inspect(workspaceFileScope, path, signal)
    if (entry.type !== 'file') {
      throw new RemoteError('workspace-file/not-regular-file', `"${path}" is a ${entry.type}`, { path, kind: entry.type })
    }
    const target = await this.ctx.fs.resolve(path, { cwd: workspaceRoot, signal })
    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) {
      throw new RemoteError('workspace-file/not-found', `no entry at "${path}"`, { path })
    }
    if (info.type !== 'file') {
      throw new RemoteError('workspace-file/not-regular-file', `"${path}" is a ${info.type}`, { path, kind: info.type })
    }
    return { target, info }
  }

  private statOf(target: FsTarget, info: FsInfo): WorkspaceFileStat {
    return {
      absolutePath: this.ctx.fs.processPath(target),
      version: info.version,
      ...info.size === undefined ? {} : { bytes: info.size },
    }
  }

  /** Stream the file as text and cut the page, classifying the backend's non-text refusal. */
  private async cutPage(target: FsTarget, offset: number, limit: number, signal: AbortSignal, path: string): Promise<Page> {
    try {
      return await cutPage(await this.ctx.fs.streamText(target, signal), offset, limit, this.config.maxBytes, path)
    } catch (error: unknown) {
      if (isNotTextRefusal(error)) {
        throw new RemoteError('workspace-file/not-text', `"${path}" is not UTF-8 text`, { path }, { cause: error })
      }
      throw error
    }
  }
}

/**
 * The backend's non-text refusal, recognized by its code alone: the error class
 * belongs to whichever `dsh-fs` instance the provider loaded, so no class
 * identity is shared across the package boundary.
 */
function isNotTextRefusal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'FS_NOT_TEXT'
}

export default WorkspaceFiles
