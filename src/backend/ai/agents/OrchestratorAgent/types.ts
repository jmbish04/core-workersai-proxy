/**
 * @fileoverview Type definitions for OrchestratorAgent
 *
 * Provides type-safe interfaces and Zod schemas for the Multi-Agent Orchestrator,
 * including sub-agent spawn configurations, state synchronization, and task routing.
 */

import { z } from "zod";

/**
 * Configuration for spawning a child sub-agent task
 */
export const spawnTaskSchema = z.object({
  agentType: z
    .enum(["code", "browse", "workflow", "artifact"])
    .describe("Target agent type to delegate the task to"),
  task: z.string().describe("Human-readable task description to route to the sub-agent"),
  context: z
    .record(z.unknown())
    .optional()
    .describe("Optional context payload forwarded to the sub-agent"),
});

export type SpawnTaskParams = z.infer<typeof spawnTaskSchema>;

/**
 * Result returned from a delegated sub-agent task
 */
export interface SubAgentResult {
  agentType: string;
  taskId: string;
  status: "pending" | "running" | "completed" | "failed";
  output?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

/**
 * Internal orchestration state persisted in embedded SQLite
 */
export interface OrchestratorState {
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  lastRoutedAgent?: string;
}
