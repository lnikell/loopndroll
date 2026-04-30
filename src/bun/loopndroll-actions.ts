import { and, asc, eq } from "drizzle-orm";
import { readFile, writeFile } from "node:fs/promises";
import type {
  CreateLoopNotificationInput,
  LoopPreset,
  LoopScope,
  UpdateLoopNotificationInput,
} from "../shared/app-rpc";
import { validateTelegramNotificationChatId } from "../shared/telegram-chat-policy";
import { DEFAULT_PROMPT } from "./constants";
import { getLoopndrollDatabase } from "./db/client";
import {
  completionChecks,
  notifications,
  sessionAwaitingReplies,
  sessionNotifications,
  sessionRemotePrompts,
  sessionRuntime,
  sessions,
  settings,
} from "./db/schema";
import { loadSnapshot } from "./hook-management";
import {
  allocateNextSessionRef,
  applyGlobalNotificationToSession,
  buildNewSession,
  buildTelegramBotUrlForStorage,
  createNotification,
  getLoopndrollPaths,
  getNotificationBaseLabel,
  getStoredGlobalNotificationId,
  getUniqueCompletionCheckLabel,
  getUniqueNotificationLabel,
  isPersistentPromptPreset,
  mapNotificationRow,
  normalizeCompletionCheckCommands,
  normalizeGlobalCompletionCheckId,
  normalizeGlobalNotificationId,
  notificationInsertFromValue,
  nowIsoString,
  optOutExistingInactiveSessionsFromGlobalPreset,
  readSnapshotFromDatabase,
  resolveSessionPresetState,
  stringifyCompletionCheckCommands,
} from "./loopndroll-core";
import {
  deleteSlackWebhookUrlFromKeychain,
  deleteTelegramBotTokenFromKeychain,
  getTelegramBotTokenMigrationRef,
  isSlackWebhookUrlKeychainRef,
  isTelegramBotTokenKeychainRef,
  resolveSlackWebhookUrl,
  resolveTelegramBotToken,
  storeSlackWebhookUrlInKeychain,
  storeTelegramBotTokenInKeychain,
} from "./secret-store";

async function redactSecretsFromManagedLogs(secrets: string[]) {
  const redactionTargets = [...new Set(secrets.map((secret) => secret.trim()))].filter(
    (secret) =>
      secret.length > 0 &&
      !isTelegramBotTokenKeychainRef(secret) &&
      !isSlackWebhookUrlKeychainRef(secret),
  );
  if (redactionTargets.length === 0) {
    return;
  }

  const { hookDebugLogPath } = getLoopndrollPaths();
  let currentLog: string;
  try {
    currentLog = await readFile(hookDebugLogPath, "utf8");
  } catch {
    return;
  }

  let nextLog = currentLog;
  for (const secret of redactionTargets) {
    nextLog = nextLog.replaceAll(secret, "[redacted]");
  }

  if (nextLog !== currentLog) {
    await writeFile(hookDebugLogPath, nextLog, "utf8");
  }
}

export function redactPersistedTelegramBotToken(
  client: ReturnType<typeof getLoopndrollDatabase>["client"],
  plaintextBotToken: string,
  botTokenRef: string,
) {
  const oldToken = plaintextBotToken.trim();
  const nextToken = botTokenRef.trim();
  if (oldToken.length === 0 || oldToken === nextToken || isTelegramBotTokenKeychainRef(oldToken)) {
    return;
  }

  client.transaction(() => {
    client
      .query(
        `insert into telegram_update_cursors (bot_token, last_update_id, updated_at)
         select ?, last_update_id, updated_at
         from telegram_update_cursors
         where bot_token = ?
         on conflict(bot_token) do update set
           last_update_id = max(telegram_update_cursors.last_update_id, excluded.last_update_id),
           updated_at = excluded.updated_at`,
      )
      .run(nextToken, oldToken);
    client.query("delete from telegram_update_cursors where bot_token = ?").run(oldToken);

    client
      .query(
        `insert into telegram_known_chats (
          bot_token,
          chat_id,
          kind,
          username,
          display_name,
          updated_at
        )
         select ?, chat_id, kind, username, display_name, updated_at
         from telegram_known_chats
         where bot_token = ?
         on conflict(bot_token, chat_id) do update set
           kind = excluded.kind,
           username = excluded.username,
           display_name = excluded.display_name,
           updated_at = excluded.updated_at`,
      )
      .run(nextToken, oldToken);
    client.query("delete from telegram_known_chats where bot_token = ?").run(oldToken);

    client
      .query(
        `insert into session_awaiting_replies (
          thread_id,
          bot_token,
          chat_id,
          turn_id,
          started_at
        )
         select thread_id, ?, chat_id, turn_id, started_at
         from session_awaiting_replies
         where bot_token = ?
         on conflict(thread_id, bot_token, chat_id) do update set
           turn_id = excluded.turn_id,
           started_at = excluded.started_at`,
      )
      .run(nextToken, oldToken);
    client.query("delete from session_awaiting_replies where bot_token = ?").run(oldToken);

    client
      .query("update or ignore telegram_delivery_receipts set bot_token = ? where bot_token = ?")
      .run(nextToken, oldToken);
    client.query("delete from telegram_delivery_receipts where bot_token = ?").run(oldToken);
  })();
}

