import { describe, expect, test } from "bun:test";
import type { LoopndrollSnapshot } from "../shared/app-rpc";

import { buildHookFileTargets, buildLoopndrollSetupSnapshot } from "./hook-management";

function createBaseSnapshot(
  hookLifecycle: Partial<LoopndrollSnapshot["hookLifecycle"]> = {},
): LoopndrollSnapshot {
  return {
    defaultPrompt: "Keep going",
    scope: "global",
    runtimeState: "running",
    globalPreset: null,
    globalNotificationId: null,
    globalCompletionCheckId: null,
    globalCompletionCheckWaitForReply: false,
    hooksAutoRegistration: true,
    mirrorEnabled: false,
    notifications: [],
    completionChecks: [],
    health: {
      registered: true,
      issues: [],
      hookRemovalWatcher: {
        active: false,
        pid: null,
        lockPath: "/tmp/hook-removal-watch.lock",
        startedAt: null,
        repoRoot: null,
        hooksPath: null,
        runtimeStatePath: null,
        message: "watcher not running",
      },
    },
    hookLifecycle: {
      requestedAction: "none",
      appliedAction: "none",
      deferredAction: "none",
      remainingRisk: "none",
      nextAutomaticStep: null,
      message: "No hook lifecycle action has been requested.",
      pending: false,
      checkedAt: null,
      objectives: {
        inertNow: false,
        removedFromHooksJson: false,
        unloadedFromLiveRuntime: false,
      },
      ...hookLifecycle,
    },
    sessions: [],
  };
}

describe("buildLoopndrollSetupSnapshot", () => {
  test("returns a product-facing setup snapshot with runtime state and hook health", () => {
    const baseSnapshot = createBaseSnapshot();

    const snapshot = buildLoopndrollSetupSnapshot(baseSnapshot, {
      registered: false,
      issues: ["Managed Stop hook is not registered."],
      hookRemovalWatcher: baseSnapshot.health.hookRemovalWatcher,
    });

    expect(snapshot.runtimeState).toBe("running");
    expect(snapshot.hooksAutoRegistration).toBe(true);
    expect(snapshot.health.registered).toBe(false);
    expect(snapshot.health.issues).toEqual(["Managed Stop hook is not registered."]);
    expect(snapshot.health.hookRemovalWatcher.active).toBe(false);
  });

  test("does not let stale lifecycle copy override hook health", () => {
    const baseSnapshot = createBaseSnapshot({
      requestedAction: "start",
      appliedAction: "running",
      message: "Loopndroll hooks registered and running.",
    });

    const snapshot = buildLoopndrollSetupSnapshot(baseSnapshot, {
      registered: false,
      issues: ["Managed Stop hook is not registered."],
      hookRemovalWatcher: baseSnapshot.health.hookRemovalWatcher,
    });

    expect(snapshot.health.registered).toBe(false);
    expect(snapshot.health.issues).toContain("Managed Stop hook is not registered.");
    expect(snapshot.hookLifecycle.message).toBe("Loopndroll hooks registered and running.");
  });
});

describe("buildHookFileTargets", () => {
  test("tracks global and repo-local hooks files without collapsing them", () => {
    expect(
      buildHookFileTargets("/home/me/.codex/hooks.json", [
        "/work/repo-a",
        "/work/repo-b",
        "/work/repo-a",
        " ",
      ]),
    ).toEqual([
      {
        path: "/home/me/.codex/hooks.json",
        scope: "global",
      },
      {
        path: "/work/repo-a/.codex/hooks.json",
        scope: "repo-local",
      },
      {
        path: "/work/repo-b/.codex/hooks.json",
        scope: "repo-local",
      },
    ]);
  });
});
