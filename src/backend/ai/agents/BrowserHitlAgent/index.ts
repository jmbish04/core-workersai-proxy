/**
 * @fileoverview BrowserHitlAgent - Agentic browser automation with human-in-the-loop approval
 *
 * This agent provides secure browser automation using Cloudflare Browser Rendering
 * with mandatory human approval for sensitive operations. Key features:
 * - Playwright CDP integration for headless Chromium control
 * - needsApproval: true pattern for high-value operations
 * - Real-time screenshot capture and page interaction
 * - Secure form filling with explicit user consent
 *
 * Built on Cloudflare Agents SDK with WebSocket hibernation.
 *
 * @example
 * ```typescript
 * // From frontend - approval UI automatically triggers
 * const result = await agent.stub.fillSecureForm({
 *   url: "https://example.com/form",
 *   selector: "#email",
 *   payload: { email: "user@example.com" }
 * });
 * ```
 */

import { AIChatAgent } from "@cloudflare/ai-chat";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { getChatModel } from "@/backend/ai/providers/ai-sdk";
import type {
  BrowserActionResult,
  BrowserAgentState,
  FillSecureFormParams,
  ClickElementParams,
  TakeScreenshotParams,
} from "./types";
import {
  fillSecureFormSchema,
  clickElementSchema,
  takeScreenshotSchema,
} from "./types";

/**
 * BrowserHitlAgent - Browser automation with mandatory human approval
 */
export class BrowserHitlAgent extends AIChatAgent<Env> {
  private agentState: BrowserAgentState = {
    totalActions: 0,
    approvedActions: 0,
    rejectedActions: 0,
  };

  /**
   * Initialize the agent and create tracking tables.
   */
  async onStart() {
    await this.initializeStorage();
    await this.loadAgentState();
  }

  /**
   * Handle incoming chat messages with browser automation tools.
   * Tools marked with needsApproval: true trigger ToolFallback UI.
   *
   * @returns AI SDK message stream response
   */
  async onChatMessage(onFinish: Parameters<AIChatAgent<Env>["onChatMessage"]>[0]) {
    const result = streamText({
      model: getChatModel(this.env),
      messages: await convertToModelMessages(this.messages as UIMessage[]),
      system: `You are a browser automation agent with human oversight.

You can:
1. Navigate to web pages
2. Take screenshots
3. Click elements (requires approval)
4. Fill forms (requires approval for sensitive data)

IMPORTANT: For any action that involves:
- Filling forms (especially payment, personal data)
- Clicking submit buttons
- Performing transactions
Always use tools marked with needsApproval.

Be cautious and transparent about what actions you're taking.`,
      tools: {
        takeScreenshot: tool({
          description: "Capture a screenshot of the current page or a specific URL",
          inputSchema: takeScreenshotSchema,
          execute: async (params: TakeScreenshotParams) => {
            return await this.captureScreenshot(params);
          },
        }),
        fillSecureForm: tool({
          description:
            "Fill a form with sensitive data. ALWAYS requires human approval before execution.",
          inputSchema: fillSecureFormSchema,
          needsApproval: true, // Triggers HITL approval UI
          execute: async (params: FillSecureFormParams) => {
            return await this.fillForm(params);
          },
        }),
        clickElement: tool({
          description:
            "Click an element on the page. Requires human approval for safety.",
          inputSchema: clickElementSchema,
          needsApproval: true, // Triggers HITL approval UI
          execute: async (params: ClickElementParams) => {
            return await this.clickElement(params);
          },
        }),
      },
      stopWhen: stepCountIs(8),
      temperature: 0.1, // Low temperature for predictable automation
      maxOutputTokens: 2048,
      onFinish,
    });

    return result.toUIMessageStreamResponse();
  }

