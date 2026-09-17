# Omchor Harness

[English](README.md) | 中文

Omchor Harness（`omh`）是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的个人构建版本，DeepSeek Harness 是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness。本项目保留上游架构——**一切皆插件**，组合在 vendored [Cordis](https://github.com/cordiverse/cordis) 之上——只改变产品自身的呈现方式，以及少量本地偏好。

本构建位于 [Six-Bit-TX/omchor-harness](https://github.com/Six-Bit-TX/omchor-harness) 的 `local-upgrades` 分支；`master` 与上游保持同步。

上游文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 这个构建改了什么

| 方面 | 改动 |
|---|---|
| 名称与标记 | Omchor Harness，侧边栏与首屏使用自己的标记，浏览器标题、PWA 名称、favicon |
| 命令 | 所有 CLI 调用以 `omh` 取代 `dsh` |
| 会话引用 | 每条消息的引用上限由 3 提升到 10 |
| 本地 overlay | 插件与 profile 行保存在 [Six-Bit-TX/dsh-overlay](https://github.com/Six-Bit-TX/dsh-overlay) |

其余部分——运行时、插件模型、profile、设置 schema、会话格式，以及 `docs/` 下的文档——都来自上游，并按上游的发布 tag 持续 rebase。

## 与 DeepSeek Harness 的关系

本仓库是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的修改副本，依据其 MIT 许可证使用与分发。[LICENSE](LICENSE) 是上游文件，未作修改，其中保留 DeepSeek 的版权声明；[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [SAFETY.zh.md](SAFETY.zh.md) 同样保持原样。

“DeepSeek”“DeepSeek Harness”“DSH”是 DeepSeek 的名称与商标。本构建仅在说明自身基于何处构建时使用它们：不与 DeepSeek 存在隶属关系，也不代表 DeepSeek 的认可，且只重命名属于本构建自己的产品界面。贡献指南、品牌指南与上游文档均保持上游原文。

<a id="run"></a>

## 运行

<a id="run-from-source"></a>

### 从源码运行

从本检出运行 Omchor Harness：

```sh
pnpm install
pnpm run build
pnpm omh web
```

`pnpm run build` 准备仓库产物；`pnpm omh web` 默认在 `http://127.0.0.1:3080` 提供 Web UI，加 `--no-open` 可跳过打开浏览器。若要以 Omchor 的公开构建值构建，请使用 overlay 的 `./build-source.sh`：它会在构建前设置 `DSH_CLIENT_TITLE` 并把标记投射到 `apps/web/public/favicon.svg`。

### 运行上游包

npm 上的发布包属于上游，因此不是本构建：

```sh
npx @deepseek-ai/dsh web
```

## 开发

请从[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)开始。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
