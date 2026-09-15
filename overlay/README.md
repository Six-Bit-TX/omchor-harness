# dsh-overlay

My local overlay on top of the DeepSeek Harness **npm install**: five UI/route
plugins for the dsh Web client, the profile patch layer that activates them, my
harness settings, and one patch to a shipped package. Installing DSH from npm
plus running `./install.sh` and `./patches/apply.sh` here reproduces this
working setup on any machine.

## What this repo is, and what it is not

DSH itself is *not* in here. `dsh web` runs from an npx/npm install
(`~/.npm/_npx/<hash>/node_modules/@deepseek-ai/dsh`), which is 324 MB of published
packages — reproducible with one command and not worth versioning:

```sh
npx @deepseek-ai/dsh web        # or: npm i -g @deepseek-ai/dsh && dsh web
```

What is *not* reproducible is the overlay: the plugins I wrote, the rows that
activate them, and the settings I chose. That is what this repo holds — about
half a megabyte of source.

Deliberately **not** included, because it is private, large, or both:

| Excluded | Why |
|---|---|
| `$DSH_HOME/sessions/` | 775 MB of session logs and transcripts |
| `$DSH_HOME/attachments/` | uploaded files |
| `$DSH_HOME/.credentials.yaml` | provider credentials |
| `~/.git-credentials` | git credentials |
| the npx install itself | published packages, 324 MB, reinstallable |

## Layout

```
install.sh                     copy packages + rows into a profile
uninstall.sh                   remove the packages, print the rows to delete
snapshot.sha256                hashes of the live files this snapshot came from
plugins/
  dsh-client-ui-video-preview/   Sidebar video tab (browser half + empty host half)
  dsh-video-preview-routes/      the authenticated byte-range route it streams from
  dsh-client-ui-sidebar-terminal/ Sidebar terminal tab (xterm.js, vendored)
  dsh-subagent-fanout/           composer subagent-count selector + the
                                 per-session delegation budget it injects
  dsh-client-ui-subagent-subsession/ expandable subagent subsession rows + the
                                 transcript route that feeds them
profile/
  cordis.patch.yml             the overlay's Loader rows, as a reference copy
  package.json                 the profile manifest (bundle list, patchReload)
settings/
  settings.yaml                providers, model defaults, subagent allowlist, locale
patches/
  max-references.mjs           raises the shipped session-reference cap (3 -> 10)
  apply.sh                     runs it against the installed package
docs/
  session-reference-max-references.patch  the same edit, as a record and fallback
  dsh-video-preview.md         the video plugin's design and verification record
  subagent-fanout-and-subsessions.md  the delegation plugins' design and
                               verification record, including the restart rule
  legacy-bundle-patch-superseded.patch  the earlier approach, kept as a record
```

## The one shipped-package patch

Every plugin in this overlay rides the Loader and touches no shipped file. One
thing does not fit that shape: the cross-session reference cap.

A message may cite at most **3** other sessions. Mention a fourth and the whole
turn fails with `本轮运行失败  a message may reference at most 3 sessions`. The
number is not a setting: `@deepseek-ai/dsh-session-reference` hard-codes it as
`MAX_REFERENCES = 3` and rejects anything higher twice — the config schema caps
`maxReferences` at that constant, and the constructor throws
`session-reference: maxReferences must not exceed 3`. No profile patch row can
raise it, and no published release raises it either (0.1.5-rc.2 is `next`;
0.1.6-alpha.1 also caps at 3).

So `patches/max-references.mjs` rewrites the installed package in place:

| file | change |
|---|---|
| `lib/index.js` | `MAX_REFERENCES = 3` → `10`; schema, default and guard read the constant |
| `lib/types/config.js` | `export const MAX_REFERENCES = 3` → `10` |
| `lib/types/config.d.ts` | the declared constant and its one-to-three doc comment |

An npm/npx install or upgrade restores the original bytes, so re-run this
afterwards:

```sh
./patches/apply.sh --dry-run   # report the edits, write nothing
./patches/apply.sh             # write them
```

It discovers the live install through the profile's own `node_modules` symlink
(override with `DSH_SESSION_REFERENCE_DIR`), is idempotent, and fails loudly
rather than guessing if a future release moves or rewords those lines. Writing
needs no restart; *loading* does — the running `dsh web` keeps the old module in
memory, so restart the host and refresh the page.
`docs/session-reference-max-references.patch` is the same edit as a
`patch -p1` record and fallback; to revert, `patch -R -p1` it from the package
directory, or reinstall the package.

The cap is a cost bound, not an arbitrary rule: each reference appends a second
user-role message holding a snapshot of that session, up to the per-source byte
budget (a 64 KiB floor, or `referenceContextFraction` of the model's context
window). Ten keeps that bounded; removing the cap entirely would let one message
ask for dozens of snapshots.

## Install

```sh
git clone git@github.com:Six-Bit-TX/dsh-overlay.git
cd dsh-overlay
./install.sh                  # profile "web" under $HOME/.dsh
# then reload the dsh Web page
```