function deleteTelegramBotTokenFromKeychainIfUnused(
  db: ReturnType<typeof getLoopndrollDatabase>["db"],
  botTokenOrRef: string | null | undefined,
) {
  if (typeof botTokenOrRef !== "string" || !isTelegramBotTokenKeychainRef(botTokenOrRef)) {
    return;
  }
  const botTokenRef = botTokenOrRef.trim();

  const remainingRef = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.channel, "telegram"), eq(notifications.botToken, botTokenRef)))
    .limit(1)
    .get();
  if (remainingRef) {
    return;
  }

  deleteTelegramBotTokenFromKeychain(botTokenRef);
}

export async function saveDefaultPrompt(defaultPrompt: string) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  db.update(settings)
    .set({ defaultPrompt: defaultPrompt.trim() || DEFAULT_PROMPT })
    .where(eq(settings.id, 1))
    .run();

  return loadSnapshot(paths);
}

export async function createLoopNotification(notification: CreateLoopNotificationInput) {
  const paths = getLoopndrollPaths();
  const { client, db } = getLoopndrollDatabase(paths.databasePath);
  const existingNotifications = readSnapshotFromDatabase().notifications;
  if (notification.channel === "telegram") {
    const chatError = validateTelegramNotificationChatId(notification.chatId.trim());
    if (chatError) {
      throw new Error(chatError);
    }
  }
  const nextNotification = createNotification(notification);
  if (nextNotification.channel === "slack") {
    const plaintextWebhookUrl = nextNotification.webhookUrl;
    nextNotification.webhookUrl = storeSlackWebhookUrlInKeychain(
      nextNotification.id,
      nextNotification.webhookUrl,
    );
    await redactSecretsFromManagedLogs([plaintextWebhookUrl]);
  } else {
    const plaintextBotToken = nextNotification.botToken;
    nextNotification.botToken = storeTelegramBotTokenInKeychain(
      nextNotification.id,
      nextNotification.botToken,
    );
    redactPersistedTelegramBotToken(client, plaintextBotToken, nextNotification.botToken);
    await redactSecretsFromManagedLogs([plaintextBotToken]);
  }

  nextNotification.label = getUniqueNotificationLabel(
    existingNotifications,
    getNotificationBaseLabel(notification),
  );

  db.insert(notifications).values(notificationInsertFromValue(nextNotification)).run();

  return loadSnapshot(paths);
}

export async function createCompletionCheck(input: { label?: string; commands: string[] }) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);
  const existingCompletionChecks = readSnapshotFromDatabase().completionChecks;
  const commands = normalizeCompletionCheckCommands(input.commands);
  if (commands.length === 0) {
    throw new Error("At least one command is required.");
  }

  db.insert(completionChecks)
    .values({
      id: crypto.randomUUID(),
      label: getUniqueCompletionCheckLabel(
        existingCompletionChecks,
        input.label?.trim() || "Completion check",
      ),
      commandsJson: stringifyCompletionCheckCommands(commands),
      createdAt: nowIsoString(),
    })
    .run();

  return loadSnapshot(paths);
}

