import { NormalizedEvent } from "../core/types";
import { array, record, safeText } from "../core/privacy";

function claudeBlock(raw: unknown): NormalizedEvent[] {
  const block = record(raw);
  switch (block.type) {
    case "text":
      return [{ kind: "progress", text: safeText(block.text) }];
    case "tool_use":
      return [{ kind: "tool", text: safeText(block.name, "Tool call") }];
    default:
      return [];
  }
}

export function parseClaude(raw: unknown): NormalizedEvent[] {
  const event = record(raw);
  switch (event.type) {
    case "init":
      return [{ kind: "session", sessionId: safeText(event.session_id), text: "Session initialized" }];
    case "system":
      switch (event.subtype) {
        case "init":
          return [{ kind: "session", sessionId: safeText(event.session_id), text: "Session initialized" }];
        case "permission_denied":
          return [{ kind: "denied", text: "A tool was denied by the configured policy" }];
        default:
          return [];
      }
    case "assistant":
      return array(record(event.message).content).flatMap(claudeBlock);
    case "stream_event": {
      const nested = record(event.event);
      switch (nested.type) {
        case "message_start":
          return [{ kind: "started", text: "Generating response" }];
        case "content_block_start":
          return claudeBlock(nested.content_block);
        case "content_block_delta": {
          const delta = record(nested.delta);
          switch (delta.type) {
            case "text_delta":
              return [{ kind: "progress", text: safeText(delta.text) }];
            default:
              return [];
          }
        }
        default:
          return [];
      }
    }
    case "result": {
      const denials = array(event.permission_denials).map((): NormalizedEvent => ({
        kind: "denied",
        text: "Tool permission denied",
      }));
      if (event.is_error === true)
        return [...denials, { kind: "failed", text: "Claude reported an unsuccessful result" }];
      return [...denials, { kind: "completed", text: safeText(event.result, "Task completed") }];
    }
    default:
      return [];
  }
}

function codexItem(raw: unknown): NormalizedEvent[] {
  const item = record(raw);
  switch (item.type) {
    case "agent_message":
      return [{ kind: "progress", text: safeText(item.text) }];
    case "command_execution":
      return [{ kind: "tool", text: "Command execution" }];
    case "file_change":
      return [{ kind: "tool", text: "File changes" }];
    case "mcp_tool_call":
      return [{ kind: "tool", text: "MCP tool call" }];
    case "web_search":
      return [{ kind: "tool", text: "Web search" }];
    default:
      return [];
  }
}

export function parseCodex(raw: unknown): NormalizedEvent[] {
  const event = record(raw);
  switch (event.type) {
    case "thread.started":
      return [{ kind: "session", sessionId: safeText(event.thread_id), text: "Thread initialized" }];
    case "turn.started":
      return [{ kind: "started", text: "Turn started" }];
    case "turn.completed":
      return [{ kind: "completed", text: "Turn completed" }];
    case "turn.failed":
      return [{ kind: "failed", text: safeText(record(event.error).message, "Turn failed") }];
    case "error":
      return [{ kind: "failed", text: safeText(event.message, "Codex reported an error") }];
    case "item.started":
    case "item.updated":
    case "item.completed":
      return codexItem(event.item);
    default:
      return [];
  }
}
