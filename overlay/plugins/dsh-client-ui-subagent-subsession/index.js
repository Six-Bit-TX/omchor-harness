/**
 * Subagent subsession transcript — host half.
 *
 * The parent conversation's `subagent` / `subagent_fork` / `send_message` rows
 * expand into a subsession: the child's own thought process, step by step. That
 * transcript is not on the parent's wire, and the child's history is only
 * streamed to the browser while the child is the selected Session, so this half
 * folds it on the host and answers one authenticated route:
 *
 *   GET /api/subagent-subsession?session=<childId>
 *
 * The fold is deliberately presentation-shaped rather than a raw event dump:
 * ordered entries of `thinking`, `text`, and `tool`, each already reduced to
 * what a compact card renders. Reads go through `ctx.sessionQuery`, which is
 * live-preferred, so an expanded card polls the same route while the child runs
 * and the transcript grows in place.
 *
 * Nothing here is model-visible: the route only reads a child log that the
 * parent's own `subagent` tool result already identifies by id.
 *
 * @module @local/dsh-client-ui-subagent-subsession
 */

/** Required host services: the authenticated API channel and the session-history query engine. */
export const inject = ["connection", "sessionQuery"];

/** The authenticated route this plugin owns. */
const ROUTE_PATH = "/api/subagent-subsession";

/** Longest single thinking block kept, in code points. */
const MAX_THINKING = 4000;

/** Longest single assistant text block kept, in code points. */
const MAX_TEXT = 4000;

/** Longest tool result preview kept, in code points. */
const MAX_RESULT = 1600;

/** Longest tool summary kept, in code points. */
const MAX_SUMMARY = 200;

/** Entry ceiling; a longer child collapses its oldest entries into a marker. */
const MAX_ENTRIES = 400;

/**
 * Clip one string, marking the cut so the card never implies completeness.
 * @param value - raw text.
 * @param limit - maximum kept code points.
 * @returns the text, or the text plus an ellipsis marker.
 */
function clip(value, limit) {
  const text = typeof value === "string" ? value : String(value ?? "");
  const points = [...text];
  if (points.length <= limit) return text;
  return points.slice(0, limit).join("") + "\n… (truncated)";
}

/**
 * First physical line, for summaries.
 * @param text - raw text.
 * @returns the first line.
 */
function firstLine(text) {
  const value = typeof text === "string" ? text : String(text ?? "");
  const at = value.indexOf("\n");
  return (at === -1 ? value : value.slice(0, at)).trim();
}

/**
 * The compact argument summary a collapsed tool row shows, in the spirit of the
 * shipped terminal and search cards.
 * @param name - the wire tool name.
 * @param argsRaw - the raw JSON argument string.
 * @returns the one-line summary.
 */
function summarizeTool(name, argsRaw) {
  let args;
  try {
    args = JSON.parse(argsRaw);
  } catch {
    return clip(firstLine(argsRaw), MAX_SUMMARY);
  }
  if (args === null || typeof args !== "object") return clip(firstLine(argsRaw), MAX_SUMMARY);
  const text = (value) => (typeof value === "string" ? value : "");
  switch (name) {
    case "bash":
    case "pwsh":
    case "terminal_send":
      return clip(firstLine(text(args.command)), MAX_SUMMARY);
    case "read":
    case "write":
    case "edit":
    case "str_replace_editor":
    case "read_image":
      return clip(text(args.file_path) || text(args.path), MAX_SUMMARY);
    case "grep":
    case "glob":
      return clip(text(args.pattern) || text(args.glob), MAX_SUMMARY);
    case "web_search":
      return Array.isArray(args.queries)
        ? clip(args.queries.filter((q) => typeof q === "string").join(" · "), MAX_SUMMARY)
        : clip(text(args.query), MAX_SUMMARY);
    case "web_fetch":
      return clip(text(args.url), MAX_SUMMARY);
    case "subagent":
    case "subagent_fork":
      return clip(text(args.description) || firstLine(text(args.prompt)), MAX_SUMMARY);
    case "send_message":
      return clip(text(args.to) || text(args.agent_id) || text(args.message), MAX_SUMMARY);
    case "todo_write": {
      const todos = Array.isArray(args.todos) ? args.todos : [];
      return clip(`${String(todos.length)} item(s)`, MAX_SUMMARY);
    }
    case "present": {
      const files = Array.isArray(args.files) ? args.files : [];
      return clip(files.length === 0 ? "" : `${String(files.length)} file(s)`, MAX_SUMMARY);
    }
    default:
      return clip(firstLine(argsRaw), MAX_SUMMARY);
  }
}

/**
 * Flatten one `tool/result` message into display text.
 * @param data - the event's `data` field.
 * @returns the flattened result text (empty when the shapes are unexpected).
 */
function resultTextOf(data) {
  const content = data?.message?.content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (block?.type !== "tool-result") continue;
    const inner = Array.isArray(block.content) ? block.content : [];
    for (const item of inner) {
      if (item?.type === "text" && typeof item.text === "string") parts.push(item.text);
      else if (item !== undefined && item !== null) parts.push(JSON.stringify(item));
    }
  }
  return parts.join("\n");
}

/**
 * Fold one child's raw event log into ordered display entries.
 * @param events - the child's contiguous events, ascending.
 * @param inheritedEventCount - leading events inherited from a fork seed.
 * @returns the folded transcript.
 */
