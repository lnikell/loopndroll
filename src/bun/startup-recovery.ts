import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getLoopndrollDatabase } from "./db/client";
import { getLoopndrollPaths, nowIsoString, type LoopndrollPaths } from "./loopndroll-core";

export type StartupRecoverySummary = {
  resetApplied: boolean;
  checkedAt: string;
  staleRuntimeMarkerFound: boolean;
  globalPresetCleared: boolean;
  sessionModesCleared: number;
  runtimeRowsDeleted: number;
  awaitingRepliesDeleted: number;
  remotePromptsDeleted: number;
};

function getCount(client: Database, sql: string) {
  const row = client.query(sql).get() as { count?: number } | null;
  return typeof row?.count === "number" ? row.count : 0;
}

function hasGlobalPreset(client: Database) {
  const row = client.query("select global_preset from settings where id = 1").get() as {
    global_preset?: string | null;
  } | null;
  return typeof row?.global_preset === "string" && row.global_preset.trim().length > 0;
}

function buildNoResetSummary(staleRuntimeMarkerFound: boolean): StartupRecoverySummary {
  return {
    resetApplied: false,
    checkedAt: nowIsoString(),
    staleRuntimeMarkerFound,
    globalPresetCleared: false,
    sessionModesCleared: 0,
    runtimeRowsDeleted: 0,
    awaitingRepliesDeleted: 0,
    remotePromptsDeleted: 0,
  };
}

function writeStartupRecoveryMarker(paths: LoopndrollPaths) {
  mkdirSync(dirname(paths.startupRecoveryMarkerPath), { recursive: true });
  writeFileSync(
    paths.startupRecoveryMarkerPath,
    `${JSON.stringify({
      pid: process.pid,
      started_at: nowIsoString(),
      database_path: paths.databasePath,
    })}\n`,
    "utf8",
  );
}

export function clearStartupRecoveryMarker(paths = getLoopndrollPaths()) {
  rmSync(paths.startupRecoveryMarkerPath, { force: true });
}

export function resetActiveLoopStateInDatabase(client: Database): StartupRecoverySummary {
  const checkedAt = nowIsoString();
  const globalPresetCleared = hasGlobalPreset(client);
  const sessionModesCleared = getCount(
    client,
    `select count(*) as count
     from sessions
     where archived = 0
       and (preset is not null or active_since is not null)`,
  );
  const runtimeRowsDeleted = getCount(client, "select count(*) as count from session_runtime");
  const awaitingRepliesDeleted = getCount(
    client,
    "select count(*) as count from session_awaiting_replies",
  );
  const remotePromptsDeleted = getCount(
    client,
    "select count(*) as count from session_remote_prompts",
  );

  const resetApplied =
    globalPresetCleared ||
    sessionModesCleared > 0 ||
    runtimeRowsDeleted > 0 ||
    awaitingRepliesDeleted > 0 ||
    remotePromptsDeleted > 0;

  if (!resetApplied) {
    return {
      resetApplied,
      checkedAt,
      staleRuntimeMarkerFound: true,
      globalPresetCleared,
      sessionModesCleared,
      runtimeRowsDeleted,
      awaitingRepliesDeleted,
      remotePromptsDeleted,
    };
  }

  client.transaction(() => {
    client.query("update settings set global_preset = null where id = 1").run();
    client
      .query(
        `update sessions
         set preset = null,
             preset_overridden = 1,
             active_since = null
         where archived = 0
           and (preset is not null or active_since is not null)`,
      )
      .run();
    client.query("delete from session_runtime").run();
    client.query("delete from session_awaiting_replies").run();
    client.query("delete from session_remote_prompts").run();
  })();

  return {
    resetApplied,
    checkedAt,
    staleRuntimeMarkerFound: true,
    globalPresetCleared,
    sessionModesCleared,
    runtimeRowsDeleted,
    awaitingRepliesDeleted,
    remotePromptsDeleted,
  };
}

export function resetActiveLoopStateOnStartup(paths = getLoopndrollPaths(), client?: Database) {
  const staleRuntimeMarkerFound = existsSync(paths.startupRecoveryMarkerPath);
  if (!staleRuntimeMarkerFound) {
    writeStartupRecoveryMarker(paths);
    return buildNoResetSummary(false);
  }

  const activeClient = client ?? getLoopndrollDatabase(paths.databasePath).client;
  const summary = resetActiveLoopStateInDatabase(activeClient);
  writeStartupRecoveryMarker(paths);

  if (summary.resetApplied) {
    console.warn("Loopndroll startup reset cleared inherited active loop state.", summary);
  }

  return summary;
}
