import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Database } from "bun:sqlite";
import { asc, eq } from "drizzle-orm";
import type {
  CompletionCheck,
  CreateLoopNotificationInput,
  LoopNotification,
  LoopPreset,
  LoopScope,
  LoopSession,
  LoopSessionPresetSource,
} from "../shared/app-rpc";
import {
  LOOP_PRESET_VALUES,
  LOOP_SCOPE_VALUES,
  LOOP_SESSION_SOURCE_VALUES,
} from "./constants";
import { getLoopndrollDatabase } from "./db/client";
import {
  completionChecks,
  notifications,
  sessionNotifications,
  sessions,
  settings,
} from "./db/schema";

export type HookHandler = {
  type?: string;
  command?: string;
  timeout?: number;
  timeoutSec?: number;
  statusMessage?: string;
};

export type HookMatcherGroup = {
  matcher?: string;
  hooks?: HookHandler[];
};

export type HooksDocument = {
  hooks?: Record<string, HookMatcherGroup[]>;
};

export type LoopndrollPaths = {
  appDirectoryPath: string;
  binDirectoryPath: string;
  logsDirectoryPath: string;
  databasePath: string;
  managedHookPath: string;
  managedHookScriptPath: string;
  hookDebugLogPath: string;
  codexDirectoryPath: string;
  codexConfigPath: string;
  codexHooksPath: string;
};

const APP_SUPPORT_DIRECTORY_NAME = "loopndroll";
export const MANAGED_HOOK_MARKER = "--managed-by loopndroll";
export const MANAGED_HOOK_SCRIPT_MARKER = "managed-by loopndroll";
export const HOOK_DEBUG_LOG_ENV_NAME = "LOOPNDROLL_ENABLE_HOOK_DEBUG_LOGS";
export const REDACTED_DEBUG_VALUE = "[redacted]";
export const HOOK_DEBUG_REDACTED_KEYS = [
  "authorization",
  "body",
  "botToken",
  "bot_token",
  "command",
  "lastAssistantMessage",
  "last_assistant_message",
  "prompt",
  "stack",
  "text",
  "transcriptPath",
  "transcript_path",
  "webhookUrl",
  "webhook_url",
] as const;
export const STOP_STATUS_MESSAGE = "Loopndroll is deciding whether Codex should continue";
export const SESSION_STATUS_MESSAGE = "Loopndroll is registering the Codex chat";
export const PROMPT_STATUS_MESSAGE = "Loopndroll is capturing the chat prompt";
export const GENERATED_TITLE_MATCH_WINDOW_MS = 30_000;
export const TELEGRAM_BRIDGE_POLL_INTERVAL_MS = 5_000;
export const AWAIT_REPLY_POLL_INTERVAL_MS = 500;
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
export const TELEGRAM_NOTIFICATION_FOOTER =
  "Reply to this message in Telegram to continue this Codex chat.";
export const TELEGRAM_ALLOWED_UPDATES = ["message", "channel_post", "my_chat_member", "chat_member"];

function getAppDataRootPath() {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support");
  }

  if (process.platform === "win32") {
    return process.env["LOCALAPPDATA"] || process.env["APPDATA"] || join(homedir(), "AppData", "Local");
  }

  return process.env["XDG_DATA_HOME"] || join(homedir(), ".local", "share");
}

export function getLoopndrollPaths(): LoopndrollPaths {
  const appDirectoryPath = join(getAppDataRootPath(), APP_SUPPORT_DIRECTORY_NAME);
  const managedHookScriptPath = join(appDirectoryPath, "bin", "loopndroll-hook.mjs");
  const codexDirectoryPath = join(homedir(), ".codex");

  return {
    appDirectoryPath,
    binDirectoryPath: join(appDirectoryPath, "bin"),
    logsDirectoryPath: join(appDirectoryPath, "logs"),
    databasePath: join(appDirectoryPath, "app.db"),
    managedHookPath:
      process.platform === "win32"
        ? join(appDirectoryPath, "bin", "loopndroll-hook.cmd")
        : managedHookScriptPath,
    managedHookScriptPath,
    hookDebugLogPath: join(appDirectoryPath, "logs", "hooks-debug.jsonl"),
    codexDirectoryPath,
    codexConfigPath: join(codexDirectoryPath, "config.toml"),
    codexHooksPath: join(codexDirectoryPath, "hooks.json"),
  };
}

