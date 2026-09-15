/**
 * Byte-range route for the Sidebar video preview, node half.
 *
 * The browser cannot stream through the JSON Remote: a video element wants one
 * HTTP resource it can issue `Range` requests against, so playback begins as
 * soon as the first bytes arrive and a seek to anywhere in the file is one more
 * request rather than a wait for the whole download. Connection's shared `/api`
 * channel is exactly that surface — it is cookie-authenticated, same-origin, and
 * already used for workspace images — so this plugin registers one exact route
 * there and answers it from the composed filesystem.
 *
 * `GET /api/video-preview?session=<id>&path=<relative|absolute>` answers `200`
 * for a whole file, `206` with `Content-Range` for a byte range, `416` for an
 * unsatisfiable one, and `HEAD` for the same headers without a body. Reads go
 * through the same `ctx.fs` authority the product's `/api/file` route uses, but
 * they are streamed one bounded window at a time, so a long capture is never
 * buffered whole — neither here nor as a base64 frame on the wire.
 *
 * The session is resolved the way the workspace file service resolves one — the
 * live header first, then persistence for a resumed Session — so a tab opened
 * before its Agent is live still streams, and an unknown Session is refused
 * rather than served from some default root.
 *
 * @module @local/dsh-video-preview-routes
 */

/** Media types handed to the browser's own player, keyed by file suffix. */
const MEDIA_TYPES = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  ogg: "video/ogg",
  mov: "video/quicktime",
  mkv: "video/x-matroska"
};

/** Largest slice one filesystem read may return; the response itself may span many. */
const WINDOW_BYTES = 8 * 1024 * 1024;

/** The authenticated route this plugin owns. */
const ROUTE_PATH = "/api/video-preview";

/**
 * Headers every answer carries: the browser must see `Accept-Ranges` before it
 * will seek, the workspace bytes must not linger in a shared cache, and a
 * media response is sniffed as the video it claims to be or not played at all.
 */
const BASE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Accept-Ranges": "bytes"
};

/** Filesystem failure codes as the HTTP statuses a player understands. */
const FAILURE_STATUS = {
  FS_NOT_FOUND: 404,
  FS_NOT_REGULAR_FILE: 403,
  FS_PERMISSION_DENIED: 403,
  FS_SANDBOX_DENIED: 403,
  FS_TOO_LARGE: 413,
  FS_ABORTED: 499
};

/** Absolute path test for the host's own filesystem world. */
const ABSOLUTE_PATH = /^(?:[/\\]|[A-Za-z]:[/\\])/u;

/**
 * Resolve a filename to the media type assigned to its response.
 * @param path - decoded workspace file path.
 * @returns the video media type, or a generic binary type for anything else.
 */
function mediaTypeOf(path) {
  const normalized = String(path).replaceAll("\\", "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
  return MEDIA_TYPES[name.slice(name.lastIndexOf(".") + 1)] ?? "application/octet-stream";
}

/**
 * Translate one `Range` header into the byte window to serve.
 *
 * A single range is honoured; an unparsable header, another unit, or a
 * multi-range set falls back to the whole representation, which is what RFC 9110
 * permits and what every player tolerates.
 * @param header - the request's `Range` header, when present.
 * @param size - the file's byte length.
 * @returns the inclusive window, `"unsatisfiable"`, or undefined for the whole file.
 */
function parseRange(header, size) {
  if (header === null || header === undefined) return void 0;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (match === null) return void 0;
  const [, startText, endText] = match;
  if (startText === "" && endText === "") return void 0;
  if (startText === "") {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix)) return void 0;
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return {
      start: Math.max(0, size - suffix),
      end: size - 1
    };
  }
  const start = Number(startText);
  if (!Number.isSafeInteger(start)) return void 0;
  const end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1);
  if (!Number.isSafeInteger(end)) return void 0;
  if (size === 0 || start >= size || start > end) return "unsatisfiable";
  return {
    start,
    end
  };
}

/** Map a filesystem failure onto the status a player reports. */
function statusOf(error) {
  const code = typeof error?.code === "string" ? error.code : void 0;
  return (code === void 0 ? void 0 : FAILURE_STATUS[code]) ?? 500;
}

/**
 * Resolve the workspace root one relative path is read against, exactly as the
 * workspace file service resolves a Session's scope: the live header owns a
 * Session that is running, persistence answers for one that was merely resumed,
 * and neither means the request names no workspace at all.
 * @param ctx - host context carrying Sessions, persistence, and the policy root.
 * @param sessionId - the Session the tab belongs to.
 * @returns the workspace root, or undefined when the Session is unknown.
 */
