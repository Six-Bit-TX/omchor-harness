/**
 * Subagent fan-out budget — host half.
 *
 * The composer's fan-out selector picks a number of subagents (3–10, or off)
 * for one Session. The browser half owns the control; this half owns the fact
 * and, more importantly, the model-visible consequence: a scoped system-prompt
 * section that tells the agent to decompose the work into that many independent
 * workstreams and dispatch them together with the `subagent` tool.
 *
 * The count is per Session and lives in this process (`budgets`), which is the
 * right lifetime for a per-prompt scheduling preference: the browser mirrors it
 * in `localStorage` and re-publishes it on mount, so a page reload or a host
 * reload both converge on the same value without a durable settings document.
 *
 * The section is installed per Agent on `agent/created` and registered empty
 * when the Session has no budget, so a Session that never touches the selector
 * gets a byte-identical system prompt to one with this plugin absent. Every
 * Assembly re-reads the map, so changing the selector applies to the next
 * request rather than requiring a new Session.
 *
 * The route is `GET/POST /api/subagent-fanout` on Connection's shared,
 * cookie-authenticated `/api` channel:
 *
 *   GET  ?session=<id>              -> { sessionId, count }   (0 = off)
 *   POST { sessionId, count }       -> { sessionId, count }   (0 clears)
 *
 * @module @local/dsh-subagent-fanout
 */

/** Required host services: the authenticated API channel, the prompt registry, and Agents. */
export const inject = ["connection", "systemPrompt", "agents"];

/** The authenticated route this plugin owns. */
const ROUTE_PATH = "/api/subagent-fanout";

/** Selectable fan-out floor, matching the composer control. */
const MIN_COUNT = 3;

/** Selectable fan-out ceiling, matching the composer control. */
const MAX_COUNT = 10;

/** The system-prompt section name this plugin owns. */
const SECTION_NAME = "local:subagent-fanout";

/**
 * Live per-Session budgets. Absent means off; `0` is never stored.
 * Keyed by top-level Session id, because only a top-level agent delegates.
 */
const budgets = new Map();

/**
 * Accept one published count.
 * @param value - decoded JSON body field.
 * @returns the normalized count (`0` for off), or undefined when malformed.
 */
function normalizeCount(value) {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value === 0) return 0;
  if (value < MIN_COUNT || value > MAX_COUNT) return undefined;
  return value;
}

/**
 * The model-facing directive for one budget.
 *
 * Deliberately explicit about the three failure modes a number alone invites:
 * fewer children when the task cannot be split (rather than inventing work),
 * one child per workstream (rather than serial delegation), and foreground
 * work while the children run (rather than idling).
 * @param count - the Session's fan-out target.
 * @returns the system-prompt section text.
 */
function directive(count) {
  return [
    `## Fan-out delegation budget: ${String(count)} subagents`,
    "",
    `The user set a fan-out target of ${String(count)} subagents for this Session. For every substantive request, decompose the work into up to ${String(count)} independent, self-contained workstreams and dispatch them together in one assistant message — one \`subagent\` call per workstream, each with \`run_in_background: true\` so the children run concurrently.`,
    "",
    "A child cannot see this conversation: give every child a complete standalone brief, a distinct 3–5 word `description`, and the exact deliverable you expect back. While the children run, keep working on whatever does not depend on them. Then collect each outcome, reconcile the findings yourself, and answer from the reconciled result rather than relaying raw child output.",
    "",
    `Use fewer than ${String(count)} children when the task genuinely does not split into that many useful workstreams, and never invent work to reach the target. Do not collapse the task into a single child either: the number is the point of the setting.`,
  ].join("\n");
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
 * Install the budget section for one Agent, once.
 * @param ctx - host context.
 * @param fibers - per-Agent install records.
 * @param agent - the Agent to cover.
 */
function install(ctx, fibers, agent) {
  if (fibers.has(agent)) return;
  /* Only a top-level agent delegates; a child never carries the parent's budget. */
  if (agent.session.header.origin === "subagent") return;
  const sessionId = agent.session.header.id;
  const fiber = agent.ctx.inject(["systemPrompt"], (scope) => {
    scope.systemPrompt.section({
      name: SECTION_NAME,
      /* Immediately after the shipped `tool:subagent` guidance, which it refines. */
      order: scope.systemPrompt.getSectionOrder("TOOL_SUBAGENT") + 10,
      text: () => {
        const count = budgets.get(sessionId);
        return count === undefined ? "" : directive(count);
      },
    });
  });
  fibers.set(agent, fiber);
}

/**
 * Register the budget route and the per-Agent prompt section.
 * @param ctx - host context.
 */
export function apply(ctx) {
  /** Agents already covered, so a repeated lifecycle event cannot double-register. */
  const fibers = new Map();

  for (const agent of ctx.agents.list()) install(ctx, fibers, agent);
  ctx.on("agent/created", ({ agent }) => {
    install(ctx, fibers, agent);
  });
  ctx.on("agent/disposed", ({ agent }) => {
    const fiber = fibers.get(agent);
    fibers.delete(agent);
    const disposal = fiber?.dispose?.();
    /* A disposal failure is a lifecycle diagnostic, never a request failure. */
    Promise.resolve(disposal).catch((error) => {
      ctx.logger?.warn?.(`subagent-fanout: prompt cleanup failed: ${String(error)}`);
    });
  });

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ROUTE_PATH,
        methods: ["GET", "POST"],
        requestBody: "buffered",
        fetch: async (request) => {
          if (request.method === "GET") {
            const sessionId = new URL(request.url).searchParams.get("session") ?? "";
            if (sessionId === "") return json({ error: "missing session" }, 400);
            return json({ sessionId, count: budgets.get(sessionId) ?? 0 });
          }
          let body;
          try {
            body = await request.json();
          } catch {
            return json({ error: "invalid JSON body" }, 400);
          }
          const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
          if (sessionId === "") return json({ error: "missing sessionId" }, 400);
          const count = normalizeCount(body?.count);
          if (count === undefined) {
            return json(
              { error: `count must be 0 or an integer between ${String(MIN_COUNT)} and ${String(MAX_COUNT)}` },
              400,
            );
          }
          if (count === 0) budgets.delete(sessionId);
          else budgets.set(sessionId, count);
          ctx.logger?.info?.(
            `subagent-fanout: session ${sessionId} fan-out ${count === 0 ? "off" : String(count)}`,
          );
          return json({ sessionId, count });
        },
      }),
    "subagent-fanout: budget route",
  );
}