export function nowIsoString() {
  return new Date().toISOString();
}

function isTruthyEnvValue(value: string | undefined) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function shouldEnableHookDebugLogging() {
  return isTruthyEnvValue(process.env[HOOK_DEBUG_LOG_ENV_NAME]);
}

function sanitizeHookDebugLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeHookDebugLogValue(item, seen));
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) {
    return "[circular]";
  }

  seen.add(value);

  const redactedKeys = new Set<string>(HOOK_DEBUG_REDACTED_KEYS);
  const sanitizedEntries = Object.entries(value).map(([entryKey, entryValue]) => {
    if (redactedKeys.has(entryKey) || /(token|secret|password)$/i.test(entryKey)) {
      return [entryKey, REDACTED_DEBUG_VALUE];
    }

    return [entryKey, sanitizeHookDebugLogValue(entryValue, seen)];
  });

  return Object.fromEntries(sanitizedEntries);
}

export async function appendHookDebugLog(paths: LoopndrollPaths, entry: Record<string, unknown>) {
  if (!shouldEnableHookDebugLogging()) {
    return;
  }

  await ensureDirectory(paths.logsDirectoryPath);
  await appendFile(
    paths.hookDebugLogPath,
    `${JSON.stringify(
      sanitizeHookDebugLogValue({
        timestamp: nowIsoString(),
        ...entry,
      }),
    )}\n`,
    "utf8",
  );
}

export function normalizeLoopPreset(value: unknown): LoopPreset | null {
  return LOOP_PRESET_VALUES.includes(value as LoopPreset) ? (value as LoopPreset) : null;
}

export function normalizeScope(value: unknown): LoopScope {
  return LOOP_SCOPE_VALUES.includes(value as LoopScope) ? (value as LoopScope) : "global";
}

export function resolveSessionPresetState(
  sessionPresetValue: unknown,
  presetOverriddenValue: unknown,
  globalPresetValue: unknown,
): {
  preset: LoopPreset | null;
  presetSource: LoopSessionPresetSource;
  effectivePreset: LoopPreset | null;
} {
  const preset = normalizeLoopPreset(sessionPresetValue);
  const presetOverridden = Boolean(presetOverriddenValue);
  const globalPreset = normalizeLoopPreset(globalPresetValue);

  if (preset !== null) {
    return {
      preset,
      presetSource: "session",
      effectivePreset: preset,
    };
  }

  if (presetOverridden) {
    return {
      preset: null,
      presetSource: "off",
      effectivePreset: null,
    };
  }

  return {
    preset: null,
    presetSource: "global",
    effectivePreset: globalPreset,
  };
}

function isSqliteBusyError(error: unknown) {
  return error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message);
}

function sleepSync(milliseconds: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withSqliteBusyRetry<T>(operation: () => T, maxAttempts = 5, delayMs = 25): T {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt >= maxAttempts) {
        throw error;
      }

      sleepSync(delayMs);
    }
  }
}

export function getNotificationBaseLabel(
  notification: Pick<CreateLoopNotificationInput, "channel"> & {
    label?: string;
    chatUsername?: string | null;
    chatDisplayName?: string | null;
  },
) {
  const explicitLabel =
    typeof notification.label === "string" && notification.label.trim().length > 0
      ? notification.label.trim()
      : null;
  if (explicitLabel) {
    return explicitLabel;
  }

  if (notification.channel === "slack") {
    return "Slack";
  }

  if (
    typeof notification.chatUsername === "string" &&
    notification.chatUsername.trim().length > 0
  ) {
    return `@${notification.chatUsername.trim()}`;
  }

  if (
    typeof notification.chatDisplayName === "string" &&
    notification.chatDisplayName.trim().length > 0
  ) {
    return notification.chatDisplayName.trim();
  }

  return "Telegram";
}

