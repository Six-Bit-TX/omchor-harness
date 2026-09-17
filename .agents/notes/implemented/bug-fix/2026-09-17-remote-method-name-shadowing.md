# Agent Note: check a Remote method name against its namespace service

Status: implemented

English | [中文](2026-09-17-remote-method-name-shadowing.zh.md)

## Problem

The workspace-files service added a deletion method named `remove`. The generated namespace service for `workspaceFiles` already answers to that name: `RemoteNamespaceService.remove(kind, method, token)`, the bookkeeping the Client calls while unmounting a namespace. Installing the namespace threw `client api: method "workspaceFiles/remove" conflicts with its namespace service`, which stopped `@deepseek-ai/dsh-api-remotes` from activating, left the forty-eight entries that inject `remote.*` services pending, and ended the web boot with `web boot: 49 entries did not activate`.

The boot page did not name the cause. It reported `@deepseek-ai/dsh-api-remotes` as failed and printed how many entries did not activate; it carries no reason for a failed loader entry, and a dependent that never starts reads like an independent failure. The harness process stayed healthy and its terminal printed nothing, so the only observable was a browser page reporting a mass plugin-load failure.

The same report also carried an error from another component: `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. No profile in this repository passes `--unshare-net`, so no command here writes that line; it comes from the Codex host sandbox. Reading it as part of the harness failure aims the work at the sandbox instead of at the plugin.

## Decision

A Remote method name must not be one the generated namespace service already answers to. The rejected set is every name reachable on the namespace service: its own prototype members (`remove`, `has`, `install`, `installDirect`, `installScoped`, `assertMethodAvailable`), everything inherited from the Cordis `Service` prototype and `Object.prototype`, and the fields `ctx`, `empty`, `invokeRemote`, `methods`, `name`, and `namespace`. The workspace-files deletion method is named `delete`, which matches the existing `workspaces.delete` Remote.

The check runs when the namespace installs on the Client, in `RemoteNamespaceService.assertMethodAvailable` (packages/api/gateway/src/client/index.ts). The Typert generator rejects two Remotes claiming one endpoint id and a Remote id that repeats; it does not compare a method name against the namespace service that will host it, so a collision is a browser-time refusal rather than a build failure.

Gateway client tests cover the refusal with fixtures (`@fixture/service-method-conflict` and `@fixture/service-own-property-conflict` in packages/api/gateway/tests/gateway.client.spec.ts). No check compares the shipped Remote method names against the rejected set, so a colliding name still reaches a browser before anything names it.

A Client bundle is served from the built `lib/client.js` bytes that the composing server reads while it scans plugin rows. Changing a Remote method therefore needs the hosting build face rerun — the Host pass for `lib/typert.remote-client.js`, the Client pass for each browser bundle — and the serving process restarted. A failing `pnpm run build:lib:client` leaves the previous bundle in place, and the server keeps serving it.

Confinement on this machine needed `/etc/apparmor.d/bwrap` to grant `userns` to `/usr/bin/bwrap`. With Ubuntu's `kernel.apparmor_restrict_unprivileged_userns=1`, a new unprivileged user namespace is transitioned into `/etc/apparmor.d/unprivileged_userns`, whose first rule is `audit deny capability`; bubblewrap cannot write its uid map or raise loopback under that profile. `bwrap --version` exits 0 in both states, so only creating a namespace shows whether a runner works.

## Alternatives considered

- **Rename the namespace service's own member.** `remove(kind, method, token)` is the Client's registry bookkeeping, called while unmounting a namespace; a wire method name is the cheaper side to change, and the two roles stay separate.
- **Drop the reserved-name check.** A Remote method that shadows the service's own machinery makes `remote.workspaceFiles.remove(...)` ambiguous between a business call and an unmount, so the check stays and the method name moves.
- **Take the boot page as the diagnosis.** It reports the failed entry id and a total of entries that did not activate, which names neither the method, nor the conflict, nor the reason; the throw is only visible by intercepting the served bundle in the browser.
- **Take the pasted sandbox error as part of the incident.** The `--unshare-net` flag in that argv exists in the Codex sandbox wrapper and nowhere in this repository, so this repository's bwrap profile cannot have written it.

## Verification

- `pnpm exec vitest run packages/api/workspace-files` passes 192 tests, including the eight of the renamed deletion endpoint.
- A headless browser on the restarted server renders the application with no console error and no `Failed to load plugins`, and the served combo bundle carries `workspaceFiles_delete` with no `workspaceFiles_remove`.
- Gateway client tests keep the refusal covered: a method that shadows a namespace-service member rejects with `conflicts with its namespace service`.
- `bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true` exits 0 on this host with the AppArmor profile installed, and exited 1 without it.

## Consequences

- The deletion endpoint is `delete` on the wire while the file tree keeps `remove` as its own operation name.
- A Remote method name is a reviewed decision: one wrong name stops the namespace that hosts it and every entry that injects it, and the boot page names neither the method nor the conflict.
- The boot page prints no reason for a failed loader entry, and no check compares shipped Remote method names against the rejected set, so the next collision reports itself the same way.
- The AppArmor profile that makes confinement work is machine state outside this repository; another host, or this host after a rebuild, fails every confined command until the profile is reinstalled.
