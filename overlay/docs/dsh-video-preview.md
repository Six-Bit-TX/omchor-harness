# Sidebar video playback — two native DSH plugins

Video files open in the right Sidebar and **stream**: playback starts on the first
bytes, a seek anywhere in the file is one range request, and 2× (or 1.5×) is a
control in the tab's toolbar. Nothing under the DSH install (`~/.npm/_npx/…`) is
modified, and no complete-file cap is raised — so a DSH reinstall or cache refresh
does not take the feature away, and a 47 MB capture plays like a 5 MB one.

## Where it lives

| Piece | Path |
|---|---|
| Browser plugin | `~/.dsh/profiles/web/node_modules/@local/dsh-client-ui-video-preview/` |
| — its host half | `…/index.js` — an empty `apply`, so the Loader has a row to scan |
| — its browser half | `…/client.js` — the tab type, the pane body, the copy |
| Route plugin | `~/.dsh/profiles/web/node_modules/@local/dsh-video-preview-routes/` |
| — its host half | `…/index.js` — the byte-range route (host-only package, no browser half) |
| Activation | `~/.dsh/profiles/web/cordis.patch.yml` — two `insert` rows |

The split is the product's own shape for this kind of pair: the shipped
`dsh-client-ui-open-in-app` browser plugin points at routes that live in a
separate host package.

## Why two plugins

**The browser half** registers its own **tab type** through the public
`ctx.sidebarRightTabs.register({ id, kind, patterns, canOpen, title })` seat, with
`kind: "video"` and globs `*.mp4, *.m4v, *.webm, *.ogv, *.ogg, *.mov, *.mkv`. It
names no `priority`, so it lands in the `extension` band, which outranks both the
`builtin` band and the document preview's `fallback` type; every existing opener
(`ctx.sidebarRight.openResource`, the chat's file links, the Files tree) passes no
`kind`, so the ranking decides and video addresses come here. Its body registers in
the keyed `sidebar.right.pane.tab` seat under the same id and renders one
`<video controls src="/api/video-preview?session=…&path=…">`.

**The route plugin** is what makes that URL real. The browser cannot stream
through the JSON Remote — a media element wants one HTTP resource it can issue
`Range` requests against — and the product's own `/api/file` route both buffers
the whole file and caps it at the attachment image limit. So the route plugin
registers one exact route on Connection's shared, cookie-authenticated `/api`
channel:

```
GET|HEAD /api/video-preview?session=<id>&path=<relative|absolute>
  200  the whole file, streamed in 8 MiB windows
  206  with Content-Range for a byte range (open-ended, closed, or suffix)
  416  with `Content-Range: bytes */<size>` for an unsatisfiable range
  401/403 from the fence when the caller is not the authenticated page
```

Same-origin is the whole point: the browser attaches the session cookie by
itself, so no script holds a credential and the request needs no custom header.
The session is resolved the way the workspace file service resolves one — the
live header first, then persistence for a resumed Session — so an unknown session
is refused rather than served from some default root.

Reads go through the same `ctx.fs` authority `/api/file` already grants the
browser, but one bounded window at a time: the host never buffers the file, and
the bytes never travel as base64 JSON frames. Beyond the file name and a reload
control, the toolbar carries the playback speed (1× → 1.5× → 2× → 1×), and the
pane reports the HTTP status when the route refuses.

## Turning it off

Remove both `insert` rows from `~/.dsh/profiles/web/cordis.patch.yml` (or reduce
the file to `[]`). The profile sets `patchReload: live`, so the Loader drops the
rows without a `dsh web` restart; a browser refresh completes it. Reinstating them
is the same edit in reverse.

A plugin *row* enters a page's boot graph only when the page is fetched, so a
browser refresh is always the last step for a new row. Once a row exists in the
page, later edits to `client.js` hot-swap on their own — the host watches the
bundle's mtime and size. A changed *host* half (`index.js`) needs the row to be
re-created or the host restarted, which is why the route lives in its own package
rather than being added to a module the running Loader already imported.

## Editing it

Both `index.js`/`client.js` files are the shipped artifacts the host serves, with
no build step. `client.js` is a hand-written
`window.__ModuleLoader__.load({ id, factory })` bundle whose only external is
`react`; the route package has no imports at all.

## Verification performed

- `node --check` on both artifacts; the host half imports with an `apply` export
  and the inject list it declares; both package specifiers resolve from the
  profile root exactly as the Loader resolves them; `dsh --profile web
  --dump-config` composes both rows.
- A harness installed the real route plugin into a fake host context and drove it
  over real HTTP through a replica of Connection's bridge loop — 44 assertions
  against the real 46.9 MB mp4: `HEAD` metadata with no byte read, a whole-file
  `200` byte-identical to disk streamed in bounded windows, open-ended / middle /
  tail / suffix `206` windows each byte-identical with the right `Content-Range`,
  `416` naming the real size, malformed and multi-range requests falling back to
  the whole file, and 404/403/400 for a missing file, a directory, a missing
  path, a missing session, an escaping path, and an unknown session, plus a
  resumed Session answered from persistence and an aborted download that stops
  reading windows without unhandled rejections.
- A second harness loaded the real browser bundle in a VM — 33 assertions: the
  tab type's id/kind/globs/`canOpen`; the body registering with no injected file
  reader; the pane probing with `HEAD`, rendering a same-origin `/api/…` source
  with `controls`, no object URL anywhere; the speed control cycling 1× → 1.5× →
  2× and reaching the media element; the buffering overlay on a stall and back
  off on resume; reload re-probing and remounting the player; and the missing /
  refused / decoder / unsupported paths each reporting instead of crashing.
- Against the running host: the client graph stayed at 54 entries with only the
  document preview returning to stock, the served bundle is byte-identical to the
  file on disk, and the composed tree carries both rows.
