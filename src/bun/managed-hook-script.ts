import { MANAGED_HOOK_SCRIPT_CHUNK_1 } from "./managed-hook-script/chunk-1";
import { MANAGED_HOOK_SCRIPT_CHUNK_2 } from "./managed-hook-script/chunk-2";
import { MANAGED_HOOK_SCRIPT_CHUNK_3 } from "./managed-hook-script/chunk-3";
import { DEFAULT_PROMPT } from "./constants";
import { SQLITE_PRAGMA_STATEMENTS } from "./db/client";
import { appMigrations } from "./db/migrations";
import {
  AWAIT_REPLY_POLL_INTERVAL_MS,
  GENERATED_TITLE_MATCH_WINDOW_MS,
  HOOK_DEBUG_LOG_ENV_NAME,
  HOOK_DEBUG_REDACTED_KEYS,
  REDACTED_DEBUG_VALUE,
  TELEGRAM_MAX_MESSAGE_LENGTH,
  TELEGRAM_NOTIFICATION_FOOTER,
  type LoopndrollPaths,
  MANAGED_HOOK_SCRIPT_MARKER,
} from "./loopndroll-core";

function getCompletionCheckRunner() {
  if (process.platform === "win32") {
    return {
      command: process.env["COMSPEC"] || "cmd.exe",
      args: ["/d", "/s", "/c"],
    };
  }

  return {
    command: process.env["SHELL"] || "/bin/sh",
    args: ["-lc"],
  };
}

export function buildManagedHookScript(paths: LoopndrollPaths) {
  const preamble = `#!/usr/bin/env bun
// ${MANAGED_HOOK_SCRIPT_MARKER}
import { spawnSync } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

const databasePath = ${JSON.stringify(paths.databasePath)};
const logsDirectoryPath = ${JSON.stringify(paths.logsDirectoryPath)};
const hookDebugLogPath = ${JSON.stringify(paths.hookDebugLogPath)};
const defaultPrompt = ${JSON.stringify(DEFAULT_PROMPT)};
const generatedTitleMatchWindowMs = ${String(GENERATED_TITLE_MATCH_WINDOW_MS)};
const awaitReplyPollIntervalMs = ${String(AWAIT_REPLY_POLL_INTERVAL_MS)};
const telegramMaxMessageLength = ${String(TELEGRAM_MAX_MESSAGE_LENGTH)};
const telegramNotificationFooter = ${JSON.stringify(TELEGRAM_NOTIFICATION_FOOTER)};
const hookDebugLogEnvName = ${JSON.stringify(HOOK_DEBUG_LOG_ENV_NAME)};
const redactedDebugValue = ${JSON.stringify(REDACTED_DEBUG_VALUE)};
const hookDebugRedactedKeys = ${JSON.stringify([...HOOK_DEBUG_REDACTED_KEYS])};
const completionCheckRunner = ${JSON.stringify(getCompletionCheckRunner())};
const sqlitePragmas = ${JSON.stringify([...SQLITE_PRAGMA_STATEMENTS])};
const appMigrations = ${JSON.stringify(appMigrations)};
`;

  return [
    preamble,
    MANAGED_HOOK_SCRIPT_CHUNK_1,
    MANAGED_HOOK_SCRIPT_CHUNK_2,
    MANAGED_HOOK_SCRIPT_CHUNK_3,
  ]
    .join("")
    .replace(
      'spawnSync("/bin/sh", ["-lc", command], {',
      "spawnSync(completionCheckRunner.command, [...completionCheckRunner.args, command], {",
    );
}
