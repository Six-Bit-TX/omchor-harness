// @vitest-environment jsdom
/**
 * The row context menu, driven by props alone.
 *
 * What is asserted is which rows a reader is offered for each kind of entry and
 * which action a row reports: a file carries open, compare, timeline, copy,
 * download, rename, and delete; a directory and any other non-file target drop
 * the file-only rows but keep open as a disabled row; `compareWith` waits for a
 * compare base that is not the entry itself; and a chosen row reports its own
 * action id.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { EntryMenu } from '../src/client/EntryMenu.tsx'
import type { EntryMenuAction, EntryTarget } from '../src/client/EntryMenu.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)
const FILE: EntryTarget = { path: '/work/app/a.ts', name: 'a.ts', kind: 'file', x: 12, y: 24 }
const DIRECTORY: EntryTarget = { path: '/work/app/src', name: 'src', kind: 'directory', x: 12, y: 24 }
const OTHER_PATH = '/work/app/b.ts'

/** Every row a file without a compare base offers, in menu order. */
const FILE_ACTIONS = [
  t('menu.open'),
  t('menu.compareSelect'),
  t('menu.timeline'),
  t('menu.copyPath'),
  t('menu.copyRelativePath'),
  t('menu.download'),
  t('menu.rename'),
  t('menu.delete'),
]

/** Mount one entry's menu with recording gestures. */
function setup(target: EntryTarget, compareBase: string | null = null) {
  const onSelect = vi.fn<(action: EntryMenuAction) => void>()
  const onClose = vi.fn<() => void>()
  render(<EntryMenu target={target} compareBase={compareBase} t={t} onSelect={onSelect} onClose={onClose} />)
  return { onSelect, onClose }
}

/** The menu's rows, in document order. */
function labels(): (string | null)[] {
  return screen.getAllByRole('menuitem').map(item => item.textContent)
}

describe('EntryMenu', () => {
  it('offers a file its open, compare, timeline, copy, download, rename, and delete rows in order', () => {
    setup(FILE)
    expect(labels()).toEqual(FILE_ACTIONS)
    expect(screen.getByRole('menuitem', { name: t('menu.open') }).hasAttribute('disabled')).toBe(false)
  })

  it('holds a directory to the non-file rows and keeps open visible but disabled', () => {
    setup(DIRECTORY)
    expect(labels()).toEqual([
      t('menu.open'),
      t('menu.copyPath'),
      t('menu.copyRelativePath'),
      t('menu.rename'),
      t('menu.delete'),
    ])
    expect(screen.getByRole('menuitem', { name: t('menu.open') }).hasAttribute('disabled')).toBe(true)
  })

  it('adds the compare-with row once another file is the compare base', () => {
    setup(FILE, OTHER_PATH)
    expect(labels()).toEqual([
      t('menu.open'),
      t('menu.compareSelect'),
      t('menu.compareWith'),
      t('menu.timeline'),
      t('menu.copyPath'),
      t('menu.copyRelativePath'),
      t('menu.download'),
      t('menu.rename'),
      t('menu.delete'),
    ])
  })

  it('leaves the compare-with row out when no base is set or the entry is its own base', () => {
    setup(FILE)
    expect(labels()).not.toContain(t('menu.compareWith'))
    cleanup()
    setup(FILE, FILE.path)
    expect(labels()).not.toContain(t('menu.compareWith'))
  })

  it('reports the action id of the row that was picked', () => {
    const { onSelect } = setup(FILE, OTHER_PATH)
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.open') }))
    expect(onSelect).toHaveBeenLastCalledWith('open')
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.compareWith') }))
    expect(onSelect).toHaveBeenLastCalledWith('compareWith')
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.download') }))
    expect(onSelect).toHaveBeenLastCalledWith('download')
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.delete') }))
    expect(onSelect).toHaveBeenLastCalledWith('delete')
    expect(onSelect).toHaveBeenCalledTimes(4)
  })

  it('reports a directory row by its own action id', () => {
    const { onSelect } = setup(DIRECTORY)
    fireEvent.click(screen.getByRole('menuitem', { name: t('menu.rename') }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('rename')
  })

  it('dismisses on Escape', () => {
    const { onClose } = setup(FILE)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