export async function updateLoopNotification(notification: UpdateLoopNotificationInput) {
  const paths = getLoopndrollPaths();
  const { client, db } = getLoopndrollDatabase(paths.databasePath);
  if (notification.channel === "telegram") {
    const chatError = validateTelegramNotificationChatId(notification.chatId.trim());
    if (chatError) {
      throw new Error(chatError);
    }
  }
  const existingNotificationRows = db
    .select()
    .from(notifications)
    .orderBy(asc(notifications.createdAt), asc(notifications.id))
    .all();
  const existingNotifications = existingNotificationRows.map(mapNotificationRow);
  const currentNotification = existingNotifications.find(
    (current) => current.id === notification.id,
  );

  if (!currentNotification) {
    return loadSnapshot(paths);
  }

  const label = getUniqueNotificationLabel(
    existingNotifications,
    getNotificationBaseLabel(notification),
    notification.id,
  );

  if (notification.channel === "slack") {
    const previousWebhookUrl =
      currentNotification.channel === "slack" ? currentNotification.webhookUrl : "";
    const previousBotToken =
      currentNotification.channel === "telegram" ? currentNotification.botToken : "";
    const webhookUrlRef = isSlackWebhookUrlKeychainRef(notification.webhookUrl)
      ? notification.webhookUrl.trim()
      : storeSlackWebhookUrlInKeychain(notification.id, notification.webhookUrl);
    await redactSecretsFromManagedLogs([notification.webhookUrl, previousWebhookUrl]);
    db.update(notifications)
      .set({
        label,
        channel: "slack",
        webhookUrl: webhookUrlRef,
        chatId: null,
        botToken: null,
        botUrl: null,
        chatUsername: null,
        chatDisplayName: null,
      })
      .where(eq(notifications.id, notification.id))
      .run();
    deleteTelegramBotTokenFromKeychainIfUnused(db, previousBotToken);
  } else {
    const previousBotToken =
      currentNotification.channel === "telegram" ? currentNotification.botToken : "";
    if (currentNotification.channel === "slack") {
      deleteSlackWebhookUrlFromKeychain(currentNotification.webhookUrl);
    }
    const plaintextBotToken = notification.botToken.trim();
    const botTokenRef = isTelegramBotTokenKeychainRef(notification.botToken)
      ? notification.botToken.trim()
      : storeTelegramBotTokenInKeychain(notification.id, notification.botToken);
    redactPersistedTelegramBotToken(client, plaintextBotToken, botTokenRef);
    redactPersistedTelegramBotToken(client, previousBotToken, botTokenRef);
    await redactSecretsFromManagedLogs([plaintextBotToken, previousBotToken]);
    db.update(notifications)
      .set({
        label,
        channel: "telegram",
        webhookUrl: null,
        chatId: notification.chatId.trim(),
        botToken: botTokenRef,
        botUrl: buildTelegramBotUrlForStorage(botTokenRef),
        chatUsername: notification.chatUsername?.trim() || null,
        chatDisplayName: notification.chatDisplayName?.trim() || null,
      })
      .where(eq(notifications.id, notification.id))
      .run();
    deleteTelegramBotTokenFromKeychainIfUnused(db, previousBotToken);
  }

  return loadSnapshot(paths);
}

export async function updateCompletionCheck(input: {
  id: string;
  label?: string;
  commands: string[];
}) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);
  const existingCompletionChecks = readSnapshotFromDatabase().completionChecks;
  const currentCheck = existingCompletionChecks.find(
    (completionCheck) => completionCheck.id === input.id,
  );
  if (!currentCheck) {
    return loadSnapshot(paths);
  }

  const commands = normalizeCompletionCheckCommands(input.commands);
  if (commands.length === 0) {
    throw new Error("At least one command is required.");
  }

  db.update(completionChecks)
    .set({
      label: getUniqueCompletionCheckLabel(
        existingCompletionChecks,
        input.label?.trim() || currentCheck.label,
        input.id,
      ),
      commandsJson: stringifyCompletionCheckCommands(commands),
    })
    .where(eq(completionChecks.id, input.id))
    .run();

  return loadSnapshot(paths);
}

export async function deleteLoopNotification(notificationId: string) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);
  const existingNotification = db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .get();

  db.transaction((tx) => {
    tx.delete(notifications).where(eq(notifications.id, notificationId)).run();
    tx.update(settings)
      .set({ globalNotificationId: null })
      .where(eq(settings.globalNotificationId, notificationId))
      .run();
  });
  deleteTelegramBotTokenFromKeychainIfUnused(db, existingNotification?.botToken);
  deleteSlackWebhookUrlFromKeychain(existingNotification?.webhookUrl);

  return loadSnapshot(paths);
}

