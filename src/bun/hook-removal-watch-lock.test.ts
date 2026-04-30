import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { LoopndrollPaths } from "./loopndroll-core";
import {
  acquireHookRemovalWatchLock,
  getHookRemovalWatcherStatus,
  releaseHookRemovalWatchLock,
} from "./hook-removal-watch-lock";

async function createTestPaths() {
  const appDirectoryPath = await mkdtemp(join(tmpdir(), "loopndroll-watch-lock-"));
  const paths = {
    appDirectoryPath,
    binDirectoryPath: join(appDirectoryPath, "bin"),
    stateDirectoryPath: join(appDirectoryPath, "state"),
    logsDirectoryPath: join(appDirectoryPath, "logs"),
    databasePath: join(appDirectoryPath, "app.db"),
    managedHookPath: join(appDirectoryPath, "bin", "loopndroll-hook"),
    hookRemovalWatchLockPath: join(appDirectoryPath, "state", "hook-removal-watch.lock"),
    startupRecoveryMarkerPath: join(appDirectoryPath, "state", "startup-runtime.marker.json"),
    hookDebugLogPath: join(appDirectoryPath, "logs", "hooks-debug.jsonl"),
    codexDirectoryPath: join(appDirectoryPath, ".codex"),
    codexConfigPath: join(appDirectoryPath, ".codex", "config.toml"),
    codexHooksPath: join(appDirectoryPath, ".codex", "hooks.json"),
  } satisfies LoopndrollPaths;

  return {
    paths,
    async cleanup() {
      await rm(appDirectoryPath, { recursive: true, force: true });
    },
  };
}

describe("hook removal watcher lock", () => {
  test("allows only one watcher owner for the same hook-state lock", async () => {
    const { paths, cleanup } = await createTestPaths();
    try {
      const first = await acquireHookRemovalWatchLock(paths, "/repo/a");
      const second = await acquireHookRemovalWatchLock(paths, "/repo/a");
      const status = await getHookRemovalWatcherStatus(paths);

      expect(first.status).toBe("acquired");
      expect(second.status).toBe("already-running");
      expect(second.message).toBe("watcher already running");
      expect(second.lock.pid).toBe(first.lock.pid);
      expect(status.active).toBe(true);
      expect(status.pid).toBe(process.pid);
      expect(status.repoRoot).toBe("/repo/a");
    } finally {
      await releaseHookRemovalWatchLock(paths);
      await cleanup();
    }
  });

  test("replaces a stale lock whose pid is no longer alive", async () => {
    const { paths, cleanup } = await createTestPaths();
    try {
      await mkdir(paths.stateDirectoryPath, { recursive: true });
      await writeFile(
        paths.hookRemovalWatchLockPath,
        `${JSON.stringify({
          pid: 0,
          started_at: "2026-04-24T00:00:00.000Z",
          repo_root: "/stale",
          hooks_path: paths.codexHooksPath,
          runtime_state_path: paths.databasePath,
        })}\n`,
        "utf8",
      );

      const result = await acquireHookRemovalWatchLock(paths, "/repo/b");

      expect(result.status).toBe("replaced-stale");
      expect(result.lock.pid).toBe(process.pid);
      expect(result.lock.repo_root).toBe("/repo/b");
    } finally {
      await releaseHookRemovalWatchLock(paths);
      await cleanup();
    }
  });
});
