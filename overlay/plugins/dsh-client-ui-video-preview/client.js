window.__ModuleLoader__.load({
	id: "@local/dsh-client-ui-video-preview",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region \0dsh-css:video-preview/VideoPane.module.css
		const VIDEO_CSS = ".DSHVP_pane{box-sizing:border-box;flex-direction:column;flex:auto;height:100%;min-height:0;display:flex;font-family:var(--dsw-font-family)}.DSHVP_header{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:center;gap:4px;height:38px;padding:0 6px 0 16px;display:flex}.DSHVP_path{white-space:nowrap;flex:auto;min-width:0;margin-right:12px;font-size:12px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis}.DSHVP_name{color:var(--dsw-alias-label-primary)}.DSHVP_tool{height:28px;min-width:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:28px;flex:none;justify-content:center;align-items:center;gap:4px;padding:0 8px;font-size:12px;font-variant-numeric:tabular-nums;line-height:1;display:inline-flex}.DSHVP_tool:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.DSHVP_body{min-height:0;flex:auto;padding:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}.DSHVP_video{max-width:100%;max-height:100%;width:auto;height:auto;background:#000;border-radius:6px;display:block}.DSHVP_overlay{color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);background:var(--dsw-alias-bg-base);opacity:.86;justify-content:center;align-items:center;display:flex;position:absolute;inset:0}.DSHVP_overlay[data-transparent]{background:0 0;opacity:1;pointer-events:none}.DSHVP_overlay span{background:var(--dsw-alias-bg-layer-2);border-radius:14px;padding:6px 14px}.DSHVP_status{min-height:0;flex:auto;flex-direction:column;justify-content:center;align-items:center;gap:12px;padding:24px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);text-align:center;line-height:1.6;display:flex}.DSHVP_message{white-space:normal;margin:0}.DSHVP_retry{height:32px;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px);border:.5px solid var(--dsw-alias-border-l2);cursor:pointer;background:0 0;border-radius:16px;align-items:center;gap:6px;padding:0 14px;font-family:inherit;display:inline-flex}.DSHVP_retry:hover{background:var(--dsw-alias-interactive-bg-hover)}";
		const VIDEO_CSS_TAG_ID = "@local/dsh-client-ui-video-preview/VideoPane.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(VIDEO_CSS_TAG_ID) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@local/dsh-client-ui-video-preview";
			tag.dataset.pluginCss = VIDEO_CSS_TAG_ID;
			tag.textContent = VIDEO_CSS;
			document.head.appendChild(tag);
		}
		const css = {
			pane: "DSHVP_pane",
			header: "DSHVP_header",
			path: "DSHVP_path",
			name: "DSHVP_name",
			tool: "DSHVP_tool",
			body: "DSHVP_body",
			video: "DSHVP_video",
			overlay: "DSHVP_overlay",
			status: "DSHVP_status",
			message: "DSHVP_message",
			retry: "DSHVP_retry"
		};
		//#endregion
		//#region lib/types/client/address.js
		/**
		* The prefix every session-scoped file address opens with.
		*
		* A `dsh-resource://file/` address is either `session/<sessionId>/<path>` or
		* `absolute/<path>`; only the session form names the workspace scope the byte
		* route needs, which is why the tab type's `canOpen` accepts that form alone
		* and lets another type draw everything else.
		*/
		const SESSION_FILE_PREFIX = "dsh-resource://file/session/";
		/**
		* Read a session file address back into the scope and path to hand the route.
		* @param address - a tab's `dsh-resource://file/session/…` address.
		* @returns the session and path, or undefined for any other address.
		*/
		function sessionFileOf(address) {
			if (typeof address !== "string" || !address.startsWith(SESSION_FILE_PREFIX)) return void 0;
			const end = address.search(/[?#]/u);
			const rest = address.slice(SESSION_FILE_PREFIX.length, end === -1 ? void 0 : end).split("/");
			const id = rest.shift();
			if (id === void 0 || id === "" || rest.length === 0) return void 0;
			try {
				return {
					sessionId: decodeURIComponent(id),
					path: rest.map(decodeURIComponent).join("/")
				};
			} catch {
				return void 0;
			}
		}
		/**
		* Split a path for display: the directories through their last separator, and
		* the final segment after it.
		* @param path - POSIX or Windows path.
		* @returns the directory prefix (possibly empty) and the final segment.
		*/
		function pathPartsOf(path) {
			const trimmed = String(path).replace(/[/\\]+$/u, "");
			if (trimmed === "") return {
				directory: "",
				name: String(path)
			};
			const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1;
			return {
				directory: trimmed.slice(0, cut),
				name: trimmed.slice(cut)
			};
		}
		//#endregion
		//#region lib/types/client/media.js
		/** Media types the route serves, keyed by file suffix; the pane must claim the same set. */
		const VIDEO_MEDIA_TYPES = {
			mp4: "video/mp4",
			m4v: "video/mp4",
			webm: "video/webm",
			ogv: "video/ogg",
			ogg: "video/ogg",
			mov: "video/quicktime",
			mkv: "video/x-matroska"
		};
		/**
		* Resolve a supported filename to the media type the route will serve.
		* @param path - decoded workspace file path.
		* @returns the video media type, or undefined for an unregistered suffix.
		*/
		function videoMediaType(path) {
			const normalized = String(path).replaceAll("\\", "/");
			const name = normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
			return VIDEO_MEDIA_TYPES[name.slice(name.lastIndexOf(".") + 1)];
		}
		/**
		* The streaming URL one file is played from.
		*
		* A relative URL keeps the request same-origin, so the browser attaches the
		* session cookie that Connection's `/api` fence authenticates and no script
		* has to hold a credential. The route answers byte ranges, which is what lets
		* the player start on the first bytes and seek anywhere without waiting for
		* the file.
		* @param file - the tab's session and path.
		* @returns the URL to hand the video element.
		*/
		function videoSourceUrl(file) {
			return `/api/video-preview?session=${encodeURIComponent(file.sessionId)}&path=${encodeURIComponent(file.path)}`;
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** Simplified Chinese dictionary, the key-set source of truth. */
		const zh = {
			loading: "正在载入视频…",
			buffering: "正在缓冲…",
			reload: "重新载入",
			retry: "重试",
			preview: "视频：{name}",
			rate: "播放速度 {rate}×",
			rateLabel: "{rate}×",
			playbackFailed: "无法播放这个视频，浏览器可能不支持它的封装格式或编码。",
			unsupported: "这个地址不是可以播放的工作区视频文件。",
			notFound: "文件不存在，可能已被移动或删除。",
			unreachable: "无法读取视频（HTTP {status}）。"
		};
		/** English dictionary with the same keys as the Chinese one. */
		const en = {
			loading: "Loading video…",
			buffering: "Buffering…",
			reload: "Load again",
			retry: "Retry",
			preview: "Video: {name}",
			rate: "Playback speed {rate}×",
			rateLabel: "{rate}×",
			playbackFailed: "This video could not be played; the browser may not support its container or codec.",
			unsupported: "This address is not a playable workspace video file.",
			notFound: "File not found. It may have been moved or deleted.",
			unreachable: "The video could not be read (HTTP {status})."
		};
		//#endregion
		//#region lib/types/client/VideoPane.js
		/** JSX-free element constructor, so the bundle needs the react table entry alone. */
		const h = react.createElement;
		/** The speeds the header control cycles through; the player's own menu offers the rest. */
		const SPEEDS = [
			1,
			1.5,
			2
		];
		/**
		* One video tab: the toolbar, the route's answer, and the streaming player.
		*
		* The bytes never pass through this component. Handing the element a range
		* URL lets the browser fetch what it needs when it needs it — the first frames
		* to start playing, later ranges while it plays, and whatever offset a seek or
		* a 2× rate asks for — so a long capture plays immediately and seeking to the
		* middle is one request, not a wait for the whole file.
		* @param props - the tab hook and copy.
		* @returns the tab's body.
		*/
		function VideoPane({ useTabInfo, t }) {
			const { tab } = useTabInfo();
			const address = tab.contentId;
			const file = (0, react.useMemo)(() => sessionFileOf(address), [address]);
			const mediaType = file === void 0 ? void 0 : videoMediaType(file.path);
			const url = file === void 0 || mediaType === void 0 ? void 0 : videoSourceUrl(file);
			const [attempt, setAttempt] = (0, react.useState)(0);
			const [status, setStatus] = (0, react.useState)("probing");
			const [buffering, setBuffering] = (0, react.useState)(false);
			const [speed, setSpeed] = (0, react.useState)(0);
			const playerRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (url === void 0) return void 0;
				const controller = new AbortController();
				let live = true;
				setStatus("probing");
				setBuffering(false);
				fetch(url, {
					method: "HEAD",
					signal: controller.signal,
					cache: "no-store"
				}).then((response) => {
					if (!live) return;
					if (response.ok) setStatus("ready");
					else if (response.status === 404) setStatus("missing");
					else setStatus(`unreachable:${String(response.status)}`);
				}).catch(() => {
					if (live) setStatus("unreachable:0");
				});
				return () => {
					live = false;
					controller.abort();
				};
			}, [
				url,
				attempt
			]);
			(0, react.useEffect)(() => {
				const player = playerRef.current;
				if (player !== null) player.playbackRate = SPEEDS[speed] ?? 1;
			}, [speed, status]);
			const reload = () => setAttempt((value) => value + 1);
			const cycleSpeed = () => setSpeed((value) => (value + 1) % SPEEDS.length);
			const { directory, name } = pathPartsOf(file === void 0 ? address : file.path);
			const displayPath = file === void 0 ? address : file.path;
			const blocked = status === "missing" || status.startsWith("unreachable:");
			const overlay = file === void 0 || mediaType === void 0 || blocked ? void 0 : status !== "ready" ? t("loading") : buffering ? t("buffering") : void 0;
			return h("div", {
				className: css.pane,
				"data-video-preview": address
			}, h("div", { className: css.header },
				h("span", {
					className: css.path,
					title: displayPath
				}, h("span", { className: css.name }, name), directory === "" ? null : directory),
				file === void 0 || mediaType === void 0 ? null : h("button", {
					type: "button",
					className: css.tool,
					title: t("rate", { rate: SPEEDS[speed] }),
					"aria-label": t("rate", { rate: SPEEDS[speed] }),
					"data-video-preview-rate": SPEEDS[speed],
					onClick: cycleSpeed
				}, t("rateLabel", { rate: SPEEDS[speed] })),
				h("button", {
					type: "button",
					className: css.tool,
					title: t("reload"),
					"aria-label": t("reload"),
					"data-video-preview-reload": true,
					onClick: reload
				}, "⟳")),
			file === void 0 || mediaType === void 0 ? h("div", {
				className: css.status,
				role: "alert"
			}, h("p", { className: css.message }, t("unsupported"))) : null,
			blocked ? h("div", {
				className: css.status,
				role: "alert",
				"data-video-preview-failed": status
			}, h("p", { className: css.message }, status === "missing" ? t("notFound") : t("unreachable", { status: status.slice("unreachable:".length) })),
				h("button", {
					type: "button",
					className: css.retry,
					"data-video-preview-retry": true,
					onClick: reload
				}, t("retry"))) : null,
			file === void 0 || mediaType === void 0 || blocked ? null : h("div", { className: css.body },
				h("video", {
					key: attempt,
					ref: playerRef,
					className: css.video,
					src: url,
					controls: true,
					preload: "metadata",
					playsInline: true,
					"aria-label": t("preview", { name }),
					"data-video-preview-player": true,
					onLoadedData: () => {
						const player = playerRef.current;
						if (player !== null) player.playbackRate = SPEEDS[speed] ?? 1;
						setStatus("ready");
						setBuffering(false);
					},
					onPlaying: () => setBuffering(false),
					onWaiting: () => setBuffering(true),
					onError: () => setStatus("playbackFailed")
				}),
				overlay === void 0 ? null : h("div", {
					className: css.overlay,
					"data-transparent": status === "ready" ? "" : void 0,
					"data-video-preview-overlay": true
				}, h("span", null, overlay))),
			status === "playbackFailed" ? h("div", {
				className: css.status,
				role: "alert",
				"data-video-preview-failed": status
			}, h("p", { className: css.message }, t("playbackFailed")),
				h("button", {
					type: "button",
					className: css.retry,
					"data-video-preview-retry": true,
					onClick: reload
				}, t("retry"))) : null);
		}
		//#endregion
		//#region lib/types/client/index.js
		/** This package's copy namespace. */
		const NS = "sidebarVideoPreview";
		/** This implementation's identity in the tab system, and the key its body registers under. */
		const TAB_ID = "@local/dsh-client-ui-video-preview";
		/**
		* Type discriminator for video tabs.
		*
		* A fresh kind rather than a takeover of the document preview's `text` kind:
		* the registry admits one builtin and one extension per kind, and a type with
		* its own kind simply outranks the `fallback` viewer on its own globs.
		*/
		const TAB_KIND = "video";
		/** Address globs this type claims, matched against the URI path at any depth. */
		const VIDEO_PATTERNS = [
			"*.mp4",
			"*.m4v",
			"*.webm",
			"*.ogv",
			"*.ogg",
			"*.mov",
			"*.mkv"
		];
		/**
		* Required browser services: the tab-type registry, the slot registry, and copy.
		*
		* The bytes come from the node half's authenticated route, so nothing here
		* needs the Remote carrier or a file reader.
		*/
		const inject = [
			"slots",
			"locale",
			"sidebarRightTabs"
		];
		/**
		* Client plugin body: register the type, its dictionary, and its tab body.
		*
		* The type goes through the same public path the shipped guide and document
		* preview types use, so nothing here reaches into the Sidebar, its store, or
		* another package: the definition into `ctx.sidebarRightTabs`, and the body
		* into the keyed `sidebar.right.pane.tab` seat under the same id.
		* @param ctx - client root context carrying the registry, the slots, and copy.
		*/
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "video-preview: dictionaries");
			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: TAB_ID,
				kind: TAB_KIND,
				patterns: VIDEO_PATTERNS,
				canOpen: (address) => sessionFileOf(address) !== void 0,
				title: (address) => pathPartsOf(sessionFileOf(address)?.path ?? address).name
			}), "video-preview: type");
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: TAB_ID,
				locale: NS
			}, VideoPane)), "video-preview: body");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
