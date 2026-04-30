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
import {
  buildTelegramPromptReceivedText,
  buildTelegramWorkingAckText,
  getTelegramRemotePromptDeliveryMode,
} from "./telegram-control";
import { TELEGRAM_OUTPUT_HOOK_SOURCE } from "./telegram-output";

const TELEGRAM_WORKING_ACK_HELPER_SOURCE = `
async function sendTelegramWorkingAck(db, sessionId, telegramTargets) {
  if (!Array.isArray(telegramTargets) || telegramTargets.length === 0) {
    return;
  }

  const session = getSession(db, sessionId);
  if (!session) {
    return;
  }

  const text = buildTelegramWorkingAckText({
    cwd: session.cwd,
    sessionRef: session.sessionRef,
    title: session.title,
  });
  const seenTargets = new Set();
  const results = await Promise.allSettled(
    telegramTargets.map(async (target) => {
      const botToken = typeof target?.botToken === "string" ? target.botToken.trim() : "";
      const chatId = typeof target?.chatId === "string" ? target.chatId.trim() : "";
      const dedupeKey = \`\${botToken}::\${chatId}\`;
      if (botToken.length === 0 || chatId.length === 0 || seenTargets.has(dedupeKey)) {
        return;
      }

      seenTargets.add(dedupeKey);
      const response = await fetch(buildTelegramBotUrl(botToken), {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({
          chat_id: chatId,
          text,
        }).toString(),
      });
      if (!response.ok) {
        throw new Error(\`Telegram working acknowledgement failed with status \${response.status}\`);
      }
    }),
  );

  const failures = results.filter((result) => result.status === "rejected").length;
  await appendHookDebugLog({
    type: "telegram-working-ack",
    sessionId,
    deliveredCount: results.length - failures,
    failedCount: failures,
  });
}
`;

const TELEGRAM_USER_MIRROR_HELPER_SOURCE = `
async function sendUserPromptMirrorNotifications(db, input) {
  const settingsRow = getSettings(db);
  if (!settingsRow.mirror_enabled) {
    return [];
  }

  const message = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (message.length === 0) {
    return [];
  }

  const selectedNotifications = db
    .query(
      \`select
        n.id,
        n.label,
        n.channel,
        n.webhook_url,
        n.chat_id,
        n.bot_token,
        n.bot_url,
        n.created_at
      from notifications n
      inner join session_notifications sn on sn.notification_id = n.id
      where sn.session_id = ?
      order by n.created_at asc, n.id asc\`,
    )
    .all(input.session_id);
  if (selectedNotifications.length === 0) {
    return [];
  }

  const sessionRow = db
    .query("select session_ref, title, archived, cwd from sessions where session_id = ?")
    .get(input.session_id);
  if (Boolean(sessionRow?.archived)) {
    return [];
  }

  const mirrorTexts = buildTelegramNotificationChunks({
    cwd: sessionRow?.cwd ?? null,
    sessionRef: sessionRow?.session_ref ?? null,
    sessionTitle: sessionRow?.title ?? null,
    message: \`User Message:\\n\\n\${message}\`,
    preset: null,
    telegramNotificationFooter,
    maxLength: telegramMaxMessageLength,
  });

  const results = await Promise.allSettled(
    selectedNotifications.map(async (notification) => {
      if (notification.channel === "slack") {
        const response = await fetch(resolveSlackWebhookUrl(notification.webhook_url), {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ text: \`User Message:\\n\\n\${message}\` }),
        });
        if (!response.ok) {
          throw new Error(\`Slack user mirror failed with status \${response.status}\`);
        }
        return;
      }

      const telegramEndpoint =
        (typeof notification.bot_token === "string" && notification.bot_token.length > 0
          ? buildTelegramBotUrl(notification.bot_token)
          : notification.bot_url) ?? null;
      if (!telegramEndpoint) {
        throw new Error("Telegram notification is missing a bot token.");
      }

      for (const telegramText of mirrorTexts) {
        const response = await fetch(telegramEndpoint, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: new URLSearchParams({
            chat_id: notification.chat_id,
            text: telegramText,
          }).toString(),
        });
        if (!response.ok) {
          throw new Error(\`Telegram user mirror failed with status \${response.status}\`);
        }
      }
    }),
  );

  const failures = results.filter((result) => result.status === "rejected").length;
  await appendHookDebugLog({
    type: "telegram-mirror",
    hookEventName: "UserPromptSubmit",
    sessionId: input.session_id,
    deliveredCount: results.length - failures,
    failedCount: failures,
  });

  return results;
}
`;