export function getUniqueNotificationLabel(
  currentNotifications: LoopNotification[],
  baseLabel: string,
  excludeId?: string,
) {
  const normalizedBaseLabel = baseLabel.trim();
  const matchingCount = currentNotifications.filter((notification) => {
    if (notification.id === excludeId) {
      return false;
    }

    return (
      notification.label === normalizedBaseLabel ||
      notification.label.startsWith(`${normalizedBaseLabel} `)
    );
  }).length;

  return matchingCount === 0 ? normalizedBaseLabel : `${normalizedBaseLabel} ${matchingCount + 1}`;
}

export function normalizeCompletionCheckCommands(commands: string[]) {
  return commands.map((command) => command.trim()).filter((command) => command.length > 0);
}

export function parseCompletionCheckCommands(commandsJson: string) {
  try {
    const parsed = JSON.parse(commandsJson);
    return Array.isArray(parsed) ? normalizeCompletionCheckCommands(parsed.map(String)) : [];
  } catch {
    return [];
  }
}

export function stringifyCompletionCheckCommands(commands: string[]) {
  return JSON.stringify(normalizeCompletionCheckCommands(commands));
}

export function getUniqueCompletionCheckLabel(
  currentChecks: CompletionCheck[],
  baseLabel: string,
  excludeId?: string,
) {
  const normalizedBaseLabel = baseLabel.trim();
  const matchingCount = currentChecks.filter((completionCheck) => {
    if (completionCheck.id === excludeId) {
      return false;
    }

    return (
      completionCheck.label === normalizedBaseLabel ||
      completionCheck.label.startsWith(`${normalizedBaseLabel} `)
    );
  }).length;

  return matchingCount === 0 ? normalizedBaseLabel : `${normalizedBaseLabel} ${matchingCount + 1}`;
}

function mapCompletionCheckRow(row: typeof completionChecks.$inferSelect): CompletionCheck {
  return {
    id: row.id,
    label: row.label,
    commands: parseCompletionCheckCommands(row.commandsJson),
    createdAt: row.createdAt,
  };
}

export function createNotification(notification: CreateLoopNotificationInput): LoopNotification {
  const createdAt = nowIsoString();
  const id = crypto.randomUUID();

  if (notification.channel === "slack") {
    return {
      id,
      label: "",
      channel: "slack",
      webhookUrl: notification.webhookUrl.trim(),
      createdAt,
    };
  }

  return {
    id,
    label: "",
    channel: "telegram",
    chatId: notification.chatId.trim(),
    botToken: notification.botToken.trim(),
    chatUsername: notification.chatUsername?.trim() || null,
    chatDisplayName: notification.chatDisplayName?.trim() || null,
    createdAt,
  };
}

export function buildTelegramBotUrl(botToken: string) {
  return `https://api.telegram.org/bot${botToken}/sendMessage`;
}

export function buildTelegramApiUrl(botToken: string, method: string) {
  return `https://api.telegram.org/bot${botToken}/${method}`;
}

function parseTelegramBotTokenFromUrl(botUrl: string | null) {
  if (!botUrl) {
    return null;
  }

  const match = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/sendMessage$/i.exec(botUrl.trim());
  return match?.[1] ?? null;
}

export function allocateNextSessionRef(db: Database) {
  const allocate = db.transaction(() => {
    const row = db.query("select last_value from session_ref_sequence where id = 1").get() as {
      last_value?: number;
    } | null;
    const nextValue = (typeof row?.last_value === "number" ? row.last_value : 0) + 1;

    db.query(
      `insert into session_ref_sequence (id, last_value)
        values (1, ?)
        on conflict(id) do update set last_value = excluded.last_value`,
    ).run(nextValue);

    return `C${nextValue}`;
  });

  return withSqliteBusyRetry(() => allocate());
}

export function mapNotificationRow(row: typeof notifications.$inferSelect): LoopNotification {
  if (row.channel === "slack") {
    return {
      id: row.id,
      label: row.label,
      channel: "slack",
      webhookUrl: row.webhookUrl ?? "",
      createdAt: row.createdAt,
    };
  }

  return {
    id: row.id,
    label: row.label,
    channel: "telegram",
    chatId: row.chatId ?? "",
    botToken: row.botToken ?? parseTelegramBotTokenFromUrl(row.botUrl) ?? "",
    chatUsername: row.chatUsername ?? null,
    chatDisplayName: row.chatDisplayName ?? null,
    createdAt: row.createdAt,
  };
}

