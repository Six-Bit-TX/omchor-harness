---
description: "dsh Web 客户端右侧 Sidebar 的文件树 tab 类型：通过网络逐层列出会话工作区根目录，按资源地址把文件打开到 Sidebar。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-files

[English](README.md) | 中文

## 概述

右侧 Sidebar 的导航器 tab 类型：把会话的工作区根目录画成一棵树，逐层经线上列出，并把文件打开到 Sidebar 里。它是从引导页进入的页类型，不认领任何地址；它按地址打开文件，交给 `dsh-resource://file` 的查看器认领：`ui-sidebar-right` 里没有任何东西认识本包。

## 目录

- [注册了什么](#what-it-registers)
- [树](#the-tree)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-it-registers"></a>
## 注册了什么

- **类型**：`ctx.sidebarRightTabs.register(...)`，kind 为 `files`，id 为 `@deepseek-ai/dsh-client-ui-sidebar-files`，档位 `builtin`，没有 patterns，另有一个打开该类型的引导页入口（order 10，标题与描述取自 `sidebarFiles` 命名空间，图标是共享的文件夹图标）。
- **正文**：以该 id 为键的 `sidebar.right.pane.tab` slot：strip 下的一行地址行，然后是树。地址行是文档预览（`ui-sidebar-documentpreview`）路径行加两个控件：路径本身就是地址，可就地编辑（点击换成以该 tab 的根为初值的文本框；Enter 列出所输入的地址，Escape 与失焦恢复显示），行首的文件夹按钮打开位置菜单，右端是重新读取。这一行是复制而非共享，因为插件 bundle 只经平台模块共享运行时代码；待 artifact 与各 slot 的形态定下来后，可以在 `ui-primitives` 放一份供每个 pane 标题行使用。
- **标签页标题**：以该 id 为键的 `sidebar.right.pane.tab.title` slot：类型标签前的一枚 16px 共享 `FileTypeIcon` 文件夹图标。树本身的行不画这枚图标。

`src/client/` 下十二个源文件：`definition.tsx`（类型是什么）、`store.ts`（它保存什么）、`face.ts`（它如何列目录与改动，含 Remote 绑定）、`FilesBody.tsx`（它画什么，含排序辅助函数）、`PathHeader.tsx`（地址行与位置菜单）、`EntryMenu.tsx`（行菜单）、`RenameDialog.tsx`、`DeleteDialog.tsx`、`CompareDialog.tsx`、`TimelineDialog.tsx`（四个对话框）、`paths.ts` 与 `download.ts`（以 `/` 拼接的路径辅助函数与浏览器下载）、`failures.ts`（失败行）、`FilesTitle.tsx`（标签页标题）、`locales.ts`（它说什么）、`index.ts`（接线）。

<a id="the-row-menu"></a>
## 行菜单

右键会在指针处用共享的 `Menu` 原语为一个条目打开菜单：打开（仅文件）、选择以进行比较、与已选文件进行比较（仅当该 tab 已选中比较基准时）、打开时间线（仅文件）、复制路径、复制相对路径（相对该 tab 的根）、下载（仅文件）、重命名与删除。复制经平台剪贴板写入；下载用 `workspaceFiles.readAll` 读出完整文件并把 Blob URL 交给浏览器。

重命名与删除是本 tab 仅有的两个 Host 改动，且都被限制在会话工作区根内：`workspaceFiles.rename` 与 `workspaceFiles.delete` 会拒绝目录越过该根的路径。重命名打开的对话框拒绝空白名、含 `/` 或 `\` 的名字以及未改动的名字；删除先打开一个点名该条目的确认框。比较各自读取一页（2000 行）并用共享的 `DiffBlock` 渲染，被上限截断的一侧会注明。时间线列出该文件的 `git log`——最多 50 个提交、最新的在前——git 报告没有历史时如实说明；该路径不再另行检查是否属于仓库，因此仓库之外的文件就是没有历史。

<a id="the-tree"></a>
## 树

根是会话的工作目录，读自 `useSessions().byId[sessionId].cwd`，地址行里的拆分由 `@deepseek-ai/dsh-util-workspace-path` 的 `pathPartsOf` 给出。地址可就地编辑，因此该 tab 可以根在 Host 能列出的任何目录上——包括会话工作区之外的目录——位置菜单则提供 Client 已知的每个 Workspace、会话工作目录、Host 账户的主目录，以及该 tab 访问过的目录（最新的在前，最多八个）。新打开的 tab 总是从会话工作目录开始。每一层以绝对路径为键；子路径是父路径以 `/` 拼上条目名。一层在首次展开时经 `@deepseek-ai/dsh-api-workspace-files` 命名空间的 `remote.workspaceFiles.list(sessionId, absolutePath)` 列出；适配器保留列表的条目与截断标志，丢弃其工作区相对路径。行序为目录优先，其后按自然序、不分大小写的名称排列；dotfiles 与其他条目一样显示。

| 条目类型 | 行 |
|---|---|
| `directory` | 切换展开与折叠；该层在首次打开时拉取，折叠期间保留。 |
| `file` | 经 `useTabInfo().tab.actions.openResource` 打开 `dsh-resource://file/session/<sessionId>/<encoded path relative to the root>`，地址由 `@deepseek-ai/dsh-util-workspace-path` 的 `fileAddressFor` 从条目的绝对路径与树的根生成，落在该 tab 自己的 pane 里。 |
| `other` | 灰显且不可点击，从而完整呈现目录内容。 |

被端点条目上限截断的层以一条标记收尾；空层如实说明；失败的层按错误码各显示一行（`workspace-file/not-found`、`outside-workspace`、`not-directory`），其他情况显示传输层自己的消息。重新读取丢弃所有已列出的层并只对展开中的层重新请求；折叠的层在下次打开时重新拉取。没有工作目录的会话只显示一行说明，而不是树。

状态保存在类型自己的存储里，按 tab id 分桶：`root`、`levels`（每个绝对路径的 loading / ready / failed）、`expanded`、`scrollTop`、`recent`（该 tab 访问过的目录）与 `compareBase`（选中用于比较的条目）。滚动期间偏移由正文自己记录，卸载时一次性写入。存储比 body 活得久，切到其他侧栏 tab 再切回来时树带着已加载的层重新挂载，滚动位置与已选比较基准也随之恢复。owner 的 `signal` 终结一个桶：中止时忘掉该 tab，其后才结算的列表与卸载时的偏移提交都什么也不写。

<a id="model-experience"></a>
## 模型体验

无，因为本包在浏览器里绘制工作区文件树，不注册任何面向模型的内容。

#### KV Cache 影响

无；目录列表经 Remote 传输，不会组装模型请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>
- **改动限制在工作区内。**重命名与删除会拒绝目录越过会话工作区根的条目，尽管列目录与读取能到更远的地方；剪切/复制/粘贴、搜索、拖拽、当前文件高亮与文件系统监听都没有——一层只会因重新读取、改动后对受影响层的重读，或导航手势而变化。
- **是列目录，不是文件管理器。**本包本身不需要 git，但时间线动词会如实报告文件所在目录的 `git log` 结果，因此仓库之外的文件——或 `PATH` 上没有 git 的主机——得到的是没有历史，而不是报错。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布 companion。树唯一的运行时状态是每 tab 一份的 Slot store，由持有它的正文写入、随 tab 的中止信号忘掉；没有第二个观测源可与之比对。
