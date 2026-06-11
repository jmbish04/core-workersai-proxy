/**
 * @fileoverview Workers AI proxy helpers for authentication, model normalization,
 * and public model-catalog discovery.
 *
 * This module centralizes the non-route concerns for the proxy surface:
 * - validating incoming proxy API keys against the Secrets Store binding,
 * - normalizing client-supplied model names into AI Gateway-compatible names,
 * - resolving the Cloudflare account / gateway configuration, and
 * - fetching the published Workers AI model catalog for `/v1/models` and
 *   Ollama-style discovery endpoints.
 *
 * The discovery data is sourced from Cloudflare's public documentation repo
 * because the invoke APIs are documented, but a stable public "list models"
 * API is not exposed alongside them. A short-lived in-memory cache keeps the
 * worker from re-downloading the catalog for every request.
 *
 * @example
 * ```typescript
 * const auth = await authenticateProxyRequest(request, env);
 * const model = normalizeGatewayModel("@cf/openai/gpt-oss-120b");
 * const models = await listWorkersAiCatalogModels();
 * ```
 */

import { constantTimeEqual } from "@/backend/lib/crypto";
import { getCloudflareAccountId, getCloudflareAiGatewayToken } from "@/backend/utils/secrets";

const WORKERS_AI_DIRECTORY_URL =
  "https://api.github.com/repos/cloudflare/cloudflare-docs/contents/src/content/workers-ai-models";
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;

type GitHubDirectoryEntry = {
  type: string;
  download_url: string | null;
};

type WorkersAiProperty = {
  property_id: string;
  value: string | Array<Record<string, unknown>>;
};

type WorkersAiModelDoc = {
  id: string;
  name: string;
  description: string;
  created_at?: string;
  tags?: string[];
  task: {
    id: string;
    name: string;
    description: string;
  };
  properties: WorkersAiProperty[];
  schema: {
    input: Record<string, unknown>;
    output: Record<string, unknown>;
  };
};

export type GatewayAuth = {
  accountId: string;
  gatewayId: string;
  gatewayToken: string;
};

export type WorkersAiCatalogModel = {
  id: string;
  normalizedId: string;
  author: string;
  task: string;
  description: string;
  createdAt?: string;
  tags: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
};

let modelCache:
  | {
      expiresAt: number;
      data: WorkersAiCatalogModel[];
    }
  | undefined;

/**
 * Authenticate a proxy request using any supported API-key transport.
 *
 * Supported inputs:
 * - Authorization bearer header
 * - `cf-aig-authorization` bearer header
 * - `x-api-key`, `api-key`, or `apikey`
 * - `?api_key=<token>` or `?key=<token>`
 *
 * @param request - Incoming Worker request
 * @param env - Cloudflare Worker bindings
 * @returns The validated account / gateway / token configuration
 * @throws Error when the gateway token or account id is missing
 * @throws Error when the provided API key is missing or invalid
 *
 * @example
 * ```typescript
 * const auth = await authenticateProxyRequest(request, env);
 * const upstream = buildGatewayCompatUrl(auth, "/chat/completions");
 * ```
 */
export async function authenticateProxyRequest(
  request: Request,
  env: Env,
): Promise<GatewayAuth> {
  const accountId = await getCloudflareAccountId(env);
  const gatewayToken = await getCloudflareAiGatewayToken(env);
  const gatewayId = env.AI_GATEWAY_ID || "coding-agents";

  if (!accountId) {
    const error = new Error("Missing CLOUDFLARE_ACCOUNT_ID");
    Object.assign(error, { status: 500 });
    throw error;
  }

  if (!gatewayToken) {
    const error = new Error("Missing CLOUDFLARE_AI_GATEWAY_TOKEN");
    Object.assign(error, { status: 500 });
    throw error;
  }

  const provided = extractProxyApiKey(request);
  if (!provided || !constantTimeEqual(provided, gatewayToken)) {
    const error = new Error("Unauthorized");
    Object.assign(error, { status: 401 });
    throw error;
  }

  return { accountId, gatewayId, gatewayToken };
}

/**
 * Normalize a client-provided model into the AI Gateway naming scheme expected
 * by the OpenAI-compatible compat endpoints.
 *
 * Rules:
 * - `gemini/<model>` → `google-ai-studio/<model>`
 * - `openai/<model>` / `anthropic/<model>` pass through
 * - `@cf/<author>/<model>` → `workers-ai/@cf/<author>/<model>`
 * - `<author>/<model>` (non-provider prefix) → `workers-ai/@cf/<author>/<model>`
 *
 * @param model - Raw client model identifier
 * @returns AI Gateway-compatible model name
 * @throws Error when the model is blank
 *
 * @example
 * ```typescript
 * normalizeGatewayModel("gemini/gemini-2.5-flash");
 * // => "google-ai-studio/gemini-2.5-flash"
 * ```
 */
