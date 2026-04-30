import { describe, expect, test } from "bun:test";
import { deriveThreadNameFromUserText } from "./thread-name-transcript";

describe("deriveThreadNameFromUserText", () => {
  test("skips AGENTS boilerplate and uses the first meaningful user heading", () => {
    const result = deriveThreadNameFromUserText(
      [
        "# AGENTS.md instructions for /Users/test/.codex/memories",
        "",
        "<INSTRUCTIONS>",
        "## JavaScript REPL (Node)",
        "## Memory Writing Agent: Phase 2 (Consolidation)",
        "",
        "You are a Memory Writing Agent.",
      ].join("\n"),
    );

    expect(result).toBe("Memory Writing Agent: Phase 2 (Consolidation)");
  });

  test("returns null when no meaningful user line exists", () => {
    const result = deriveThreadNameFromUserText(
      ["# AGENTS.md instructions for /tmp/project", "", "<INSTRUCTIONS>", "Your job:"].join("\n"),
    );

    expect(result).toBeNull();
  });

  test("does not classify regular Java prompts as boilerplate", () => {
    const result = deriveThreadNameFromUserText(
      ["Java migration plan", "## JavaScript REPL (Node)"].join("\n"),
    );

    expect(result).toBe("Java migration plan");
  });
});
