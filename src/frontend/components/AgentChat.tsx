/**
 * @fileoverview AgentChat — assistant-ui `<Thread />` wired to the ChatBroker
 * Durable Object over a WebSocket channel.
 *
 * No external provider middleware sits between the browser and the broker:
 * `useAgentChat` from `@cloudflare/ai-chat/react` opens a WebSocket directly
 * to the `CHAT_BROKER` Durable Object (keyed by session id) and streams
 * UI-message frames back. The DO calls Workers AI via the project's
 * `getProvider()` registry on the server side.
 *
 * The thread is composed from `@assistant-ui/react` primitives
 * (ThreadPrimitive, MessagePrimitive, ComposerPrimitive). `@assistant-ui/react`
 * itself does not ship a styled `<Thread />`; that lives in `@assistant-ui/react-ui`
 * or the shadcn registry. The primitives give us full Monolith styling control.
 */

"use client";

import { useState, type ComponentProps } from "react";

import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";

import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function newSessionId() {
  if (typeof window === "undefined") return "session-ssr";
  const stored = window.sessionStorage.getItem("agent-chat-session");
  if (stored) return stored;
  const fresh = `session-${crypto.randomUUID()}`;
  window.sessionStorage.setItem("agent-chat-session", fresh);
  return fresh;
}

export function AgentChat() {
  const [sessionId] = useState(newSessionId);

  // 1. Open the long-lived WebSocket connection to the ChatBroker DO.
  //    The DO name (`chat-broker`) is the kebab-case of the class name and
  //    must match the `/agents/:name/:instance` routing rule used by the SDK.
  const agent = useAgent({ agent: "chat-broker", name: sessionId });

  // 2. Subscribe to the broker's persisted message stream. `useAgentChat`
  //    returns an `@ai-sdk/react` Chat surface backed by the DO transport.
  //    History is rehydrated server-side from the DO's SQLite store via the
  //    SDK's `/get-messages` endpoint — no `initialMessages` needed here.
  const chat = useAgentChat({ agent });

  // 3. Adapt the AI SDK chat surface to assistant-ui's runtime.
  //    `useAgentChat`'s return type is a structural extension of `useChat`, so
  //    `useAISDKRuntime` consumes it directly. The cast on the resulting runtime
  //    bridges a benign `@assistant-ui/react` vs `@assistant-ui/react-ai-sdk`
  //    version-skew in the `AssistantRuntime` type — verified to converge at
  //    runtime. See the assistant-ui Cloudflare Agents integration guide.
  const runtime = useAISDKRuntime(chat);
  type RuntimeProp = ComponentProps<typeof AssistantRuntimeProvider>["runtime"];

  // PartySocket readyState: 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED.
  const status =
    agent.readyState === 1
      ? "connected"
      : agent.readyState === 0
        ? "connecting"
        : "disconnected";

  return (
    <Card className="flex h-[calc(100vh-12rem)] flex-col">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle>Assistant</CardTitle>
          <CardDescription>
            assistant-ui Thread routed through the ChatBroker Durable Object over a
            WebSocket channel. No external provider middleware.
          </CardDescription>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={status === "connected" ? "default" : "outline"}>{status}</Badge>
          <code className="text-xs text-muted-foreground">{sessionId.slice(0, 18)}…</code>
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 p-0">
        <AssistantRuntimeProvider runtime={runtime as unknown as RuntimeProp}>
          <ThreadPrimitive.Root className="flex h-full flex-col">
            <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-6 py-4">
              <ThreadPrimitive.Empty>
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <p className="text-sm">No messages yet — start the conversation.</p>
                  <p className="text-xs">Streaming over wss://&hellip;/agents/chat-broker/{sessionId.slice(0, 10)}…</p>
                </div>
              </ThreadPrimitive.Empty>

              <ThreadPrimitive.Messages
                components={{
                  UserMessage: UserMessage,
                  AssistantMessage: AssistantMessage,
                }}
              />
            </ThreadPrimitive.Viewport>

            <ComposerPrimitive.Root className="flex items-end gap-2 px-6 py-4">
              <ComposerPrimitive.Input
                rows={1}
                autoFocus
                placeholder="Ask the assistant…"
                className="flex-1 resize-none rounded-md bg-muted/40 px-3 py-2 text-sm ring-1 ring-foreground/10 placeholder:text-muted-foreground focus:outline-none focus:ring-foreground/30"
              />
              <ComposerPrimitive.Send asChild>
                <Button size="sm">Send</Button>
              </ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
          </ThreadPrimitive.Root>
        </AssistantRuntimeProvider>
      </CardContent>
    </Card>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="mb-4 flex justify-end">
      <div className="max-w-[80%] rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="mb-4 flex justify-start">
      <div className="max-w-[80%] rounded-md bg-muted/60 px-3 py-2 text-sm">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}
