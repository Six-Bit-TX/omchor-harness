# Agent Note: 让 Remote 方法名避开其命名空间服务

Status: implemented

[English](2026-09-17-remote-method-name-shadowing.md) | 中文

## 问题

workspace-files 服务新增了一个名为 `remove` 的删除方法。`workspaceFiles` 的生成式命名空间服务已经占用了该名字：`RemoteNamespaceService.remove(kind, method, token)`，即 Client 在卸载命名空间时调用的记账方法。安装该命名空间时抛出 `client api: method "workspaceFiles/remove" conflicts with its namespace service`，导致 `@deepseek-ai/dsh-api-remotes` 无法激活，48 个注入 `remote.*` 服务的条目停留在 pending，Web 启动以 `web boot: 49 entries did not activate` 结束。

启动页没有给出原因。它报告 `@deepseek-ai/dsh-api-remotes` 失败并打印未激活条目的数量；它不携带失败加载条目的原因，而一个始终未能启动的依赖项看起来就像一次独立的失败。harness 进程本身保持健康，终端没有输出，因此唯一的可观察结果只是一个报告大规模插件加载失败的浏览器页面。

同一份报告还带有来自另一个组件的错误：`bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`。本仓库没有任何 profile 传入 `--unshare-net`，因此这里的命令写不出这一行；它来自 Codex 宿主沙箱。把它当作 harness 失败的一部分，会把工作引向沙箱而不是插件。

## 决策

Remote 方法名不得是生成式命名空间服务已经应答的名字。被拒绝的集合是命名空间服务上可达的每个名字：它自身的原型成员（`remove`、`has`、`install`、`installDirect`、`installScoped`、`assertMethodAvailable`）、从 Cordis `Service` 原型与 `Object.prototype` 继承的一切，以及字段 `ctx`、`empty`、`invokeRemote`、`methods`、`name` 与 `namespace`。workspace-files 的删除方法命名为 `delete`，与既有的 `workspaces.delete` Remote 一致。

该检查在命名空间于 Client 安装时运行，位于 `RemoteNamespaceService.assertMethodAvailable`（packages/api/gateway/src/client/index.ts）。Typert 生成器只拒绝两个 Remote 争用同一个 endpoint id 以及重复的 Remote id；它不会把方法名与将要承载它的命名空间服务作比较，因此名字冲突是浏览器运行时的拒绝，而不是构建失败。

Gateway client 测试用夹具覆盖了该拒绝行为（packages/api/gateway/tests/gateway.client.spec.ts 中的 `@fixture/service-method-conflict` 与 `@fixture/service-own-property-conflict`）。没有任何检查把已发布的 Remote 方法名与被拒绝集合作比较，因此冲突的名字仍会在任何东西指出它之前先到达浏览器。

Client bundle 由组装服务器扫描插件行时读取的 `lib/client.js` 构建产物提供。因此修改 Remote 方法需要重跑承载它的构建 face——`lib/typert.remote-client.js` 走 Host pass，各浏览器 bundle 走 Client pass——并重启正在服务的进程。`pnpm run build:lib:client` 失败会保留上一份 bundle，服务器继续提供它。

本机的约束能力需要 `/etc/apparmor.d/bwrap` 为 `/usr/bin/bwrap` 授予 `userns`。在 Ubuntu 的 `kernel.apparmor_restrict_unprivileged_userns=1` 下，新的非特权用户命名空间会转移到 `/etc/apparmor.d/unprivileged_userns`，其第一条规则是 `audit deny capability`；bubblewrap 在该 profile 下无法写入 uid map 或拉起 loopback。两种状态下 `bwrap --version` 都返回 0，因此只有创建命名空间才能显示某个 runner 是否可用。

## 备选方案

- **重命名命名空间服务自身的成员。** `remove(kind, method, token)` 是 Client 自身的注册表记账，在卸载命名空间时调用；线路上的方法名是更容易更改的一侧，且两种角色保持分离。
- **去掉保留名检查。** 遮蔽服务自身机制名的 Remote 方法会让 `remote.workspaceFiles.remove(...)` 在业务调用与卸载之间产生歧义，因此检查保留、方法名迁移。
- **把启动页当作诊断。** 它报告失败的条目 id 与未激活条目的总数，既没有指出方法、冲突，也没有指出原因；只有通过拦截浏览器中提供的 bundle 才能看到该异常。
- **把粘贴来的沙箱错误当作事件的一部分。** 那段 argv 中的 `--unshare-net` 参数存在于 Codex 沙箱包装器中，本仓库任何地方都没有，因此本仓库的 bwrap profile 不可能写出它。

## 验证

- `pnpm exec vitest run packages/api/workspace-files` 通过 192 个测试，其中 8 个属于改名后的删除 endpoint。
- 在重启后的服务器上用无头浏览器渲染应用，控制台无错误、无 `Failed to load plugins`，且所提供的 combo bundle 包含 `workspaceFiles_delete` 而不含 `workspaceFiles_remove`。
- Gateway client 测试持续覆盖该拒绝：遮蔽命名空间服务成员的方法会以 `conflicts with its namespace service` 被拒绝。
- `bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true` 在本机装上 AppArmor profile 后返回 0，装之前返回 1。

## 后果

- 删除 endpoint 在线路上是 `delete`，而文件树保留 `remove` 作为自己的操作名。
- Remote 方法名成为需要评审的决定：一个错误的名字会停止承载它的命名空间以及注入它的每个条目，而启动页既没有指出方法也没有指出冲突。
- 启动页对失败的加载条目不打印原因，也没有检查把已发布的 Remote 方法名与被拒绝集合作比较，因此下一次冲突会以同样的方式报告自己。
- 使约束能力生效的 AppArmor profile 是本仓库之外的机器状态；换一台主机，或本机重建之后，每条受约束命令都会失败，直到重新安装该 profile。