export async function migrateNotificationSecretsToKeychain() {
  const paths = getLoopndrollPaths();
  const { client, db } = getLoopndrollDatabase(paths.databasePath);
  const existingNotificationRows = db
    .select()
    .from(notifications)
    .orderBy(asc(notifications.createdAt), asc(notifications.id))
    .all();
  const migratedTelegramBotTokenRefs = new Map<string, string>();

  for (const row of existingNotificationRows) {
    const currentNotification = mapNotificationRow(row);
    if (currentNotification.channel === "slack") {
      const webhookUrl = currentNotification.webhookUrl.trim();
      if (webhookUrl.length === 0) {
        continue;
      }

      if (isSlackWebhookUrlKeychainRef(webhookUrl)) {
        await redactSecretsFromManagedLogs([resolveSlackWebhookUrl(webhookUrl)]);
        continue;
      }

      db.update(notifications)
        .set({
          webhookUrl: storeSlackWebhookUrlInKeychain(currentNotification.id, webhookUrl),
        })
        .where(eq(notifications.id, currentNotification.id))
        .run();
      await redactSecretsFromManagedLogs([webhookUrl]);
      continue;
    }

    const botToken = currentNotification.botToken.trim();
    if (botToken.length === 0) {
      continue;
    }

    if (isTelegramBotTokenKeychainRef(botToken)) {
      const resolvedBotToken = resolveTelegramBotToken(botToken);
      redactPersistedTelegramBotToken(client, resolvedBotToken, botToken);
      await redactSecretsFromManagedLogs([resolvedBotToken]);
      continue;
    }

    const botTokenMigration = getTelegramBotTokenMigrationRef(
      currentNotification.id,
      botToken,
      migratedTelegramBotTokenRefs,
    );
    let botTokenRef = botTokenMigration.ref;
    if (botTokenMigration.shouldStore) {
      botTokenRef = storeTelegramBotTokenInKeychain(currentNotification.id, botToken);
      migratedTelegramBotTokenRefs.set(botToken, botTokenRef);
    }
    redactPersistedTelegramBotToken(client, botToken, botTokenRef);
    await redactSecretsFromManagedLogs([botToken]);
    db.update(notifications)
      .set({
        botToken: botTokenRef,
        botUrl: buildTelegramBotUrlForStorage(botTokenRef),
      })
      .where(eq(notifications.id, currentNotification.id))
      .run();
  }

  return loadSnapshot(paths);
}

export async function deleteCompletionCheck(completionCheckId: string) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  db.transaction((tx) => {
    tx.delete(completionChecks).where(eq(completionChecks.id, completionCheckId)).run();
    tx.update(settings)
      .set({ globalCompletionCheckId: null, globalCompletionCheckWaitForReply: false })
      .where(eq(settings.globalCompletionCheckId, completionCheckId))
      .run();
    tx.update(sessions)
      .set({ completionCheckId: null, completionCheckWaitForReply: false })
      .where(eq(sessions.completionCheckId, completionCheckId))
      .run();
  });

  return loadSnapshot(paths);
}

export async function setSessionNotifications(sessionId: string, notificationIds: string[]) {
  const paths = getLoopndrollPaths();
  const { client, db } = getLoopndrollDatabase(paths.databasePath);
  const validNotificationIds = new Set(
    db
      .select({ id: notifications.id })
      .from(notifications)
      .all()
      .map((row) => row.id),
  );
  const dedupedNotificationIds = [...new Set(notificationIds)].filter((id) =>
    validNotificationIds.has(id),
  );
  const nextSessionRef = allocateNextSessionRef(client);

  db.transaction((tx) => {
    const existingSession = tx
      .select()
      .from(sessions)
      .where(eq(sessions.threadId, sessionId))
      .get();
    if (!existingSession) {
      tx.insert(sessions).values(buildNewSession(sessionId, nextSessionRef)).run();
      applyGlobalNotificationToSession(tx, sessionId, getStoredGlobalNotificationId(tx));
    }

    tx.delete(sessionNotifications).where(eq(sessionNotifications.threadId, sessionId)).run();

    if (existingSession?.archived) {
      return;
    }

    if (dedupedNotificationIds.length > 0) {
      tx.insert(sessionNotifications)
        .values(
          dedupedNotificationIds.map((notificationId) => ({
            threadId: sessionId,
            notificationId,
          })),
        )
        .run();
    }
  });

  return loadSnapshot(paths);
}

