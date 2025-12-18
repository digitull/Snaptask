import { z } from "zod";
import { McpServer } from "skybridge/server";

const SNAPTASK_API_BASE =
  process.env.SNAPTASK_API_BASE ??
  "https://ma64ers93d.adaptive.ai/api/rpc";

// Small helper to call your Snaptask Adaptive RPC methods
async function callSnaptask<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(SNAPTASK_API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Adaptive RPC expects { method, params: [] }
    body: JSON.stringify({
      method,
      params: Array.isArray(params) ? params : [params],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Snaptask API error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { result?: T; error?: unknown };
  if (!("result" in json)) {
    throw new Error("Snaptask API: missing result field");
  }
  return json.result as T;
}

const server = new McpServer(
  {
    name: "snaptask-mcp",
    version: "0.0.1",
  },
  { capabilities: {} },
)

// 1) Widget: today view (uses mcpListTodayTasks)
  .registerWidget(
    "today_view",
    {
      description: "Snaptask: today’s tasks overview",
    },
    {
      description:
        "Use this tool to get the user’s Snaptask tasks for today. " +
        "Prefer this for anything like daily planning, checking what’s on today, or deciding the next action.",
      inputSchema: {}, // no input needed for today view
    },
    async () => {
      try {
        const tasks = await callSnaptask<
          Array<{
            id: string;
            title: string;
            isCompleted: boolean;
            dueDate: string | null;
            hasIncompleteSubtasks?: boolean;
          }>
        >("mcpListTodayTasks", []);

        const lines =
          tasks.length === 0
            ? "You have no tasks scheduled for today."
            : tasks
                .map((t) => {
                  const status = t.isCompleted ? "✅" : "⬜️";
                  const due = t.dueDate ? ` (due ${t.dueDate})` : "";
                  return `${status} ${t.title}${due}`;
                })
                .join("\n");

        return {
          _meta: { count: tasks.length },
          structuredContent: { tasks },
          content: [
            {
              type: "text" as const,
              text: lines,
            },
          ],
          isError: false,
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching today’s tasks from Snaptask: ${
                error?.message ?? String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  )

// 2) Tool: create tasks from free text (uses mcpCreateTasksFromText)
  .registerTool(
    "create_tasks_from_text",
    {
      description:
        "Turn a natural language description into structured Snaptask tasks.",
      inputSchema: {
        text: z
          .string()
          .describe(
            "User’s free‑form description of what they need to do. Can be long.",
          ),
      },
    },
    async ({ text }) => {
      try {
        const result = await callSnaptask<{
          response: string;
          sources: any[];
          tasks: Array<{
            id: string;
            title: string;
            isCompleted: boolean;
            dueDate: string | null;
          }>;
        }>("mcpCreateTasksFromText", { text });

        const createdSummary =
          result.tasks.length === 0
            ? "No tasks were created."
            : `Created ${result.tasks.length} task(s):\n` +
              result.tasks
                .map((t) => {
                  const due = t.dueDate ? ` (due ${t.dueDate})` : "";
                  return `• ${t.title}${due}`;
                })
                .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `${result.response}\n\n${createdSummary}`,
            },
          ],
          isError: false,
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating tasks in Snaptask: ${
                error?.message ?? String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  )

// 3) Tool: update task status (uses mcpUpdateTaskStatus)
  .registerTool(
    "update_task_status",
    {
      description: "Mark one or more Snaptask tasks as done or not done.",
      inputSchema: {
        updates: z
          .array(
            z.object({
              id: z.string().describe("Snaptask task id"),
              isCompleted: z
                .boolean()
                .describe("true to mark done, false to mark not done"),
            }),
          )
          .min(1)
          .describe("List of task completion updates."),
      },
    },
    async ({ updates }) => {
      try {
        const result = await callSnaptask<{ updatedCount: number }>(
          "mcpUpdateTaskStatus",
          { updates },
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Updated ${result.updatedCount} task(s) in Snaptask.`,
            },
          ],
          isError: false,
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating Snaptask task status: ${
                error?.message ?? String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  )

// 4) Tool: week overview (uses mcpListWeekOverview)
  .registerTool(
    "week_overview",
    {
      description:
        "Get an overview of the user’s Snaptask tasks for the current week.",
      inputSchema: {
        referenceDateIso: z
          .string()
          .datetime()
          .optional()
          .describe(
            "Optional ISO timestamp to anchor the week. Defaults to now if omitted.",
          ),
      },
    },
    async ({ referenceDateIso }) => {
      try {
        const tasks = await callSnaptask<
          Array<{
            id: string;
            title: string;
            dueDate: string | null;
            isCompleted: boolean;
          }>
        >("mcpListWeekOverview", { referenceDateIso });

        const text =
          tasks.length === 0
            ? "No tasks scheduled for this week."
            : tasks
                .map((t) => {
                  const status = t.isCompleted ? "✅" : "⬜️";
                  const due = t.dueDate ? ` (due ${t.dueDate})` : "";
                  return `${status} ${t.title}${due}`;
                })
                .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text,
            },
          ],
          isError: false,
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching Snaptask week overview: ${
                error?.message ?? String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  )

// 5) Tool: suggest next tasks (uses mcpSuggestNextTasks)
  .registerTool(
    "suggest_next_tasks",
    {
      description:
        "Ask Snaptask’s prioritization system what the user should work on next.",
      inputSchema: {
        daysAhead: z
          .number()
          .int()
          .min(1)
          .max(14)
          .optional()
          .describe("How many days ahead to consider (default 3)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Max number of suggestions to return (default 5)."),
      },
    },
    async ({ daysAhead, limit }) => {
      try {
        const suggestions = await callSnaptask<
          Array<{
            title: string;
            action: string | null;
            day: string | null;
            startTime: string | null;
            durationMin: number | null;
            taskId: string | null;
          }>
        >("mcpSuggestNextTasks", { daysAhead, limit });

        const text =
          suggestions.length === 0
            ? "No suggestions available right now."
            : suggestions
                .map((s, idx) => {
                  const whenParts = [];
                  if (s.day) whenParts.push(s.day);
                  if (s.startTime) whenParts.push(s.startTime);
                  const when = whenParts.length ? ` — ${whenParts.join(" ")}` : "";
                  const action = s.action ? ` (${s.action})` : "";
                  return `${idx + 1}. ${s.title}${action}${when}`;
                })
                .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text,
            },
          ],
          isError: false,
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting Snaptask suggestions: ${
                error?.message ?? String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  );

export default server;
export type AppType = typeof server;
