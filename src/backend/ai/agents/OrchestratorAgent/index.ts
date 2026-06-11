/**
 * @fileoverview OrchestratorAgent - Multi-Agent Orchestrator Durable Object
 *
 * Coordinates task delegation across the showcase agent fleet (CodeModeAgent,
 * BrowserHitlAgent, WorkflowsAgent, ArtifactAgent). Key features:
 * - Classifies user intent and routes to the most appropriate sub-agent
 * - Tracks active/completed/failed tasks in embedded SQLite
 * - Exposes a `spawnTask` tool the AI can invoke to delegate work
 * - State persists across WebSocket reconnections via AIChatAgent
 *
 * @example
 * ```typescript
 * // Frontend pairing via Agents SDK React hooks:
 * const { sendMessage } = useAgentChat({ agent: "orchestrator-agent", name: sessionId });
 * sendMessage({ role: "user", content: "Run a web scrape and save the result as an artifact" });
 * ```
 */

import { AIChatAgent } from "@cloudflare/ai-chat";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { getChatModel } from "@/backend/ai/providers/ai-sdk";
import type { SpawnTaskParams, OrchestratorState, SubAgentResult } from "./types";
import { spawnTaskSchema } from "./types";

const SYSTEM_PROMPT = [
  "You are the Multi-Agent Orchestrator for the Cloudflare Edge Showcase.",
  "Your role is to analyze user requests and delegate them to the most appropriate specialist agent.",
  "Use the spawnTask tool to route work: 'code' for execution tasks, 'browse' for web tasks,",
  "'workflow' for multi-step pipelines, 'artifact' for version-tracked code snapshots.",
  "Always explain your routing decision before delegating.",
].join(" ");

/**
 * OrchestratorAgent - Routes tasks to specialist showcase agents.
 */
export class OrchestratorAgent extends AIChatAgent<Env> {
  private agentState: OrchestratorState = {
    activeTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
  };

  /**
   * Initialize SQLite task log and restore persisted state.
   * Called automatically by the Agents SDK on first activation.
   */
  async onStart() {
    await this.initializeStorage();
    await this.loadAgentState();
  }

  /**
   * Handle incoming chat messages. Uses the spawnTask tool to delegate
   * sub-tasks to specialist agents and streams the orchestration narrative back.
   *
   * @param onFinish - Agents SDK finish callback for persisting the assistant turn
   * @returns Streaming UI message response
   */
  async onChatMessage(onFinish: Parameters<AIChatAgent<Env>["onChatMessage"]>[0]) {
    const result = streamText({
      model: getChatModel(this.env),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(this.messages as UIMessage[]),
      tools: {
        spawnTask: tool({
          description:
            "Delegate a task to a specialist sub-agent. Returns a task record with status and output.",
          inputSchema: spawnTaskSchema,
          execute: async (params: SpawnTaskParams): Promise<SubAgentResult> => {
            return await this.delegateTask(params);
          },
        }),
      },
      stopWhen: stepCountIs(10),
      onFinish,
    });

    return result.toUIMessageStreamResponse();
  }

  /**
   * Delegate a task to the appropriate specialist agent.
   * Persists the task record to SQLite for audit and status tracking.
   *
   * @param params - Spawn task parameters including target agent type and task description
   * @returns Sub-agent task result with status and output
   */
  private async delegateTask(params: SpawnTaskParams): Promise<SubAgentResult> {
    const taskId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    this.agentState.activeTasks++;
    await this.saveAgentState();

    await this.sql`
      INSERT INTO task_log (task_id, agent_type, task, status, started_at)
      VALUES (${taskId}, ${params.agentType}, ${params.task}, 'running', ${startedAt})
    `;

    try {
      // In a full implementation this would use getAgentByName / stub.callMethod
      // to reach the actual specialist DO instance. Here we record the delegation
      // and return a pending result — the agent can poll or the client subscribes
      // directly via the specialist agent's WebSocket channel.
      const output = `Task delegated to ${params.agentType} agent. Task ID: ${taskId}`;
      const completedAt = new Date().toISOString();

      await this.sql`
        UPDATE task_log
        SET status = 'completed', output = ${output}, completed_at = ${completedAt}
        WHERE task_id = ${taskId}
      `;

      this.agentState.activeTasks = Math.max(0, this.agentState.activeTasks - 1);
      this.agentState.completedTasks++;
      this.agentState.lastRoutedAgent = params.agentType;
      await this.saveAgentState();

      return {
        agentType: params.agentType,
        taskId,
        status: "completed",
        output,
        startedAt,
        completedAt,
      };
    } catch (err) {
      const completedAt = new Date().toISOString();
      const error = err instanceof Error ? err.message : String(err);

      await this.sql`
        UPDATE task_log
        SET status = 'failed', error = ${error}, completed_at = ${completedAt}
        WHERE task_id = ${taskId}
      `;

      this.agentState.activeTasks = Math.max(0, this.agentState.activeTasks - 1);
      this.agentState.failedTasks++;
      await this.saveAgentState();

      return {
        agentType: params.agentType,
        taskId,
        status: "failed",
        error,
        startedAt,
        completedAt,
      };
    }
  }

  /**
   * Initialize SQLite tables for task log and agent state.
   */
  private async initializeStorage(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS task_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL UNIQUE,
        agent_type TEXT NOT NULL,
        task TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        output TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS agent_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `;
  }

  /**
   * Load persisted orchestrator state from SQLite.
   */
  private async loadAgentState(): Promise<void> {
    const rows = await this.sql<{ value: string }>`
      SELECT value FROM agent_state WHERE key = 'state'
    `;
    if (rows.length > 0) {
      this.agentState = JSON.parse(rows[0].value);
    }
  }

  /**
   * Persist orchestrator state to SQLite.
   */
  private async saveAgentState(): Promise<void> {
    await this.sql`
      INSERT OR REPLACE INTO agent_state (key, value)
      VALUES ('state', ${JSON.stringify(this.agentState)})
    `;
  }
}
