/**
 * The row menu: what can be done to one entry, opened where the pointer was.
 *
 * A context menu has no trigger of its own, so the list is placed from a
 * zero-size rect at the pointer instead of from an anchor element, and it
 * portals out of the tree so no scrolling ancestor can crop it.
 *
 * Files and directories do not offer the same rows: a directory has nothing to
 * open, compare, download, or read a timeline of, so those rows are absent
 * rather than disabled — except `open`, which stays visible and disabled so the
 * menu's rows keep one order. `compareWith` appears only once another file has
 * been selected as the base.
 */
import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'

/** What kind of entry a row menu was opened on. */
export type EntryKind = 'file' | 'directory'

/** The row menu's item ids, in the order the menu shows them. */
export type EntryMenuAction =
  | 'open'
  | 'compareSelect'
  | 'compareWith'
  | 'timeline'
  | 'copyPath'
  | 'copyRelativePath'
  | 'download'
  | 'rename'
  | 'delete'

/** One entry a menu was opened on, and where the pointer was. */
export interface EntryTarget {
  /** Absolute path of the entry. */
  readonly path: string
  /** The entry's basename. */
  readonly name: string
  /** Whether the entry is a file or a directory. */
  readonly kind: EntryKind
  /** Viewport x of the pointer that opened the menu. */
  readonly x: number
  /** Viewport y of the pointer that opened the menu. */
  readonly y: number
}

/** Everything the row menu draws and the gestures it reports. */
export interface EntryMenuProps {
  /** The entry the menu acts on. */
  readonly target: EntryTarget
  /** The file selected as this tab's compare base, or null. */
  readonly compareBase: string | null
  /** Namespace-bound translate. */
  readonly t: TranslateNS<'sidebarFiles'>
  /** Perform one row's action. */
  readonly onSelect: (action: EntryMenuAction) => void
  /** Dismiss the menu. */
  readonly onClose: () => void
}

/**
 * Render one entry's context menu, placed at the pointer that opened it.
 * @param props - see {@link EntryMenuProps}.
 * @returns the portaled menu list.
 */
export function EntryMenu({ target, compareBase, t, onSelect, onClose }: EntryMenuProps): ReactNode {
  const file = target.kind === 'file'
  const items: MenuEntry[] = [{ id: 'open', label: t('menu.open'), disabled: !file }]
  if (file) {
    items.push({ id: 'compareSelect', label: t('menu.compareSelect') })
    if (compareBase !== null && compareBase !== target.path) {
      items.push({ id: 'compareWith', label: t('menu.compareWith') })
    }
    items.push({ id: 'timeline', label: t('menu.timeline') })
  }
  items.push({ id: 'copyPath', label: t('menu.copyPath') })
  items.push({ id: 'copyRelativePath', label: t('menu.copyRelativePath') })
  if (file) items.push({ id: 'download', label: t('menu.download') })
  items.push({ id: 'rename', label: t('menu.rename') })
  items.push({ id: 'delete', label: t('menu.delete'), danger: true })
  // Placement reads the pointer, not an element; the rect is rebuilt only when
  // the pointer moves to another entry, so the menu settles on the first frame.
  const getAnchorRect = useCallback(() => new DOMRect(target.x, target.y, 0, 0), [target.x, target.y])
  return (
    <Menu
      open
      autoFocus
      anchor={null}
      items={items}
      onSelect={(id) => { onSelect(id as EntryMenuAction) }}
      onClose={onClose}
      portal
      getAnchorRect={getAnchorRect}
    />
  )
}
