/**
 * Interactive terminal in the right Sidebar — node half.
 *
 * The browser half renders a real terminal (the vendored xterm.js), so this half
 * owns the other end of that contract: a local PTY per terminal tab, its raw
 * bytes on the way out and keystrokes on the way in. `ctx.subprocess.spawnTerminal`
 * is the only primitive that both allocates an OS terminal and manages its whole
 * session, so it is what this plugin spawns through; nothing here goes through the
 * agent-facing `ctx.terminals` registry, whose sessions are fenced to one Agent
 * and whose output is line-sanitized rather than raw.
 *
 * The browser cannot hold a WebSocket here without its own upgrade route and its
 * own authentication, and every byte this surface needs is already covered by
 * Connection's shared, cookie-authenticated `/api` channel, which streams
 * response bodies. So the wire is ordinary HTTP:
 *
 * - `POST /api/terminal.open`   — spawn a shell, answer its id and pid
 * - `GET  /api/terminal.stream` — Server-Sent Events of the PTY's bytes
 * - `POST /api/terminal.input`  — keystrokes and pastes
 * - `POST /api/terminal.signal` — one signal to the foreground process group
 * - `POST /api/terminal.close`  — tear the shell down
 * - `GET  /api/terminal.asset`  — the vendored terminal renderer and its CSS
 *
 * Output is retained per session in one bounded scrollback buffer, so a reloaded
 * page resumes from the byte offset it already drew instead of replaying, and a
 * stream that reconnects after a dropped connection loses no output. PTY size is
 * fixed at spawn time: the subprocess terminal seam exposes no resize, so the
 * browser reports the size it measures before the shell starts.
 *
 * @module @local/dsh-client-ui-sidebar-terminal
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Route path prefix every terminal request lives under. */
const OPEN_PATH = "/api/terminal.open";
const STREAM_PATH = "/api/terminal.stream";
const RESIZE_PATH = "/api/terminal.resize";
const INPUT_PATH = "/api/terminal.input";
const SIGNAL_PATH = "/api/terminal.signal";
const CLOSE_PATH = "/api/terminal.close";
const ASSET_PATH = "/api/terminal.asset";

/** Vendored renderer files this plugin serves, by exact request name. */
const ASSETS = {
  "xterm.js": ["xterm.js", "text/javascript; charset=utf-8"],
  "xterm.css": ["xterm.css", "text/css; charset=utf-8"]
};

/** Files the asset route reads from, resolved beside this module. */
const ASSET_ROOT = join(dirname(fileURLToPath(import.meta.url)), "vendor");

/** Signals a browser client may deliver to the terminal's foreground group. */
const SIGNALS = new Set(["SIGINT", "SIGTERM", "SIGKILL", "SIGTSTP", "SIGHUP"]);

/** Retained output ceiling per session: enough to redraw a long session, bounded so a chatty process cannot grow memory without limit. */
const SCROLLBACK_MAX_BYTES = 2 * 1024 * 1024;

/** Most input one request may carry; a paste larger than this is refused rather than truncated. */
const MAX_INPUT_BYTES = 256 * 1024;

/** A stream with no subscriber for this long is an abandoned tab and is torn down. */
const IDLE_REAP_MS = 60 * 60 * 1000;

/** How often an idle stream sends a comment frame so a proxy does not drop it. */
const KEEPALIVE_MS = 15000;

/** Terminal geometry bounds, so a hostile or broken client cannot ask for an absurd PTY. */
const COLS_RANGE = [20, 500];
const ROWS_RANGE = [4, 200];

/** Shell used when the environment names none. */
const DEFAULT_SHELL = "/bin/bash";

/**
 * Clamp one requested terminal dimension.
 * @param value - the client's number, if any.
 * @param low - inclusive minimum.
 * @param high - inclusive maximum.
 * @param fallback - value used when the client sent nothing usable.
 * @returns the dimension to allocate.
 */
function clampDimension(value, low, high, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(high, Math.max(low, Math.trunc(value)));
}

/**
 * One session's retained output: the bytes still held, and the absolute offset of
 * the first byte that is still held.
 *
 * A reader resumes from an absolute byte offset, so dropping old chunks from the
 * front never renumbers what remains. When a reader asks for an offset that has
 * already been dropped it is told, rather than silently re-synchronized.
 */
