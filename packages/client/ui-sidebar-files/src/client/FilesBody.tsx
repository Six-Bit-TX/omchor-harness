/**
 * The file tree's body: the directory it is rooted at, listed one level at a
 * time, and every gesture a row offers.
 *
 * Everything the tree keeps lives in its store, keyed by tab; everything it
 * asks for goes through its injected face. The component itself only decides
 * what to draw for each absolute path and what a gesture means: a directory
 * toggles, a file opens through the owner's `tabActions` for a `file:` viewer to
 * claim, anything else is shown but refuses to open, and a right-click opens the
 * row menu whose rows copy, download, rename, remove, compare, or open a file's
 * timeline. The header row is the address bar (`PathHeader`) and the reload
 * control, which drops every listed level and asks again for the expanded ones.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  FileTypeIcon, IconFolderClose16, IconFolderOpen16, classifyFileType, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { childPath } from './face.ts'
import type { FilesInjected } from './face.ts'
import { actionFailureLine, failureLine } from './failures.ts'
import { saveBase64File } from './download.ts'
import { parentPath, relativeToRoot } from './paths.ts'
import { CompareDialog } from './CompareDialog.tsx'
import { DeleteDialog } from './DeleteDialog.tsx'
import { EntryMenu } from './EntryMenu.tsx'
import type { EntryMenuAction, EntryTarget } from './EntryMenu.tsx'
import { PathHeader } from './PathHeader.tsx'
import { RenameDialog } from './RenameDialog.tsx'
import { TimelineDialog } from './TimelineDialog.tsx'
import type {} from './locales.ts'
import type { FilesTabState, createFilesStore } from './store.ts'
import css from './FilesBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type FilesBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createFilesStore>>
  & FilesInjected
  & PropsLocale<'sidebarFiles'>

/** One row's open dialog, which outlives the menu that opened it. */
type OpenDialog =
  | { readonly action: 'rename'; readonly target: EntryTarget }
  | { readonly action: 'delete'; readonly target: EntryTarget }
  | { readonly action: 'compare'; readonly target: EntryTarget; readonly base: string }
  | { readonly action: 'timeline'; readonly target: EntryTarget }

/** Natural, case-insensitive name order, so `file2` precedes `file10`. */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Order one level's entries for display: directories first, then everything
 * else, each group by name. The endpoint's order is a listing fact; this is the
 * reader's.
 * @param entries - the listing as the endpoint returned it.
 * @returns a new array, directories first, then by name within each group.
 */
export function orderEntries(entries: readonly WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === 'directory') - Number(left.type === 'directory')
    return group !== 0 ? group : byName.compare(left.name, right.name)
  })
}

/**
 * Closed-union backstop for the row menu's action ids.
 * @param value - the action the menu reported.
 * @returns never; the call is unreachable.
 */
/* v8 ignore next 3 -- closed-union backstop; only reached if an action id is forged */
function assertNever(value: never): never {
  throw new Error(`ui-sidebar-files: unknown row action ${String(value)}`)
}

/** What every level shares: the tab's tree, the gestures, and where a menu opens. */
interface TreeContext {
  readonly state: FilesTabState
  readonly onToggle: (path: string) => void
  readonly onOpen: (path: string) => void
  readonly onContextMenu: (target: EntryTarget) => void
  readonly t: TranslateNS<'sidebarFiles'>
}

/** One entry's row, and its children when it is an expanded directory. */
function Entry({ parent, entry, tree }: { parent: string; entry: WorkspaceDirectoryEntry; tree: TreeContext }): ReactNode {
  const path = childPath(parent, entry.name)
  /**
   * Open this row's menu where the pointer was: the browser's own menu would
   * otherwise cover the tree.
   * @param event - the context-menu gesture on this row.
   */
  const openMenu = (event: { preventDefault: () => void; clientX: number; clientY: number }, kind: EntryTarget['kind']): void => {
    event.preventDefault()
    tree.onContextMenu({ path, name: entry.name, kind, x: event.clientX, y: event.clientY })
  }
  if (entry.type === 'directory') {
    const expanded = tree.state.expanded.includes(path)
    return (
      <li className={css.item} data-files-entry="directory" data-files-path={path}>
        <button
          type="button"
          className={css.row}
          aria-expanded={expanded}
          onClick={() => { tree.onToggle(path) }}
          onContextMenu={(event) => { openMenu(event, 'directory') }}
        >
          {expanded ? <IconFolderOpen16 className={css.icon} /> : <IconFolderClose16 className={css.icon} />}
          <span className={css.name}>{entry.name}</span>
        </button>
        {expanded && <ul className={css.level}><Level path={path} tree={tree} /></ul>}
      </li>
    )
  }
  if (entry.type === 'file') {
    return (
      <li className={css.item} data-files-entry="file" data-files-path={path}>
        <button
          type="button"
          className={css.row}
          onClick={() => { tree.onOpen(path) }}
          onContextMenu={(event) => { openMenu(event, 'file') }}
        >
          <FileTypeIcon kind={classifyFileType(entry.name)} size={16} className={css.fileIcon} />
          <span className={css.name}>{entry.name}</span>
        </button>
      </li>
    )
  }
  return (
    <li className={css.item} data-files-entry="other" data-files-path={path}>
      <span className={clsx(css.row, css.other)} aria-disabled="true" title={tree.t('entry.other')}>
        <span className={css.name}>{entry.name}</span>
      </span>
    </li>
  )
}

