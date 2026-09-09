import { describe, expect, it } from "vitest";
import { parseClaude, parseCodex } from "../src/adapters/parsers";

describe("Claude structured stream parser", () => {
  it.each([
    null,
    [],
    1,
    {},
    { type: "future" },
    { type: "system", subtype: "other" },
    { type: "stream_event", event: { type: "other" } },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "input_json_delta" } } },
  ])("ignores unsupported data %j", (event) => expect(parseClaude(event)).toEqual([]));
  it.each(["init", "system"])("reads session IDs from %s", (type) =>
    expect(parseClaude({ type, subtype: "init", session_id: "session-id" })[0].sessionId).toBe("session-id"),
  );
  it("recognizes lifecycle, tool blocks, partial output and permission denial", () => {
    expect(parseClaude({ type: "system", subtype: "permission_denied" })[0].kind).toBe("denied");
    expect(parseClaude({ type: "stream_event", event: { type: "message_start" } })[0].kind).toBe("started");
    expect(
      parseClaude({
        type: "stream_event",
        event: { type: "content_block_start", content_block: { type: "tool_use", name: "Read" } },
      })[0].text,
    ).toBe("Read");
    expect(
      parseClaude({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "part" } },
      })[0].text,
    ).toBe("part");
    expect(
      parseClaude({
        type: "assistant",
        message: { content: [{ type: "text", text: "answer" }, { type: "thinking" }, { type: "tool_use" }] },
      }).map((e) => e.kind),
    ).toEqual(["progress", "tool"]);
  });
  it("distinguishes a failed result, a successful result and denied tools", () => {
    expect(parseClaude({ type: "result", is_error: true, permission_denials: [{}] }).map((e) => e.kind)).toEqual([
      "denied",
      "failed",
    ]);
    expect(parseClaude({ type: "result", result: "done" })).toEqual([{ kind: "completed", text: "done" }]);
    expect(parseClaude({ type: "result" })[0].text).toBe("Task completed");
  });
});

describe("Codex JSONL parser", () => {
  it.each([null, [], {}, { type: "future" }, { type: "item.completed", item: { type: "reasoning" } }])(
    "ignores unsupported data %j",
    (event) => expect(parseCodex(event)).toEqual([]),
  );
  it("reads lifecycle and error events", () => {
    expect(parseCodex({ type: "thread.started", thread_id: "id" })[0].sessionId).toBe("id");
    expect(parseCodex({ type: "turn.started" })[0].kind).toBe("started");
    expect(parseCodex({ type: "turn.completed" })[0].kind).toBe("completed");
    expect(parseCodex({ type: "turn.failed", error: { message: "failed" } })[0]).toEqual({
      kind: "failed",
      text: "failed",
    });
    expect(parseCodex({ type: "error", message: "failed" })[0].kind).toBe("failed");
  });
  it.each(["item.started", "item.updated", "item.completed"])("accepts %s", (type) =>
    expect(parseCodex({ type, item: { type: "agent_message", text: "answer" } })[0].text).toBe("answer"),
  );
  it.each(["command_execution", "file_change", "mcp_tool_call", "web_search"])(
    "emits tool metadata without raw input: %s",
    (type) =>
      expect(parseCodex({ type: "item.completed", item: { type, command: "private input" } })[0].kind).toBe("tool"),
  );
});