const SQLITE_STATEMENT_FINALIZER_SOURCE = `
function installHookSqliteStatementFinalizer(db) {
  const statements = [];
  const originalQuery = db.query.bind(db);
  db.query = (...args) => {
    const statement = originalQuery(...args);
    statements.push(statement);
    return statement;
  };

  return () => {
    for (const statement of statements.reverse()) {
      try {
        statement.finalize();
      } catch {
        // The hook is process-scoped; finalization is best-effort cleanup before close.
      }
    }
  };
}
`;

function getLoopndrollRuntimeState(db: {
  query: (sql: string) => { get: (...args: unknown[]) => Record<string, unknown> | null };
}) {
  const row = db.query("select runtime_state from settings where id = 1").get();
  return row?.runtime_state === "paused" || row?.runtime_state === "stopped"
    ? row.runtime_state
    : "running";
}

export function normalizeRuntimeStateHelperName(source: string) {
  return source.replace(
    /^function getLoopndrollRuntimeState\d*\(/,
    "function getLoopndrollRuntimeState(",
  );
}

function normalizeManagedHookTelegramTokenResolver(source: string) {
  return source.replaceAll(
    [
      "function buildTelegramBotUrl(botToken) {",
      "  return `https://api.telegram.org/bot${botToken}/sendMessage`;",
      "}",
    ].join("\n"),
    [
      'const telegramBotTokenKeychainRefPrefix = "keychain://loopndroll/telegram-bot-token/";',
      'const telegramBotTokenKeychainService = "loopndroll.telegram.bot-token";',
      'const slackWebhookUrlKeychainRefPrefix = "keychain://loopndroll/slack-webhook-url/";',
      'const slackWebhookUrlKeychainService = "loopndroll.slack.webhook-url";',
      "",
      "function resolveKeychainSecret(secretOrRef, refPrefix, service, label) {",
      '  const value = String(secretOrRef ?? "").trim();',
      "  if (!value.startsWith(refPrefix)) {",
      "    return value;",
      "  }",
      "  const account = decodeURIComponent(value.slice(refPrefix.length));",
      "  const result = spawnSync(",
      '    "/usr/bin/security",',
      "    [",
      '      "find-generic-password",',
      '      "-a",',
      "      account,",
      '      "-s",',
      "      service,",
      '      "-w",',
      "    ],",
      '    { encoding: "utf8", maxBuffer: 1024 * 1024 },',
      "  );",
      "  if (result.status !== 0) {",
      "    throw new Error(`Could not read ${label} from macOS Keychain.`);",
      "  }",
      '  const secret = String(result.stdout ?? "").trim();',
      "  if (secret.length === 0) {",
      "    throw new Error(`${label} in macOS Keychain is empty.`);",
      "  }",
      "  return secret;",
      "}",
      "",
      "function resolveTelegramBotToken(botTokenOrRef) {",
      "  return resolveKeychainSecret(",
      "    botTokenOrRef,",
      "    telegramBotTokenKeychainRefPrefix,",
      "    telegramBotTokenKeychainService,",
      '    "Telegram bot token",',
      "  );",
      "}",
      "",
      "function resolveSlackWebhookUrl(webhookUrlOrRef) {",
      "  return resolveKeychainSecret(",
      "    webhookUrlOrRef,",
      "    slackWebhookUrlKeychainRefPrefix,",
      "    slackWebhookUrlKeychainService,",
      '    "Slack webhook URL",',
      "  );",
      "}",
      "",
      "function buildTelegramBotUrl(botToken) {",
      "  return `https://api.telegram.org/bot${resolveTelegramBotToken(botToken)}/sendMessage`;",
      "}",
    ].join("\n"),
  );
}

function normalizeManagedHookSchemaReferences(source: string) {
  return normalizeManagedHookTelegramTokenResolver(source)
    .replaceAll(
      "  const db = new Database(databasePath, { create: true });\n  configureDatabase(db);\n  applyMigrations(db);\n\n  const sessionCountBefore",
      "  const db = new Database(databasePath, { create: true });\n  const finalizeHookSqliteStatements = installHookSqliteStatementFinalizer(db);\n  try {\n  configureDatabase(db);\n  applyMigrations(db);\n\n  const sessionCountBefore",
    )
    .replaceAll(
      "\n}\n\nawait main().catch(async (error) => {",
      "\n  } finally {\n    finalizeHookSqliteStatements();\n    db.close();\n  }\n}\n\nawait main().catch(async (error) => {",
    )
    .replaceAll(
      "if (queuedPrompt) {\n      clearSessionAwaitingReplies(db, sessionId);\n      return {",
      "if (queuedPrompt) {\n      clearSessionAwaitingReplies(db, sessionId);\n      await sendTelegramWorkingAck(db, sessionId, telegramTargets);\n      return {",
    )
    .replaceAll(
      'if (resolution?.type === "prompt") {\n      return {',
      'if (resolution?.type === "prompt") {\n      await sendTelegramWorkingAck(db, sessionId, telegramTargets);\n      return {',
    )
    .replaceAll(
      "  const effectivePreset = getEffectivePreset(db, input.session_id);\n  const telegramTexts = buildTelegramNotificationChunks({",
      '  const effectivePreset = getEffectivePreset(db, input.session_id);\n  const settingsRow = getSettings(db);\n  if (effectivePreset === null && !settingsRow.mirror_enabled) {\n    await appendHookDebugLog({\n      type: "notification",\n      hookEventName: "Stop",\n      sessionId: input.session_id,\n      action: "skipped",\n      reason: "no-active-mode-and-mirror-disabled",\n    });\n    return [];\n  }\n  const telegramTexts = buildTelegramNotificationChunks({',
    )
    .replaceAll(
      '    await appendHookDebugLog({\n      type: "hook-event",\n      hookEventName,\n      action: existingSession ? "update-session-title" : "recover-session-on-prompt",\n      sessionId: input.session_id,\n      payload: input,\n      sessionCountBefore,\n      sessionCountAfter,\n      storedSession: session,\n    });\n    return;',
      '    await sendUserPromptMirrorNotifications(db, input);\n    await appendHookDebugLog({\n      type: "hook-event",\n      hookEventName,\n      action: existingSession ? "update-session-title" : "recover-session-on-prompt",\n      sessionId: input.session_id,\n      payload: input,\n      sessionCountBefore,\n      sessionCountAfter,\n      storedSession: session,\n    });\n    return;',
    )
    .replaceAll(
      "select default_prompt, scope, global_preset, global_notification_id, global_completion_check_id, global_completion_check_wait_for_reply, hooks_auto_registration from settings where id = 1",
      "select default_prompt, scope, global_preset, global_notification_id, global_completion_check_id, global_completion_check_wait_for_reply, hooks_auto_registration, mirror_enabled from settings where id = 1",
    )
    .replaceAll(
      "  const remotePrompt =\n    readPersistentSessionRemotePrompt(db, sessionId) ?? consumeSessionRemotePrompt(db, sessionId);\n  return {",
      "  const remotePrompt =\n    readPersistentSessionRemotePrompt(db, sessionId) ?? consumeSessionRemotePrompt(db, sessionId);\n  if (remotePrompt) {\n    await sendTelegramWorkingAck(db, sessionId, telegramTargets);\n  }\n  return {",
    )
    .replaceAll(
      "const response = await fetch(notification.webhook_url, {",
      "const response = await fetch(resolveSlackWebhookUrl(notification.webhook_url), {",
    )
    .replaceAll(
      "insert into sessions (\n          session_id,",
      "insert into sessions (\n          thread_id,",
    )
    .replaceAll("select\n        session_id,", "select\n        thread_id as session_id,")
    .replaceAll("\n              title = ?,", "\n              thread_name = ?,")
    .replaceAll(
      "\n          title,\n          transcript_path",
      "\n          thread_name,\n          transcript_path",
    )
    .replaceAll(
      "\n        title,\n        transcript_path",
      "\n        thread_name as title,\n        transcript_path",
    )
    .replaceAll(
      "update sessions set title = ? where thread_id = ?",
      "update sessions set thread_name = ? where thread_id = ?",
    )
    .replaceAll(
      "select session_ref, title, archived, cwd from sessions where thread_id = ?",
      "select session_ref, thread_name as title, archived, cwd from sessions where thread_id = ?",
    )
    .replaceAll("where s.session_id = ?", "where s.thread_id = ?")
    .replaceAll("where sn.session_id = ?", "where sn.thread_id = ?")
    .replaceAll("where session_id != ?", "where thread_id != ?")
    .replaceAll("where session_id = ?", "where thread_id = ?")
    .replaceAll(
      "update sessions set title = ? where thread_id = ?",
      "update sessions set thread_name = ? where thread_id = ?",
    )
    .replaceAll(
      "select session_ref, title, archived, cwd from sessions where thread_id = ?",
      "select session_ref, thread_name as title, archived, cwd from sessions where thread_id = ?",
    )
    .replaceAll(
      "insert into session_notifications (session_id, notification_id)",
      "insert into session_notifications (thread_id, notification_id)",
    )
    .replaceAll(
      "on conflict(session_id, notification_id)",
      "on conflict(thread_id, notification_id)",
    )
    .replaceAll(
      "insert into session_runtime (session_id, remaining_turns)",
      "insert into session_runtime (thread_id, remaining_turns)",
    )
    .replaceAll("on conflict(session_id) do update", "on conflict(thread_id) do update")
    .replaceAll(
      "insert into session_awaiting_replies (\n      session_id,",
      "insert into session_awaiting_replies (\n      thread_id,",
    )
    .replaceAll(
      "insert into telegram_delivery_receipts (\n            id,\n            notification_id,\n            session_id,",
      "insert into telegram_delivery_receipts (\n            id,\n            notification_id,\n            thread_id,",
    );
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
const sqlitePragmas = ${JSON.stringify([...SQLITE_PRAGMA_STATEMENTS])};
const appMigrations = ${JSON.stringify(appMigrations)};
`;

  const hookBody = normalizeManagedHookSchemaReferences(
    [
      `${TELEGRAM_OUTPUT_HOOK_SOURCE}\n`,
      `${normalizeRuntimeStateHelperName(getLoopndrollRuntimeState.toString())}\n\n`,
      `${getTelegramRemotePromptDeliveryMode.toString()}\n\n`,
      `${buildTelegramPromptReceivedText.toString()}\n\n`,
      `${buildTelegramWorkingAckText.toString()}\n\n`,
      `${TELEGRAM_WORKING_ACK_HELPER_SOURCE}\n`,
      `${TELEGRAM_USER_MIRROR_HELPER_SOURCE}\n`,
      `${SQLITE_STATEMENT_FINALIZER_SOURCE}\n`,
      MANAGED_HOOK_SCRIPT_CHUNK_1,
      MANAGED_HOOK_SCRIPT_CHUNK_2,
      MANAGED_HOOK_SCRIPT_CHUNK_3,
    ].join(""),
  );

  return `${preamble}${hookBody}`;
}
