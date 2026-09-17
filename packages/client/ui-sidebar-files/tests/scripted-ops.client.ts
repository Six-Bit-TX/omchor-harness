/** The Remote calls a spec settles by hand: the scripted listing, and stubs for the gestures. */
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  FilesRemoteOps, ListWorkspaceDirectory, ReadWorkspaceDownload, ReadWorkspaceHistory, ReadWorkspacePage,
  RemoveWorkspaceEntry, RenameWorkspaceEntry,
} from '../src/client/face.ts'
import type { DirLevel } from '../src/client/store.ts'

/** Every Remote call the tree's face performs, as a recording mock. */
export interface ScriptedOps {
  readonly list: Mock<ListWorkspaceDirectory>
  readonly readPage: Mock<ReadWorkspacePage>
  readonly download: Mock<ReadWorkspaceDownload>
  readonly rename: Mock<RenameWorkspaceEntry>
  readonly remove: Mock<RemoveWorkspaceEntry>
  readonly history: Mock<ReadWorkspaceHistory>
}

/** Adapt the recording mocks to the face's Remote calls. */
export function opsOf(script: ScriptedOps): FilesRemoteOps {
  return script
}

/**
 * Bind the scripted operations to one listing.
 *
 * The listing is the spec's own (it settles by hand); every other call starts
 * with an answer a spec can leave alone and a mock it can re-point.
 * @param list - the scripted listing mock.
 * @returns the operations the face is built from.
 */
export function scriptedOps(list: Mock<ListWorkspaceDirectory>): ScriptedOps {
  return {
    list,
    readPage: vi.fn<ReadWorkspacePage>(async (_session, path) =>
      ({ ok: true, value: { text: `content of ${path}`, eof: true } })),
    download: vi.fn<ReadWorkspaceDownload>(async (_session, path) =>
      ({ ok: true, value: { name: path.slice(path.lastIndexOf('/') + 1), base64: 'aGk=' } })),
    rename: vi.fn<RenameWorkspaceEntry>(async (_session, _path, newName) =>
      ({ ok: true, value: { absolutePath: `/work/app/${newName}` } })),
    remove: vi.fn<RemoveWorkspaceEntry>(async (_session, path) =>
      ({ ok: true, value: { absolutePath: path } })),
    history: vi.fn<ReadWorkspaceHistory>(async (_session, path) =>
      ({ ok: true, value: { path, entries: [] } })),
  }
}

/** The result a scripted call answers with next. */
export type Settled<T> = RemoteResult<T>

/** The listing a spec settles by hand. */
export type ScriptedLevel = DirLevel
