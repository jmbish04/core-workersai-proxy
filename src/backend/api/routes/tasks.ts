/**
 * @fileoverview Tasks REST API router.
 *
 * Full CRUD over the `tasks` D1 table with support for:
 *  - Filtered list (q, status, priority, projectId, assignee, label, sort)
 *  - Kanban board view grouped by status column
 *  - Partial PATCH (status, priority, progress, position, and more)
 *
 * Mount this router at `/api/tasks` in `api/index.ts`.
 *
 * Route inventory:
 *   GET    /        – list tasks (q, status, priority, projectId, assignee, label, sort, limit, offset)
 *   GET    /board   – tasks grouped into kanban columns {todo, in_progress, in_review, done}
 *   POST   /        – create task
 *   GET    /{id}    – get task by id
 *   PATCH  /{id}    – partial update
 *   DELETE /{id}    – hard delete
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";

import { getDb } from "../../db";
import { insertTaskSchema, selectTaskSchema, tasks } from "../../db/schema";

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const taskIdParam = z.object({ id: z.string().min(1) });
const notFoundSchema = z.object({ error: z.string() });

const taskListQuerySchema = z.object({
  q: z.string().optional().openapi({ description: "Search on title and description." }),
  status: z
    .enum(["todo", "in_progress", "in_review", "done"])
    .optional()
    .openapi({ description: "Filter by workflow status." }),
  priority: z
    .enum(["low", "medium", "high", "urgent"])
    .optional()
    .openapi({ description: "Filter by priority." }),
  projectId: z.string().optional().openapi({ description: "Filter to a single project." }),
  assignee: z.string().optional().openapi({ description: "Filter by assignee display name." }),
  label: z.string().optional().openapi({ description: "Filter tasks containing this label." }),
  sort: z
    .enum(["dueDate", "priority", "createdAt", "position"])
    .optional()
    .openapi({ description: "Sort field (default: createdAt desc)." }),
  limit: z.string().optional().openapi({ description: "Max rows (default 50)." }),
  offset: z.string().optional().openapi({ description: "Skip rows for pagination (default 0)." }),
});

/** Slim insert body — server generates id, createdAt, updatedAt. */
const createTaskBody = insertTaskSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({ title: z.string().min(1) });

/** All fields optional for PATCH. */
const patchTaskBody = createTaskBody.partial();