class Scrollback {
  /** Retained chunks, oldest first. */
  chunks = [];
  /** Absolute offset of `chunks[0][0]`. */
  start = 0;
  /** Total bytes ever written. */
  end = 0;

  /**
   * Retain one chunk, trimming the oldest bytes past the ceiling.
   * @param chunk - bytes just read from the PTY.
   */
  push(chunk) {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.end += chunk.length;
    let retained = this.end - this.start;
    while (retained > SCROLLBACK_MAX_BYTES && this.chunks.length > 1) {
      const dropped = this.chunks.shift();
      this.start += dropped.length;
      retained -= dropped.length;
    }
  }

  /**
   * Read what is retained from one absolute offset.
   * @param offset - absolute byte offset the reader has already drawn.
   * @returns the text, its start offset, and whether anything was missed, or
   *   `undefined` when the offset is ahead of the stream or already dropped.
   */
  read(offset) {
    if (offset < this.start || offset > this.end) return undefined;
    if (offset === this.end) return { text: "", start: offset, lost: false };
    let skip = offset - this.start;
    const parts = [];
    for (const chunk of this.chunks) {
      if (skip >= chunk.length) {
        skip -= chunk.length;
        continue;
      }
      parts.push(skip === 0 ? chunk : chunk.subarray(skip));
      skip = 0;
    }
    return { text: Buffer.concat(parts).toString("utf8"), start: offset, lost: false };
  }
}

/** One live terminal: its PTY, its retained output, and its stream subscribers. */
class TerminalSession {
  /** Retained output. */
  scrollback = new Scrollback();
  /** Functions woken whenever output arrives or the terminal exits. */
  listeners = new Set();
  /** Monotonic counter stamping every output change, so a reader can detect settling. */
  generation = 0;
  /** Set once the process has exited or the session was closed. */
  ended = false;
  /** Why the terminal ended, once it has. */
  exitNote = undefined;
  /** Wall-clock stamp of the last input or output, for the idle reaper. */
  touched = Date.now();

  /**
   * @param id - this session's opaque id.
   * @param handle - the allocated PTY handle.
   * @param cwd - the directory the shell started in.
   */
  constructor(id, handle, cwd) {
    this.id = id;
    this.handle = handle;
    this.cwd = cwd;
    this.pid = handle.pid;
    this.reader = handle.output[Symbol.asyncIterator]();
    this.pump();
  }

  /** Read the PTY until it ends, retaining output and waking subscribers. */
  async pump() {
    try {
      for (;;) {
        const { value, done } = await this.reader.next();
        if (done) break;
        if (value !== undefined && value.length > 0) {
          this.scrollback.push(Buffer.from(value));
          this.generation += 1;
          this.touched = Date.now();
          this.notify();
        }
      }
      this.settle("exit");
    } catch (error) {
      this.settle(`error: ${String(error?.message ?? error)}`);
    }
  }

  /**
   * Mark the terminal finished and wake every reader.
   * @param note - why it finished.
   */
  settle(note) {
    if (this.ended) return;
    this.ended = true;
    this.exitNote = note;
    this.generation += 1;
    this.notify();
  }