export function normalizeGatewayModel(model: string): string {
  const trimmed = model.trim();

  if (!trimmed) {
    throw new Error("Model is required");
  }

  if (trimmed.startsWith("workers-ai/@cf/")) {
    return trimmed;
  }

  if (trimmed.startsWith("@cf/")) {
    return `workers-ai/${trimmed}`;
  }

  if (trimmed.startsWith("gemini/")) {
    return `google-ai-studio/${trimmed.slice("gemini/".length)}`;
  }

  if (
    trimmed.startsWith("google-ai-studio/") ||
    trimmed.startsWith("openai/") ||
    trimmed.startsWith("anthropic/")
  ) {
    return trimmed;
  }

  if (trimmed.startsWith("workers-ai/")) {
    return trimmed;
  }

  const [prefix] = trimmed.split("/", 1);
  if (prefix && !prefix.startsWith("@")) {
    return `workers-ai/@cf/${trimmed}`;
  }

  return trimmed;
}

/**
 * Build the AI Gateway OpenAI-compat upstream URL for a given request path.
 *
 * @param auth - Validated gateway auth configuration
 * @param path - Compat sub-path beginning with `/`
 * @returns Fully-qualified AI Gateway URL
 *
 * @example
 * ```typescript
 * buildGatewayCompatUrl(auth, "/embeddings");
 * ```
 */
export function buildGatewayCompatUrl(auth: GatewayAuth, path: string): string {
  return `https://gateway.ai.cloudflare.com/v1/${auth.accountId}/${auth.gatewayId}/compat${path}`;
}

/**
 * Fetch the published Workers AI model catalog and return a normalized list.
 *
 * @returns The normalized Workers AI catalog
 * @throws Error when the public catalog cannot be fetched
 *
 * @example
 * ```typescript
 * const models = await listWorkersAiCatalogModels();
 * const coding = models.filter((model) => model.task === "Text Generation");
 * ```
 */
export async function listWorkersAiCatalogModels(): Promise<WorkersAiCatalogModel[]> {
  if (modelCache && modelCache.expiresAt > Date.now()) {
    return modelCache.data;
  }

  const files = await fetchJson<GitHubDirectoryEntry[]>(WORKERS_AI_DIRECTORY_URL);
  const downloadableFiles = files.filter(
    (file): file is GitHubDirectoryEntry & { download_url: string } =>
      file.type === "file" && typeof file.download_url === "string",
  );
  const models = await Promise.all(
    downloadableFiles.map(async (file) =>
      normalizeWorkersAiCatalogModel(await fetchJson<WorkersAiModelDoc>(file.download_url)),
    ),
  );

  models.sort((left, right) => {
    return (
      left.task.localeCompare(right.task) ||
      left.author.localeCompare(right.author) ||
      left.id.localeCompare(right.id)
    );
  });

  modelCache = {
    expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
    data: models,
  };

  return models;
}

function extractProxyApiKey(request: Request): string | null {
  const authorization =
    request.headers.get("authorization") ?? request.headers.get("cf-aig-authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  const headerKey =
    request.headers.get("x-api-key") ??
    request.headers.get("api-key") ??
    request.headers.get("apikey");
  if (headerKey?.trim()) {
    return headerKey.trim();
  }

  const url = new URL(request.url);
  return url.searchParams.get("api_key") ?? url.searchParams.get("key");
}

function normalizeWorkersAiCatalogModel(model: WorkersAiModelDoc): WorkersAiCatalogModel {
  const author = extractWorkersAiAuthor(model.name);

  return {
    id: model.name,
    normalizedId: normalizeGatewayModel(model.name),
    author,
    task: model.task.name,
    description: model.description,
    createdAt: model.created_at,
    tags: model.tags ?? [],
    contextWindow: readNumericProperty(model.properties, "context_window"),
    maxOutputTokens: readNumericProperty(model.properties, "max_output_tokens"),
    inputSchema: model.schema.input,
    outputSchema: model.schema.output,
  };
}

function extractWorkersAiAuthor(modelId: string): string {
  const match = modelId.match(/^@cf\/([^/]+)\//);
  return match?.[1] ?? "unknown";
}

function readNumericProperty(properties: WorkersAiProperty[], id: string): number | undefined {
  const value = properties.find((property) => property.property_id === id)?.value;
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "core-workersai-proxy",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}
