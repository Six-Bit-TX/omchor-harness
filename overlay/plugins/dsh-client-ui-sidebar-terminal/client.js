/**
 * Interactive terminal in the right Sidebar — browser half.
 *
 * One tab type, `terminal`, opened as a page from the guide capsule or from the
 * tab strip. The pane renders the vendored xterm.js and talks to this package's
 * node half over three authenticated routes: open a shell, stream its bytes,
 * send input. Nothing here knows how a PTY is made — the host owns that.
 *
 * xterm.js is vendored rather than bundled: this package ships no build step, and
 * the renderer is loaded through the host's own asset route so the page never
 * depends on a CDN.
 *
 * @module @local/dsh-client-ui-sidebar-terminal
 */

window.__ModuleLoader__.load({
  id: "@local/dsh-client-ui-sidebar-terminal",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    /** This package's copy namespace. */
    const NS = "sidebarTerminal";
    /** This implementation's identity in the tab system, and the key its body registers under. */
    const TAB_ID = "@local/dsh-client-ui-sidebar-terminal";
    /** Type discriminator for terminal tabs: a page type, opened by kind. */
    const TAB_KIND = "terminal";

    /** The routes the node half owns. */
    const OPEN_URL = "/api/terminal.open";
    const STREAM_URL = "/api/terminal.stream";
    const RESIZE_URL = "/api/terminal.resize";
    const INPUT_URL = "/api/terminal.input";
    const SIGNAL_URL = "/api/terminal.signal";
    const CLOSE_URL = "/api/terminal.close";
    const ASSET_URL = "/api/terminal.asset";

    /** Retained lines before the oldest scroll off; the host's server-side buffer is the replay source, not this. */
    const SCROLLBACK_LINES = 10000;

    /** How long keystrokes may accumulate before one input request carries them. */
    const INPUT_COALESCE_MS = 12;

    /** Terminal geometry the pane asks the host for when it cannot measure yet. */
    const FALLBACK_COLS = 80;
    const FALLBACK_ROWS = 24;

    let terminalController = null;
    let xtermPromise = null;
    let xtermCss = false;

    /**
     * The terminal controller: xterm's state lives here, not in React, so a
     * remount reattaches without replaying anything into a fresh emulator.
     */
    class TerminalController {
      /** xterm's Terminal. */
      terminal = null;
      /** The PTY's id once the host has opened it. */
      sessionId = undefined;
      /** The in-flight open, so two panes of one tab cannot spawn two shells. */
      opening = undefined;
      /** Set once the stream reports the shell's exit. */
      closed = false;
      /** The shell's working directory, as the host resolved it. */
      cwd = undefined;
      /** Text typed but not yet queued for one input request. */
      pending = "";
      /** The coalescing timer, while one is pending. */
      inputTimer = undefined;
      /** The live output stream, while the pane is visible. */
      reader = undefined;
      /** Aborts the connection this body owns; a remount makes a new one. */
      connection = undefined;
      /** The last size reported to the host, so an unchanged measure posts nothing. */
      lastSize = undefined;
      /** The resize coalescing timer, while one is pending. */
      resizeTimer = undefined;
      /** The pane's element, while one is attached. */
      element = null;
      /** ResizeObserver on the pane. */
      observer = undefined;

      /**
       * Make sure the host has opened this tab's shell.
       * @param sessionId - the Session the tab belongs to.
       * @param cols - measured columns.
       * @param rows - measured rows.
       * @returns the PTY id.
       */
      async ensure(sessionId, cols, rows) {
        if (this.sessionId !== undefined) return this.sessionId;
        if (this.opening === undefined) this.opening = this.open(sessionId, cols, rows);
        try {
          return await this.opening;
        } finally {
          this.opening = undefined;
        }
      }

      /**
       * Open one shell through the host.
       * @param sessionId - the Session the tab belongs to.
       * @param cols - measured columns.
       * @param rows - measured rows.
       * @returns the PTY id.
       */
      async open(sessionId, cols, rows) {
        const response = await fetch(OPEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, cols, rows })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? `open failed (${String(response.status)})`);
        this.sessionId = body.id;
        this.cwd = body.cwd;
        return this.sessionId;
      }

      /**
       * End this tab's shell, if it has one, without touching the screen: the
       * reconnect ladder opens the next one from byte zero.
       */
      async reopen() {
        const id = this.sessionId;
        this.sessionId = undefined;
        this.closed = false;
        this.terminal?.reset();
        if (id === undefined) return;
        await fetch(CLOSE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id })
        }).catch(() => {});
      }

      /**
       * Attach one pane element: bind xterm's data, focus, and resize to it.
       * @param element - the pane's own div.
       */
      attach(element) {
        this.element = element;
        if (element === null) return;
        const terminal = this.terminal;
        if (terminal === null) return;
        if (element.firstChild !== terminal.element) element.replaceChildren(terminal.element);
        this.measureInto(terminal);
        if (this.observer !== undefined) {
          const observer = this.observer;
          observer.observe(element);
          return;
        }
        this.observer = new ResizeObserver(() => {
          if (this.terminal !== null) this.measureInto(this.terminal);
        });
        this.observer.observe(element);
      }

      /** Detach the pane's observer without touching the PTY. */
      detach() {
        this.observer?.disconnect();
        this.observer = undefined;
        this.element = null;
      }

      /**
       * Ask the host for the geometry the pane can actually show.
       * @param terminal - the xterm instance.
       */
      measureInto(terminal) {
        const element = this.element;
        if (element === null) return;
        const width = element.clientWidth;
        const height = element.clientHeight;
        if (width <= 0 || height <= 0) return;
        const core = terminal._core;
        const cell = core?._renderService?.dimensions?.css?.cell;
        const cellWidth = cell?.width > 0 ? cell.width : 8;
        const cellHeight = cell?.height > 0 ? cell.height : 17;
        const cols = Math.max(20, Math.floor((width - 4) / cellWidth));
        const rows = Math.max(4, Math.floor((height - 4) / cellHeight));
        this.applySize(cols, rows);
      }

      /** Report a changed geometry to the PTY, coalescing bursts of measurements. */
      applySize(cols, rows) {
        if (this.lastSize !== undefined && this.lastSize.cols === cols && this.lastSize.rows === rows) return;
        this.lastSize = { cols, rows };
        if (this.sessionId === undefined) return;
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => {
          const id = this.sessionId;
          if (id === undefined) return;
          fetch(RESIZE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, cols, rows })
          }).catch(() => {});
        }, 250);
      }

      /**
       * Queue terminal input, coalescing keystrokes into one request.
       * @param data - what xterm reported.
       */
      type(data) {
        this.pending += data;
        if (this.inputTimer !== undefined) return;
        this.inputTimer = setTimeout(() => {
          this.inputTimer = undefined;
          this.flush();
        }, INPUT_COALESCE_MS);
      }

      /** Send whatever input is queued. */
      flush() {
        const data = this.pending;
        this.pending = "";
        if (data === "") return;
        const id = this.sessionId;
        if (id === undefined) return;
        fetch(INPUT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, data })
        }).catch(() => {});
      }

      /**
       * Open the output stream and write every frame into xterm, reconnecting
       * from the last byte offset until the shell exits.
       * @param onState - reports each connection state to the pane.
       */
      async stream(onState) {
        const connection = new AbortController();
        this.connection = connection;
        this.closed = false;
        let offset = 0;
        for (;;) {
          if (connection.signal.aborted) return;
          const id = this.sessionId;
          if (id === undefined) return;
          onState("connecting");
          let response;
          try {
            response = await fetch(`${STREAM_URL}?id=${encodeURIComponent(id)}&from=${String(offset)}`, {
              signal: connection.signal
            });
          } catch (error) {
            if (connection.signal.aborted) return;
            onState("error", String(error?.message ?? error));
            await delay(1500);
            continue;
          }
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            /* The host forgot this id: the shell is gone, so say so instead of reconnecting forever. */
            if (response.status === 404) {
              this.closed = true;
              this.sessionId = undefined;
              onState("closed");
              return;
            }
            onState("error", body.error ?? `stream failed (${String(response.status)})`);
            await delay(1500);
            continue;
          }
          onState("open");
          try {
            for await (const frame of readSse(response)) {
              if (connection.signal.aborted) return;
              if (frame.event === "output") {
                const text = frame.parsed;
                if (typeof text === "string" && text.length > 0) {
                  this.closed = false;
                  this.terminal?.write(text);
                  offset = Number(frame.id ?? offset);
                }
                continue;
              }
              if (frame.event === "reset") {
                this.terminal?.reset();
                offset = 0;
                break;
              }
              if (frame.event === "end") {
                this.closed = true;
                onState("closed");
                return;
              }
            }
          } catch (error) {
            if (connection.signal.aborted) return;
            onState("error", String(error?.message ?? error));
          }
          if (this.closed) return;
          await delay(400);
        }
      }

      /** Tear the PTY down and forget it; the next mount opens a new one. */
      async close() {
        this.connection?.abort();
        this.connection = undefined;
        clearTimeout(this.inputTimer);
        clearTimeout(this.resizeTimer);
        this.pending = "";
        const id = this.sessionId;
        this.sessionId = undefined;
        if (id === undefined) return;
        await fetch(CLOSE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id })
        }).catch(() => {});
      }
    }

    /** Every tab's controller, so closing the body does not close the shell. */
    const controllers = new Map();

    /**
     * The controller for one tab, created on first use.
     * @param tabId - the tab's id in the layout.
     * @returns the controller.
     */
    function controllerFor(tabId) {
      let controller = controllers.get(tabId);
      if (controller === undefined) {
        controller = new TerminalController();
        controllers.set(tabId, controller);
      }
      return controller;
    }

    /**
     * Sleep, for the reconnect ladder.
     * @param ms - milliseconds.
     * @returns a promise that settles after the delay.
     */
    function delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Parse one Server-Sent Events body into frames.
     * @param response - the live response.
     * @returns each frame as it arrives.
     */
    async function* readSse(response) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          for (;;) {
            const cut = buffer.indexOf("\n\n");
            if (cut < 0) break;
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            const frame = { event: "message", id: undefined, data: "" };
            for (const line of block.split("\n")) {
              if (line.startsWith(":")) continue;
              const colon = line.indexOf(":");
              const field = colon < 0 ? line : line.slice(0, colon);
              const raw = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
              if (field === "event") frame.event = raw;
              else if (field === "id") frame.id = raw;
              else if (field === "data") frame.data += raw;
            }
            let parsed = frame.data;
            try {
              parsed = JSON.parse(frame.data);
            } catch {
              /* Not JSON: the payload is the raw text. */
            }
            yield { event: frame.event, id: frame.id, parsed };
          }
        }
      } finally {
        reader.cancel().catch(() => {});
      }
    }

    /**
     * Load the vendored renderer once per page.
     *
     * @returns the Terminal constructor and its FitAddon-free helpers.
     */
    function loadXterm() {
      if (xtermPromise !== null) return xtermPromise;
      xtermPromise = new Promise((resolve, reject) => {
        if (!xtermCss) {
          xtermCss = true;
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = `${ASSET_URL}?name=xterm.css`;
          document.head.appendChild(link);
        }
        if (globalThis.Terminal !== undefined) {
          resolve(globalThis.Terminal);
          return;
        }
        const script = document.createElement("script");
        script.src = `${ASSET_URL}?name=xterm.js`;
        script.async = true;
        script.onload = () => {
          if (globalThis.Terminal === undefined) reject(new Error("the vendored terminal renderer did not register"));
          else resolve(globalThis.Terminal);
        };
        script.onerror = () => reject(new Error("the vendored terminal renderer could not be loaded"));
        document.head.appendChild(script);
      });
      return xtermPromise;
    }

    /** The guide's glyph: a terminal frame with a prompt chevron and a cursor. */
    function TerminalGlyph({ size, className }) {
      return react.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 16 16",
          fill: "none",
          className,
          "aria-hidden": "true"
        },
        react.createElement("path", {
          fillRule: "evenodd",
          clipRule: "evenodd",
          fill: "currentColor",
          d: "M4 1.75h8A2.25 2.25 0 0 1 14.25 4v8A2.25 2.25 0 0 1 12 14.25H4A2.25 2.25 0 0 1 1.75 12V4A2.25 2.25 0 0 1 4 1.75Zm-.4 1.5A.85.85 0 0 0 2.75 4.1v7.8c0 .47.38.85.85.85h8.8c.47 0 .85-.38.85-.85V4.1a.85.85 0 0 0-.85-.85H3.6Z"
        }),
        react.createElement("path", {
          d: "M4.9 5.35a.7.7 0 0 1 .99-.05L8.02 7.2a.7.7 0 0 1 0 1.03L5.89 10.13a.7.7 0 0 1-.92-1.05l1.54-1.35L4.97 6.4a.7.7 0 0 1-.07-.99Z",
          fill: "currentColor"
        }),
        react.createElement("rect", {
          x: "8.2",
          y: "8.5",
          width: "3.2",
          height: "1.3",
          rx: ".65",
          fill: "currentColor"
        })
      );
    }

    /** One terminal pane: the tab body. */
    function TerminalPane({ sessionId, useTabInfo, t }) {
      const { tab } = useTabInfo();
      const [state, setState] = react.useState("connecting");
      const [error, setError] = react.useState(undefined);
      const [cwd, setCwd] = react.useState(undefined);
      const [attempt, setAttempt] = react.useState(0);
      const paneRef = react.useRef(null);
      const controller = controllerFor(tab.id);

      react.useEffect(() => {
        const element = paneRef.current;
        if (element === null) return undefined;
        let disposed = false;
        const onState = (next, detail) => {
          if (disposed) return;
          setState(next);
          setError(detail);
        };
        (async () => {
          if (controller.closed) {
            /* The shell ended: this attempt restarts it, so drop the dead id first. */
            await controller.reopen();
          }
          await loadXterm();
          if (disposed) return;
          let terminal = controller.terminal;
          if (terminal === null) {
            terminal = new globalThis.Terminal({
              allowProposedApi: true,
              convertEol: false,
              cursorBlink: true,
              cursorStyle: "block",
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, "DejaVu Sans Mono", monospace',
              fontSize: 12,
              lineHeight: 1.15,
              scrollback: SCROLLBACK_LINES,
              theme: themeFrom(element)
            });
            controller.terminal = terminal;
            terminal.onData((data) => {
              controller.type(data);
            });
          }
          controller.attach(element);
          setCwd(controller.cwd);
          const size = controller.lastSize ?? { cols: FALLBACK_COLS, rows: FALLBACK_ROWS };
          await controller.ensure(sessionId, size.cols, size.rows);
          if (disposed) return;
          setCwd(controller.cwd);
          terminal.focus();
          await controller.stream(onState);
        })().catch((caught) => {
          if (disposed) return;
          setState("error");
          setError(String(caught?.message ?? caught));
        });
        return () => {
          disposed = true;
          controller.connection?.abort();
          controller.connection = undefined;
          controller.flush();
          controller.detach();
        };
      }, [attempt, controller, sessionId]);

      react.useEffect(() => {
        const signal = tab.signal;
        const onAbort = () => {
          controllers.delete(tab.id);
          controller.close().catch(() => {});
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
        return () => signal.removeEventListener("abort", onAbort);
      }, [controller, tab.id, tab.signal]);

      /** Restart the shell: a fresh PTY, and the emulator cleared for it. */
      const reconnect = () => {
        controller.connection?.abort();
        controller.connection = undefined;
        controller.reopen().finally(() => {
          setAttempt((value) => value + 1);
        });
      };

      const interrupt = () => {
        const id = controller.sessionId;
        if (id === undefined) return;
        fetch(SIGNAL_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, signal: "SIGINT" })
        }).catch(() => {});
      };

      const status = state === "open" ? t("status.open") : state === "connecting" ? t("status.connecting") : state === "closed" ? t("status.closed") : t("status.error");
      return react.createElement(
        "div",
        { className: "dsh-terminal-root", "data-terminal-state": state, "data-terminal-tab": tab.id },
        react.createElement(
          "div",
          { className: "dsh-terminal-bar" },
          react.createElement("span", { className: "dsh-terminal-status", "data-terminal-status": state, title: cwd ?? "" }, status),
          react.createElement("span", { className: "dsh-terminal-cwd", title: cwd ?? "" }, cwd ?? ""),
          react.createElement("button", { type: "button", className: "dsh-terminal-tool", "data-terminal-interrupt": true, title: t("interrupt"), onClick: interrupt }, t("interrupt")),
          react.createElement("button", { type: "button", className: "dsh-terminal-tool", "data-terminal-reconnect": true, title: t("reconnect"), onClick: reconnect }, t("reconnect"))
        ),
        react.createElement("div", { ref: paneRef, className: "dsh-terminal-pane", "data-terminal-pane": true }),
        state === "error" && error !== undefined
          ? react.createElement("p", { className: "dsh-terminal-note", "data-terminal-error": true }, t("error.line", { message: error }))
          : null,
        state === "closed"
          ? react.createElement("p", { className: "dsh-terminal-note", "data-terminal-exit": true }, t("exited"))
          : null
      );
    }

    /**
     * The terminal's colors, read from the applied theme so the pane inherits it.
     * @param element - the pane holding the themed tokens.
     * @returns the xterm theme.
     */
    function themeFrom(element) {
      const styles = getComputedStyle(element);
      const read = (name, fallback) => {
        const value = styles.getPropertyValue(name).trim();
        return value === "" ? fallback : value;
      };
      const background = read("--dsw-alias-bg-base", "#ffffff");
      return {
        background,
        foreground: read("--dsw-alias-label-primary", "#1a1a1a"),
        cursor: read("--dsw-alias-label-primary", "#1a1a1a"),
        selectionBackground: read("--dsw-alias-interactive-bg-hover", "rgba(0,0,0,0.12)")
      };
    }

    /** The terminal chip's glyph. */
    function TerminalTitle({ useTabInfo }) {
      const { tab } = useTabInfo();
      return react.createElement(
        react.Fragment,
        null,
        react.createElement(TerminalGlyph, { size: 16, className: "dsh-terminal-title-icon" }),
        tab.title
      );
    }

    /** Simplified Chinese dictionary and key-set source of truth. */
    const zh = {
      "type.label": "终端",
      "guide.title": "终端",
      "guide.description": "在会话工作区里开一个交互式终端",
      "status.connecting": "连接中",
      "status.open": "已连接",
      "status.closed": "已退出",
      "status.error": "连接出错",
      "interrupt": "中断",
      "reconnect": "重开",
      "exited": "这个终端已退出。点“重开”再开一个。",
      "error.line": "终端出错：{message}"
    };

    /** English dictionary, checked against the Chinese key set. */
    const en = {
      "type.label": "Terminal",
      "guide.title": "Terminal",
      "guide.description": "Open an interactive terminal in this session's workspace",
      "status.connecting": "Connecting",
      "status.open": "Connected",
      "status.closed": "Exited",
      "status.error": "Connection failed",
      "interrupt": "Interrupt",
      "reconnect": "Restart",
      "exited": "This terminal has exited. Restart it to open another.",
      "error.line": "Terminal failed: {message}"
    };

    /** The pane's own stylesheet, injected once per page. */
    const CSS = `
.dsh-terminal-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dsh-terminal-bar{display:flex;align-items:center;gap:8px;flex:none;height:30px;padding:0 8px 0 12px;border-bottom:.5px solid var(--dsw-alias-border-l3);font-size:12px}
.dsh-terminal-status{flex:none;color:var(--dsw-alias-label-secondary)}
.dsh-terminal-root[data-terminal-state="open"] .dsh-terminal-status{color:var(--dsw-alias-label-secondary)}
.dsh-terminal-root[data-terminal-state="error"] .dsh-terminal-status{color:var(--dsw-alias-label-error, #d33)}
.dsh-terminal-cwd{flex:auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-caption);direction:rtl;text-align:left}
.dsh-terminal-tool{flex:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;padding:2px 6px;border-radius:6px}
.dsh-terminal-tool:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-terminal-pane{flex:auto;min-height:0;padding:6px 0 6px 8px;overflow:hidden}
.dsh-terminal-pane .xterm{height:100%}
.dsh-terminal-pane .xterm-viewport{background:transparent!important}
.dsh-terminal-note{flex:none;margin:0;padding:6px 12px;font-size:12px;color:var(--dsw-alias-label-caption);border-top:.5px solid var(--dsw-alias-border-l3)}
.dsh-terminal-title-icon{color:var(--dsw-alias-label-tertiary);flex:none}
`;

    /** Inject the pane's stylesheet once per page. */
    function installStyles() {
      const id = "@local/dsh-client-ui-sidebar-terminal/terminal.css";
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(id)}]`) !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = TAB_ID;
      tag.dataset.pluginCss = id;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** Required browser services: the tab registry, the slot registry, and copy. */
    const inject = ["slots", "locale", "sidebarRightTabs"];

    /**
     * Client plugin body: register the type, its dictionaries, its glyph, and its pane.
     * @param ctx - the client root context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      installStyles();
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh,
            en
          }),
        "sidebar-terminal: dictionaries"
      );
      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            priority: "builtin",
            title: () => t("type.label"),
            guide: [
              {
                order: 20,
                title: () => t("guide.title"),
                description: () => t("guide.description"),
                icon: TerminalGlyph
              }
            ]
          }),
        "sidebar-terminal: type"
      );
      ctx.effect(
        () =>
          ctx.slots.register(
            {
              name: "sidebar.right.pane.tab",
              key: TAB_ID,
              locale: NS
            },
            TerminalPane
          ),
        "sidebar-terminal: pane"
      );
      ctx.effect(
        () =>
          ctx.slots.register(
            {
              name: "sidebar.right.pane.tab.title",
              key: TAB_ID
            },
            TerminalTitle
          ),
        "sidebar-terminal: title"
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    module.exports = exports;
    return module.exports;
  }
});
