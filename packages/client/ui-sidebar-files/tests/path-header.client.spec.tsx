// @vitest-environment jsdom
/**
 * The header row's address bar and location menu, driven by props alone.
 *
 * What is asserted is what a reader can do: the row draws the root split before
 * its final segment, the path swaps in a field seeded with the root whose Enter
 * lists the expanded address while Escape puts the display back, the folder
 * button lists every Workspace, the session's own directory, the home, and the
 * visits this tab has made, and the reload button asks for a fresh listing.
 * `expandAddress` is checked on its own, including the home it does not know.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { PathHeader, expandAddress } from '../src/client/PathHeader.tsx'
import type { LocationWorkspace, PathHeaderProps } from '../src/client/PathHeader.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)
const ROOT = '/work/app'
const CWD = '/work/cwd'
const HOME = '/home/dev'
const WORKSPACES: readonly LocationWorkspace[] = [
  { id: 'w1', title: '项目一', path: '/work/app' },
  { id: 'w2', title: '其他', path: '/other' },
]

/** Mount the row with recording gestures and whatever a spec overrides. */
function setup(overrides: Partial<PathHeaderProps> = {}) {
  const onNavigate = vi.fn<(path: string) => void>()
  const onReload = vi.fn<() => void>()
  const props: PathHeaderProps = {
    root: ROOT,
    cwd: CWD,
    workspaces: WORKSPACES,
    recent: [],
    home: HOME,
    t,
    onNavigate,
    onReload,
    ...overrides,
  }
  const view = render(<PathHeader {...props} />)
  return { view, onNavigate, onReload }
}

/** Open the location menu from the folder button. */
function openLocations(view: ReturnType<typeof setup>['view']): void {
  fireEvent.click(view.container.querySelector('[data-files-locations]')!)
}

/** The menu's selectable rows, in document order. */
function menuLabels(): (string | null)[] {
  return screen.getAllByRole('menuitem').map(item => item.textContent)
}

/** Open the address field from the path button. */
function openField(view: ReturnType<typeof setup>['view']): HTMLInputElement {
  fireEvent.click(view.container.querySelector('[data-files-path]')!)
  return view.container.querySelector<HTMLInputElement>('[data-files-path-edit]')!
}

describe('expandAddress', () => {
  it('passes an ordinary address through with surrounding whitespace dropped', () => {
    expect(expandAddress('  /work/app  ', HOME)).toBe('/work/app')
    expect(expandAddress('/work/app', undefined)).toBe('/work/app')
  })

  it('resolves a home-relative address against the home directory', () => {
    expect(expandAddress('~', HOME)).toBe(HOME)
    expect(expandAddress('~/', HOME)).toBe(HOME)
    expect(expandAddress('~/notes', HOME)).toBe('/home/dev/notes')
    expect(expandAddress('~\\notes', HOME)).toBe('/home/dev/notes')
    // A trailing separator on the home itself does not double up.
    expect(expandAddress('~/notes', '/home/dev/')).toBe('/home/dev/notes')
    expect(expandAddress('  ~/notes  ', HOME)).toBe('/home/dev/notes')
  })

  it('leaves a home-relative address alone when the home is unknown', () => {
    expect(expandAddress('~', undefined)).toBe('~')
    expect(expandAddress('~/notes', undefined)).toBe('~/notes')
  })

  it('leaves an address alone when the tilde does not start it', () => {
    expect(expandAddress('/work/~backup', HOME)).toBe('/work/~backup')
    expect(expandAddress('~~/notes', HOME)).toBe('~~/notes')
    expect(expandAddress('a~/b', HOME)).toBe('a~/b')
  })
})

describe('PathHeader', () => {
  it('draws the root with its directory part before the final segment', () => {
    const { view } = setup()
    const path = view.container.querySelector('[data-files-path]')
    expect(path?.getAttribute('title')).toBe(ROOT)
    expect([...path?.querySelectorAll('span > span') ?? []].map(span => span.textContent)).toEqual(['/work/', 'app'])
  })

  it('swaps in a field seeded with the root when the path is clicked', () => {
    const { view } = setup()
    const input = openField(view)
    expect(input.value).toBe(ROOT)
    expect(input.getAttribute('aria-label')).toBe(zh['path.input'])
    expect(view.container.querySelector('[data-files-path]')).toBeNull()
  })

  it('navigates to the expanded address on Enter and puts the display back', () => {
    const { view, onNavigate } = setup()
    const input = openField(view)
    fireEvent.change(input, { target: { value: '  ~/notes  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('/home/dev/notes')
    expect(view.container.querySelector('[data-files-path-edit]')).toBeNull()
    expect(view.container.querySelector('[data-files-path]')?.getAttribute('title')).toBe(ROOT)
  })

  it('puts the display back on Escape and navigates nowhere', () => {
    const { view, onNavigate } = setup()
    const input = openField(view)
    fireEvent.change(input, { target: { value: '/work/elsewhere' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onNavigate).not.toHaveBeenCalled()
    expect(view.container.querySelector('[data-files-path-edit]')).toBeNull()
    expect(view.container.querySelector('[data-files-path]')).not.toBeNull()
  })

  it('lists the root again on Enter only when the address changed', () => {
    const { view, onNavigate } = setup()
    const input = openField(view)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNavigate).not.toHaveBeenCalled()
    expect(view.container.querySelector('[data-files-path]')).not.toBeNull()
  })

  it('lists every workspace, the session directory, the home, and the recent visits, and navigates to the one picked', () => {
    const { view, onNavigate } = setup({ recent: ['/work/app/src', '/tmp'] })
    openLocations(view)
    expect(screen.getByText(zh['locations.workspaces'])).not.toBeNull()
    expect(screen.getByText(zh['locations.other'])).not.toBeNull()
    expect(screen.getByText(zh['locations.recent'])).not.toBeNull()
    expect(menuLabels()).toEqual([
      '项目一',
      '其他',
      `${zh['locations.cwd']}${CWD}`,
      `${zh['locations.home']}${HOME}`,
      '/work/app/src',
      '/tmp',
    ])

    fireEvent.click(screen.getByRole('menuitem', { name: '项目一' }))
    expect(onNavigate).toHaveBeenLastCalledWith('/work/app')

    openLocations(view)
    fireEvent.click(screen.getByRole('menuitem', { name: `${zh['locations.cwd']}${CWD}` }))
    expect(onNavigate).toHaveBeenLastCalledWith(CWD)

    openLocations(view)
    fireEvent.click(screen.getByRole('menuitem', { name: `${zh['locations.home']}${HOME}` }))
    expect(onNavigate).toHaveBeenLastCalledWith(HOME)

    openLocations(view)
    fireEvent.click(screen.getByRole('menuitem', { name: '/tmp' }))
    expect(onNavigate).toHaveBeenLastCalledWith('/tmp')
    expect(onNavigate).toHaveBeenCalledTimes(4)
  })

  it('offers an unknown home as a disabled row and shows no workspace or recent group without one', () => {
    const { view } = setup({ workspaces: [], recent: [], home: undefined })
    openLocations(view)
    const items = screen.getAllByRole('menuitem')
    expect(items.map(item => item.textContent)).toEqual([`${zh['locations.cwd']}${CWD}`, zh['locations.home']])
    expect(items[1]?.hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText(zh['locations.workspaces'])).toBeNull()
    expect(screen.queryByText(zh['locations.recent'])).toBeNull()
  })

  it('asks for a fresh listing from the reload button', () => {
    const { view, onReload } = setup()
    fireEvent.click(view.container.querySelector('[data-files-reload]')!)
    expect(onReload).toHaveBeenCalledTimes(1)
  })
})
