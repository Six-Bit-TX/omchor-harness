# Agent Note: reach the GPU from a confined command

Status: implemented

English | [中文](2026-09-17-confined-gpu-device-access.zh.md)

## Problem

A confined command could not reach this host's GPU. The bwrap profile mounts the host root read-only and replaces `/dev` with a fresh minimal devtmpfs, so `/dev/nvidia*` and `/dev/dri/renderD*` do not exist inside the sandbox; a plain bind cannot repair that, because bubblewrap mounts its binds no-dev and `open()` on a device node under one returns `EACCES`. `nvidia-smi`, CUDA and every training script failed, and the only way to run GPU work was to widen the session's policy and take an approval — an escalated retry for an environment capability rather than for a file effect.

## Decision

A wrap rebinds the host's GPU device nodes into the sandbox with bubblewrap's device-allowing bind. `hostGpuDevicePaths()` returns the nodes that exist at wrap time — `/dev/nvidiactl`, `/dev/nvidia-uvm`, `/dev/nvidia-uvm-tools`, `/dev/nvidia-modeset` and `/dev/nvidia-caps` when present, plus the numbered `/dev/nvidia<N>` and `/dev/dri/renderD<N>` entries — and `deviceBindArgs()` turns them into `--dev-bind` pairs. `bwrapProfileArgs()` and `landlockProfileArgs()` carry them; `seatbeltProfileArgs()` and the Windows rung do not, because Metal and the ACL token have no device node.

`gpuDevices` on `LocalSandboxProvider` (default `true`) governs the grant, and `false` withholds device access. Detection runs per wrap rather than once per provider lifetime, because the driver creates `/dev/nvidia-uvm` and `/dev/nvidia<N>` when it first loads. The functional bwrap probe shares the profile builder, so it binds the same nodes as a real wrap.

Device access is not a file effect. `SandboxMode` still governs filesystem writes only, a wrap still reports the same enforcement and denial signatures, and a host without these nodes detects an empty list and wraps exactly as before.

## Alternatives considered

- **Leave GPU work to an escalated retry.** That is what the sandbox did: the model requested a wider policy per GPU command. It spends an approval on an environment capability, and a permitted retry also drops the file-effect confinement the command did not need to lose.
- **Grant `/dev` wholesale.** One bind would hand over every host device node; the profile rebinds the named GPU nodes instead, and nothing else.
- **Include the DRM display nodes.** `/dev/dri/card*` serves display rather than compute; the render nodes and the NVIDIA character devices are what CUDA and NVML open.
- **Detect the nodes once at provider construction.** A server outlives the driver's first load, so a cached list can miss the nodes a later wrap needs; a few stats per wrap keep it current.
- **Default the grant off.** A GPU-less host detects an empty list either way, so defaulting to `false` would only move the same configuration onto every GPU host.

## Verification

- `pnpm exec vitest run packages/sandbox/sandbox-local packages/shell/bash-sandbox` passes 128 tests, including the real-bwrap test that confines `nvidia-smi -L` and reads `GPU 0` from the driver.
- Profile tests pin the argv: one `--dev-bind` pair per injected node after `--dev /dev`, and the same nodes as Landlock `--rw` grants.
- Config tests pin that `gpuDevices: false` removes the binds, and that the detected list holds existing paths only and no display node.

## Consequences

- GPU work runs confined: `nvidia-smi`, CUDA and the training entry points reach the driver without an escalated retry, and the file-effect policy is unchanged.
- Confined commands can now open the GPU device nodes, which is a real capability grant — driver ioctls and GPU memory — that a deployment withholds with `gpuDevices: false`.
- A host that falls back to the Landlock rung keeps GPU access through the same nodes; Seatbelt and the Windows rung are untouched.
- The wrap argv now depends on host state: tests inject `devicePaths` so a pinned argv never depends on whether the test host has a GPU.