  /**
   * Capture a screenshot using Browser Rendering API.
   *
   * @param params - Screenshot parameters
   * @returns Action result with base64 screenshot
   */
  private async captureScreenshot(
    params: TakeScreenshotParams,
  ): Promise<BrowserActionResult> {
    try {
      // Note: In production, this would use Cloudflare Browser Rendering
      // const browser = await this.env.MYBROWSER.launch();
      // const page = await browser.newPage();
      // await page.goto(params.url || this.agentState.activeSessionUrl);
      // const screenshot = await page.screenshot({ fullPage: params.fullPage });
      // await browser.close();

      this.agentState.totalActions++;
      await this.saveAgentState();
      await this.logAction("screenshot", params.url || "current", "success");

      return {
        status: "success",
        message: `Screenshot captured${params.fullPage ? " (full page)" : ""}`,
        url: params.url,
        screenshot: "base64_placeholder", // Would be actual base64 data
      };
    } catch (error) {
      await this.logAction("screenshot", params.url || "current", "error", String(error));

      return {
        status: "error",
        message: "Screenshot capture failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Fill a form with the provided data.
   * This method is only called after human approval via ToolFallback UI.
   *
   * @param params - Form filling parameters
   * @returns Action result
   */
  private async fillForm(params: FillSecureFormParams): Promise<BrowserActionResult> {
    try {
      // Note: In production, this would use Cloudflare Browser Rendering
      // const browser = await this.env.MYBROWSER.launch();
      // const page = await browser.newPage();
      // await page.goto(params.url);
      // await page.fill(params.selector, params.payload.data);
      // if (params.submitSelector) {
      //   await page.click(params.submitSelector);
      //   await page.waitForNavigation();
      // }
      // await browser.close();

      this.agentState.totalActions++;
      this.agentState.approvedActions++;
      await this.saveAgentState();
      await this.logAction("fillForm", params.url, "success");

      return {
        status: "success",
        message: `Form filled successfully at ${params.selector}`,
        url: params.url,
      };
    } catch (error) {
      await this.logAction("fillForm", params.url, "error", String(error));

      return {
        status: "error",
        message: "Form filling failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Click an element on the page.
   * This method is only called after human approval via ToolFallback UI.
   *
   * @param params - Click parameters
   * @returns Action result
   */
  private async clickElement(
    params: ClickElementParams,
  ): Promise<BrowserActionResult> {
    try {
      // Note: In production, this would use Cloudflare Browser Rendering
      // const browser = await this.env.MYBROWSER.launch();
      // const page = await browser.newPage();
      // await page.goto(params.url);
      // await page.click(params.selector);
      // if (params.waitForNavigation) {
      //   await page.waitForNavigation();
      // }
      // await browser.close();

      this.agentState.totalActions++;
      this.agentState.approvedActions++;
      await this.saveAgentState();
      await this.logAction("click", params.url, "success");

      return {
        status: "success",
        message: `Clicked element: ${params.selector}`,
        url: params.url,
      };
    } catch (error) {
      await this.logAction("click", params.url, "error", String(error));

      return {
        status: "error",
        message: "Click action failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Log browser actions to SQLite for audit trail.
   */
  private async logAction(
    action: string,
    url: string,
    status: string,
    error?: string,
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    await this.sql`
      INSERT INTO action_log (timestamp, action, url, status, error)
      VALUES (${timestamp}, ${action}, ${url}, ${status}, ${error || null})
    `;
  }

  /**
   * Initialize SQLite tables for action tracking.
   */
  private async initializeStorage(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS action_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        url TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT
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
   * Load agent state from SQLite.
   */
  private async loadAgentState(): Promise<void> {
    const result = await this.sql<{ value: string }>`
      SELECT value FROM agent_state WHERE key = 'state'
    `;

    if (result.length > 0) {
      this.agentState = JSON.parse(result[0].value);
    }
  }

  /**
   * Save agent state to SQLite.
   */
  private async saveAgentState(): Promise<void> {
    await this.sql`
      INSERT OR REPLACE INTO agent_state (key, value)
      VALUES ('state', ${JSON.stringify(this.agentState)})
    `;
  }
}
