import { type Database } from "bun:sqlite";
import type { LoopPreset, LoopSession } from "../shared/app-rpc";
import {
  isPersistentPromptPreset,
  normalizeLoopPreset,
  nowIsoString,
  resolveSessionPresetState,
} from "./loopndroll-core";
import {
  buildTelegramPromptReceivedText,
  getTelegramRemotePromptDeliveryMode,
} from "./telegram-control";
import { looksInternalThreadNameArtifact } from "./thread-name-artifact";
import type { TelegramInboundMessage } from "./telegram-utils";

export type TelegramBridgeTargetSession = {
  sessionId: string;
  sessionRef: string;
  cwd?: string | null;
  title: string | null;
};

export type TelegramSessionBridgeStates = {
  awaitingReplySessionIds: Set<string>;
  queuedPromptSessionIds: Set<string>;
};

export function getTelegramSessionBridgeStates(
  db: Database,
  botToken: string,
  chatId: string,
): TelegramSessionBridgeStates {
  const awaitingRows = db
    .query(
      `select ar.thread_id as session_id
      from session_awaiting_replies ar
      inner join sessions s on s.thread_id = ar.thread_id
      where ar.bot_token = ?
        and ar.chat_id = ?
        and s.archived = 0`,
    )
    .all(botToken, chatId) as Array<{ session_id?: string }>;
  const queuedRows = db
    .query(
      `select distinct rp.thread_id as session_id
      from session_remote_prompts rp
      inner join sessions s on s.thread_id = rp.thread_id
      inner join session_notifications sn on sn.thread_id = s.thread_id
      inner join notifications n on n.id = sn.notification_id
      where rp.source = 'telegram'
        and rp.telegram_chat_id = ?
        and n.channel = 'telegram'
        and n.bot_token = ?
        and n.chat_id = ?
        and s.archived = 0`,
    )
    .all(chatId, botToken, chatId) as Array<{ session_id?: string }>;

  return {
    awaitingReplySessionIds: new Set(
      awaitingRows.flatMap((row) =>
        typeof row.session_id === "string" && row.session_id.length > 0 ? [row.session_id] : [],
      ),
    ),
    queuedPromptSessionIds: new Set(
      queuedRows.flatMap((row) =>
        typeof row.session_id === "string" && row.session_id.length > 0 ? [row.session_id] : [],
      ),
    ),
  };
}

export function listRegisteredTelegramSessions(
  db: Database,
  botToken: string,
  chatId: string,
): LoopSession[] {
  const settingsRow = db.query("select global_preset from settings where id = 1").get() as {
    global_preset?: unknown;
  } | null;
  const globalPreset = normalizeLoopPreset(settingsRow?.global_preset);
  const rows = db
    .query(
      `select distinct
        s.thread_id as session_id,
        s.session_ref,
        s.thread_name as title,
        s.cwd,
        s.transcript_path,
        s.last_assistant_message,
        s.last_seen_at,
        s.active_since,
        s.preset,
        s.preset_overridden
      from sessions s
      inner join session_notifications sn on sn.thread_id = s.thread_id
      inner join notifications n on n.id = sn.notification_id
      where n.channel = 'telegram'
        and n.bot_token = ?
        and n.chat_id = ?
      order by s.last_seen_at desc, s.first_seen_at desc`,
    )
    .all(botToken, chatId) as Array<{
    session_id: string;
    session_ref: string;
    title: string | null;
    cwd: string | null;
    transcript_path: string | null;
    last_assistant_message: string | null;
    last_seen_at: string;
    active_since: string | null;
    preset: LoopPreset | null;
    preset_overridden: number | boolean | null;
  }>;

  return rows
    .map((row) => {
      const presetState = resolveSessionPresetState(
        row.preset,
        row.preset_overridden,
        globalPreset,
      );

      return {
        threadId: row.session_id,
        sessionId: row.session_id,
        sessionRef: row.session_ref,
        source: "stop" as const,
        cwd: row.cwd,
        notificationIds: [],
        archived: false,
        firstSeenAt: row.last_seen_at,
        lastSeenAt: row.last_seen_at,
        activeSince: row.active_since,
        stopCount: 0,
        preset: presetState.preset,
        presetSource: presetState.presetSource,
        effectivePreset: presetState.effectivePreset,
        completionCheckId: null,
        completionCheckWaitForReply: false,
        effectiveCompletionCheckId: null,
        effectiveCompletionCheckWaitForReply: false,
        threadName: row.title,
        title: row.title,
        transcriptPath: row.transcript_path,
        lastAssistantMessage: row.last_assistant_message,
      } satisfies LoopSession;
    })
    .filter((session) => isVisibleTelegramBridgeSession(session));
}

