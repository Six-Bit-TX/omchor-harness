/**
 * Subagent fan-out budget — browser half.
 *
 * One compact control in the composer's tool row, immediately left of the model
 * seat: how many subagents the agent should fan this Session's work out to
 * (off, or 3–10). The control owns the choice for the browser's lifetime and
 * mirrors it into `localStorage` so a reload restores it; the node half owns the
 * model-visible consequence (a scoped system-prompt directive) and this half
 * publishes every change to it over the authenticated `/api/subagent-fanout`
 * route, including once on mount so a host reload converges back.
 *
 * The control never renders for a subagent conversation: a delegated child does
 * not delegate, and its composer is a read-only record.
 *
 * @module @local/dsh-subagent-fanout
 */

window.__ModuleLoader__.load({
  id: "@local/dsh-subagent-fanout",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");

    /** This package's copy namespace. */
    const NS = "subagentFanout";
    /** The node half's authenticated route. */
    const ROUTE = "/api/subagent-fanout";
    /** Selectable fan-out floor. */
    const MIN_COUNT = 3;
    /** Selectable fan-out ceiling. */
    const MAX_COUNT = 10;
    /** Browser mirror key prefix; the suffix is the Session id. */
    const STORAGE_PREFIX = "dsh.subagentFanout.";

    /** Every selectable value in display order: off, then the range. */
    const VALUES = [0, 3, 4, 5, 6, 7, 8, 9, 10].filter(
      (value) => value === 0 || (value >= MIN_COUNT && value <= MAX_COUNT),
    );

    /**
     * Read one Session's mirrored choice.
     * @param sessionId - the Session whose composer is mounted.
     * @returns a valid count, or 0 for off.
     */
    function readCount(sessionId) {
      try {
        const raw = window.localStorage.getItem(STORAGE_PREFIX + sessionId);
        if (raw === null) return 0;
        const value = Number(raw);
        if (!Number.isInteger(value)) return 0;
        return VALUES.includes(value) ? value : 0;
      } catch {
        /* A blocked storage keeps the control usable for this page's lifetime. */
        return 0;
      }
    }

    /**
     * Mirror one Session's choice into browser storage.
     * @param sessionId - the Session whose composer is mounted.
     * @param count - the chosen count.
     */
    function writeCount(sessionId, count) {
      try {
        window.localStorage.setItem(STORAGE_PREFIX + sessionId, String(count));
      } catch {
        /* See readCount: storage is an optimization, not the source of truth. */
      }
    }

    /**
     * Publish one Session's choice to the node half.
     * @param sessionId - the Session whose composer is mounted.
     * @param count - the chosen count.
     * @returns completion; a failed publish is silent because the next mount republishes.
     */
    async function publish(sessionId, count) {
      try {
        await fetch(ROUTE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, count }),
        });
      } catch {
        /* Offline or host-reloading: the mount republish is the retry. */
      }
    }

    /**
     * The composer's fan-out control.
     * @param props - Session standard props plus this package's copy.
     * @returns the control, or null inside a subagent conversation.
     */
    function FanoutControl({ sessionId, useSession, t }) {
      const subagent = useSession((snapshot) => snapshot.subagent);
      const [count, setCount] = react.useState(() => readCount(sessionId));
      react.useEffect(() => {
        let cancelled = false;
        const local = readCount(sessionId);
        setCount(local);
        /*
         * The host is the thing the model actually obeys, so it wins when it
         * already holds a decision for this Session (another tab, or a reload
         * after this page's storage was cleared); otherwise this page's mirror
         * is republished, which is how a restarted host converges back.
         */
        (async () => {
          try {
            const response = await fetch(`${ROUTE}?session=${encodeURIComponent(sessionId)}`);
            const body = await response.json();
            if (cancelled) return;
            const hostCount =
              typeof body?.count === "number" && VALUES.includes(body.count) ? body.count : 0;
            if (hostCount > 0) {
              writeCount(sessionId, hostCount);
              setCount(hostCount);
              return;
            }
          } catch {
            /* Fall through to the republish path. */
          }
          if (!cancelled) void publish(sessionId, local);
        })();
        return () => {
          cancelled = true;
        };
      }, [sessionId]);
      /* A delegated child has no composer of its own and never delegates. */
      if (subagent !== null && subagent !== undefined) return null;
      const onChange = (event) => {
        const next = Number(event.target.value);
        setCount(next);
        writeCount(sessionId, next);
        void publish(sessionId, next);
      };
      return react.createElement(
        "label",
        {
          className: "dsh-fanout",
          "data-on": count === 0 ? "false" : "true",
          title: t("control.title"),
        },
        react.createElement(
          "span",
          { className: "dsh-fanout-glyph", "aria-hidden": true },
          react.createElement(
            "svg",
            { viewBox: "0 0 16 16", width: 14, height: 14, fill: "none" },
            react.createElement("circle", { cx: 8, cy: 3.5, r: 2, fill: "currentColor" }),
            react.createElement("circle", { cx: 3.5, cy: 12, r: 2, fill: "currentColor" }),
            react.createElement("circle", { cx: 12.5, cy: 12, r: 2, fill: "currentColor" }),
            react.createElement("path", {
              d: "M8 5.5v2.2M8 7.7 4.2 10.6M8 7.7l3.8 2.9",
              stroke: "currentColor",
              strokeWidth: 1.1,
              strokeLinecap: "round",
            }),
          ),
        ),
        react.createElement("span", { className: "dsh-fanout-label" }, t("control.label")),
        react.createElement(
          "select",
          {
            className: "dsh-fanout-select",
            "aria-label": t("control.aria"),
            value: String(count),
            onChange,
          },
          VALUES.map((value) =>
            react.createElement(
              "option",
              { key: String(value), value: String(value) },
              value === 0 ? t("control.off") : String(value),
            ),
          ),
        ),
      );
    }

    /** Simplified Chinese dictionary and key-set source of truth. */
    const zh = {
      "control.label": "子代理",
      "control.off": "关闭",
      "control.aria": "派发的子代理数量",
      "control.title":
        "设置本会话的子代理数量（3–10）。模型会据此把任务拆成多个独立子任务并并行委派；选择“关闭”则不注入任何指令。",
    };

    /** English dictionary, checked against the Chinese key set. */
    const en = {
      "control.label": "Subagents",
      "control.off": "Off",
      "control.aria": "Number of subagents to dispatch",
      "control.title":
        "Set this session's subagent count (3–10). The model is told to split the task into that many independent workstreams and dispatch them in parallel. Off injects nothing.",
    };

    /** The control's stylesheet, injected once per page. */
    const CSS = `
.dsh-fanout{display:inline-flex;align-items:center;gap:2px;height:28px;padding:0 6px;border-radius:8px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;cursor:pointer;user-select:none}
.dsh-fanout:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fanout[data-on="true"]{color:var(--dsw-alias-label-primary)}
.dsh-fanout-glyph{display:inline-flex;align-items:center;justify-content:center;flex:none;color:var(--dsw-alias-label-tertiary)}
.dsh-fanout[data-on="true"] .dsh-fanout-glyph{color:var(--dsw-alias-label-secondary)}
.dsh-fanout-label{white-space:nowrap}
.dsh-fanout-select{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:0;margin:0;outline:none;text-align:start}
.dsh-fanout-select:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:2px;border-radius:6px}
.dsh-fanout-select option{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
`;

    /** Inject the control's stylesheet once per page. */
    function installStyles() {
      const id = "@local/dsh-subagent-fanout/fanout.css";
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(id)}]`) !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "@local/dsh-subagent-fanout";
      tag.dataset.pluginCss = id;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** Required browser services: the composer's slot registry and copy. */
    const inject = ["slots", "locale"];

    /**
     * Client plugin body: register the dictionaries and the composer control.
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
        "subagent-fanout: dictionaries",
      );
      ctx.slots.inject("conversation.input.right", () =>
        ctx.slots.register(
          {
            name: "conversation.input.right",
            id: "subagent-fanout",
            order: 10,
            locale: NS,
          },
          FanoutControl,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    module.exports = exports;
    return module.exports;
  },
});
