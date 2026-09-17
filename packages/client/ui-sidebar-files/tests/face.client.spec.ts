/**
 * The tree's asynchronous half against a scripted listing, and the Remote
 * adapter under it.
 *
 * The face's contract is what reaches the store and when: a level is `loading`
 * before the listing settles, `ready` or `failed` after, never written once the
 * owner's signal aborted or a newer listing of the level was asked for, and a
 * tab whose record is gone leaves no bucket behind. The adapter's is what each
 * Remote call keeps and what it drops: entries and the truncation flag reach the
 * store, a page drops the stat it travels with, a download names the file the
 * browser offers, the mutations keep the Host's absolute path, and a failure
 * passes through untouched.
 */
import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  WorkspaceDirectoryListing, WorkspaceFileBytes, WorkspaceFileHistory, WorkspaceFileText,
} from '@deepseek-ai/dsh-api-workspace-files/types'
import { childPath, createFilesRemote, filesFace } from '../src/client/face.ts'
import type { WorkspaceFilesRemote } from '../src/client/face.ts'
import { createFilesStore } from '../src/client/store.ts'
import type { DirLevel } from '../src/client/store.ts'
import { opsOf, scriptedOps } from './scripted-ops.client.ts'
import { scriptedList } from './scripted-list.client.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'

const SESSION = 's-1' as SessionId
const ROOT = '/work/app'
const TAB = 'tab-1' as TabId

const LEVEL: DirLevel = { entries: [{ name: 'src', type: 'directory' }], truncated: false }

function mount() {
  const instance = createFilesStore().create()
  const script = scriptedList()
  const ops = scriptedOps(script.list)
  const face = filesFace(opsOf(ops), () => undefined)(SESSION, instance.actions)
  return { ...script, ops, face, snapshot: () => instance.getSnapshot().byTab[TAB] }
}

