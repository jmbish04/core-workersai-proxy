/**
 * @fileoverview OpenAI-compatible and Ollama-compatible Workers AI proxy routes.
 *
 * These routes authenticate callers with the shared
 * `CLOUDFLARE_AI_GATEWAY_TOKEN`, normalize incoming model names into AI
 * Gateway-compatible identifiers, and proxy requests into the `coding-agents`
 * AI Gateway.
 *
 * The surface intentionally exposes:
 * - `/v1/*` OpenAI-compatible endpoints for standard SDKs,
 * - `/api/*` Ollama-compatible endpoints for local-model tooling, and
 * - `/api/ai/models` + `/api/ai/health` for typed discovery and diagnostics.
 *
 * @example
 * ```typescript
 * // OpenAI-compatible
 * POST /v1/chat/completions
 *
 * // Ollama-compatible
 * POST /api/chat
 * GET  /api/tags
 * ```
 */

import type { Context } from "hono";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import {
  authenticateProxyRequest,
  buildGatewayCompatUrl,
  listWorkersAiCatalogModels,
  normalizeGatewayModel,
} from "@/backend/ai/proxy/catalog";

const proxyHealthSchema = z.object({
  ok: z.boolean(),
  gatewayId: z.string(),
  accountConfigured: z.boolean(),
  tokenConfigured: z.boolean(),
  authPatterns: z.array(z.string()),
});

const proxyModelSchema = z.object({
  id: z.string(),
  object: z.literal("model"),
  created: z.number().nullable(),
  owned_by: z.string(),
  task: z.string(),
  description: z.string(),
  normalized_model: z.string(),
  context_window: z.number().nullable(),
  max_output_tokens: z.number().nullable(),
  tags: z.array(z.string()),
});

const proxyModelsResponseSchema = z.object({
  object: z.literal("list"),
  data: z.array(proxyModelSchema),
  categories: z.object({
    byTask: z.record(z.string(), z.array(z.string())),
    byAuthor: z.record(z.string(), z.array(z.string())),
  }),
});

const ollamaShowRequestSchema = z
  .object({
    name: z.string().optional(),
    model: z.string().optional(),
  })
  .refine((value) => Boolean(value.name || value.model), {
    message: "Either `name` or `model` is required",
  });

const ollamaChatRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(z.record(z.string(), z.unknown())),
    stream: z.boolean().optional(),
    format: z.union([z.literal("json"), z.record(z.string(), z.unknown())]).optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const ollamaGenerateRequestSchema = z
  .object({
    model: z.string().min(1),
    prompt: z.string().min(1),
    stream: z.boolean().optional(),
    format: z.union([z.literal("json"), z.record(z.string(), z.unknown())]).optional(),
    system: z.string().optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const ollamaEmbedRequestSchema = z
  .object({
    model: z.string().min(1),
    input: z.union([z.string(), z.array(z.string())]).optional(),
    prompt: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .passthrough()
  .refine((value) => value.input !== undefined || value.prompt !== undefined, {
    message: "Either `input` or `prompt` is required",
  });

const openAiBodySchema = z.object({ model: z.string().min(1) }).passthrough();
type ProxyContext = Context<{ Bindings: Env }>;

export const aiProxyRouter = new OpenAPIHono<{ Bindings: Env }>();

aiProxyRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/ai/health",
    operationId: "aiProxyHealth",
    responses: {
      200: {
        description: "Workers AI proxy health and configuration status",
        content: {
          "application/json": {
            schema: proxyHealthSchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
      },
    },
  }),
  async (c) => {
    const auth = await authenticateProxyRequest(c.req.raw, c.env);
    return c.json({
      ok: true,
      gatewayId: auth.gatewayId,
      accountConfigured: Boolean(auth.accountId),
      tokenConfigured: Boolean(auth.gatewayToken),
      authPatterns: [
        "Authorization: ******",
        "cf-aig-authorization: ******",
        "x-api-key: <token>",
        "api-key: <token>",
        "?api_key=<token>",
      ],
    });
  },
);

aiProxyRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/ai/models",
    operationId: "aiProxyModels",
    responses: {
      200: {
        description: "Published Workers AI model catalog grouped for discovery",
        content: {
          "application/json": {
            schema: proxyModelsResponseSchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
      },
    },
  }),
  async (c) => {
    await authenticateProxyRequest(c.req.raw, c.env);
    return c.json(await buildModelDiscoveryResponse());
  },
);

aiProxyRouter.get("/v1/models", async (c) => {
  await authenticateProxyRequest(c.req.raw, c.env);
  return c.json(await buildModelDiscoveryResponse());
});

aiProxyRouter.get("/v1/models/:model", async (c) => {
  await authenticateProxyRequest(c.req.raw, c.env);
  const requested = c.req.param("model");
  const models = await buildModelDiscoveryResponse();
  const model =
    models.data.find((entry) => entry.id === requested) ??
    models.data.find((entry) => entry.id === decodeURIComponent(requested));

  if (!model) {
    return openAiError("Model not found", 404);
  }

  return c.json(model);
});

aiProxyRouter.post("/v1/chat/completions", async (c) => {
  return proxyOpenAiJson(c, "/chat/completions");
});

aiProxyRouter.post("/v1/completions", async (c) => {
  return proxyOpenAiJson(c, "/completions");
});

aiProxyRouter.post("/v1/embeddings", async (c) => {
  return proxyOpenAiJson(c, "/embeddings");
});

aiProxyRouter.post("/v1/responses", async (c) => {
  return proxyOpenAiJson(c, "/responses");
});

aiProxyRouter.post("/v1/audio/transcriptions", async (c) => {
  try {
    const auth = await authenticateProxyRequest(c.req.raw, c.env);
    const input = await c.req.formData();
    const model = input.get("model");
    if (typeof model !== "string" || !model.trim()) {
      return openAiError("Model is required", 400);
    }

    const body = new FormData();
    for (const [key, value] of input.entries()) {
      body.append(key, key === "model" && typeof value === "string" ? normalizeGatewayModel(value) : value);
    }

    const upstream = await fetch(buildGatewayCompatUrl(auth, "/audio/transcriptions"), {
      method: "POST",
      headers: createUpstreamHeaders(c.req.raw.headers, auth.gatewayToken, {
        contentType: false,
      }),
      body,
    });

    return mirrorResponse(upstream);
  } catch (error) {
    return openAiError(readErrorMessage(error), readErrorStatus(error));
  }
});

aiProxyRouter.get("/api/tags", async (c) => {
  try {
    await authenticateProxyRequest(c.req.raw, c.env);
    const models = await listWorkersAiCatalogModels();
    return c.json({
      models: models.map((model) => ({
        name: model.id,
        model: model.id,
        modified_at: model.createdAt ?? new Date(0).toISOString(),
        size: 0,
        digest: model.normalizedId,
        details: {
          format: "cloudflare-workers-ai",
          family: model.author,
          families: [model.author, model.task],
          parameter_size: model.maxOutputTokens ? `${model.maxOutputTokens} output tokens` : "unknown",
          quantization_level: "unknown",
        },
      })),
    });
  } catch (error) {
    return ollamaError(readErrorMessage(error), readErrorStatus(error));
  }
});

aiProxyRouter.post("/api/show", async (c) => {
  try {
    await authenticateProxyRequest(c.req.raw, c.env);
    const request = ollamaShowRequestSchema.parse(await c.req.json());
    const name = request.name ?? request.model!;
    const models = await listWorkersAiCatalogModels();
    const match = models.find((model) => model.id === name || model.normalizedId === name);

    if (!match) {
      return ollamaError("Model not found", 404);
    }

    return c.json({
      license: "",
      modelfile: `FROM ${match.id}`,
      parameters: "",
      template: "",
      details: {
        format: "cloudflare-workers-ai",
        family: match.author,
        families: [match.author, match.task],
        parameter_size: match.maxOutputTokens ? `${match.maxOutputTokens} output tokens` : "unknown",
        quantization_level: "unknown",
      },
      model_info: {
        task: match.task,
        description: match.description,
        normalized_model: match.normalizedId,
        tags: match.tags,
      },
    });
  } catch (error) {
    return ollamaError(readErrorMessage(error), readErrorStatus(error));
  }
});

aiProxyRouter.post("/api/chat", async (c) => {
  try {
    const auth = await authenticateProxyRequest(c.req.raw, c.env);
    const request = ollamaChatRequestSchema.parse(await c.req.json());
    const upstream = await fetch(buildGatewayCompatUrl(auth, "/chat/completions"), {
      method: "POST",
      headers: createUpstreamHeaders(c.req.raw.headers, auth.gatewayToken),
      body: JSON.stringify({
        model: normalizeGatewayModel(request.model),
        messages: request.messages,
        stream: request.stream ?? false,
        temperature: readNumberOption(request.options, "temperature"),
        top_p: readNumberOption(request.options, "top_p"),
        max_tokens: readNumberOption(request.options, "num_predict"),
        stop: request.options?.stop,
        ...(request.format === "json" ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    if (!upstream.ok) {
      return ollamaError(await readResponseMessage(upstream), upstream.status);
    }

    if (request.stream) {
      return new Response(
        transformOpenAiSseToNdjson(upstream.body, (payload) => {
          const choice = firstChoice(payload);
          const delta = choice?.delta as Record<string, unknown> | undefined;
          const content = typeof delta?.content === "string" ? delta.content : "";
          const role = typeof delta?.role === "string" ? delta.role : "assistant";
          return content || delta?.role
            ? {
                model: request.model,
                created_at: new Date().toISOString(),
                message: { role, content },
                done: false,
              }
            : null;
        }, {
          model: request.model,
          created_at: new Date().toISOString(),
          message: { role: "assistant", content: "" },
          done: true,
          done_reason: "stop",
        }),
        {
          headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
        },
      );
    }

    const payload = await upstream.json<Record<string, unknown>>();
    const choice = firstChoice(payload);
    const message = asRecord(choice?.message) ?? {};

    return c.json({
      model: request.model,
      created_at: new Date().toISOString(),
      message: {
        role: typeof message.role === "string" ? message.role : "assistant",
        content: typeof message.content === "string" ? message.content : "",
      },
      done: true,
      done_reason: typeof choice?.finish_reason === "string" ? choice.finish_reason : "stop",
      prompt_eval_count: readUsageNumber(payload, "prompt_tokens"),
      eval_count: readUsageNumber(payload, "completion_tokens"),
    });
  } catch (error) {
    return ollamaError(readErrorMessage(error), readErrorStatus(error));
  }
});

aiProxyRouter.post("/api/generate", async (c) => {
  try {
    const auth = await authenticateProxyRequest(c.req.raw, c.env);
    const request = ollamaGenerateRequestSchema.parse(await c.req.json());
    const upstream = await fetch(buildGatewayCompatUrl(auth, "/chat/completions"), {
      method: "POST",
      headers: createUpstreamHeaders(c.req.raw.headers, auth.gatewayToken),
      body: JSON.stringify({
        model: normalizeGatewayModel(request.model),
        messages: [
          ...(request.system ? [{ role: "system", content: request.system }] : []),
          { role: "user", content: request.prompt },
        ],
        stream: request.stream ?? false,
        temperature: readNumberOption(request.options, "temperature"),
        top_p: readNumberOption(request.options, "top_p"),
        max_tokens: readNumberOption(request.options, "num_predict"),
        stop: request.options?.stop,
        ...(request.format === "json" ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    if (!upstream.ok) {
      return ollamaError(await readResponseMessage(upstream), upstream.status);
    }

    if (request.stream) {
      return new Response(
        transformOpenAiSseToNdjson(upstream.body, (payload) => {
          const choice = firstChoice(payload);
          const delta = choice?.delta as Record<string, unknown> | undefined;
          const content = typeof delta?.content === "string" ? delta.content : "";
          return content
            ? {
                model: request.model,
                created_at: new Date().toISOString(),
                response: content,
                done: false,
              }
            : null;
        }, {
          model: request.model,
          created_at: new Date().toISOString(),
          response: "",
          done: true,
          done_reason: "stop",
        }),
        {
          headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
        },
      );
    }

    const payload = await upstream.json<Record<string, unknown>>();
    const choice = firstChoice(payload);
    const message = asRecord(choice?.message) ?? {};

    return c.json({
      model: request.model,
      created_at: new Date().toISOString(),
      response: typeof message.content === "string" ? message.content : "",
      done: true,
      done_reason: typeof choice?.finish_reason === "string" ? choice.finish_reason : "stop",
      prompt_eval_count: readUsageNumber(payload, "prompt_tokens"),
      eval_count: readUsageNumber(payload, "completion_tokens"),
    });
  } catch (error) {
    return ollamaError(readErrorMessage(error), readErrorStatus(error));
  }
});

aiProxyRouter.post("/api/embed", async (c) => {
  return proxyOllamaEmbeddings(c);
});

aiProxyRouter.post("/api/embeddings", async (c) => {
  return proxyOllamaEmbeddings(c);
});

async function proxyOpenAiJson(c: ProxyContext, path: string) {
  try {
    const auth = await authenticateProxyRequest(c.req.raw, c.env);
    const request = openAiBodySchema.parse(await c.req.json());
    const upstream = await fetch(buildGatewayCompatUrl(auth, path), {
      method: "POST",
      headers: createUpstreamHeaders(c.req.raw.headers, auth.gatewayToken),
      body: JSON.stringify({
        ...request,
        model: normalizeGatewayModel(request.model),
      }),
    });

    return mirrorResponse(upstream);
  } catch (error) {
    return openAiError(readErrorMessage(error), readErrorStatus(error));
  }
}

async function proxyOllamaEmbeddings(c: ProxyContext) {
  try {
    const auth = await authenticateProxyRequest(c.req.raw, c.env);
    const request = ollamaEmbedRequestSchema.parse(await c.req.json());
    const input = request.input ?? request.prompt!;
    const upstream = await fetch(buildGatewayCompatUrl(auth, "/embeddings"), {
      method: "POST",
      headers: createUpstreamHeaders(c.req.raw.headers, auth.gatewayToken),
      body: JSON.stringify({
        model: normalizeGatewayModel(request.model),
        input,
      }),
    });

    if (!upstream.ok) {
      return ollamaError(await readResponseMessage(upstream), upstream.status);
    }

    const payload = await upstream.json<Record<string, unknown>>();
    const data = Array.isArray(payload.data) ? payload.data : [];
    const embeddings = data
      .map((item) => asRecord(item)?.embedding)
      .filter((item): item is number[] => Array.isArray(item));

    return c.json({
      model: request.model,
      embeddings,
      embedding: embeddings[0] ?? [],
      total_duration: 0,
      prompt_eval_count: readUsageNumber(payload, "prompt_tokens"),
    });
  } catch (error) {
    return ollamaError(readErrorMessage(error), readErrorStatus(error));
  }
}

async function buildModelDiscoveryResponse() {
  const models = await listWorkersAiCatalogModels();
  const byTask: Record<string, string[]> = {};
  const byAuthor: Record<string, string[]> = {};

  for (const model of models) {
    byTask[model.task] ??= [];
    byTask[model.task].push(model.id);

    byAuthor[model.author] ??= [];
    byAuthor[model.author].push(model.id);
  }

  return {
    object: "list" as const,
    data: models.map((model) => ({
      id: model.id,
      object: "model" as const,
      created: model.createdAt ? Math.floor(new Date(model.createdAt).getTime() / 1000) : null,
      owned_by: model.author,
      task: model.task,
      description: model.description,
      normalized_model: model.normalizedId,
      context_window: model.contextWindow ?? null,
      max_output_tokens: model.maxOutputTokens ?? null,
      tags: model.tags,
    })),
    categories: {
      byTask,
      byAuthor,
    },
  };
}

function createUpstreamHeaders(
  requestHeaders: Headers,
  gatewayToken: string,
  options: { contentType?: boolean } = {},
): Headers {
  const headers = new Headers();

  for (const [name, value] of requestHeaders.entries()) {
    const key = name.toLowerCase();
    if (
      key === "host" ||
      key === "authorization" ||
      key === "cf-aig-authorization" ||
      key === "x-api-key" ||
      key === "api-key" ||
      key === "apikey" ||
      key === "content-length"
    ) {
      continue;
    }

    if (key === "content-type" && options.contentType === false) {
      continue;
    }

    headers.set(name, value);
  }

  headers.set("cf-aig-authorization", ["Bearer", gatewayToken].join(" "));
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }
  if (options.contentType !== false && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return headers;
}

function mirrorResponse(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

function openAiError(message: string, status: number): Response {
  return Response.json(
    {
      error: {
        message,
        type: status === 401 ? "authentication_error" : "invalid_request_error",
      },
    },
    { status },
  );
}

function ollamaError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function readErrorStatus(error: unknown): number {
  return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : 500;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Internal server error";
}

async function readResponseMessage(response: Response): Promise<string> {
  try {
    const data = await response.clone().json<Record<string, unknown>>();
    const outer = asRecord(data.error);
    if (typeof outer?.message === "string") {
      return outer.message;
    }
    if (typeof data.error === "string") {
      return data.error;
    }
  } catch {
    // Ignore JSON parse errors and fall back to text / status.
  }

  const text = await response.clone().text();
  return text || `${response.status} ${response.statusText}`;
}

function transformOpenAiSseToNdjson(
  stream: ReadableStream<Uint8Array> | null,
  mapEvent: (payload: Record<string, unknown>) => Record<string, unknown> | null,
  finalLine: Record<string, unknown>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  if (!stream) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify(finalLine)}\n`));
        controller.close();
      },
    });
  }

  let buffer = "";

  return new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          for (const line of event.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice("data:".length).trim();
            if (!data) continue;
            if (data === "[DONE]") {
              controller.enqueue(encoder.encode(`${JSON.stringify(finalLine)}\n`));
              controller.close();
              return;
            }

            const payload = JSON.parse(data) as Record<string, unknown>;
            const mapped = mapEvent(payload);
            if (mapped) {
              controller.enqueue(encoder.encode(`${JSON.stringify(mapped)}\n`));
            }
          }
        }
      }

      controller.enqueue(encoder.encode(`${JSON.stringify(finalLine)}\n`));
      controller.close();
    },
  });
}

function firstChoice(payload: Record<string, unknown>) {
  return Array.isArray(payload.choices) ? asRecord(payload.choices[0]) : undefined;
}

function readUsageNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const usage = asRecord(payload.usage);
  const value = usage?.[key];
  return typeof value === "number" ? value : undefined;
}

function readNumberOption(
  options: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = options?.[key];
  return typeof value === "number" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