export function notificationInsertFromValue(
  notification: LoopNotification,
): typeof notifications.$inferInsert {
  if (notification.channel === "slack") {
    return {
      id: notification.id,
      label: notification.label,
      channel: "slack",
      webhookUrl: notification.webhookUrl,
      chatId: null,
      botUrl: null,
      createdAt: notification.createdAt,
    };
  }

  return {
    id: notification.id,
    label: notification.label,
    channel: "telegram",
    webhookUrl: null,
    chatId: notification.chatId,
    botToken: notification.botToken,
    botUrl: buildTelegramBotUrl(notification.botToken),
    chatUsername: notification.chatUsername,
    chatDisplayName: notification.chatDisplayName,
    createdAt: notification.createdAt,
  };
}

export function buildNewSession(sessionId: string, sessionRef: string): typeof sessions.$inferInsert {
  const timestamp = nowIsoString();

  return {
    sessionId,
    sessionRef,
    source: "startup",
    cwd: null,
    archived: false,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    activeSince: null,
    stopCount: 0,
    preset: null,
    presetOverridden: false,
    completionCheckId: null,
    completionCheckWaitForReply: false,
    title: null,
    transcriptPath: null,
    lastAssistantMessage: null,
  };
}

function resolveSessionCompletionCheckState(
  sessionCompletionCheckIdValue: unknown,
  sessionCompletionCheckWaitForReplyValue: unknown,
  sessionPresetValue: unknown,
  presetOverriddenValue: unknown,
  globalPresetValue: unknown,
  globalCompletionCheckIdValue: unknown,
  globalCompletionCheckWaitForReplyValue: unknown,
  availableCompletionCheckIds: Iterable<string>,
) {
  const availableIds = new Set(availableCompletionCheckIds);
  const sessionCompletionCheckId =
    typeof sessionCompletionCheckIdValue === "string" &&
    sessionCompletionCheckIdValue.trim().length > 0 &&
    availableIds.has(sessionCompletionCheckIdValue.trim())
      ? sessionCompletionCheckIdValue.trim()
      : null;
  const sessionCompletionCheckWaitForReply = Boolean(sessionCompletionCheckWaitForReplyValue);
  const presetState = resolveSessionPresetState(
    sessionPresetValue,
    presetOverriddenValue,
    globalPresetValue,
  );
  const globalCompletionCheckId =
    typeof globalCompletionCheckIdValue === "string" &&
    globalCompletionCheckIdValue.trim().length > 0 &&
    availableIds.has(globalCompletionCheckIdValue.trim())
      ? globalCompletionCheckIdValue.trim()
      : null;
  const globalCompletionCheckWaitForReply = Boolean(globalCompletionCheckWaitForReplyValue);

  if (presetState.effectivePreset !== "completion-checks") {
    return {
      completionCheckId: sessionCompletionCheckId,
      completionCheckWaitForReply: sessionCompletionCheckWaitForReply,
      effectiveCompletionCheckId: null,
      effectiveCompletionCheckWaitForReply: false,
    };
  }

  if (presetState.presetSource === "session") {
    return {
      completionCheckId: sessionCompletionCheckId,
      completionCheckWaitForReply: sessionCompletionCheckWaitForReply,
      effectiveCompletionCheckId: sessionCompletionCheckId,
      effectiveCompletionCheckWaitForReply:
        sessionCompletionCheckId === null ? false : sessionCompletionCheckWaitForReply,
    };
  }

  return {
    completionCheckId: sessionCompletionCheckId,
    completionCheckWaitForReply: sessionCompletionCheckWaitForReply,
    effectiveCompletionCheckId: globalCompletionCheckId,
    effectiveCompletionCheckWaitForReply:
      globalCompletionCheckId === null ? false : globalCompletionCheckWaitForReply,
  };
}

