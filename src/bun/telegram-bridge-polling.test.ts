import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { LoopndrollPaths } from "./loopndroll-core";
import { pollTelegramBridgeBotToken } from "./telegram-bridge";
import type { TelegramUpdate } from "./telegram-utils";

async function createTestPaths() {
  const appDirectoryPath = await mkdtemp(join(tmpdir(), "loopndroll-telegram-polling-"));
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

function createPollingSchema(db: Database) {
  db.exec(`
    create table telegram_update_cursors (
      bot_token text primary key,
      last_update_id integer not null,
      updated_at text not null
    );
  `);
}

function getCursor(db: Database, botToken: string) {
  return db
    .query("select last_update_id from telegram_update_cursors where bot_token = ?")
    .get(botToken) as { last_update_id: number } | null;
}

describe("pollTelegramBridgeBotToken", () => {
  test("continues after a bad update and advances the cursor past the fetched batch", async () => {
    const { paths, cleanup } = await createTestPaths();
    const db = new Database(":memory:");
    createPollingSchema(db);
    const processed: number[] = [];
    const logs: Array<Record<string, unknown>> = [];
    const updates: TelegramUpdate[] = [{ update_id: 10 }, { update_id: 11 }, { update_id: 12 }];

    try {
      await pollTelegramBridgeBotToken(paths, db, "bot-token", {
        fetchUpdates: async () => updates,
        processUpdate: async (_paths, _db, _botToken, update) => {
          if (update.update_id === 11) {
            throw new Error("poison update");
          }
          processed.push(update.update_id ?? -1);
        },
        log: async (_paths, entry) => {
          logs.push(entry);
        },
      });

      expect(processed).toEqual([10, 12]);
      expect(getCursor(db, "bot-token")).toEqual({ last_update_id: 12 });
      expect(logs).toMatchObject([
        {
          action: "poll-update-error",
          updateId: 11,
        },
      ]);
    } finally {
      db.close();
      await cleanup();
    }
  });

  test("does not advance the cursor when fetching updates fails", async () => {
    const { paths, cleanup } = await createTestPaths();
    const db = new Database(":memory:");
    createPollingSchema(db);
    db.query(
      "insert into telegram_update_cursors (bot_token, last_update_id, updated_at) values ('bot-token', 41, '2026-04-30T00:00:00.000Z')",
    ).run();
    const logs: Array<Record<string, unknown>> = [];

    try {
      await pollTelegramBridgeBotToken(paths, db, "bot-token", {
        fetchUpdates: async () => {
          throw new Error("bad token");
        },
        log: async (_paths, entry) => {
          logs.push(entry);
        },
      });

      expect(getCursor(db, "bot-token")).toEqual({ last_update_id: 41 });
      expect(logs).toMatchObject([
        {
          action: "poll-token-error",
          error: "bad token",
        },
      ]);
    } finally {
      db.close();
      await cleanup();
    }
  });
});
