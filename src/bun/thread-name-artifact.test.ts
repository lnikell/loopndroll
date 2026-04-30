import { describe, expect, test } from "bun:test";
import {
  looksInternalThreadNameArtifact,
  looksStaleStoredThreadName,
} from "./thread-name-artifact";

describe("looksInternalThreadNameArtifact", () => {
  test("flags unmistakable prompt and instruction artifacts", () => {
    expect(looksInternalThreadNameArtifact("You are a helpful assistant.")).toBe(true);
    expect(looksInternalThreadNameArtifact("- Use `js_repl` for Node-backed JavaScript")).toBe(
      true,
    );
    expect(
      looksInternalThreadNameArtifact("# AGENTS.md instructions for /Users/test/project"),
    ).toBe(true);
  });

  test("keeps normal human-facing thread names visible", () => {
    expect(looksInternalThreadNameArtifact("Build freelancer pricing engine")).toBe(false);
    expect(looksInternalThreadNameArtifact("Memory Writing Agent: Phase 2 (Consolidation)")).toBe(
      false,
    );
  });
});

describe("looksStaleStoredThreadName", () => {
  test("keeps broad stale detection for refresh candidates", () => {
    expect(looksStaleStoredThreadName(null)).toBe(true);
    expect(looksStaleStoredThreadName("## Memory Writing Agent: Phase 2")).toBe(true);
    expect(looksStaleStoredThreadName("- Some prompt artifact")).toBe(true);
    expect(looksStaleStoredThreadName("Planeia setup local Open WebUI")).toBe(false);
  });
});