function mapSessionRow(
  row: typeof sessions.$inferSelect,
  notificationIds: string[],
  globalPreset: LoopPreset | null,
  globalCompletionCheckId: string | null,
  globalCompletionCheckWaitForReply: boolean,
  availableCompletionCheckIds: Iterable<string>,
): LoopSession {
  const presetState = row.archived
    ? {
        preset: null,
        presetSource: "off" as const,
        effectivePreset: null,
      }
    : resolveSessionPresetState(row.preset, row.presetOverridden, globalPreset);
  const completionCheckState = row.archived
    ? {
        completionCheckId: row.completionCheckId,
        completionCheckWaitForReply: false,
        effectiveCompletionCheckId: null,
        effectiveCompletionCheckWaitForReply: false,
      }
    : resolveSessionCompletionCheckState(
        row.completionCheckId,
        row.completionCheckWaitForReply,
        row.preset,
        row.presetOverridden,
        globalPreset,
        globalCompletionCheckId,
        globalCompletionCheckWaitForReply,
        availableCompletionCheckIds,
      );

  return {
    sessionId: row.sessionId,
    sessionRef: row.sessionRef,
    source: LOOP_SESSION_SOURCE_VALUES.includes(row.source) ? row.source : "startup",
    cwd: row.cwd,
    notificationIds,
    archived: Boolean(row.archived),
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    activeSince: row.activeSince,
    stopCount: row.stopCount,
    preset: presetState.preset,
    presetSource: presetState.presetSource,
    effectivePreset: presetState.effectivePreset,
    completionCheckId: completionCheckState.completionCheckId,
    completionCheckWaitForReply: completionCheckState.completionCheckWaitForReply,
    effectiveCompletionCheckId: completionCheckState.effectiveCompletionCheckId,
    effectiveCompletionCheckWaitForReply: completionCheckState.effectiveCompletionCheckWaitForReply,
    title: row.title,
    transcriptPath: row.transcriptPath,
    lastAssistantMessage: row.lastAssistantMessage,
  };
}

export function isPromptOnlyArtifact(
  session: Pick<LoopSession, "transcriptPath" | "title" | "lastAssistantMessage">,
) {
  if (session.transcriptPath !== null) {
    return false;
  }

  const titleLooksInternal = session.title?.startsWith("You are a helpful assistant.") ?? false;
  const assistantPayloadLooksInternal =
    session.lastAssistantMessage?.startsWith('{"title":') ?? false;

  return titleLooksInternal || assistantPayloadLooksInternal;
}

export function getSettingsRow() {
  const { db } = getLoopndrollDatabase(getLoopndrollPaths().databasePath);
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();

  if (!row) {
    throw new Error("Loopndroll settings row is missing.");
  }

  return row;
}

type NotificationDefaultsReader = Pick<ReturnType<typeof getLoopndrollDatabase>["db"], "select">;
type NotificationDefaultsWriter = Pick<ReturnType<typeof getLoopndrollDatabase>["db"], "insert">;

export function normalizeGlobalNotificationId(
  availableNotificationIds: Iterable<string>,
  candidate: string | null | undefined,
) {
  if (typeof candidate !== "string") {
    return null;
  }

  const notificationId = candidate.trim();
  if (notificationId.length === 0) {
    return null;
  }

  const knownNotificationIds = new Set(availableNotificationIds);
  return knownNotificationIds.has(notificationId) ? notificationId : null;
}

export function normalizeGlobalCompletionCheckId(
  availableCompletionCheckIds: Iterable<string>,
  candidate: string | null | undefined,
) {
  if (typeof candidate !== "string") {
    return null;
  }

  const completionCheckId = candidate.trim();
  if (completionCheckId.length === 0) {
    return null;
  }

  const knownCompletionCheckIds = new Set(availableCompletionCheckIds);
  return knownCompletionCheckIds.has(completionCheckId) ? completionCheckId : null;
}

