# Agent Note: 让受约束命令访问 GPU

Status: implemented

[English](2026-09-17-confined-gpu-device-access.md) | 中文

## 问题

受约束命令无法访问本机 GPU。bwrap profile 以只读方式挂载宿主根目录，并用全新的最小 devtmpfs 替换 `/dev`，因此沙箱内没有 `/dev/nvidia*` 与 `/dev/dri/renderD*`；普通绑定也无法补救，因为 bubblewrap 的绑定挂载均为 no-dev，在这样的挂载下 `open()` 设备节点返回 `EACCES`。`nvidia-smi`、CUDA 以及所有训练脚本都会失败，运行 GPU 工作的唯一途径是放宽会话策略并取得批准——为一项环境能力而非文件影响付出升级重试。

## 决策

wrap 会用 bubblewrap 允许设备访问的绑定方式把宿主 GPU 设备节点重新绑进沙箱。`hostGpuDevicePaths()` 返回 wrap 时实际存在的节点——`/dev/nvidiactl`、`/dev/nvidia-uvm`、`/dev/nvidia-uvm-tools`、`/dev/nvidia-modeset`，以及存在时的 `/dev/nvidia-caps`，外加带编号的 `/dev/nvidia<N>` 与 `/dev/dri/renderD<N>`——`deviceBindArgs()` 将它们转换为 `--dev-bind` 对。`bwrapProfileArgs()` 与 `landlockProfileArgs()` 都会带上这些参数；`seatbeltProfileArgs()` 与 Windows rung 不带，因为 Metal 与 ACL 令牌没有设备节点概念。

`LocalSandboxProvider` 的 `gpuDevices`（默认 `true`）决定该授权，`false` 则拒绝设备访问。探测在每次 wrap 时进行而不是在提供方生命周期内只做一次，因为驱动在首次加载时才会创建 `/dev/nvidia-uvm` 与 `/dev/nvidia<N>`。bwrap 功能探测复用同一个 profile 构建器，因此它与真实 wrap 绑定相同的节点。

设备访问不是文件影响。`SandboxMode` 仍只约束文件系统写入，wrap 报告的强制执行程度与否决签名不变，而没有这些节点的主机探测到空列表，wrap 行为与之前完全一致。

## 备选方案

- **把 GPU 工作留给升级重试。** 这正是沙箱此前的行为：模型为每条 GPU 命令申请更宽策略。它把一次批准花在一项环境能力上，而被批准的升级重试还会一并丢掉本条命令本不必失去的文件影响约束。
- **整体授予 `/dev`。** 一次绑定就会交出宿主上所有设备节点；profile 改为只重新绑定具名的 GPU 节点，其余一概不授。
- **把 DRM 显示节点也包含进来。** `/dev/dri/card*` 面向显示而非计算；CUDA 与 NVML 打开的是 render 节点与 NVIDIA 字符设备。
- **在提供方构造时只探测一次。** 服务器生命周期长于驱动的首次加载，缓存列表可能漏掉后续 wrap 需要的节点；每次 wrap 做几次 stat 即可保持最新。
- **默认关闭该授权。** 没有 GPU 的主机两种情况都探测到空列表，因此默认 `false` 只是把同一份配置转嫁给每台有 GPU 的主机。

## 验证

- `pnpm exec vitest run packages/sandbox/sandbox-local packages/shell/bash-sandbox` 通过 128 个测试，其中包括在真实 bwrap 中执行 `nvidia-smi -L` 并从驱动读到 `GPU 0` 的测试。
- profile 测试固定了 argv：在 `--dev /dev` 之后，每个注入节点对应一个 `--dev-bind` 对，并且同样的节点作为 Landlock 的 `--rw` 授权。
- 配置测试固定了 `gpuDevices: false` 会移除这些绑定，以及探测到的列表只包含存在的路径且不含显示节点。

## 后果

- GPU 工作可在受约束状态下运行：`nvidia-smi`、CUDA 与各训练入口无需升级重试即可访问驱动，且文件影响策略保持不变。
- 受约束命令现在可以打开 GPU 设备节点，这是真实的权限授予——驱动 ioctl 与 GPU 显存——部署方可用 `gpuDevices: false` 拒绝。
- 回退到 Landlock rung 的主机通过同一批节点保留 GPU 访问；Seatbelt 与 Windows rung 不受影响。
- wrap 的 argv 现在依赖主机状态：测试注入 `devicePaths`，使固定的 argv 不再取决于测试主机是否拥有 GPU。