const taskListResponse = z.object({
  data: z.array(selectTaskSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

// Board column names in display order
const BOARD_STATUSES = ["todo", "in_progress", "in_review", "done"] as const;

const boardColumnSchema = z.object({
  status: z.enum(BOARD_STATUSES),
  label: z.string(),
  tasks: z.array(selectTaskSchema),
});

const boardResponseSchema = z.object({
  columns: z.array(boardColumnSchema),
});

const COLUMN_LABELS: Record<(typeof BOARD_STATUSES)[number], string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

const deleteResponseSchema = z.object({ ok: z.boolean() });

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const tasksRouter = new OpenAPIHono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// GET /
// ---------------------------------------------------------------------------

tasksRouter.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["Tasks"],
    summary: "List tasks",
    operationId: "tasksList",
    request: { query: taskListQuerySchema },
    responses: {
      200: {
        description: "Paginated list of tasks.",
        content: { "application/json": { schema: taskListResponse } },
      },
    },
  }),
  async (c) => {
    const { q, status, priority, projectId, assignee, label, sort, limit: lStr, offset: oStr } =
      c.req.valid("query");
    const limit = Math.min(parseInt(lStr ?? "50", 10) || 50, 200);
    const offset = parseInt(oStr ?? "0", 10) || 0;
    const db = getDb(c.env);

    const conditions = [];
    if (q) {
      conditions.push(or(like(tasks.title, `%${q}%`), like(tasks.description, `%${q}%`)));
    }
    if (status) conditions.push(eq(tasks.status, status));
    if (priority) conditions.push(eq(tasks.priority, priority));
    if (projectId) conditions.push(eq(tasks.projectId, projectId));
    if (assignee) conditions.push(eq(tasks.assignee, assignee));
    // Label is stored as JSON array — use a JSON contains check
    if (label) {
      conditions.push(like(tasks.labels as unknown as Parameters<typeof like>[0], `%"${label}"%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const priorityOrder = sql`CASE ${tasks.priority}
      WHEN 'urgent' THEN 0
      WHEN 'high'   THEN 1
      WHEN 'medium' THEN 2
      WHEN 'low'    THEN 3
      ELSE 4 END`;

    const sortExpr =
      sort === "dueDate"
        ? asc(tasks.dueDate)
        : sort === "priority"
          ? asc(priorityOrder)
          : sort === "position"
            ? asc(tasks.position)
            : desc(tasks.createdAt);

    const [rows, countResult] = await Promise.all([
      db.select().from(tasks).where(where).orderBy(sortExpr).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(tasks).where(where),
    ]);

    return c.json({ data: rows, total: countResult[0]?.count ?? 0, limit, offset }, 200);
  },
);

// ---------------------------------------------------------------------------
// GET /board
// ---------------------------------------------------------------------------

tasksRouter.openapi(
  createRoute({
    method: "get",
    path: "/board",
    tags: ["Tasks"],
    summary: "Kanban board — tasks grouped by status column",
    operationId: "tasksBoard",
    responses: {
      200: {
        description: "All tasks grouped into kanban columns ordered by position.",
        content: { "application/json": { schema: boardResponseSchema } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c.env);
    const rows = await db
      .select()
      .from(tasks)
      .orderBy(asc(tasks.status), asc(tasks.position), asc(tasks.createdAt));

    // Group into columns
    const grouped = new Map<string, typeof rows>(BOARD_STATUSES.map((s) => [s, []]));
    for (const task of rows) {
      grouped.get(task.status)?.push(task);
    }

    const columns = BOARD_STATUSES.map((status) => ({
      status,
      label: COLUMN_LABELS[status],
      tasks: grouped.get(status) ?? [],
    }));

    return c.json({ columns }, 200);
  },
);

// ---------------------------------------------------------------------------
// POST /
// ---------------------------------------------------------------------------

tasksRouter.openapi(
  createRoute({
    method: "post",
    path: "/",
    tags: ["Tasks"],
    summary: "Create task",
    operationId: "tasksCreate",
    request: {
      body: { content: { "application/json": { schema: createTaskBody } } },
    },
    responses: {
      201: {
        description: "Created task.",
        content: { "application/json": { schema: selectTaskSchema } },
      },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const db = getDb(c.env);
    const [row] = await db
      .insert(tasks)
      .values({ ...body, createdAt: new Date(), updatedAt: new Date() })
      .returning();
    return c.json(row!, 201);
  },
);

// ---------------------------------------------------------------------------
// GET /{id}
// ---------------------------------------------------------------------------

tasksRouter.openapi(
  createRoute({
    method: "get",
    path: "/{id}",
    tags: ["Tasks"],
    summary: "Get task by ID",
    operationId: "tasksGet",
    request: { params: taskIdParam },
    responses: {
      200: {
        description: "Task record.",
        content: { "application/json": { schema: selectTaskSchema } },
      },
      404: {
        description: "Not found.",
        content: { "application/json": { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const db = getDb(c.env);
    const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!row) {
      return c.json({ error: "Task not found." }, 404);
    }
    return c.json(row, 200);
  },
);

// ---------------------------------------------------------------------------
// PATCH /{id}
// ---------------------------------------------------------------------------

tasksRouter.openapi(
  createRoute({
    method: "patch",
    path: "/{id}",
    tags: ["Tasks"],
    summary: "Partial update task (status, priority, progress, position, etc.)",
    operationId: "tasksPatch",
    request: {
      params: taskIdParam,
      body: { content: { "application/json": { schema: patchTaskBody } } },
    },
    responses: {
      200: {
        description: "Updated task.",
        content: { "application/json": { schema: selectTaskSchema } },
      },
      404: {
        description: "Not found.",
        content: { "application/json": { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const db = getDb(c.env);
    const [row] = await db
      .update(tasks)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    if (!row) {
      return c.json({ error: "Task not found." }, 404);
    }
    return c.json(row, 200);
  },
);

// ---------------------------------------------------------------------------
// DELETE /{id}
// ---------------------------------------------------------------------------

tasksRouter.openapi(
  createRoute({
    method: "delete",
    path: "/{id}",
    tags: ["Tasks"],
    summary: "Delete task",
    operationId: "tasksDelete",
    request: { params: taskIdParam },
    responses: {
      200: {
        description: "Deletion confirmation.",
        content: { "application/json": { schema: deleteResponseSchema } },
      },
      404: {
        description: "Not found.",
        content: { "application/json": { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const db = getDb(c.env);
    const result = await db.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id });
    if (result.length === 0) {
      return c.json({ error: "Task not found." }, 404);
    }
    return c.json({ ok: true }, 200);
  },
);
