// @vitest-environment jsdom
/**
 * The mutation, compare, and timeline dialogs, driven by props alone.
 *
 * What is asserted is what each dialog shows and which gesture it reports: a
 * rename stays unavailable until the typed name is a changed, usable segment; a
 * delete names the entry it would remove; a comparison waits for both pages,
 * draws their diff, and says when a page was cut; a timeline names the file, its
 * waiting and empty states, one row per commit, and the failure lines a refused
 * gesture shows in place of its result.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceFileHistory, WorkspaceFileHistoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import { CompareDialog } from '../src/client/CompareDialog.tsx'
import { DeleteDialog } from '../src/client/DeleteDialog.tsx'
import { RenameDialog } from '../src/client/RenameDialog.tsx'
import { TimelineDialog } from '../src/client/TimelineDialog.tsx'
import type { FilePage } from '../src/client/face.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

/** One Remote read the spec settles by hand, flushing React after it lands. */
function deferred<T>(): { promise: Promise<T>; settle: (value: T) => Promise<void> } {
  const { promise, resolve } = Promise.withResolvers<T>()
  return {
    promise,
    settle: async (value) => {
      resolve(value)
      await act(async () => {})
    },
  }
}

describe('RenameDialog', () => {
  const NAME = 'README.md'

  function setup(onConfirm: (newName: string) => Promise<string | null>) {
    const confirm = vi.fn<(newName: string) => Promise<string | null>>(onConfirm)
    const close = vi.fn<() => void>()
    render(<RenameDialog name={NAME} t={t} onConfirm={confirm} onClose={close} />)
    const dialog = screen.getByRole('dialog')
    const input = dialog.querySelector<HTMLInputElement>('[data-rename-input]')!
    const button = dialog.querySelector<HTMLButtonElement>('[data-rename-confirm]')!
    return { confirm, close, input, button }
  }

  it('keeps confirm disabled until the name is a changed, usable segment', () => {
    const { input, button, confirm } = setup(async () => null)
    expect(input.value).toBe(NAME)
    expect(button.disabled).toBe(true)

    fireEvent.change(input, { target: { value: '   ' } })
    expect(button.disabled).toBe(true)
    expect(screen.getByText(zh['rename.invalid'])).not.toBeNull()

    fireEvent.change(input, { target: { value: 'a/b' } })
    expect(button.disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'a\\b' } })
    expect(button.disabled).toBe(true)

    fireEvent.change(input, { target: { value: 'CHANGELOG.md' } })
    expect(button.disabled).toBe(false)
    expect(screen.queryByText(zh['rename.invalid'])).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('confirms the typed name and closes when the rename is accepted', async () => {
    const { input, button, confirm, close } = setup(async () => null)
    fireEvent.change(input, { target: { value: 'CHANGELOG.md' } })
    fireEvent.click(button)
    await act(async () => {})
    expect(confirm).toHaveBeenCalledExactlyOnceWith('CHANGELOG.md')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('keeps the typed name and shows the failure line when the Host refuses', async () => {
    const line = t('error.actionFailed', { message: 'read-only' })
    const { input, button, close } = setup(async () => line)
    fireEvent.change(input, { target: { value: 'CHANGELOG.md' } })
    fireEvent.click(button)
    await act(async () => {})
    expect(screen.getByText(line)).not.toBeNull()
    expect(input.value).toBe('CHANGELOG.md')
    expect(close).not.toHaveBeenCalled()
  })
})

describe('DeleteDialog', () => {
  const NAME = 'README.md'

  function setup(onConfirm: () => Promise<string | null>) {
    const confirm = vi.fn<() => Promise<string | null>>(onConfirm)
    const close = vi.fn<() => void>()
    render(<DeleteDialog name={NAME} t={t} onConfirm={confirm} onClose={close} />)
    const button = screen.getByRole('dialog').querySelector<HTMLButtonElement>('[data-delete-confirm]')!
    return { confirm, close, button }
  }

  it('names the entry and removes it on confirm', async () => {
    const { confirm, close, button } = setup(async () => null)
    expect(screen.getByText(t('delete.description', { name: NAME }))).not.toBeNull()
    fireEvent.click(button)
    await act(async () => {})
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('shows the failure line and keeps the dialog when the Host refuses', async () => {
    const line = t('error.actionFailed', { message: 'permission denied' })
    const { close, button } = setup(async () => line)
    fireEvent.click(button)
    await act(async () => {})
    expect(screen.getByText(line)).not.toBeNull()
    expect(close).not.toHaveBeenCalled()
  })
})

describe('CompareDialog', () => {
  const BASE = '/work/app/a.ts'
  const TARGET = '/work/app/b.ts'

  function setup() {
    const base = deferred<RemoteResult<FilePage>>()
    const target = deferred<RemoteResult<FilePage>>()
    const readPage = vi.fn<(path: string) => Promise<RemoteResult<FilePage>>>(
      path => (path === BASE ? base.promise : target.promise))
    const close = vi.fn<() => void>()
    render(<CompareDialog base={BASE} target={TARGET} t={t} readPage={readPage} onClose={close} />)
    return { base, target, readPage, close }
  }

  it('reads both sides and waits for both before drawing anything', async () => {
    const { base, readPage } = setup()
    expect(readPage.mock.calls.map(call => call[0])).toEqual([BASE, TARGET])
    expect(screen.getByText(t('compare.paths', { base: BASE, target: TARGET }))).not.toBeNull()
    expect(screen.getByText(zh.loading)).not.toBeNull()

    await base.settle({ ok: true, value: { text: 'first\n', eof: true } })
    expect(screen.getByText(zh.loading)).not.toBeNull()
    expect(document.querySelector('[data-diff]')).toBeNull()
  })

  it('draws the diff of both pages once they have landed', async () => {
    const { base, target } = setup()
    await base.settle({ ok: true, value: { text: 'first\n', eof: true } })
    await target.settle({ ok: true, value: { text: 'second\n', eof: true } })

    expect(screen.queryByText(zh.loading)).toBeNull()
    const diff = document.querySelector('[data-diff]')
    expect(diff?.textContent).toContain(TARGET)
    expect(diff?.textContent).toContain('second')
    expect(document.querySelector('[data-compare-truncated]')).toBeNull()
  })

  it('says so when the Host cut either page', async () => {
    const { base, target } = setup()
    await base.settle({ ok: true, value: { text: 'first\n', eof: false } })
    await target.settle({ ok: true, value: { text: 'second\n', eof: true } })
    expect(screen.getByText(zh['compare.truncated'])).not.toBeNull()
    expect(document.querySelector('[data-diff]')).not.toBeNull()
  })

  it('reports a failed read in place of the diff', async () => {
    const { base } = setup()
    await base.settle({ ok: false, error: new RemoteError('workspace-file/not-found', 'gone', { path: BASE }) })
    expect(screen.getByText(t('error.actionFailed', { message: 'gone' }))).not.toBeNull()
    expect(document.querySelector('[data-diff]')).toBeNull()
    expect(screen.queryByText(zh.loading)).toBeNull()
  })
})

describe('TimelineDialog', () => {
  const FILE = '/work/app/a.ts'
  const ENTRIES: readonly WorkspaceFileHistoryEntry[] = [
    {
      hash: 'a'.repeat(40), shortHash: 'aaaaaaa', author: 'Ada', date: '2024-05-06T07:08:09Z',
      subject: 'first commit', additions: 3, deletions: 1,
    },
    {
      hash: 'b'.repeat(40), shortHash: 'bbbbbbb', author: 'Lin', date: '2024-06-07T08:09:10Z',
      subject: 'second commit', additions: 0, deletions: 0,
    },
  ]

  function setup() {
    const read = deferred<RemoteResult<WorkspaceFileHistory>>()
    const loadHistory = vi.fn<(path: string) => Promise<RemoteResult<WorkspaceFileHistory>>>(() => read.promise)
    const close = vi.fn<() => void>()
    render(<TimelineDialog path={FILE} t={t} loadHistory={loadHistory} onClose={close} />)
    return { read, loadHistory, close }
  }

  it('names the file and reads its history while the answer is pending', () => {
    const { loadHistory } = setup()
    expect(loadHistory).toHaveBeenCalledExactlyOnceWith(FILE)
    expect(document.querySelector('[data-timeline-path]')?.textContent).toBe(FILE)
    expect(screen.getByText(zh.loading)).not.toBeNull()
  })

  it('says the file has no history when the answer carries no commit', async () => {
    const { read } = setup()
    await read.settle({ ok: true, value: { path: FILE, entries: [] } })
    expect(screen.getByText(zh['timeline.empty'])).not.toBeNull()
    expect(document.querySelectorAll('[data-timeline-entry]')).toHaveLength(0)
  })

  it('draws one row per commit with its subject, author, and counted change', async () => {
    const { read } = setup()
    await read.settle({ ok: true, value: { path: FILE, entries: ENTRIES } })
    const rows = [...document.querySelectorAll('[data-timeline-entry]')]
    expect(rows.map(row => row.getAttribute('data-timeline-entry'))).toEqual(['aaaaaaa', 'bbbbbbb'])
    expect(rows[0]?.textContent).toContain('first commit')
    expect(rows[0]?.textContent).toContain('Ada')
    expect(rows[1]?.textContent).toContain('second commit')
    expect(rows[1]?.textContent).toContain('Lin')
    expect(rows[0]?.querySelector('[data-timeline-counts]')?.textContent)
      .toBe(t('timeline.counts', { additions: 3, deletions: 1 }))
    // A commit git reports as binary has no counted lines to show.
    expect(rows[1]?.querySelector('[data-timeline-counts]')).toBeNull()
  })

  it('reports a failed history read', async () => {
    const { read } = setup()
    await read.settle({ ok: false, error: new RemoteError('workspace-file/not-found', 'gone', { path: FILE }) })
    expect(screen.getByText(t('error.actionFailed', { message: 'gone' }))).not.toBeNull()
    expect(screen.queryByText(zh.loading)).toBeNull()
    expect(document.querySelector('[data-timeline-empty]')).toBeNull()
  })
})