  /** Wake every waiting stream. */
  notify() {
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * Wait for the next output change, the terminal's end, or the keepalive.
   * @param signal - the stream's cancellation.
   * @returns nothing; the caller re-reads the buffer when this settles.
   */
  wait(signal) {
    return new Promise((resolve) => {
      let timer;
      const done = () => {
        this.listeners.delete(done);
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      this.listeners.add(done);
      timer = setTimeout(done, KEEPALIVE_MS);
      signal?.addEventListener("abort", done, { once: true });
      if (signal?.aborted === true) done();
    });
  }

  /**
   * Write input to the PTY.
   * @param data - text to deliver, without newline conversion.
   */
  async write(data) {
    if (this.ended) throw new Error("terminal has exited");
    this.touched = Date.now();
    await this.handle.write(data);
  }

  /**
   * Adopt a new terminal size.
   *
   * The subprocess terminal seam allocates a size and exposes no resize, so the
   * PTY's own line discipline is told instead: `stty` from inside the shell is
   * what a terminal emulator's resize amounts to, and the screen is cleared
   * afterwards so the redraw is not a torn frame. A foreground full-screen
   * program keeps the input until it exits, which is the ordinary consequence of
   * typing at a busy shell.
   * @param rows - the pane's measured rows.
   * @param cols - the pane's measured columns.
   */
  async resize(rows, cols) {
    if (this.ended) throw new Error("terminal has exited");
    this.touched = Date.now();
    await this.handle.write(`stty rows ${String(rows)} cols ${String(cols)}\n`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await this.handle.write("clear\r");
  }

  /** Stop the shell and wait for its process tree to be quiescent. */
  async close() {
    this.settle("closed");
    try {
      await this.reader.return?.();
    } catch {
      /* The reader is already finished. */
    }
    await this.handle.terminate();
  }
}

/** Every terminal this process has opened, keyed by id. */
const sessions = new Map();

/** Ids are opaque to the browser and unique per process. */
let nextId = 1;

/** The idle reaper, installed with the first session and cleared with the last. */
let reaper;

/** Start the periodic sweep that tears down abandoned terminals. */
function startReaper() {
  if (reaper !== undefined) return;
  reaper = setInterval(() => {
    const now = Date.now();
    for (const session of [...sessions.values()]) {
      if (session.listeners.size > 0 || now - session.touched < IDLE_REAP_MS) continue;
      dropSession(session.id, "idle");
    }
  }, 60_000);
  reaper.unref?.();
}

/** Stop the sweep once nothing is left to sweep. */
function stopReaper() {
  if (sessions.size > 0 || reaper === undefined) return;
  clearInterval(reaper);
  reaper = undefined;
}

/**
 * Forget one terminal and tear its shell down.
 * @param id - the session to drop.
 * @param note - why it is being dropped, for the exit frame.
 * @returns the dropped session, or undefined when the id is unknown.
 */
function dropSession(id, note) {
  const session = sessions.get(id);
  if (session === undefined) return undefined;
  sessions.delete(id);
  session.settle(note);
  stopReaper();
  session.close().catch((error) => {
    /* A shell that cannot be reaped is the provider's report to make; the record is already gone. */
    console.warn(`[terminal] closing ${id} failed: ${String(error)}`);
  });
  return session;
}

/**
 * The workspace root a tab's shell should start in: the live Session header's
 * `cwd`, then persistence for a resumed Session, then the policy root.
 * @param ctx - host context carrying Sessions, persistence, and the policy.
 * @param sessionId - the Session the tab belongs to.
 * @returns the absolute directory, or undefined when no session can be resolved.
 */
async function workspaceRootOf(ctx, sessionId) {
  const live = ctx.sessions.get(sessionId)?.header;
  const stored = live === undefined ? await ctx.get("sessionPersistence")?.stat(sessionId) : undefined;
  const header = live ?? stored?.header;
  const root = header?.cwd ?? ctx.get("sandboxPolicy")?.workspaceRoot;
  return root === undefined || root === "" ? undefined : root;
}

/**
 * The shell to start, and the environment overrides a terminal wants.
 * @returns the argv to spawn.
 */
function shellArgv() {
  const shell = process.env.SHELL !== undefined && process.env.SHELL !== "" ? process.env.SHELL : DEFAULT_SHELL;
  return [shell, "-i"];
}

/** Environment that makes the PTY behave like a terminal rather than a pipe. */
const TERMINAL_ENV = {
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
  LANG: process.env.LANG ?? "C.UTF-8"
};

/**
 * Answer one JSON failure.
 * @param status - HTTP status.
 * @param message - one-line reason.
 * @returns the response.
 */
function fail(status, message) {
  return Response.json({ error: message }, { status });
}

/**
 * Read one JSON request body.
 * @param request - the authenticated request.
 * @returns the parsed body, or undefined when it is not a JSON object.
 */
async function jsonBody(request) {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null ? body : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Open one terminal for a Session's workspace.
 * @param ctx - host context.
 * @param request - `{ sessionId, cols, rows }`.
 * @returns the new terminal's identity.
 */
async function openTerminal(ctx, request) {
  const body = await jsonBody(request);
  if (body === undefined) return fail(400, "body must be a JSON object");
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
  if (sessionId === undefined || sessionId === "") return fail(400, "sessionId is required");
  const cwd = await workspaceRootOf(ctx, sessionId);
  if (cwd === undefined) return fail(404, "unknown session");
  const cols = clampDimension(body.cols, COLS_RANGE[0], COLS_RANGE[1], 80);
  const rows = clampDimension(body.rows, ROWS_RANGE[0], ROWS_RANGE[1], 24);
  const argv = shellArgv();
  let handle;
  try {
    handle = await ctx.subprocess.spawnTerminal({
      argv,
      cwd,
      env: TERMINAL_ENV,
      cols,
      rows,
      graceMs: 3000,
      signal: request.signal
    });
  } catch (error) {
    return fail(500, `cannot start a shell: ${String(error?.message ?? error)}`);
  }
  const id = `t${nextId++}-${Date.now().toString(36)}`;
  const session = new TerminalSession(id, handle, cwd);
  sessions.set(id, session);
  startReaper();
  return Response.json({
    id,
    pid: session.pid,
    cwd,
    cols,
    rows,
    argv
  });
}

/**
 * Stream one terminal's output as Server-Sent Events.
 *
 * Each `output` frame carries the absolute byte offset that follows it, so the
 * client's `Last-Event-ID` (or its saved offset) resumes exactly where it stopped.
 * @param request - the authenticated request, with `id` and optional `from`.
 * @returns the event stream, or a JSON failure.
 */
function streamTerminal(request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const session = id === null ? undefined : sessions.get(id);
  if (session === undefined) return fail(404, "unknown terminal");
  const header = request.headers.get("last-event-id");
  const requested = header ?? url.searchParams.get("from");
  const from = requested === null || requested === "" ? session.scrollback.start : Number(requested);
  if (!Number.isSafeInteger(from) || from < 0) return fail(400, "from must be a byte offset");
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const stream = new ReadableStream({
    start(controller) {
      let offset = from;
      let closed = false;
      const finish = (note) => {
        if (closed) return;
        closed = true;
        if (note !== undefined) {
          try {
            controller.enqueue(encoder.encode(`event: end\ndata: ${JSON.stringify({ note })}\n\n`));
          } catch {
            /* The consumer is already gone. */
          }
        }
        try {
          controller.close();
        } catch {
          /* Already closed. */
        }
      };
      (async () => {
        for (;;) {
          if (abort.signal.aborted) {
            finish();
            return;
          }
          const page = session.scrollback.read(offset);
          if (page === undefined) {
            controller.enqueue(encoder.encode("event: reset\ndata: {}\n\n"));
            offset = session.scrollback.start;
            continue;
          }
          if (page.text.length > 0) {
            offset = session.scrollback.end;
            controller.enqueue(encoder.encode(`id: ${offset}\nevent: output\ndata: ${JSON.stringify(page.text)}\n\n`));
            continue;
          }
          if (session.ended) {
            finish(session.exitNote);
            return;
          }
          const seen = session.generation;
          await session.wait(abort.signal);
          if (session.generation === seen && !session.ended && !abort.signal.aborted) {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          }
        }
      })().catch((error) => {
        try {
          controller.error(error);
        } catch {
          /* Already settled. */
        }
      });
    },
    cancel() {
      abort.abort();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Accel-Buffering": "no"
    }
  });
}

/**
 * Deliver input to one terminal.
 * @param request - `{ id, data }`.
 * @returns an empty success.
 */
async function writeTerminal(request) {
  const body = await jsonBody(request);
  if (body === undefined) return fail(400, "body must be a JSON object");
  const session = typeof body.id === "string" ? sessions.get(body.id) : undefined;
  if (session === undefined) return fail(404, "unknown terminal");
  const data = typeof body.data === "string" ? body.data : undefined;
  if (data === undefined || data === "") return fail(400, "data is required");
  if (Buffer.byteLength(data, "utf8") > MAX_INPUT_BYTES) return fail(413, "input is too large");
  try {
    await session.write(data);
  } catch (error) {
    return fail(409, String(error?.message ?? error));
  }
  return Response.json({ ok: true });
}

/**
 * Tell one terminal's line discipline the pane's new size.
 * @param request - `{ id, cols, rows }`.
 * @returns an empty success.
 */
async function resizeTerminal(request) {
  const body = await jsonBody(request);
  if (body === undefined) return fail(400, "body must be a JSON object");
  const session = typeof body.id === "string" ? sessions.get(body.id) : undefined;
  if (session === undefined) return fail(404, "unknown terminal");
  const cols = clampDimension(body.cols, COLS_RANGE[0], COLS_RANGE[1], 80);
  const rows = clampDimension(body.rows, ROWS_RANGE[0], ROWS_RANGE[1], 24);
  try {
    await session.resize(rows, cols);
  } catch (error) {
    return fail(409, String(error?.message ?? error));
  }
  return Response.json({ ok: true, cols, rows });
}

/**
 * Signal one terminal's foreground process group.
 * @param request - `{ id, signal }`.
 * @returns the process group that received it.
 */async function signalTerminal(request) {
  const body = await jsonBody(request);
  if (body === undefined) return fail(400, "body must be a JSON object");
  const session = typeof body.id === "string" ? sessions.get(body.id) : undefined;
  if (session === undefined) return fail(404, "unknown terminal");
  const signal = typeof body.signal === "string" ? body.signal : "";
  if (!SIGNALS.has(signal)) return fail(400, "unsupported signal");
  if (session.ended) return fail(409, "terminal has exited");
  try {
    const processGroupId = await session.handle.signalForeground(signal);
    return Response.json({ processGroupId });
  } catch (error) {
    return fail(409, String(error?.message ?? error));
  }
}

/**
 * Tear one terminal down.
 * @param request - `{ id }`.
 * @returns an empty success.
 */
async function closeTerminal(request) {
  const body = await jsonBody(request);
  if (body === undefined) return fail(400, "body must be a JSON object");
  if (typeof body.id !== "string") return fail(400, "id is required");
  dropSession(body.id, "closed");
  return Response.json({ ok: true });
}

/**
 * Serve one vendored browser asset.
 * @param request - the authenticated request, with `name`.
 * @returns the file, or a JSON failure.
 */
async function serveAsset(request) {
  const name = new URL(request.url).searchParams.get("name");
  const entry = name === null ? undefined : ASSETS[name];
  if (entry === undefined) return fail(404, "unknown asset");
  const [file, type] = entry;
  try {
    const body = await readFile(join(ASSET_ROOT, file));
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return fail(500, `asset ${file} is missing from the plugin`);
  }
}

/** Required host services: the shared API channel, the PTY primitive, and Sessions. */
export const inject = ["connection", "subprocess", "sessions"];

/**
 * Register the terminal routes for the caller's lifetime.
 * @param ctx - host context.
 */
export function apply(ctx) {
  ctx.inject(["connection", "subprocess", "sessions"], (scope) => {
    const routes = [
      { path: OPEN_PATH, methods: ["POST"], fetch: (request) => openTerminal(scope, request) },
      { path: STREAM_PATH, methods: ["GET"], fetch: (request) => streamTerminal(request) },
      { path: RESIZE_PATH, methods: ["POST"], fetch: (request) => resizeTerminal(request) },
      { path: INPUT_PATH, methods: ["POST"], fetch: (request) => writeTerminal(request) },
      { path: SIGNAL_PATH, methods: ["POST"], fetch: (request) => signalTerminal(request) },
      { path: CLOSE_PATH, methods: ["POST"], fetch: (request) => closeTerminal(request) },
      { path: ASSET_PATH, methods: ["GET"], fetch: (request) => serveAsset(request) }
    ];
    scope.effect(() => {
      const disposers = routes.map((route) =>
        scope.connection.fetch.register({
          path: route.path,
          methods: route.methods,
          requestBody: "buffered",
          fetch: route.fetch
        })
      );
      return () => {
        for (const dispose of disposers) dispose();
        for (const session of [...sessions.values()]) {
          sessions.delete(session.id);
          session.close().catch(() => {});
        }
        stopReaper();
      };
    }, "sidebar-terminal: routes");
  });
}

export default apply;