export async function setLoopScope(scope: LoopScope) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  db.transaction((tx) => {
    tx.update(settings).set({ scope }).where(eq(settings.id, 1)).run();
    tx.delete(sessionRuntime).run();
  });

  return loadSnapshot(paths);
}

export async function setGlobalPreset(preset: LoopPreset | null) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  db.transaction((tx) => {
    if (preset !== null) {
      optOutExistingInactiveSessionsFromGlobalPreset(tx);
    }

    tx.update(settings).set({ globalPreset: preset }).where(eq(settings.id, 1)).run();
    if (preset === null) {
      tx.run(
        `update sessions
         set active_since = null
         where archived = 0
           and preset_overridden = 0`,
      );
    }
    tx.delete(sessionRuntime).run();
    if (preset !== "await-reply") {
      tx.run(
        `delete from session_awaiting_replies
         where thread_id in (
           select thread_id
           from sessions
           where preset is null
             and preset_overridden = 0
             and archived = 0
         )`,
      );
    }
    if (preset === null) {
      tx.run(
        `delete from session_remote_prompts
         where thread_id in (
           select thread_id
           from sessions
           where preset is null
             and preset_overridden = 0
             and archived = 0
         )`,
      );
      return;
    }
    if (!isPersistentPromptPreset(preset)) {
      tx.run(
        `delete from session_remote_prompts
         where delivery_mode = 'persistent'
           and thread_id in (
             select thread_id
             from sessions
             where preset is null
               and preset_overridden = 0
               and archived = 0
           )`,
      );
    }
  });

  return loadSnapshot(paths);
}

export async function setGlobalNotification(notificationId: string | null) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);
  const nextNotificationId = normalizeGlobalNotificationId(
    db
      .select({ id: notifications.id })
      .from(notifications)
      .all()
      .map((row) => row.id),
    notificationId,
  );

  db.update(settings)
    .set({ globalNotificationId: nextNotificationId })
    .where(eq(settings.id, 1))
    .run();

  return loadSnapshot(paths);
}

export async function setGlobalCompletionCheckConfig(
  completionCheckId: string | null,
  waitForReplyAfterCompletion: boolean,
) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);
  const nextCompletionCheckId = normalizeGlobalCompletionCheckId(
    db
      .select({ id: completionChecks.id })
      .from(completionChecks)
      .all()
      .map((row) => row.id),
    completionCheckId,
  );

  db.update(settings)
    .set({
      globalCompletionCheckId: nextCompletionCheckId,
      globalCompletionCheckWaitForReply:
        nextCompletionCheckId === null ? false : waitForReplyAfterCompletion,
    })
    .where(eq(settings.id, 1))
    .run();

  return loadSnapshot(paths);
}

export async function setMirrorEnabled(enabled: boolean) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  db.update(settings).set({ mirrorEnabled: enabled }).where(eq(settings.id, 1)).run();

  return loadSnapshot(paths);
}

export async function setSessionCompletionCheckConfig(
  sessionId: string,
  completionCheckId: string | null,
  waitForReplyAfterCompletion: boolean,
) {
  const paths = getLoopndrollPaths();
  const { client, db } = getLoopndrollDatabase(paths.databasePath);
  const nextSessionRef = allocateNextSessionRef(client);
  const nextCompletionCheckId = normalizeGlobalCompletionCheckId(
    db
      .select({ id: completionChecks.id })
      .from(completionChecks)
      .all()
      .map((row) => row.id),
    completionCheckId,
  );

  db.transaction((tx) => {
    const existingSession = tx
      .select()
      .from(sessions)
      .where(eq(sessions.threadId, sessionId))
      .get();

    if (!existingSession) {
      tx.insert(sessions).values(buildNewSession(sessionId, nextSessionRef)).run();
      applyGlobalNotificationToSession(tx, sessionId, getStoredGlobalNotificationId(tx));
    }

    tx.update(sessions)
      .set({
        completionCheckId: nextCompletionCheckId,
        completionCheckWaitForReply:
          nextCompletionCheckId === null ? false : waitForReplyAfterCompletion,
      })
      .where(eq(sessions.threadId, sessionId))
      .run();

    if (nextCompletionCheckId !== null) {
      return;
    }

    tx.delete(sessionAwaitingReplies).where(eq(sessionAwaitingReplies.threadId, sessionId)).run();
  });

  return loadSnapshot(paths);
}

