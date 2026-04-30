import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type {
  LoopNotification,
  LoopPreset,
  LoopScope,
  LoopSession,
  LoopndrollRuntimeState,
} from "../../shared/app-rpc";

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  defaultPrompt: text("default_prompt").notNull(),
  scope: text("scope").$type<LoopScope>().notNull(),
  runtimeState: text("runtime_state").$type<LoopndrollRuntimeState>().notNull().default("running"),
  globalPreset: text("global_preset").$type<LoopPreset | null>(),
  globalNotificationId: text("global_notification_id"),
  globalCompletionCheckId: text("global_completion_check_id"),
  globalCompletionCheckWaitForReply: integer("global_completion_check_wait_for_reply", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  hooksAutoRegistration: integer("hooks_auto_registration", { mode: "boolean" })
    .notNull()
    .default(true),
  mirrorEnabled: integer("mirror_enabled", { mode: "boolean" }).notNull().default(false),
  hookRemovalPending: integer("hook_removal_pending", { mode: "boolean" }).notNull().default(false),
  hookRemovalNextAttemptAt: text("hook_removal_next_attempt_at"),
  hookLifecycleStatusJson: text("hook_lifecycle_status_json").$type<string | null>(),
});

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  channel: text("channel").$type<LoopNotification["channel"]>().notNull(),
  webhookUrl: text("webhook_url"),
  chatId: text("chat_id"),
  botToken: text("bot_token"),
  botUrl: text("bot_url"),
  chatUsername: text("chat_username"),
  chatDisplayName: text("chat_display_name"),
  createdAt: text("created_at").notNull(),
});

export const completionChecks = sqliteTable("completion_checks", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  commandsJson: text("commands_json").$type<string>().notNull(),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  threadId: text("thread_id").primaryKey(),
  sessionRef: text("session_ref").notNull(),
  source: text("source").$type<LoopSession["source"]>().notNull(),
  cwd: text("cwd"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  activeSince: text("active_since"),
  stopCount: integer("stop_count").notNull().default(0),
  preset: text("preset").$type<LoopPreset | null>(),
  presetOverridden: integer("preset_overridden", { mode: "boolean" }).notNull().default(false),
  completionCheckId: text("completion_check_id"),
  completionCheckWaitForReply: integer("completion_check_wait_for_reply", { mode: "boolean" })
    .notNull()
    .default(false),
  threadName: text("thread_name"),
  orphanedRefreshMissCount: integer("orphaned_refresh_miss_count").notNull().default(0),
  transcriptPath: text("transcript_path"),
  lastAssistantMessage: text("last_assistant_message"),
});

export const sessionNotifications = sqliteTable(
  "session_notifications",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => sessions.threadId, { onDelete: "cascade" }),
    notificationId: text("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.notificationId] })],
);

export const sessionRuntime = sqliteTable("session_runtime", {
  threadId: text("thread_id")
    .primaryKey()
    .references(() => sessions.threadId, { onDelete: "cascade" }),
  remainingTurns: integer("remaining_turns").notNull(),
});

export const sessionRemotePrompts = sqliteTable(
  "session_remote_prompts",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => sessions.threadId, { onDelete: "cascade" }),
    source: text("source").notNull(),
    deliveryMode: text("delivery_mode").notNull(),
    promptText: text("prompt_text").notNull(),
    telegramChatId: text("telegram_chat_id"),
    telegramMessageId: integer("telegram_message_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.deliveryMode] })],
);

export const telegramDeliveryReceipts = sqliteTable("telegram_delivery_receipts", {
  id: text("id").primaryKey(),
  notificationId: text("notification_id").references(() => notifications.id, {
    onDelete: "set null",
  }),
  threadId: text("thread_id")
    .notNull()
    .references(() => sessions.threadId, { onDelete: "cascade" }),
  botToken: text("bot_token").notNull(),
  chatId: text("chat_id").notNull(),
  telegramMessageId: integer("telegram_message_id").notNull(),
  createdAt: text("created_at").notNull(),
});

export const telegramUpdateCursors = sqliteTable("telegram_update_cursors", {
  botToken: text("bot_token").primaryKey(),
  lastUpdateId: integer("last_update_id").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const telegramKnownChats = sqliteTable(
  "telegram_known_chats",
  {
    botToken: text("bot_token").notNull(),
    chatId: text("chat_id").notNull(),
    kind: text("kind").notNull(),
    username: text("username"),
    displayName: text("display_name").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.botToken, table.chatId] })],
);

export const sessionRefSequence = sqliteTable("session_ref_sequence", {
  id: integer("id").primaryKey(),
  lastValue: integer("last_value").notNull(),
});

export const sessionAwaitingReplies = sqliteTable(
  "session_awaiting_replies",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => sessions.threadId, { onDelete: "cascade" }),
    botToken: text("bot_token").notNull(),
    chatId: text("chat_id").notNull(),
    turnId: text("turn_id"),
    startedAt: text("started_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.botToken, table.chatId] })],
);
