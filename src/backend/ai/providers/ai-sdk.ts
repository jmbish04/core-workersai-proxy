/**
 * @fileoverview AI SDK model factory for `AIChatAgent` Durable Objects.
 *
 * The `AIChatAgent` chat loop (`streamText`/`generateText` from the `ai`
 * package) needs a real AI SDK `LanguageModel`, not the project's internal
 * `WorkersAIProvider` facade (which exposes `streamModel`/`generateStructured`
 * helpers but is NOT AI-SDK-compatible). This module bridges that gap using
 * the official `workers-ai-provider` package, wiring Cloudflare Workers AI
 * (`env.AI`) into the AI SDK exactly as the Cloudflare Agents docs prescribe:
 *
 *   const result = streamText({ model: getChatModel(this.env), ... })
 *
 * Keeping this in one place means every showcase agent resolves the same model
 * from the same `MODEL_CHAT` env var, and swapping providers later (OpenAI,
 * Anthropic, AI Gateway) is a one-file change.
 *
 * @see https://developers.cloudflare.com/agents/api-reference/chat-agents/
 */

import { createWorkersAI } from "workers-ai-provider";
import type { LanguageModel } from "ai";

/** Default Workers AI chat model when `MODEL_CHAT` is not set in the env. */
const DEFAULT_CHAT_MODEL = "@cf/openai/gpt-oss-120b";

/**
 * Resolve the AI SDK `LanguageModel` used by the chat showcase agents.
 *
 * Uses the `MODEL_CHAT` Worker var (declared in `wrangler.jsonc`) so the model
 * can be changed without code edits, falling back to a sane Workers AI default.
 *
 * @param env - Worker bindings (needs the `AI` Workers AI binding).
 * @returns An AI SDK `LanguageModel` ready to pass to `streamText`/`generateText`.
 */
export function getChatModel(env: Env): LanguageModel {
  const workersai = createWorkersAI({ binding: env.AI });
  const modelId = (env.MODEL_CHAT ?? DEFAULT_CHAT_MODEL) as Parameters<typeof workersai>[0];
  return workersai(modelId);
}