describe('filesFace', () => {
  it('start seeds the tab and lists the root with the session and the absolute root path', async () => {
    const { face, list, settle, snapshot } = mount()
    const controller = new AbortController()
    face.start(TAB, ROOT, controller.signal)
    expect(list).toHaveBeenCalledWith(SESSION, ROOT, controller.signal)
    expect(snapshot()!.levels[ROOT]).toEqual({ kind: 'loading' })
    await settle({ ok: true, value: LEVEL })
    expect(snapshot()!.levels[ROOT]).toEqual({ kind: 'ready', level: LEVEL })
  })

  it('records a failed listing under its level', async () => {
    const { face, settle, snapshot } = mount()
    face.start(TAB, ROOT, new AbortController().signal)
    const error = new RemoteError('workspace-file/not-directory', 'not a directory', { path: ROOT, kind: 'file' })
    await settle({ ok: false, error })
    expect(snapshot()!.levels[ROOT]).toEqual({ kind: 'failed', failure: error })
  })

  it('toggle expands and lists a directory the first time, and only toggles afterwards', async () => {
    const { face, list, settle, snapshot } = mount()
    const signal = new AbortController().signal
    const child = `${ROOT}/src`
    face.start(TAB, ROOT, signal)
    await settle({ ok: true, value: LEVEL })
    face.toggle(TAB, child, false, signal)
    expect(list).toHaveBeenLastCalledWith(SESSION, child, signal)
    expect(snapshot()!.expanded).toEqual([ROOT, child])
    await settle({ ok: true, value: LEVEL })
    face.toggle(TAB, child, true, signal)
    expect(snapshot()!.expanded).toEqual([ROOT])
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('navigate re-roots the tab, forgets the old levels, and lists the new root', async () => {
    const { face, list, settle, snapshot } = mount()
    const signal = new AbortController().signal
    face.start(TAB, ROOT, signal)
    await settle({ ok: true, value: LEVEL })
    face.toggle(TAB, `${ROOT}/src`, false, signal)
    face.navigate(TAB, '/elsewhere', signal)
    expect(list).toHaveBeenLastCalledWith(SESSION, '/elsewhere', signal)
    expect(snapshot()!.root).toBe('/elsewhere')
    expect(snapshot()!.expanded).toEqual(['/elsewhere'])
    expect(snapshot()!.levels[ROOT]).toBeUndefined()
    expect(snapshot()!.levels['/elsewhere']).toEqual({ kind: 'loading' })
  })

  it('hands the row gestures back as their settled Remote result', async () => {
    const { face, ops } = mount()
    const signal = new AbortController().signal
    expect(await face.rename(`${ROOT}/a.txt`, 'b.txt', signal)).toEqual({ ok: true, value: { absolutePath: '/work/app/b.txt' } })
    expect(ops.rename).toHaveBeenCalledWith(SESSION, `${ROOT}/a.txt`, 'b.txt', signal)
    expect(await face.remove(`${ROOT}/a.txt`, signal)).toEqual({ ok: true, value: { absolutePath: `${ROOT}/a.txt` } })
    expect(ops.remove).toHaveBeenCalledWith(SESSION, `${ROOT}/a.txt`, signal)
    expect(await face.download(`${ROOT}/a.txt`, signal)).toEqual({ ok: true, value: { name: 'a.txt', base64: 'aGk=' } })
    expect(ops.download).toHaveBeenCalledWith(SESSION, `${ROOT}/a.txt`, signal)
    expect(await face.readPage(`${ROOT}/a.txt`, signal)).toEqual({ ok: true, value: { text: `content of ${ROOT}/a.txt`, eof: true } })
    expect(await face.history(`${ROOT}/a.txt`, signal)).toEqual({ ok: true, value: { path: `${ROOT}/a.txt`, entries: [] } })
    expect(face.homePath()).toBeUndefined()
  })

  it('abort forgets the bucket and a late settlement writes nothing', async () => {
    const { face, settle, snapshot } = mount()
    const controller = new AbortController()
    face.start(TAB, ROOT, controller.signal)
    controller.abort()
    expect(snapshot()).toBeUndefined()
    await settle({ ok: true, value: LEVEL })
    expect(snapshot()).toBeUndefined()
  })

  it('makes no request for a record that already ended', () => {
    const { face, list } = mount()
    const controller = new AbortController()
    controller.abort()
    face.load(TAB, ROOT, controller.signal)
    face.navigate(TAB, '/elsewhere', controller.signal)
    expect(list).not.toHaveBeenCalled()
  })

  it('lets the latest listing of a level win, whichever settles first', async () => {
    const { face, list, settle, settleLatest, snapshot, outstanding } = mount()
    const signal = new AbortController().signal
    const older: DirLevel = { entries: [{ name: 'old.txt', type: 'file' }], truncated: false }
    face.start(TAB, ROOT, signal)
    // The reload gesture asks for the root again while the first listing is still out.
    face.load(TAB, ROOT, signal)
    expect(list).toHaveBeenCalledTimes(2)
    expect(outstanding()).toEqual([ROOT, ROOT])
    await settleLatest({ ok: true, value: LEVEL })
    expect(snapshot()!.levels[ROOT]).toEqual({ kind: 'ready', level: LEVEL })
    // The retired listing lands afterwards and changes nothing.
    await settle({ ok: true, value: older })
    expect(snapshot()!.levels[ROOT]).toEqual({ kind: 'ready', level: LEVEL })
    // A retired failure is dropped the same way.
    face.load(TAB, ROOT, signal)
    face.load(TAB, ROOT, signal)
    await settleLatest({ ok: true, value: LEVEL })
    await settle({ ok: false, error: new RemoteError('workspace-file/not-found', 'gone', { path: ROOT }) })
    expect(snapshot()!.levels[ROOT]).toEqual({ kind: 'ready', level: LEVEL })
  })
})

/** One complete Remote face whose calls all answer, so a spec can re-point the one it exercises. */
function remoteOf() {
  const listing: WorkspaceDirectoryListing = {
    path: 'src',
    entries: [{ name: 'a.ts', type: 'file', size: 3 }],
    truncated: true,
  }
  const page: WorkspaceFileText = { absolutePath: '/work/app/a.ts', version: 'v1', offset: 1, text: 'hi', lines: 1, eof: true }
  const bytes: WorkspaceFileBytes = { absolutePath: '/work/app/a.ts', version: 'v1', offset: 0, data: 'aGk=', eof: true }
  return {
    list: vi.fn<WorkspaceFilesRemote['workspaceFiles']['list']>().mockResolvedValue({ ok: true, value: listing }),
    read: vi.fn<WorkspaceFilesRemote['workspaceFiles']['read']>().mockResolvedValue({ ok: true, value: page }),
    readAll: vi.fn<WorkspaceFilesRemote['workspaceFiles']['readAll']>().mockResolvedValue({ ok: true, value: bytes }),
    rename: vi.fn<WorkspaceFilesRemote['workspaceFiles']['rename']>().mockResolvedValue({ ok: true, value: { absolutePath: '/work/app/b.ts' } }),
    delete: vi.fn<WorkspaceFilesRemote['workspaceFiles']['delete']>().mockResolvedValue({ ok: true, value: { absolutePath: '/work/app/a.ts' } }),
    history: vi.fn<WorkspaceFilesRemote['workspaceFiles']['history']>().mockResolvedValue({
      ok: true,
      value: { path: '/work/app/a.ts', entries: [] } satisfies WorkspaceFileHistory,
    }),
  }
}

describe('createFilesRemote', () => {
  it('passes the session, the absolute path, and the signal through, and keeps entries and truncation', async () => {
    const files = remoteOf()
    const signal = new AbortController().signal
    const result = await createFilesRemote({ workspaceFiles: files }).list(SESSION, `${ROOT}/src`, signal)
    expect(files.list).toHaveBeenCalledWith(SESSION, `${ROOT}/src`, signal)
    expect(result).toEqual({ ok: true, value: { entries: [{ name: 'a.ts', type: 'file', size: 3 }], truncated: true } })
  })

  it('reads one bounded page per compared file and drops the stat it travels with', async () => {
    const files = remoteOf()
    const signal = new AbortController().signal
    const result = await createFilesRemote({ workspaceFiles: files }).readPage(SESSION, `${ROOT}/a.ts`, signal)
    expect(files.read).toHaveBeenCalledWith(SESSION, `${ROOT}/a.ts`, { limit: 2000 }, signal)
    expect(result).toEqual({ ok: true, value: { text: 'hi', eof: true } })
  })

  it('names a download after the file it read', async () => {
    const files = remoteOf()
    const result = await createFilesRemote({ workspaceFiles: files }).download(SESSION, `${ROOT}/a.ts`, new AbortController().signal)
    expect(result).toEqual({ ok: true, value: { name: 'a.ts', base64: 'aGk=' } })
  })

  it('keeps the Host path each mutation reports', async () => {
    const files = remoteOf()
    const signal = new AbortController().signal
    const ops = createFilesRemote({ workspaceFiles: files })
    expect(await ops.rename(SESSION, `${ROOT}/a.ts`, 'b.ts', signal)).toEqual({ ok: true, value: { absolutePath: '/work/app/b.ts' } })
    expect(files.rename).toHaveBeenCalledWith(SESSION, `${ROOT}/a.ts`, 'b.ts', signal)
    // The row gesture is named `remove`; the wire method it calls is `delete`.
    expect(await ops.remove(SESSION, `${ROOT}/a.ts`, signal)).toEqual({ ok: true, value: { absolutePath: '/work/app/a.ts' } })
    expect(files.delete).toHaveBeenCalledWith(SESSION, `${ROOT}/a.ts`, signal)
  })

  it('returns a failure as the endpoint reported it', async () => {
    const files = remoteOf()
    const error = new RemoteError('workspace-file/not-directory', 'file', { path: 'x', kind: 'file' })
    files.list.mockResolvedValue({ ok: false, error })
    const result = await createFilesRemote({ workspaceFiles: files }).list(SESSION, `${ROOT}/x`, new AbortController().signal)
    expect(result).toEqual({ ok: false, error })
  })
})

describe('childPath', () => {
  it('joins with one slash whatever the parent ends in', () => {
    expect(childPath('/work/app', 'src')).toBe('/work/app/src')
    expect(childPath('/work/app/', 'src')).toBe('/work/app/src')
    expect(childPath('/', 'etc')).toBe('/etc')
    expect(childPath('C:\\work\\', 'src')).toBe('C:\\work/src')
  })
})