function isVisibleTelegramBridgeSession(session: LoopSession) {
  return !(
    looksInternalThreadNameArtifact(session.threadName) ||
    (session.notificationIds.length === 0 &&
      session.transcriptPath === null &&
      (session.lastAssistantMessage?.startsWith('{"title":') ?? false))
  );
}

export function getEffectivePresetForSession(db: Database, sessionId: string) {
  const row = db
    .query(
      `select
        s.preset as session_preset,
        s.preset_overridden as preset_overridden,
        s.archived as session_archived,
        st.global_preset as global_preset
      from sessions s
      left join settings st on st.id = 1
      where s.thread_id = ?
      limit 1`,
    )
    .get(sessionId) as {
    session_preset?: unknown;
    preset_overridden?: unknown;
    session_archived?: unknown;
    global_preset?: unknown;
  } | null;

  if (row?.session_archived) {
    return null;
  }

  return resolveSessionPresetState(row?.session_preset, row?.preset_overridden, row?.global_preset)
    .effectivePreset;
}

export function findTelegramReplySessionId(
  db: Database,
  botToken: string,
  chatId: string,
  replyToMessageId: number,
) {
  const row = db
    .query(
      `select thread_id as session_id
      from telegram_delivery_receipts
      where bot_token = ?
        and chat_id = ?
        and telegram_message_id = ?
      order by created_at desc
      limit 1`,
    )
    .get(botToken, chatId, replyToMessageId) as { session_id?: string } | null;

  return typeof row?.session_id === "string" && row.session_id.length > 0 ? row.session_id : null;
}

export function findLatestAwaitingTelegramSessionId(
  db: Database,
  botToken: string,
  chatId: string,
) {
  const row = db
    .query(
      `select ar.thread_id as session_id
      from session_awaiting_replies ar
      inner join sessions s on s.thread_id = ar.thread_id
      where ar.bot_token = ?
        and ar.chat_id = ?
        and s.archived = 0
      order by ar.started_at desc, ar.thread_id desc
      limit 1`,
    )
    .get(botToken, chatId) as { session_id?: string } | null;

  return typeof row?.session_id === "string" && row.session_id.length > 0 ? row.session_id : null;
}

export function findLatestDeliveredTelegramSessionId(
  db: Database,
  botToken: string,
  chatId: string,
) {
  const row = db
    .query(
      `select r.thread_id as session_id
      from telegram_delivery_receipts r
      inner join sessions s on s.thread_id = r.thread_id
      where r.bot_token = ?
        and r.chat_id = ?
        and s.archived = 0
      order by r.created_at desc, r.telegram_message_id desc
      limit 1`,
    )
    .get(botToken, chatId) as { session_id?: string } | null;

  return typeof row?.session_id === "string" && row.session_id.length > 0 ? row.session_id : null;
}

export function findTelegramSessionByRef(
  db: Database,
  botToken: string,
  chatId: string,
  sessionRef: string,
): TelegramBridgeTargetSession | null {
  const row = db
    .query(
      `select distinct
        s.thread_id as session_id,
        s.session_ref,
        s.cwd,
        s.thread_name as title
      from sessions s
      inner join session_notifications sn on sn.thread_id = s.thread_id
      inner join notifications n on n.id = sn.notification_id
      where n.channel = 'telegram'
        and n.bot_token = ?
        and n.chat_id = ?
        and lower(s.session_ref) = lower(?)
      limit 1`,
    )
    .get(botToken, chatId, sessionRef) as {
    session_id?: string;
    session_ref?: string;
    cwd?: string | null;
    title?: string | null;
  } | null;

  if (!row?.session_id || !row?.session_ref || looksInternalThreadNameArtifact(row.title)) {
    return null;
  }

  return {
    sessionId: row.session_id,
    sessionRef: row.session_ref,
    cwd: row.cwd ?? null,
    title: row.title ?? null,
  };
}

export function findTelegramSessionById(
  db: Database,
  sessionId: string,
): TelegramBridgeTargetSession | null {
  const row = db
    .query(
      `select
        thread_id as session_id,
        session_ref,
        cwd,
        thread_name as title
      from sessions
      where thread_id = ?
      limit 1`,
    )
    .get(sessionId) as {
    session_id?: string;
    session_ref?: string;
    cwd?: string | null;
    title?: string | null;
  } | null;

  if (!row?.session_id || !row?.session_ref) {
    return null;
  }

  return {
    sessionId: row.session_id,
    sessionRef: row.session_ref,
    cwd: row.cwd ?? null,
    title: row.title ?? null,
  };
}

