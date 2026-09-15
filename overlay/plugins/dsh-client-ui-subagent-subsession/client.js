/**
 * Subagent subsession — browser half.
 *
 * The parent conversation's delegation rows (`subagent`, `subagent_fork`,
 * `send_message`) expand into the child's own subsession: its reasoning, its
 * tool calls and their results, and the text it is producing, in order. The
 * transcript itself comes from this package's node half over the authenticated
 * `/api/subagent-subsession` route; while the child is still running the card
 * polls it, so an expanded subsession grows in place instead of freezing at the
 * moment it was opened.
 *
 * The row replaces the generic Tool card through the keyed `tool.call.toolview`
 * seat, which is exactly the seat a business-owned tool presentation registers
 * into — nothing here pairs Session events or rebuilds the transcript.
 *
 * @module @local/dsh-client-ui-subagent-subsession
 */

window.__ModuleLoader__.load({
  id: "@local/dsh-client-ui-subagent-subsession",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    /** This package's copy namespace. */
    const NS = "subagentSubsession";
    /** The node half's transcript route. */
    const ROUTE = "/api/subagent-subsession";
    /** How often an expanded, still-running subsession re-reads the child's log. */
    const POLL_MS = 2500;

    /**
     * The Sessions service's subagent navigation, bound by `apply`.
     * Held in module scope so the row component can reach it without a second
     * registration face; `apply` runs exactly once per plugin load.
     */
    let openSubagent = null;

    /**
     * Parse one raw Tool argument string.
     * @param argsRaw - the call's argument string.
     * @returns the parsed object, or undefined.
     */
    function parseArgs(argsRaw) {
      if (typeof argsRaw !== "string" || argsRaw.trim() === "") return undefined;
      try {
        const parsed = JSON.parse(argsRaw);
        return parsed !== null && typeof parsed === "object" ? parsed : undefined;
      } catch {
        return undefined;
      }
    }

    /**
     * Flatten one settled Tool result under the generic row's text contract.
     * @param block - the frozen call block.
     * @returns the flattened text, or null.
     */
    function resultText(block) {
      if (block === null || block === undefined || !("kind" in block)) return null;
      const parts = [];
      for (const item of block.content ?? []) {
        parts.push(item?.type === "text" ? item.text : JSON.stringify(item, null, 2));
      }
      if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`);
      return parts.join("\n") || null;
    }

    /**
     * The child id a settled call's own result names.
     * @param block - the frozen call block.
     * @returns the child Session id, or undefined.
     */
    function childIdFromResult(block) {
      const text = resultText(block);
      if (text === null) return null;
      const match = /started subagent ([0-9a-zA-Z-]{6,})/u.exec(text);
      return match === null ? null : match[1];
    }

    /**
     * The most recent catalog child whose creation label matches this call.
     *
     * A foreground one-shot call's result is the child's answer, not an id, so
     * the durable catalog entry created for the same `description` is the only
     * join available.
     * @param catalog - the parent's catalog snapshot.
     * @param args - the parsed call arguments.
     * @returns the child Session id, or undefined.
     */
    function childIdFromCatalog(catalog, args) {
      const entries = catalog?.entries;
      if (!Array.isArray(entries)) return undefined;
      const label = typeof args?.description === "string" ? args.description : undefined;
      if (label === undefined || label === "") return undefined;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry?.kind === "child" && entry.label === label) return entry.id;
      }
      return undefined;
    }

    /**
     * Format one duration the way the product's own timing rows do.
     * @param milliseconds - elapsed milliseconds.
     * @returns a compact duration.
     */
    function formatDuration(milliseconds) {
      const total = Math.max(0, Math.round(milliseconds / 1000));
      if (total < 60) return `${String(total)}s`;
      const minutes = Math.floor(total / 60);
      const seconds = total % 60;
      if (minutes < 60) return `${String(minutes)}m ${String(seconds)}s`;
      const hours = Math.floor(minutes / 60);
      return `${String(hours)}h ${String(minutes % 60)}m`;
    }

    /** Markdown labels the shipped renderer expects. */
    function markdownLabels(t) {
      return {
        code: { copyLabel: t("markdown.copy"), copiedLabel: t("markdown.copied") },
        footnotes: t("markdown.footnotes"),
      };
    }

    /** One tool entry's lifecycle dot. */
    function ToolState({ state }) {
      if (state === "running") return react.createElement(primitives.StateDot, { state: "ongoing" });
      if (state === "error") return react.createElement(primitives.StateDot, { state: "error" });
      return react.createElement(primitives.StateDot, { state: "done" });
    }

    /**
     * Render one folded transcript entry.
     * @param props - the entry plus copy.
     * @returns the entry node.
     */
    function Entry({ entry, labels, t }) {
      if (entry.kind === "thinking") {
        return react.createElement(
          "div",
          { className: "dsh-sub-entry dsh-sub-thinking" },
          react.createElement("div", { className: "dsh-sub-entry-label" }, t("entry.thinking")),
          react.createElement("div", { className: "dsh-sub-thinking-text" }, entry.text),
        );
      }
      if (entry.kind === "text") {
        return react.createElement(
          "div",
          { className: "dsh-sub-entry dsh-sub-text" },
          react.createElement(primitives.MarkdownText, { text: entry.text, labels }),
        );
      }
      return react.createElement(
        "details",
        { className: "dsh-sub-entry dsh-sub-tool" },
        react.createElement(
          "summary",
          { className: "dsh-sub-tool-head" },
          react.createElement("span", { className: "dsh-sub-tool-dot" }, react.createElement(ToolState, { state: entry.status })),
          react.createElement("code", { className: "dsh-sub-tool-name" }, entry.name),
          react.createElement("span", { className: "dsh-sub-tool-summary" }, entry.summary),
        ),
        entry.result === null
          ? react.createElement("div", { className: "dsh-sub-tool-empty" }, t("entry.noResult"))
          : react.createElement("pre", { className: "dsh-sub-tool-result" }, entry.result),
      );
    }

    /**
     * Render one delegation call as an expandable subsession.
     * @param props - the keyed toolview payload, standard Session props, and copy.
     * @returns the row.
     */
    function SubsessionRow({ block, sessionId, useSessions, t, inspect }) {
      const settled = block !== null && block !== undefined && typeof block === "object" && "kind" in block;
      const argsRaw = (settled ? block.call?.argsRaw : block?.argsRaw) ?? "";
      const args = parseArgs(argsRaw);
      const toolName = (settled ? block.call?.name : block?.name) ?? "subagent";
      const directId =
        (settled ? childIdFromResult(block) : null) ??
        (typeof args?.agent_id === "string" && args.agent_id !== "" ? args.agent_id : undefined);
      const catalog = useSessions((state) =>
        sessionId === undefined ? undefined : state.subagentsByParent[sessionId],
      );
      const childId = directId ?? childIdFromCatalog(catalog, args);
      const entry =
        childId === undefined
          ? undefined
          : catalog?.entries?.find((row) => row?.kind === "child" && row.id === childId);
      const child = useSessions((state) => (childId === undefined ? undefined : state.byId[childId]));
      const running = child?.running === true;
      const label =
        (typeof args?.description === "string" && args.description !== "" ? args.description : undefined) ??
        (typeof entry?.label === "string" && entry.label !== "" ? entry.label : undefined) ??
        (typeof args?.agent_id === "string" ? args.agent_id : undefined) ??
        undefined;
      const status = settled && block.isError === true ? "error" : running ? "running" : "inactive";
      const fallbackText = settled ? resultText(block) : null;
      const canExpand = childId !== undefined || (fallbackText !== null && fallbackText !== "");
      const [open, setOpen] = react.useState(false);
      const [transcript, setTranscript] = react.useState(null);
      const [failure, setFailure] = react.useState(null);
      const expanded = open && canExpand;

      react.useEffect(() => {
        if (!expanded || childId === undefined) return undefined;
        let cancelled = false;
        const load = async () => {
          try {
            const response = await fetch(`${ROUTE}?session=${encodeURIComponent(childId)}`);
            const body = await response.json();
            if (cancelled) return;
            if (body?.ok === true) {
              setTranscript(body);
              setFailure(null);
            } else {
              setFailure(typeof body?.error === "string" ? body.error : "unavailable");
            }
          } catch (error) {
            if (!cancelled) setFailure(String(error?.message ?? error));
          }
        };
        void load();
        if (!running) return () => { cancelled = true; };
        const timer = window.setInterval(load, POLL_MS);
        return () => {
          cancelled = true;
          window.clearInterval(timer);
        };
      }, [expanded, childId, running]);

      /* A fresh call target resets a previously expanded card. */
      react.useEffect(() => {
        setOpen(false);
        setTranscript(null);
        setFailure(null);
      }, [block?.callId]);

      const toggle = () => {
        if (canExpand) setOpen((value) => !value);
      };
      const onKeyDown = (event) => {
        if (!canExpand || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        toggle();
      };
      const openFull = (event) => {
        event.stopPropagation();
        if (childId === undefined || openSubagent === null) return;
        const mode = entry?.mode === "one-shot" ? "one-shot" : "continuable";
        try {
          openSubagent({ parentSessionId: sessionId, childSessionId: childId, mode });
        } catch {
          /* A catalog row that is no longer healthy refuses the navigation. */
        }
      };

      const timing = child?.projectionValues?.subagentTiming;
      const durationMs =
        (timing?.settledMs ?? 0) + (timing?.active === undefined ? 0 : timing.active.through - timing.active.since);
      const model = transcript?.model ?? undefined;
      const effort = transcript?.effort ?? undefined;
      const labels = react.useMemo(() => markdownLabels(t), [t]);
      const entries = transcript?.entries ?? [];

      return react.createElement(
        "div",
        { className: "dsh-sub", "data-state": status, "data-open": expanded ? "true" : "false" },
        react.createElement(
          "div",
          {
            className: "dsh-sub-head",
            role: canExpand ? "button" : undefined,
            tabIndex: canExpand ? 0 : undefined,
            "aria-expanded": canExpand ? expanded : undefined,
            onClick: toggle,
            onKeyDown,
          },
          react.createElement(
            "span",
            { className: "dsh-sub-leading" },
            react.createElement(primitives.IconChevronDownOutline14, {
              className: expanded ? "dsh-sub-chevron dsh-sub-chevron-open" : "dsh-sub-chevron",
            }),
          ),
          react.createElement("span", { className: "dsh-sub-title" }, t("row.title")),
          react.createElement("span", { className: "dsh-sub-separator", "aria-hidden": true }),
          react.createElement("span", { className: "dsh-sub-summary" }, label ?? toolName),
          status === "running"
            ? react.createElement(
                "span",
                { className: "dsh-sub-status" },
                react.createElement(primitives.StateDot, { state: "ongoing" }),
                react.createElement("span", null, t("row.running")),
              )
            : null,
          status === "error"
            ? react.createElement(
                "span",
                { className: "dsh-sub-status dsh-sub-status-error" },
                react.createElement(primitives.StateDot, { state: "error" }),
                react.createElement("span", null, t("row.failed")),
              )
            : null,
          durationMs > 0
            ? react.createElement("span", { className: "dsh-sub-duration" }, formatDuration(durationMs))
            : null,
          childId === undefined
            ? null
            : react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-sub-open",
                  title: t("row.open"),
                  onClick: openFull,
                },
                t("row.open"),
              ),
          inspect === undefined
            ? null
            : react.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-sub-open",
                  title: t("row.inspect"),
                  onClick: (event) => {
                    event.stopPropagation();
                    inspect();
                  },
                },
                t("row.inspect"),
              ),
        ),
        expanded
          ? react.createElement(
              "div",
              { className: "dsh-sub-body" },
              react.createElement(
                "div",
                { className: "dsh-sub-meta" },
                model === undefined
                  ? null
                  : react.createElement(
                      "span",
                      { className: "dsh-sub-meta-model" },
                      effort === undefined ? model : `${model} · ${effort}`,
                    ),
                childId === undefined ? null : react.createElement("code", { className: "dsh-sub-meta-id" }, childId),
              ),
              transcript?.prompt === null || transcript?.prompt === undefined
                ? null
                : react.createElement(
                    "details",
                    { className: "dsh-sub-brief" },
                    react.createElement("summary", null, t("row.brief")),
                    react.createElement("pre", { className: "dsh-sub-brief-text" }, transcript.prompt),
                  ),
              transcript === null && childId !== undefined
                ? react.createElement("div", { className: "dsh-sub-note" }, t("row.loading"))
                : null,
              failure === null ? null : react.createElement("div", { className: "dsh-sub-note" }, t("row.unavailable", { message: failure })),
              transcript?.truncated === true
                ? react.createElement("div", { className: "dsh-sub-note" }, t("row.truncated"))
                : null,
              entries.length === 0 && transcript !== null
                ? react.createElement("div", { className: "dsh-sub-note" }, t("row.empty"))
                : null,
              react.createElement(
                "div",
                { className: "dsh-sub-scroll" },
                entries.map((item, index) =>
                  react.createElement(Entry, { key: String(index), entry: item, labels, t }),
                ),
              ),
              childId === undefined && fallbackText !== null
                ? react.createElement("pre", { className: "dsh-sub-tool-result" }, fallbackText)
                : null,
            )
          : null,
      );
    }

    /** Simplified Chinese dictionary and key-set source of truth. */
    const zh = {
      "row.title": "子代理",
      "row.running": "运行中",
      "row.failed": "启动失败",
      "row.open": "打开完整会话",
      "row.inspect": "查看调用",
      "row.brief": "任务说明",
      "row.loading": "正在读取子代理会话…",
      "row.empty": "子代理还没有产生任何步骤。",
      "row.truncated": "内容较长，仅显示最新的部分。",
      "row.unavailable": "无法读取子代理会话：{message}",
      "entry.thinking": "思考",
      "entry.noResult": "（无输出）",
      "markdown.copy": "复制",
      "markdown.copied": "已复制",
      "markdown.footnotes": "脚注",
    };

    /** English dictionary, checked against the Chinese key set. */
    const en = {
      "row.title": "Subagent",
      "row.running": "Running",
      "row.failed": "Start failed",
      "row.open": "Open full session",
      "row.inspect": "Inspect call",
      "row.brief": "Brief",
      "row.loading": "Reading the subagent conversation…",
      "row.empty": "This subagent has not produced a step yet.",
      "row.truncated": "Long transcript: only the newest part is shown.",
      "row.unavailable": "Subagent conversation unavailable: {message}",
      "entry.thinking": "Thinking",
      "entry.noResult": "(no output)",
      "markdown.copy": "Copy",
      "markdown.copied": "Copied",
      "markdown.footnotes": "Footnotes",
    };

    /** The row's stylesheet, injected once per page. */
    const CSS = `
.dsh-sub{display:flex;flex-direction:column;min-width:0}
.dsh-sub-head{display:flex;align-items:center;gap:0;height:24px;min-width:0;position:relative;overflow:hidden;cursor:pointer}
.dsh-sub-head[role]{cursor:pointer}
.dsh-sub[data-state="running"] .dsh-sub-head:after{content:"";position:absolute;inset:0 auto 0 0;width:300px;pointer-events:none;background:linear-gradient(90deg,transparent 0%,color-mix(in srgb,var(--dsw-alias-bg-base) 60%,transparent) 55%,transparent 100%);animation:2.6s ease-out infinite dsh-sub-sweep}
@keyframes dsh-sub-sweep{0%{left:-300px}90%,to{left:100%}}
.dsh-sub-leading{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-right:6px;flex:none;color:var(--dsw-alias-label-secondary)}
.dsh-sub-chevron{transition:transform .12s ease}
.dsh-sub-chevron-open{transform:rotate(0deg)}
.dsh-sub:not([data-open="true"]) .dsh-sub-chevron{transform:rotate(-90deg)}
.dsh-sub-title{flex:none;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:24px}
.dsh-sub-separator{flex:none;width:2px;height:2px;margin:0 8px;border-radius:1px;background:var(--dsw-alias-label-caption)}
.dsh-sub-summary{flex:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:24px}
.dsh-sub-status{display:inline-flex;align-items:center;gap:4px;flex:none;margin-left:8px;color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}
.dsh-sub-status-error{color:var(--dsw-alias-state-error-primary)}
.dsh-sub-duration{flex:none;margin-left:8px;color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.dsh-sub-open{flex:none;margin-left:8px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;padding:1px 6px;border-radius:6px;cursor:pointer;opacity:0;transition:opacity .1s}
.dsh-sub:hover .dsh-sub-open,.dsh-sub-open:focus-visible{opacity:1}
.dsh-sub-open:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-sub-body{display:flex;flex-direction:column;gap:6px;margin:4px 0 6px 4px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-markdown-code-block)}
.dsh-sub-meta{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}
.dsh-sub-meta-id{font-family:var(--dsw-font-mono,ui-monospace,monospace);overflow-wrap:anywhere}
.dsh-sub-brief{border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 8px;color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}
.dsh-sub-brief summary{cursor:pointer}
.dsh-sub-brief-text{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;max-height:200px;overflow:auto}
.dsh-sub-note{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}
.dsh-sub-scroll{display:flex;flex-direction:column;gap:8px;max-height:380px;overflow:auto;padding-right:2px}
.dsh-sub-entry{min-width:0}
.dsh-sub-entry-label{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px;margin-bottom:2px}
.dsh-sub-thinking{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.dsh-sub-thinking-text{white-space:pre-wrap;overflow-wrap:anywhere;border-left:2px solid var(--dsw-alias-border-l2);padding-left:8px}
.dsh-sub-text{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.dsh-sub-tool{border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base)}
.dsh-sub-tool-head{display:flex;align-items:center;gap:6px;min-width:0;padding:3px 8px;cursor:pointer;list-style:none}
.dsh-sub-tool-head::-webkit-details-marker{display:none}
.dsh-sub-tool-dot{display:inline-flex;flex:none}
.dsh-sub-tool-name{flex:none;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px}
.dsh-sub-tool-summary{min-width:0;flex:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-caption);font-size:12px}
.dsh-sub-tool-result{margin:0;padding:6px 8px;border-top:.5px solid var(--dsw-alias-border-l2);white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px;line-height:18px}
.dsh-sub-tool-empty{padding:4px 8px;color:var(--dsw-alias-label-caption);font-size:12px;border-top:.5px solid var(--dsw-alias-border-l2)}
`;

    /** Inject the row's stylesheet once per page. */
    function installStyles() {
      const id = "@local/dsh-client-ui-subagent-subsession/subsession.css";
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(id)}]`) !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "@local/dsh-client-ui-subagent-subsession";
      tag.dataset.pluginCss = id;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** Required browser services: the Tool-view and locale registries, and Session navigation. */
    const inject = ["slots", "locale", "sessions"];

    /** The wire tool names whose rows become subsessions. */
    const TOOL_KEYS = ["subagent", "subagent_fork", "send_message"];

    /**
     * Client plugin body: register the dictionaries and the keyed delegation rows.
     * @param ctx - the client root context.
     */
    function apply(ctx) {
      installStyles();
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh,
            en,
          }),
        "subagent-subsession: dictionaries",
      );
      const sessions = ctx.sessions;
      openSubagent = (address) => {
        sessions.openSubagent(address);
      };
      ctx.slots.inject("tool.call.toolview", function* registerRows() {
        for (const key of TOOL_KEYS) {
          yield ctx.slots.register(
            {
              name: "tool.call.toolview",
              key,
              locale: NS,
            },
            SubsessionRow,
          );
        }
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    module.exports = exports;
    return module.exports;
  },
});
