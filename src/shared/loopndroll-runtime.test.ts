import { describe, expect, test } from "bun:test";

import { isLoopndrollRunning, normalizeLoopndrollRuntimeState } from "./loopndroll-runtime";

describe("normalizeLoopndrollRuntimeState", () => {
  test("accepts known runtime states", () => {
    expect(normalizeLoopndrollRuntimeState("running")).toBe("running");
    expect(normalizeLoopndrollRuntimeState("paused")).toBe("paused");
    expect(normalizeLoopndrollRuntimeState("stopped")).toBe("stopped");
  });

  test("falls back to running for unknown values", () => {
    expect(normalizeLoopndrollRuntimeState(null)).toBe("running");
    expect(normalizeLoopndrollRuntimeState("weird")).toBe("running");
  });
});

describe("isLoopndrollRunning", () => {
  test("returns true only for the running state", () => {
    expect(isLoopndrollRunning("running")).toBe(true);
    expect(isLoopndrollRunning("paused")).toBe(false);
    expect(isLoopndrollRunning("stopped")).toBe(false);
  });
});
