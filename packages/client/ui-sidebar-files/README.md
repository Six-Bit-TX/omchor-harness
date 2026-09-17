---
description: "The right Sidebar's file-tree tab type for the dsh web client: the session workspace root listed one level at a time over the wire, opening files into the Sidebar by resource address."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-files

English | [中文](README.zh.md)

## Summary

The right Sidebar's navigator tab type: the session's workspace root as a tree, listed one level at a time over the wire, opening files into the Sidebar. It is a page type reached from the guide and claims no address; it opens files by address for the `dsh-resource://file` viewers to claim — nothing in `ui-sidebar-right` knows this package.

## Table of Contents

- [What it registers](#what-it-registers)
- [The tree](#the-tree)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

- **The type** — `ctx.sidebarRightTabs.register(...)` with kind `files`, id `@deepseek-ai/dsh-client-ui-sidebar-files`, band `builtin`, no patterns, and one guide entry (order 10, its title and description from the `sidebarFiles` namespace, its glyph the shared folder icon) that opens the type.
- **The body** — the keyed `sidebar.right.pane.tab` seat under that id: an address row under the strip, then the tree. The address row is the document preview's (`ui-sidebar-documentpreview`) path row plus two controls: the path itself is the address and edits in place (a click swaps in a text field seeded with the tab's root; Enter lists the typed address, Escape and blur put the display back), a folder button at its start opens the location menu, and reload sits at its end. The row is copied rather than shared because a plugin bundle shares runtime code only through the platform modules; once the artifact and slot surfaces settle, one copy in `ui-primitives` could serve every pane header.
- **The chip title** — the keyed `sidebar.right.pane.tab.title` seat under that id: a shared `FileTypeIcon` folder glyph at 16px before the type's label. The tree's own rows never draw this sheet.

Twelve source files under `src/client/`: `definition.tsx` (the type), `store.ts` (what it keeps), `face.ts` (how it lists and mutates, Remote binding included), `FilesBody.tsx` (what it draws, with its ordering helper), `PathHeader.tsx` (the address row and its location menu), `EntryMenu.tsx` (the row menu), `RenameDialog.tsx`, `DeleteDialog.tsx`, `CompareDialog.tsx`, `TimelineDialog.tsx` (the four dialogs), `paths.ts` and `download.ts` (`/`-joined path helpers and the browser download), `failures.ts` (the failure lines), `FilesTitle.tsx` (the chip title), `locales.ts` (what it says), and `index.ts` (the wiring).

<a id="the-row-menu"></a>
## The row menu

A right-click opens the shared `Menu` primitive at the pointer for one entry: open (files only), select for compare, compare with the selected file (only while this tab holds a compare base), open timeline (files only), copy path, copy relative path (relative to the tab's root), download (files only), rename, and delete. Copy writes through the platform clipboard; download reads the complete file with `workspaceFiles.readAll` and hands the browser a Blob URL.

Rename and delete are the two Host mutations the tab performs, and both are confined to the session's workspace root: `workspaceFiles.rename` and `workspaceFiles.delete` refuse a path whose directory leaves it. Rename opens a dialog that refuses a blank name, a name with `/` or `\`, and an unchanged name; delete opens a confirmation that names the entry. Compare reads one bounded page (2000 lines) of each side and renders the shared `DiffBlock`, noting a side the cap cut. Timeline lists the file's `git log` — up to 50 commits, newest first — and says so when git reports none; the path is not re-checked for a repository, so a file outside one simply has no history.

<a id="the-tree"></a>
## The tree

The root is the session's working directory, read from `useSessions().byId[sessionId].cwd`, and split for the address row by `pathPartsOf` from `@deepseek-ai/dsh-util-workspace-path`. The address edits in place, so the tab can be rooted anywhere the Host can list — including directories outside the session's workspace — and the location menu offers every Workspace the Client knows, the session's working directory, the Host account's home, and the directories this tab has visited, most recent first (capped at eight). A freshly opened tab always starts at the session's working directory. Every level is keyed by absolute path; a child's path is its parent's joined with the entry name by `/`. A level is listed when it is first expanded, through `remote.workspaceFiles.list(sessionId, absolutePath)` on the `@deepseek-ai/dsh-api-workspace-files` namespace; the adapter keeps the listing's entries and truncation flag and drops its workspace-relative path. Rows are ordered directories first, then by natural, case-insensitive name; dotfiles are shown like any other entry.

| Entry type | Row |
|---|---|
| `directory` | Toggles; the level is fetched the first time it opens and kept while collapsed. |
| `file` | Opens `dsh-resource://file/session/<sessionId>/<encoded path relative to the root>`, built by `fileAddressFor` from `@deepseek-ai/dsh-util-workspace-path` from the entry's absolute path and the tree's root, through `useTabInfo().tab.actions.openResource`, landing in the tab's own pane. |
| `other` | Shown greyed and not clickable, so the directory is reported whole. |

A level cut by the endpoint's entry cap ends with a marker; an empty level says so; a level that failed shows one line per code — `workspace-file/not-found`, `outside-workspace`, `not-directory` — and the transport's own message otherwise. Reload drops every listed level and asks again for the expanded ones; collapsed levels are fetched again when they next open. A session without a working directory shows a single line instead of a tree.

State lives in the type's own store, bucketed by tab id: `root`, `levels` (loading / ready / failed per absolute path), `expanded`, `scrollTop`, `recent` (this tab's visited directories), and `compareBase` (the entry selected for comparison). The body tracks the scroll offset locally while scrolling and commits it once when it unmounts. Because the store outlives the body, switching to another sidebar tab and back remounts the tree with its levels intact, its scroll offset restored, and its compare base still selected. The owner's `signal` ends a bucket: on abort the tab is forgotten, and neither a listing that settles afterwards nor the unmount's offset commit writes anything.

<a id="model-experience"></a>
## Model Experience

None, as this package draws a workspace file tree in the browser and registers nothing model-facing.

#### KV Cache effect

None; directory listings travel over the Remote and assemble no model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **Workspace-confined mutations.** Rename and delete refuse an entry whose directory leaves the session's workspace root, even though listing and reading reach further; a cut/copy/paste pair, search, drag-and-drop, a current-file highlight, and filesystem watching are absent — a level changes only through reload, a mutation's own reload of the affected level, or the navigation gesture.
- **Listing, not a file manager.** Nothing here needs git, but the timeline verb reports whatever `git log` says for the file's directory, so a file outside a repository — or a host without git on `PATH` — has no history rather than an error.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The tree's only runtime state is one Slot store per tab, written by the body that owns it and forgotten on the tab's abort signal; there is no second observation of it to compare against.