export async function setSessionPreset(sessionId: string, preset: LoopPreset | null) {
  const paths = getLoopndrollPaths();
  const { client, db } = getLoopndrollDatabase(paths.databasePath);
  const nextSessionRef = allocateNextSessionRef(client);

  db.transaction((tx) => {
    const existingSession = tx
      .select()
      .from(sessions)
      .where(eq(sessions.threadId, sessionId))
      .get();

    if (!existingSession) {
      tx.insert(sessions).values(buildNewSession(sessionId, nextSessionRef)).run();
      applyGlobalNotificationToSession(tx, sessionId, getStoredGlobalNotificationId(tx));
    }

    if (existingSession?.archived) {
      tx.update(sessions)
        .set({
          preset: null,
          presetOverridden: false,
          activeSince: null,
          completionCheckId: null,
          completionCheckWaitForReply: false,
        })
        .where(eq(sessions.threadId, sessionId))
        .run();
      tx.delete(sessionRuntime).where(eq(sessionRuntime.threadId, sessionId)).run();
      tx.delete(sessionAwaitingReplies).where(eq(sessionAwaitingReplies.threadId, sessionId)).run();
      tx.delete(sessionRemotePrompts).where(eq(sessionRemotePrompts.threadId, sessionId)).run();
      return;
    }

    const previousPreset = resolveSessionPresetState(
      existingSession?.preset,
      existingSession?.presetOverridden,
      null,
    ).effectivePreset;
    const nextActiveSince =
      previousPreset === null && preset !== null
        ? nowIsoString()
        : previousPreset !== null && preset === null
          ? null
          : (existingSession?.activeSince ?? null);
    const isRestartingFromOff = previousPreset === null && preset !== null;

    tx.update(sessions)
      .set({
        preset,
        presetOverridden: true,
        activeSince: nextActiveSince,
      })
      .where(eq(sessions.threadId, sessionId))
      .run();
    tx.delete(sessionRuntime).where(eq(sessionRuntime.threadId, sessionId)).run();
    if (preset !== "await-reply") {
      tx.delete(sessionAwaitingReplies).where(eq(sessionAwaitingReplies.threadId, sessionId)).run();
    }
    if (isRestartingFromOff) {
      tx.delete(sessionRemotePrompts).where(eq(sessionRemotePrompts.threadId, sessionId)).run();
      return;
    }
    if (preset === null) {
      tx.delete(sessionRemotePrompts).where(eq(sessionRemotePrompts.threadId, sessionId)).run();
      return;
    }
    if (!isPersistentPromptPreset(preset)) {
      tx.delete(sessionRemotePrompts)
        .where(
          and(
            eq(sessionRemotePrompts.threadId, sessionId),
            eq(sessionRemotePrompts.deliveryMode, "persistent"),
          ),
        )
        .run();
    }
  });

  return loadSnapshot(paths);
}

export async function setSessionArchived(sessionId: string, archived: boolean) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  db.transaction((tx) => {
    const existingSession = tx
      .select()
      .from(sessions)
      .where(eq(sessions.threadId, sessionId))
      .get();

    if (!existingSession) {
      return;
    }

    tx.update(sessions)
      .set({
        archived,
        preset: archived ? null : existingSession.preset,
        presetOverridden: archived ? false : existingSession.presetOverridden,
        activeSince: archived ? null : existingSession.activeSince,
        completionCheckId: archived ? null : existingSession.completionCheckId,
        completionCheckWaitForReply: archived ? false : existingSession.completionCheckWaitForReply,
      })
      .where(eq(sessions.threadId, sessionId))
      .run();

    if (!archived) {
      return;
    }

    tx.delete(sessionNotifications).where(eq(sessionNotifications.threadId, sessionId)).run();
    tx.delete(sessionRuntime).where(eq(sessionRuntime.threadId, sessionId)).run();
    tx.delete(sessionAwaitingReplies).where(eq(sessionAwaitingReplies.threadId, sessionId)).run();
    tx.delete(sessionRemotePrompts).where(eq(sessionRemotePrompts.threadId, sessionId)).run();
  });

  return loadSnapshot(paths);
}

export async function deleteSession(sessionId: string) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  db.delete(sessions).where(eq(sessions.threadId, sessionId)).run();

  return loadSnapshot(paths);
}
