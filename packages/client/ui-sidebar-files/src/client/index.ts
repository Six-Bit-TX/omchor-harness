/**
 * Browser half: register `files` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat and the chip title into
 * the keyed `sidebar.right.pane.tab.title` seat, both under the type's `id`.
 *
 * The file split is this package's layering: what the type IS
 * (`definition.tsx`), what it keeps (`store.ts`), how it talks to the Host
 * (`face.ts`, `paths.ts`, `failures.ts`, `download.ts`), what it draws
 * (`FilesBody.tsx`, `PathHeader.tsx`, `EntryMenu.tsx`, the dialogs,
 * `FilesTitle.tsx`), what it says (`locales.ts`), and this module, which only
 * wires them together.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls the global `useWorkspaces` seat the location menu reads.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { FILES_ID, filesDefinition } from './definition.tsx'
import { createFilesRemote, filesFace } from './face.ts'
import { FilesBody } from './FilesBody.tsx'
import { FilesTitle } from './FilesTitle.tsx'
import { en, zh } from './locales.ts'
import { createFilesStore } from './store.ts'

export type { SidebarFilesKey } from './locales.ts'
export type { DirLevel, FilesState, FilesTabState, LevelState } from './store.ts'
export type {
  EntryMutation, FileDownload, FilePage, FilesInjected, FilesRemoteOps, ListWorkspaceDirectory, ReadWorkspaceDownload,
  ReadWorkspaceHistory, ReadWorkspacePage, RemoveWorkspaceEntry, RenameWorkspaceEntry, WorkspaceFilesRemote,
} from './face.ts'
export type { FilesBodyProps } from './FilesBody.tsx'
export type { PathHeaderProps } from './PathHeader.tsx'
export type { EntryMenuAction, EntryMenuProps, EntryTarget } from './EntryMenu.tsx'

/** This package's copy namespace. */
const NS = 'sidebarFiles'

/**
 * Required browser services: the tab registry, the keyed seat, the Remote
 * carrier and its namespace, and copy.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles']

/**
 * Client plugin body: register the type, its dictionaries, its body, and its chip title.
 * @param ctx - client root context carrying the registry, the slots, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(filesDefinition(t)), 'ui-sidebar-files: files type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-files: dictionaries')

  const store = createFilesStore()
  // `$host.home` is read on every call rather than captured: the ready frame
  // may not have landed when the plugin applies.
  const inject = filesFace(createFilesRemote(ctx.remote), () => ctx.remote.$host.home)
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: FILES_ID, locale: NS, store, inject },
    FilesBody,
  )), 'ui-sidebar-files: files tab body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: FILES_ID },
    FilesTitle,
  )), 'ui-sidebar-files: files tab title')
}