export function clearRemotePromptStateForPreset(
  db: Database,
  sessionId: string,
  preset: LoopPreset | null,
) {
  if (!preset || !isPersistentPromptPreset(preset)) {
    db.query("delete from session_runtime where thread_id = ?").run(sessionId);

    if (preset !== "await-reply") {
      db.query("delete from session_awaiting_replies where thread_id = ?").run(sessionId);
    }
    if (preset === null) {
      db.query("delete from session_remote_prompts where thread_id = ?").run(sessionId);
      return;
    }
    if (preset === "await-reply") {
      db.query(
        "delete from session_remote_prompts where thread_id = ? and delivery_mode = 'persistent'",
      ).run(sessionId);
      return;
    }
    db.query("delete from session_remote_prompts where thread_id = ?").run(sessionId);
    return;
  }

  db.query(
    "delete from session_remote_prompts where thread_id = ? and delivery_mode = 'persistent'",
  ).run(sessionId);
}

export function clearRemotePromptStateForGlobalPreset(db: Database, preset: LoopPreset | null) {
  if (preset !== "await-reply") {
    db.query(
      `delete from session_awaiting_replies
       where thread_id in (
         select thread_id
         from sessions
         where preset is null
           and preset_overridden = 0
           and archived = 0
       )`,
    ).run();
  }
  if (preset === null) {
    db.query(
      `delete from session_remote_prompts
       where thread_id in (
         select thread_id
         from sessions
         where preset is null
           and preset_overridden = 0
           and archived = 0
       )`,
    ).run();
    return;
  }
  if (!isPersistentPromptPreset(preset)) {
    db.query(
      `delete from session_remote_prompts
       where delivery_mode = 'persistent'
         and thread_id in (
           select thread_id
           from sessions
           where preset is null
             and preset_overridden = 0
             and archived = 0
         )`,
    ).run();
  }
}

export function disableTelegramSessionViaFailsafe(db: Database, sessionId: string) {
  const applyUpdate = db.transaction(() => {
    db.query(
      `update sessions
       set preset = null,
           preset_overridden = 1,
           active_since = null
       where thread_id = ?
         and archived = 0`,
    ).run(sessionId);

    db.query("delete from session_runtime where thread_id = ?").run(sessionId);
    db.query("delete from session_awaiting_replies where thread_id = ?").run(sessionId);
    db.query("delete from session_remote_prompts where thread_id = ?").run(sessionId);
  });

  applyUpdate();
}

export function disableAllTelegramSessionsViaFailsafe(db: Database) {
  const applyUpdate = db.transaction(() => {
    db.query("update settings set global_preset = null where id = 1").run();
    db.run(
      `update sessions
       set preset = null,
           preset_overridden = 1,
           active_since = null
       where archived = 0`,
    );
    db.query("delete from session_runtime").run();
    db.query("delete from session_awaiting_replies").run();
    db.query("delete from session_remote_prompts").run();
  });

  applyUpdate();
}

export function upsertSessionRemotePrompt(
  db: Database,
  sessionId: string,
  promptText: string,
  deliveryMode: "once" | "persistent",
  message: TelegramInboundMessage,
) {
  const trimmedPrompt = promptText.trim();
  if (trimmedPrompt.length === 0) {
    return false;
  }

  db.query(
    `insert into session_remote_prompts (
      thread_id,
      source,
      delivery_mode,
      prompt_text,
      telegram_chat_id,
      telegram_message_id,
      created_at
    ) values (?, 'telegram', ?, ?, ?, ?, ?)
    on conflict(thread_id, delivery_mode) do update set
      source = excluded.source,
      delivery_mode = excluded.delivery_mode,
      prompt_text = excluded.prompt_text,
      telegram_chat_id = excluded.telegram_chat_id,
      telegram_message_id = excluded.telegram_message_id,
      created_at = excluded.created_at`,
  ).run(
    sessionId,
    deliveryMode,
    trimmedPrompt,
    typeof message.chat?.id === "number" || typeof message.chat?.id === "string"
      ? String(message.chat.id)
      : null,
    typeof message.message_id === "number" ? message.message_id : null,
    nowIsoString(),
  );

  return true;
}

export function buildReplyQueuedAck(
  targetSession: TelegramBridgeTargetSession,
  effectivePreset: LoopPreset,
) {
  return {
    ackText: buildTelegramPromptReceivedText(targetSession),
    deliveryMode: getTelegramRemotePromptDeliveryMode(effectivePreset),
  };
}