async function workspaceRootOf(ctx, sessionId) {
  const live = ctx.sessions.get(sessionId)?.header;
  const stored = live === void 0 ? await ctx.get("sessionPersistence")?.stat(sessionId) : void 0;
  const header = live ?? stored?.header;
  if (header === void 0) return void 0;
  const root = header.cwd ?? ctx.sandboxPolicy.workspaceRoot;
  return root === void 0 || root === "" ? void 0 : root;
}

/**
 * Stream one byte window at a time, so neither the host nor the socket ever
 * holds the whole file for this request.
 * @param fs - the composed filesystem.
 * @param target - the resolved regular file.
 * @param window - the inclusive byte window to stream.
 * @param signal - the request's abort signal.
 * @returns the response body.
 */
function streamWindow(fs, target, window, signal) {
  let offset = window.start;
  let remaining = window.end - window.start + 1;
  return new ReadableStream({
    async pull(controller) {
      if (remaining <= 0) {
        controller.close();
        return;
      }
      try {
        const length = Math.min(WINDOW_BYTES, remaining);
        const bytes = await fs.readByteRange(target, {
          offset,
          length
        }, signal);
        if (bytes.byteLength === 0) {
          /* The file was truncated under us: end the body rather than hang. */
          controller.close();
          return;
        }
        controller.enqueue(bytes);
        offset += bytes.byteLength;
        remaining -= bytes.byteLength;
      } catch (error) {
        if (signal?.aborted === true) {
          try {
            controller.close();
          } catch {
            /* The consumer is already gone. */
          }
          return;
        }
        controller.error(error);
      }
    }
  });
}

/**
 * Answer one video request.
 * @param ctx - host context carrying the filesystem, Sessions, and the sandbox policy.
 * @param request - the already-authenticated request.
 * @returns the file, or the reason it cannot be served.
 */
async function serveVideo(ctx, request) {
  const head = request.method === "HEAD";
  const fail = (status, text) => new Response(head ? null : text, {
    status,
    headers: BASE_HEADERS
  });
  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  if (path === null || path.length === 0) return fail(400, "missing path");
  if (path.includes("\0")) return fail(400, "invalid path");
  let target;
  try {
    if (ABSOLUTE_PATH.test(path)) {
      /* The same authority the product's `/api/file` route already grants the browser. */
      target = await ctx.fs.resolve(path, { signal: request.signal });
    } else {
      const session = url.searchParams.get("session");
      if (session === null || session.length === 0) return fail(400, "missing session for a relative path");
      const root = await workspaceRootOf(ctx, session);
      if (root === void 0) return fail(404, "unknown session");
      target = await ctx.fs.resolve(path, {
        cwd: root,
        signal: request.signal
      });
    }
  } catch (error) {
    return fail(statusOf(error), String(error?.code ?? "FS_ERROR"));
  }
  let info;
  try {
    info = await ctx.fs.stat(target, request.signal);
  } catch (error) {
    return fail(statusOf(error), String(error?.code ?? "FS_ERROR"));
  }
  if (info === void 0) return fail(404, "not found");
  if (info.type !== "file") return fail(403, "not a regular file");
  const headers = {
    ...BASE_HEADERS,
    "Content-Type": mediaTypeOf(path)
  };
  const size = info.size;
  if (size === void 0) {
    /* A backend that cannot size the file cannot serve ranges either. */
    const open = {
      ...headers,
      "Accept-Ranges": "none"
    };
    if (head) return new Response(null, {
      status: 200,
      headers: open
    });
    return new Response(streamWindow(ctx.fs, target, {
      start: 0,
      end: Number.MAX_SAFE_INTEGER
    }, request.signal), {
      status: 200,
      headers: open
    });
  }
  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") return new Response(head ? null : "range not satisfiable", {
    status: 416,
    headers: {
      ...headers,
      "Content-Range": `bytes */${String(size)}`
    }
  });
  const start = range === void 0 ? 0 : range.start;
  const end = range === void 0 ? size - 1 : range.end;
  const length = size === 0 ? 0 : end - start + 1;
  const responseHeaders = {
    ...headers,
    "Content-Length": String(length),
    ...range === void 0 ? {} : { "Content-Range": `bytes ${String(start)}-${String(end)}/${String(size)}` }
  };
  const status = range === void 0 ? 200 : 206;
  if (head || length === 0) return new Response(null, {
    status,
    headers: responseHeaders
  });
  return new Response(streamWindow(ctx.fs, target, {
    start,
    end
  }, request.signal), {
    status,
    headers: responseHeaders
  });
}

/** Required host services: the shared API channel, the filesystem, Sessions, and the policy root. */
export const inject = [
  "connection",
  "fs",
  "sessions",
  "sandboxPolicy"
];

/**
 * Register the route for the caller's lifetime.
 * @param ctx - host context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ["GET", "HEAD"],
    requestBody: "buffered",
    fetch: (request) => serveVideo(ctx, request)
  }), "video-preview-routes: byte range route");
}