`install.sh` copies each `plugins/<name>` into
`$DSH_HOME/profiles/<profile>/node_modules/@local/<name>` and ensures each row
exists in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`. Rows it does not own
are left untouched, and a row that is already present is left exactly as it is,
so it is safe to run repeatedly and safe to run while other plugins share that
file. A browser refresh is the last step, because a new plugin row enters a page's
boot graph only when the page is fetched.

**A new row needs the server to start again.** The `patchReload: live` field in
the profile manifest reloads *already-composed* rows; it does not compose a row
that did not exist when `dsh web` booted. Measured on 0.1.5-rc.2: after appending
a row, the served boot graph and the host's `/api` route table both still lacked
it until the process restarted. So the order is `./install.sh`, restart
`dsh web`, then refresh the page. Editing an *existing* plugin's source needs no
restart: its browser bundle is re-fetched on refresh, and its host half is
watched by the loader.

After a plugin's source is edited here, re-run `./install.sh` and refresh. Once a
row is present in a page, later edits to a browser half hot-swap on their own —
the host watches that bundle's mtime and size.

## The plugins

**`@local/dsh-client-ui-video-preview` + `@local/dsh-video-preview-routes`** —
video files open in the right Sidebar and stream. The browser half registers a
tab type (`kind: "video"`, the `extension` band, globs for the usual containers)
and hands the player one URL:
`/api/video-preview?session=…&path=…`. The route half answers it from Connection's
shared, cookie-authenticated `/api` channel with real HTTP range semantics — `200`
whole file streamed in bounded windows, `206` with `Content-Range` for a range,
`416` for an unsatisfiable one, `HEAD` for headers alone. So playback starts on the
first bytes, seeking to the middle is one range request, 2× just pulls data
faster, no complete file is buffered anywhere, and no complete-file cap applies.
`docs/dsh-video-preview.md` has the design and the full verification record.

**`@local/dsh-client-ui-sidebar-terminal`** — an interactive terminal as a Sidebar
tab: a local PTY streamed to xterm.js over authenticated `/api` routes, with
xterm.js vendored under `plugins/dsh-client-ui-sidebar-terminal/vendor/` (its own
LICENSE is kept beside it).

**`@local/dsh-subagent-fanout`** — a subagent-count selector in the composer's
tool row, immediately left of the model control, plus the model-visible
consequence. The browser half owns the choice (off, or 3–10), mirrors it in
`localStorage`, and publishes it to `POST /api/subagent-fanout`; the node half
holds the per-session budget and installs a scoped system-prompt section on
`agent/created` that tells the agent to decompose the work into that many
independent workstreams and dispatch them together in one assistant message with
`run_in_background: true`. A session that never touches the selector gets an
empty section, so its system prompt is byte-identical to one without the plugin.
On mount the control reads the host's value first and adopts it when the host
already holds a decision; otherwise it republishes the browser's mirror, which is
how a restarted host converges back. Verified live: with the selector at 4 the
agent dispatched 4 subagents in one step and reconciled their answers.

**`@local/dsh-client-ui-subagent-subsession`** — every delegation row
(`subagent`, `subagent_fork`, `send_message`) becomes an expandable subsession
that shows the child's own thought process: its reasoning blocks, its tool calls
with their result previews, and the text it is producing, in order. The row
replaces the generic Tool card through the keyed `tool.call.toolview` seat; the
transcript is folded on the host by `GET /api/subagent-subsession?session=<childId>`
over `ctx.sessionQuery`, which is live-preferred, and an expanded card polls it
while the child runs so the subsession grows in place. The header line carries the
child's model and effort, its live duration, its session id, and a collapsed copy
of the brief it was given. Completed turns still fold their process rows — the
turn control counts delegation calls (`N 个子代理`) and revealing it shows the
cards.

## Restoring on a fresh machine

```sh
# 1. the harness
npx @deepseek-ai/dsh web --no-open     # creates $DSH_HOME/profiles/web on first run
# 2. the overlay
git clone git@github.com:Six-Bit-TX/dsh-overlay.git && cd dsh-overlay && ./install.sh
# 3. the shipped-package patch: raises the session-reference cap from 3 to 10,
#    which no setting or plugin row can do
./patches/apply.sh
# 4. settings: copy settings/settings.yaml to $DSH_HOME/settings.yaml
#    (it names API keys through environment variables, so export those too)
# 5. reload the page
```

## If I ever need to change DSH itself

The upstream source is public (`deepseek-ai/deepseek-harness`, branch `master`), so
the heavier alternative is a real fork carrying these pieces as monorepo packages:

```sh
gh repo fork deepseek-ai/deepseek-harness --clone
```

That needs Node plus pnpm and the repo's build (`pnpm install`, `tsdown`), and it
is a different project from this overlay. The overlay exists so the *current*
working setup is preserved today, whatever happens to the npm install.
