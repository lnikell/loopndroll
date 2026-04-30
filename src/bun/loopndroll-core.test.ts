import { describe, expect, test } from "bun:test";
import { isPromptOnlyArtifact } from "./loopndroll-core";

describe("isPromptOnlyArtifact", () => {
  test("hides unresolved internal thread names even when a transcript exists", () => {
    expect(
      isPromptOnlyArtifact({
        transcriptPath: "/tmp/thread.jsonl",
        threadName: "- Use `js_repl` for Node-backed JavaScript",
        lastAssistantMessage: null,
      }),
    ).toBe(true);
  });

  test("keeps clean transcript-derived titles visible", () => {
    expect(
      isPromptOnlyArtifact({
        transcriptPath: "/tmp/thread.jsonl",
        threadName: "Memory Writing Agent: Phase 2 (Consolidation)",
        lastAssistantMessage: null,
      }),
    ).toBe(false);
  });
});