/** One directory's rows: its state while listing, its entries once listed. */
function Level({ path, tree }: { path: string; tree: TreeContext }): ReactNode {
  const { state, t } = tree
  const level = state.levels[path]
  if (level === undefined || level.kind === 'loading') {
    return <li className={css.note} data-files-row="loading">{t('loading')}</li>
  }
  if (level.kind === 'failed') {
    return (
      <li className={css.note} data-files-row="failed" data-files-code={level.failure.code}>
        {failureLine(t, level.failure)}
      </li>
    )
  }
  const entries = orderEntries(level.level.entries)
  return (
    <>
      {entries.length === 0 && <li className={css.note} data-files-row="empty">{t('empty')}</li>}
      {entries.map(entry => <Entry key={entry.name} parent={path} entry={entry} tree={tree} />)}
      {level.level.truncated && <li className={css.note} data-files-row="truncated">{t('truncated')}</li>}
    </>
  )
}

/** The file tree's body: the directory it is rooted at and whatever the reader has opened under it. */
export function FilesBody({
  useTabInfo, sessionId, useSessions, useWorkspaces, useStore, actions,
  start, navigate, load, toggle, rename, remove, download, readPage, history, homePath, t,
}: FilesBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const { signal, actions: tabActions } = tab
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const workspaces = useWorkspaces(state => state.items)
  // The header's jump targets are the Workspace entity reduced to what the menu
  // shows and where it goes; the identity it carries is the Workspace id.
  const locations = useMemo(
    () => workspaces.map(workspace => ({
      id: workspace.workspaceId as string,
      title: workspace.title,
      path: workspace.path,
    })),
    [workspaces],
  )
  const state = useStore(store => store.byTab[tab.id])
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollTopRef = useRef(0)
  const rootSeen = useRef(state?.root)
  const [menuAt, setMenuAt] = useState<EntryTarget | null>(null)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Stable per tab: a dialog's read effect keys on these, and the store's own
  // face members survive every re-render.
  const readPageBound = useCallback((path: string) => readPage(path, signal), [readPage, signal])
  const historyBound = useCallback((path: string) => history(path, signal), [history, signal])

  // Come back where the reader was: loaded levels outlive the body in the
  // store, so a remounted tree lays out at its full height before this runs
  // and the stored offset re-lands exactly. A fresh tree stores 0.
  const seeded = state !== undefined
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (seeded && body !== null) {
      body.scrollTop = state.scrollTop
      scrollTopRef.current = body.scrollTop
    }
  }, [seeded])
  // Rooting the tab elsewhere starts the body at the top again; the store's own
  // offset is already 0, so this only moves the elements that stayed mounted.
  useLayoutEffect(() => {
    if (rootSeen.current === state?.root) return
    rootSeen.current = state?.root
    scrollTopRef.current = 0
    /* v8 ignore next -- the body is mounted whenever the root under it changes */
    if (bodyRef.current !== null) bodyRef.current.scrollTop = 0
  }, [state?.root])
  // Scrolling only moves the ref; the store hears about it once, on unmount,
  // so a scroll neither re-renders the tree nor writes after the owner's
  // abort has forgotten the bucket.
  useEffect(() => () => {
    if (seeded && !signal.aborted) actions.scrolled(tab.id, scrollTopRef.current)
  }, [seeded, signal, tab.id, actions])
  useEffect(() => {
    // A bucket gone because the record aborted must not be re-seeded by a
    // component that has not unmounted yet.
    if (state !== undefined || cwd === undefined || signal.aborted) return
    start(tab.id, cwd, signal)
  }, [state, cwd, tab.id, signal, start])

  if (cwd === undefined) {
    return (
      <div className={css.status} data-files-state="no-workspace">
        <p className={css.statusLine}>{t('noWorkspace')}</p>
      </div>
    )
  }
  if (state === undefined) return null

  /** Download one file: read it whole, then hand the bytes to the browser. */
  const startDownload = (path: string): void => {
    void download(path, signal).then((result) => {
      if (!result.ok) {
        setNotice(actionFailureLine(t, result.error))
        return
      }
      saveBase64File(result.value.name, result.value.base64)
    })
  }
  /**
   * Rename one entry, then list the directory that showed it again. An expanded
   * renamed directory has its own level listed under its new path.
   * @param target - the entry being renamed.
   * @param newName - the name the reader confirmed.
   * @returns a localized failure line, or null when the Host accepted it.
   */
  const confirmRename = (target: EntryTarget, newName: string): Promise<string | null> =>
    rename(target.path, newName, signal).then((result) => {
      if (!result.ok) return actionFailureLine(t, result.error)
      load(tab.id, parentPath(target.path), signal)
      if (state.expanded.includes(target.path)) load(tab.id, result.value.absolutePath, signal)
      return null
    })
  /**
   * Remove one entry, then list the directory that showed it again.
   * @param target - the entry being removed.
   * @returns a localized failure line, or null when the Host accepted it.
   */
  const confirmDelete = (target: EntryTarget): Promise<string | null> =>
    remove(target.path, signal).then((result) => {
      if (!result.ok) return actionFailureLine(t, result.error)
      load(tab.id, parentPath(target.path), signal)
      return null
    })
  /**
   * Perform one row menu's action.
   * @param action - the row the reader chose.
   * @param target - the entry the menu was opened on.
   */
  const runMenuAction = (action: EntryMenuAction, target: EntryTarget): void => {
    setMenuAt(null)
    setNotice(null)
    switch (action) {
      case 'open':
        tabActions.openResource(fileAddressFor(sessionId, state.root, target.path))
        return
      case 'compareSelect':
        actions.compareSelected(tab.id, target.path)
        return
      case 'compareWith':
        // The row is listed only while another file is the base, so the base is
        // a path here.
        setDialog({ action: 'compare', target, base: state.compareBase as string })
        return
      case 'timeline':
        setDialog({ action: 'timeline', target })
        return
      case 'copyPath':
        void writeClipboard(target.path)
        return
      case 'copyRelativePath':
        void writeClipboard(relativeToRoot(state.root, target.path))
        return
      case 'download':
        startDownload(target.path)
        return
      case 'rename':
        setDialog({ action: 'rename', target })
        return
      case 'delete':
        setDialog({ action: 'delete', target })
        return
      /* v8 ignore next -- closed-union backstop; only reached if an action id is forged */
      default: return assertNever(action)
    }
  }

  const tree: TreeContext = {
    state,
    onToggle: (path) => { toggle(tab.id, path, state.levels[path] !== undefined, signal) },
    // Every row is under the tree's root, so its address is session-relative.
    onOpen: (path) => { tabActions.openResource(fileAddressFor(sessionId, state.root, path)) },
    onContextMenu: (target) => { setNotice(null); setMenuAt(target) },
    t,
  }
  // Reload drops every level and asks again for the expanded ones; a collapsed
  // level is fetched again the next time it opens.
  const reload = (): void => {
    actions.reset(tab.id)
    for (const path of state.expanded) load(tab.id, path, signal)
  }
  return (
    <>
      <div className={css.root} data-files-state="tree" data-files-root={state.root}>
        <PathHeader
          root={state.root}
          cwd={cwd}
          workspaces={locations}
          recent={state.recent}
          home={homePath()}
          t={t}
          onNavigate={(path) => { setNotice(null); navigate(tab.id, path, signal) }}
          onReload={reload}
        />
        {notice !== null && <p className={css.notice} role="status" data-files-notice>{notice}</p>}
        <div
          ref={bodyRef}
          className={css.body}
          data-files-body
          onScroll={(event) => { scrollTopRef.current = event.currentTarget.scrollTop }}
        >
          <ul className={css.level}><Level path={state.root} tree={tree} /></ul>
        </div>
      </div>
      {menuAt !== null && (
        <EntryMenu
          target={menuAt}
          compareBase={state.compareBase}
          t={t}
          onSelect={(action) => { runMenuAction(action, menuAt) }}
          onClose={() => { setMenuAt(null) }}
        />
      )}
      {dialog?.action === 'rename' && (
        <RenameDialog
          name={dialog.target.name}
          t={t}
          onConfirm={newName => confirmRename(dialog.target, newName)}
          onClose={() => { setDialog(null) }}
        />
      )}
      {dialog?.action === 'delete' && (
        <DeleteDialog
          name={dialog.target.name}
          t={t}
          onConfirm={() => confirmDelete(dialog.target)}
          onClose={() => { setDialog(null) }}
        />
      )}
      {dialog?.action === 'compare' && (
        <CompareDialog
          base={dialog.base}
          target={dialog.target.path}
          t={t}
          readPage={readPageBound}
          onClose={() => { setDialog(null) }}
        />
      )}
      {dialog?.action === 'timeline' && (
        <TimelineDialog
          path={dialog.target.path}
          t={t}
          loadHistory={historyBound}
          onClose={() => { setDialog(null) }}
        />
      )}
    </>
  )
}