function fold(events, inheritedEventCount) {
  const entries = [];
  const byCallId = new Map();
  const facts = {
    label: undefined,
    mode: undefined,
    provider: undefined,
    model: undefined,
    effort: undefined,
    title: undefined,
    prompt: undefined,
  };
  let truncated = false;
  const skip = Number.isSafeInteger(inheritedEventCount) ? inheritedEventCount : 0;

  const push = (entry) => {
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
      entries.shift();
      truncated = true;
    }
  };

  for (const event of events.slice(skip)) {
    const data = event?.data;
    switch (event?.type) {
      case "subagent/descriptor": {
        if (typeof data?.label === "string") facts.label = data.label;
        if (typeof data?.mode === "string") facts.mode = data.mode;
        if (typeof data?.agentProvider === "string") facts.provider = data.agentProvider;
        if (typeof data?.agentModel === "string") facts.model = data.agentModel;
        if (typeof data?.agentReasoningEffort === "string") facts.effort = data.agentReasoningEffort;
        break;
      }
      case "session/title": {
        if (typeof data?.title === "string") facts.title = data.title;
        break;
      }
      case "user/message": {
        /* Only the human brief is interesting; runtime-context snapshots and
           relayed agent messages are not part of the child's task. */
        if (facts.prompt !== undefined || data?.source?.kind !== "user") break;
        const content = data?.content ?? data?.message?.content;
        if (!Array.isArray(content)) break;
        const text = content
          .map((block) => (block?.type === "text" && typeof block.text === "string" ? block.text : ""))
          .filter((part) => part !== "")
          .join("\n");
        if (text !== "") facts.prompt = clip(text, MAX_TEXT);
        break;
      }
      case "assistant/message": {
        const content = data?.message?.content;
        if (!Array.isArray(content)) break;
        for (const block of content) {
          if (block?.type === "reasoning" && typeof block.text === "string" && block.text.trim() !== "") {
            push({ kind: "thinking", text: clip(block.text, MAX_THINKING) });
          } else if (block?.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
            push({ kind: "text", text: clip(block.text, MAX_TEXT) });
          }
        }
        break;
      }
      case "tool/call": {
        const entry = {
          kind: "tool",
          callId: typeof data?.callId === "string" ? data.callId : "",
          name: typeof data?.name === "string" ? data.name : "tool",
          summary: summarizeTool(data?.name, data?.arguments ?? ""),
          status: "running",
          result: null,
          isError: false,
        };
        if (entry.callId !== "") byCallId.set(entry.callId, entry);
        push(entry);
        break;
      }
      case "tool/result": {
        const callId = data?.message?.source?.callId;
        const entry = typeof callId === "string" ? byCallId.get(callId) : undefined;
        const content = data?.message?.content;
        const failed =
          Array.isArray(content) && content.some((block) => block?.type === "tool-result" && block.isError === true);
        const text = resultTextOf(data);
        if (entry !== undefined) {
          entry.status = failed ? "error" : "ok";
          entry.isError = failed;
          entry.result = text === "" ? null : clip(text, MAX_RESULT);
        } else {
          push({
            kind: "tool",
            callId: typeof callId === "string" ? callId : "",
            name: "tool",
            summary: "",
            status: failed ? "error" : "ok",
            isError: failed,
            result: text === "" ? null : clip(text, MAX_RESULT),
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return { entries, facts, truncated };
}

/**
 * One JSON response with the no-store discipline the backend routes use.
 * @param body - JSON-serializable body.
 * @param status - HTTP status.
 * @returns the response.
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Answer one subsession read.
 * @param ctx - host context carrying the query engine.
 * @param request - the already-authenticated request.
 * @returns the folded transcript, or the reason it cannot be served.
 */
async function serveSubsession(ctx, request) {
  const sessionId = new URL(request.url).searchParams.get("session") ?? "";
  if (sessionId === "" || sessionId.includes("\0")) return json({ error: "missing session" }, 400);
  let snapshot;
  try {
    snapshot = await ctx.sessionQuery.readSession(sessionId);
  } catch (error) {
    /* An unknown id is a client bug; an unreadable live turn is a transient state. */
    return json({ ok: false, sessionId, error: String(error?.message ?? error) }, 200);
  }
  const { entries, facts, truncated } = fold(snapshot.events ?? [], snapshot.inheritedEventCount ?? 0);
  const live = ctx.get("sessions")?.get?.(sessionId) !== undefined;
  return json({
    ok: true,
    sessionId,
    live,
    label: facts.label ?? facts.title ?? null,
    mode: facts.mode ?? null,
    provider: facts.provider ?? null,
    model: facts.model ?? null,
    effort: facts.effort ?? null,
    prompt: facts.prompt ?? null,
    cwd: snapshot.session?.cwd ?? null,
    createdAt: snapshot.session?.createdAt ?? null,
    eventCount: Array.isArray(snapshot.events) ? snapshot.events.length : 0,
    truncated,
    entries,
  });
}

/**
 * Register the subsession route for the caller's lifetime.
 * @param ctx - host context.
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ROUTE_PATH,
        methods: ["GET"],
        requestBody: "buffered",
        fetch: (request) => serveSubsession(ctx, request),
      }),
    "subagent-subsession: transcript route",
  );
}
