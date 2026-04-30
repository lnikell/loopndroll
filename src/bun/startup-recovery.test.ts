import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { LoopndrollPaths } from "./loopndroll-core";
import {
  clearStartupRecoveryMarker,
  resetActiveLoopStateInDatabase,
  resetActiveLoopStateOnStartup,
} from "./startup-recovery";

async function createTestPaths() {
  const appDirectoryPath = await mkdtemp(join(tmpdir(), "loopndroll-startup-recovery-"));
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

function createRecoverySchema(db: Database) {
  db.exec(`
    create table settings (
      id integer primary key,
      global_preset text
    );
    insert into settings (id, global_preset) values (1, 'await-reply');

    create table sessions (
      thread_id text primary key,
      preset text,
      preset_overridden integer not null default 0,
      active_since text,
      archived integer not null default 0
    );

    create table session_runtime (
      thread_id text primary key
    );

    create table session_awaiting_replies (
      thread_id text not null
    );

    create table session_remote_prompts (
      thread_id text not null,
      delivery_mode text not null,
      primary key(thread_id, delivery_mode)
    );
  `);
}

describe("resetActiveLoopStateInDatabase", () => {
  test("clears inherited active loop state without deleting sessions", () => {
    const db = new Database(":memory:");
    createRecoverySchema(db);
    db.query(
      `insert into sessions (thread_id, preset, preset_overridden, active_since, archived) values
        ('active', 'await-reply', 0, '2026-04-30T00:00:00.000Z', 0),
        ('archived', 'infinite', 0, '2026-04-30T00:00:00.000Z', 1)`,
    ).run();
    db.query("insert into session_runtime (thread_id) values ('active')").run();
    db.query("insert into session_awaiting_replies (thread_id) values ('active')").run();
    db.query(
      "insert into session_remote_prompts (thread_id, delivery_mode) values ('active', 'once')",
    ).run();

    const summary = resetActiveLoopStateInDatabase(db);

    expect(summary).toMatchObject({
      resetApplied: true,
      globalPresetCleared: true,
      sessionModesCleared: 1,
      runtimeRowsDeleted: 1,
      awaitingRepliesDeleted: 1,
      remotePromptsDeleted: 1,
    });
    expect(db.query("select global_preset from settings where id = 1").get()).toEqual({
      global_preset: null,
    });
    expect(
      db
        .query(
          "select preset, preset_overridden, active_since from sessions where thread_id = 'active'",
        )
        .get(),
    ).toEqual({
      preset: null,
      preset_overridden: 1,
      active_since: null,
    });
    expect(db.query("select count(*) as count from sessions").get()).toEqual({ count: 2 });
    expect(db.query("select count(*) as count from session_runtime").get()).toEqual({ count: 0 });
    db.close();
  });

  test("does nothing when there is no inherited active state", () => {
    const db = new Database(":memory:");
    createRecoverySchema(db);
    db.query("update settings set global_preset = null where id = 1").run();

    const summary = resetActiveLoopStateInDatabase(db);

    expect(summary.resetApplied).toBe(false);
    db.close();
  });
});

describe("resetActiveLoopStateOnStartup", () => {
  test("preserves active modes during a normal launch with no stale runtime marker", async () => {
    const { paths, cleanup } = await createTestPaths();
    try {
      const db = new Database(paths.databasePath);
      createRecoverySchema(db);
      db.query(
        `insert into sessions (thread_id, preset, preset_overridden, active_since, archived)
         values ('active', 'await-reply', 0, '2026-04-30T00:00:00.000Z', 0)`,
      ).run();
      db.close();

      const summary = resetActiveLoopStateOnStartup(paths);
      const reopened = new Database(paths.databasePath);

      expect(summary).toMatchObject({
        resetApplied: false,
        staleRuntimeMarkerFound: false,
      });
      expect(existsSync(paths.startupRecoveryMarkerPath)).toBe(true);
      expect(reopened.query("select global_preset from settings where id = 1").get()).toEqual({
        global_preset: "await-reply",
      });
      expect(
        reopened.query("select preset from sessions where thread_id = 'active'").get(),
      ).toEqual({ preset: "await-reply" });
      reopened.close();
    } finally {
      clearStartupRecoveryMarker(paths);
      await cleanup();
    }
  });

  test("clears inherited active modes after a stale runtime marker", async () => {
    const { paths, cleanup } = await createTestPaths();
    try {
      const db = new Database(paths.databasePath);
      createRecoverySchema(db);
      db.query(
        `insert into sessions (thread_id, preset, preset_overridden, active_since, archived)
         values ('active', 'await-reply', 0, '2026-04-30T00:00:00.000Z', 0)`,
      ).run();
      await mkdir(paths.stateDirectoryPath, { recursive: true });
      await writeFile(paths.startupRecoveryMarkerPath, "{}\n", "utf8");

      const summary = resetActiveLoopStateOnStartup(paths, db);

      expect(summary).toMatchObject({
        resetApplied: true,
        staleRuntimeMarkerFound: true,
        globalPresetCleared: true,
        sessionModesCleared: 1,
      });
      expect(db.query("select global_preset from settings where id = 1").get()).toEqual({
        global_preset: null,
      });
      expect(db.query("select preset from sessions where thread_id = 'active'").get()).toEqual({
        preset: null,
      });
      expect(existsSync(paths.startupRecoveryMarkerPath)).toBe(true);
      db.close();
    } finally {
      clearStartupRecoveryMarker(paths);
      await cleanup();
    }
  });

  test("removes the runtime marker during graceful shutdown cleanup", async () => {
    const { paths, cleanup } = await createTestPaths();
    try {
      const db = new Database(paths.databasePath);
      createRecoverySchema(db);
      db.close();

      resetActiveLoopStateOnStartup(paths);
      clearStartupRecoveryMarker(paths);

      expect(existsSync(paths.startupRecoveryMarkerPath)).toBe(false);
    } finally {
      await cleanup();
    }
  });
});
