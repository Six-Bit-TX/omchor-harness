# Omchor Harness

English | [中文](README.zh.md)

Omchor Harness (`omh`) is a personal build of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), the open-source agent harness developed by [DeepSeek AI](https://deepseek.com). It keeps the upstream architecture — **everything is a plugin**, composed over vendored [Cordis](https://github.com/cordiverse/cordis) — and changes how the product presents itself, plus a few local preferences.

The build lives at [Six-Bit-TX/omchor-harness](https://github.com/Six-Bit-TX/omchor-harness) on the `local-upgrades` branch; `master` mirrors upstream.

Upstream documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## What this build changes

| Area | Change |
|---|---|
| Name and mark | Omchor Harness, its mark in the sidebar and hero, the browser title, the PWA name, the favicon |
| Command | `omh` replaces `dsh` for every CLI invocation |
| Session references | the per-message cap is raised from 3 to 10 |
| Local overlay | the plugins and profile rows kept in [Six-Bit-TX/dsh-overlay](https://github.com/Six-Bit-TX/dsh-overlay) |

Everything else — the runtime, the plugin model, the profiles, the settings schema, the session format, and the docs under `docs/` — is upstream and is kept rebased on its release tags.

## Relationship to DeepSeek Harness

This repository is a modified copy of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), used and distributed under its MIT License. [LICENSE](LICENSE) is upstream's file, unchanged, including DeepSeek's copyright notice; so are [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [SAFETY.md](SAFETY.md).

"DeepSeek", "DeepSeek Harness", and "DSH" are DeepSeek's names and marks. This build uses them only to state what it is built on: it claims no affiliation with DeepSeek and no endorsement by DeepSeek, and it renames only its own product surfaces. The contribution guides, the brand guidelines, and the upstream documentation are left as upstream wrote them.

## Run

### Run from source

To run Omchor Harness from this checkout:

```sh
pnpm install
pnpm run build
pnpm omh web
```

`pnpm run build` prepares the repository artifacts; `pnpm omh web` serves the Web UI at `http://127.0.0.1:3080` by default. Pass `--no-open` to skip the browser handoff. To build with the Omchor public values, use the overlay's `./build-source.sh`, which sets `DSH_CLIENT_TITLE` and projects the mark into `apps/web/public/favicon.svg` before building.

### Run the upstream package

The published npm package is upstream's, so it is not this build:

```sh
npx @deepseek-ai/dsh web
```

## Development

Start with the [development guide](docs/development.md) and the [architecture documentation](docs/architecture.md).

## License

MIT — see [LICENSE](LICENSE).