export function getStoredGlobalNotificationId(db: NotificationDefaultsReader) {
  const settingsRow = db
    .select({ globalNotificationId: settings.globalNotificationId })
    .from(settings)
    .where(eq(settings.id, 1))
    .get();

  if (!settingsRow) {
    return null;
  }

  const notificationIds = db
    .select({ id: notifications.id })
    .from(notifications)
    .all()
    .map((row) => row.id);

  return normalizeGlobalNotificationId(notificationIds, settingsRow.globalNotificationId);
}

export function applyGlobalNotificationToSession(
  tx: NotificationDefaultsWriter,
  sessionId: string,
  notificationId: string | null,
) {
  if (notificationId === null) {
    return;
  }

  tx.insert(sessionNotifications)
    .values({
      sessionId,
      notificationId,
    })
    .onConflictDoNothing()
    .run();
}

export function readSnapshotFromDatabase() {
  const { db } = getLoopndrollDatabase(getLoopndrollPaths().databasePath);
  const settingsRow = getSettingsRow();
  const completionCheckRows = db
    .select()
    .from(completionChecks)
    .orderBy(asc(completionChecks.createdAt), asc(completionChecks.id))
    .all();
  const notificationRows = db
    .select()
    .from(notifications)
    .orderBy(asc(notifications.createdAt), asc(notifications.id))
    .all();
  const sessionRows = db
    .select()
    .from(sessions)
    .orderBy(asc(sessions.firstSeenAt), asc(sessions.sessionId))
    .all();
  const sessionNotificationRows = db
    .select()
    .from(sessionNotifications)
    .orderBy(asc(sessionNotifications.sessionId), asc(sessionNotifications.notificationId))
    .all();
  const normalizedGlobalCompletionCheckId = normalizeGlobalCompletionCheckId(
    completionCheckRows.map((row) => row.id),
    settingsRow.globalCompletionCheckId,
  );

  const notificationIdMap = new Map<string, string[]>();
  for (const row of sessionNotificationRows) {
    const current = notificationIdMap.get(row.sessionId);
    if (current) {
      current.push(row.notificationId);
      continue;
    }

    notificationIdMap.set(row.sessionId, [row.notificationId]);
  }

  return {
    defaultPrompt: settingsRow.defaultPrompt,
    scope: normalizeScope(settingsRow.scope),
    globalPreset: normalizeLoopPreset(settingsRow.globalPreset),
    globalNotificationId: normalizeGlobalNotificationId(
      notificationRows.map((row) => row.id),
      settingsRow.globalNotificationId,
    ),
    globalCompletionCheckId: normalizedGlobalCompletionCheckId,
    globalCompletionCheckWaitForReply: settingsRow.globalCompletionCheckWaitForReply,
    hooksAutoRegistration: settingsRow.hooksAutoRegistration,
    notifications: notificationRows.map(mapNotificationRow),
    completionChecks: completionCheckRows.map(mapCompletionCheckRow),
    sessions: sessionRows
      .map((row) =>
        mapSessionRow(
          row,
          notificationIdMap.get(row.sessionId) ?? [],
          normalizeLoopPreset(settingsRow.globalPreset),
          normalizedGlobalCompletionCheckId,
          settingsRow.globalCompletionCheckWaitForReply,
          completionCheckRows.map((completionCheckRow) => completionCheckRow.id),
        ),
      )
      .filter((session) => !isPromptOnlyArtifact(session)),
  };
}

export function isPersistentPromptPreset(preset: LoopPreset | null) {
  return (
    preset === "infinite" ||
    preset === "max-turns-1" ||
    preset === "max-turns-2" ||
    preset === "max-turns-3"
  );
}

const OPT_OUT_EXISTING_INACTIVE_SESSIONS_FROM_GLOBAL_PRESET_SQL = `update sessions
  set preset_overridden = 1
  where archived = 0
    and preset is null
    and preset_overridden = 0
    and active_since is null`;

export function optOutExistingInactiveSessionsFromGlobalPreset(executor: {
  run: (sql: string) => unknown;
}) {
  executor.run(OPT_OUT_EXISTING_INACTIVE_SESSIONS_FROM_GLOBAL_PRESET_SQL);
}

export async function ensureDirectory(path: string) {
  await mkdir(path, { recursive: true });
}
