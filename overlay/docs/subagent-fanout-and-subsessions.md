# Subagent fan-out and expandable subsessions

Two related overlay plugins that make delegation visible and controllable from
the composer. This note is the design and verification record for them.

| Package | Halves | Owns |
|---|---|---|
| `@local/dsh-subagent-fanout` | browser + host | the composer's subagent-count selector, and the per-session delegation budget injected into the system prompt |
| `@local/dsh-client-ui-subagent-subsession` | browser + host | the expandable delegation rows, and the transcript route that feeds them |

## 1. The fan-out budget

### What the user sees

A compact control in the composer's tool row, immediately left of the model
control: a count selector with `Off` and `3`–`10`. Its glyph is three linked
nodes; it tints to the primary label colour while a count is set. It never
renders inside a subagent conversation — a delegated child does not delegate, and
its composer is a read-only record.

### Where the number lives

The browser owns the choice and mirrors it in
`localStorage["dsh.subagentFanout.<sessionId>"]`; the host owns the per-session
budget in an in-process `Map`. The two reconcile on mount:

1. read the browser mirror, show it;
2. `GET /api/subagent-fanout?session=<id>`;
3. if the host already holds a non-zero count for that session, adopt it (write
   the mirror, update the control) — this covers a second tab, a cleared
   storage, and any reload while the host is up;
4. otherwise `POST` the browser's value — this is how a restarted host converges
   back to the user's last choice.

A first-ever visit publishes `0`, which clears the host entry; an absent entry
and an explicit `0` are the same state.

The per-session lifetime is deliberate: `localStorage` + an in-process map is the
right weight for a scheduling preference, and the plugin needs no durable
settings document. The cost is that a host restart forgets, which step 4 repairs
on the next page load.

### What the model sees

The host half installs one scoped system-prompt section per top-level Agent on
`agent/created`:

```text
## Fan-out delegation budget: 5 subagents

The user set a fan-out target of 5 subagents for this Session. For every
substantive request, decompose the work into up to 5 independent, self-contained
workstreams and dispatch them together in one assistant message — one `subagent`
call per workstream, each with `run_in_background: true` so the children run
concurrently.
…
```

Design points that matter:

- **Order `TOOL_SUBAGENT + 10`** (2810), immediately after the shipped
  `tool:subagent` guidance it refines, rather than replacing it.
- **Dynamic text read at every Assembly**, so changing the selector applies to
  the next request in the same Session.
- **Empty when off.** The provider returns `''` with no budget, so a Session that
  never touches the selector has a byte-identical system prompt to one with the
  plugin absent (no cache churn, no phantom prompt diff).
- **Top-level only.** A child's `header.origin === "subagent"` skips
  installation, so a budget never leaks into a delegated child.
- The directive names the three failure modes a bare number invites: fewer
  children when the task genuinely does not split (never invented work), one
  child per workstream (never serial delegation), and foreground work while the
  children run.

The route is on Connection's shared `/api` channel, so it inherits the
cookie-authenticated same-origin fence:

```text
GET  /api/subagent-fanout?session=<id>   -> { sessionId, count }   (0 = off)
POST /api/subagent-fanout {sessionId, count} -> { sessionId, count }
```

`count` must be `0` or an integer in `[3, 10]`; anything else is `400`.

## 2. The expandable subsession

### The row

`tool.call.toolview` is a keyed seat: a registration under a wire Tool name
replaces the generic card for that call. This plugin registers `subagent`,
`subagent_fork`, and `send_message`, so every delegation row becomes:

- a collapsed line: disclosure chevron, `Subagent`, the child's `description`,
  a running/failed chip, the live duration from the child's `subagentTiming`
  projection, and (on hover) `Open full session` / `Inspect call`;
- an expanded subsession: the child's model and reasoning effort, its session
  id, a collapsed copy of the brief it was given, then its steps in order —
  reasoning blocks, tool rows with result previews, and its text.

`Open full session` routes through `ctx.sessions.openSubagent(address)`, which is
the product's own navigation into a child conversation (full chat, follow-ups,
independent stop). The address is taken from the parent's durable catalog entry,
so an unlabeled foreground one-shot still resolves.

### Finding the child

Three joins, in order:

1. the settled result text `started subagent <childId>` — the continuable and
   fork case, exactly as the tool reports it;
2. `arguments.agent_id` — the `send_message` case;
3. the parent's `subagentsByParent` catalog matched on `description` — the
   foreground one-shot case, whose result is the child's answer rather than an
   id.

No child id means no expansion; the row falls back to showing the call's own
result text.

### The transcript

The child's history is only streamed to the browser while the child is the
selected Session, so the fold happens on the host:

```text
GET /api/subagent-subsession?session=<childId>
-> { ok, label, mode, provider, model, effort, prompt, cwd, createdAt,
     truncated, entries: [ {kind:'thinking'|'text'} | {kind:'tool', …} ] }
```

`ctx.sessionQuery.readSession(childId)` is live-preferred, so a running child's
log is read as it grows; the card polls every 2.5 s while the child is running
and stops when it is not. Limits: 4000 code points per reasoning/text block,
1600 per tool result, 200 per summary, 400 entries (oldest dropped and
`truncated: true`).

The fold skips fork-inherited events (`inheritedEventCount`) and takes the brief
only from the first `source.kind === "user"` message, so runtime-context
snapshots and relayed agent messages never masquerade as the task. Tool rows
pair `tool/call` with `tool/result` by `callId`; an unpaired call stays
`running`. Unreadable ids answer `{ ok: false, error }` at `200` rather than
failing the request — a live turn that cannot be replay-validated is a transient
state, not a client error.

## Verification record (2026-09-15, dsh 0.1.5-rc.2)

**Host-half unit checks** (stub context, real child log): route registration,
section order 2810, empty-without-budget, POST/GET/clear, out-of-range `400`,
and a fold of the real 556 KB child log
`session-924347e6…` producing 205 entries — 98 paired tool rows (none left
running), thinking and text blocks present, `web_search` summarized from its
`queries`, and the brief captured from the first user message.

**Isolated home end-to-end** (`DSH_HOME` copy of the profile + two copied
sessions, server on port 3082, Playwright):

- the selector renders next to the model control with `关闭, 3…10`;
- selecting `4` writes the mirror **and** the host (`GET` returns `4`);
- clearing `localStorage` and reloading shows `4` (adopted from the host);
- a **fresh browser context** with empty storage also shows `4` for that
  session (host-first reconciliation);
- sending "Use four subagents in parallel: each must reply with one different
  colour…" produced **4 concurrent delegation rows in one step** ("1 轮 1 步"),
  which the turn control summarized as `3 条消息 · 4 个 子代理`;
- expanding the cards rendered the children's briefs, model/effort
  (`deepseek-flash · high`), ids and live durations; once settled, the cards held
  11 folded entries across the four children (reasoning, `send_message` tool
  rows, replies);
- no console or page errors in any run.

**One measured harness fact** (now recorded in the top-level README): adding a
*new* row to `cordis.patch.yml` does **not** take effect in a running `dsh web`
— neither the served boot graph nor the host route table included the new row
until the process restarted. `patchReload: "live"` reloads composed rows; it does
not compose new ones. The order is `./install.sh` → restart `dsh web` → refresh.
Editing an already-composed plugin's source needs no restart.
