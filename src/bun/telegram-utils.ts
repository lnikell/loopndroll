import { type Database } from "bun:sqlite";
import type { TelegramChatOption } from "../shared/app-rpc";
import { filterTelegramDirectMessageChats } from "../shared/telegram-chat-policy";
import { getLoopndrollDatabase } from "./db/client";
import {
  TELEGRAM_ALLOWED_UPDATES,
  buildTelegramApiUrl,
  getLoopndrollPaths,
  nowIsoString,
} from "./loopndroll-core";

export type TelegramUpdatePayload = {
  ok?: boolean;
  result?: TelegramUpdate[];
  description?: string;
};

export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramInboundMessage;
  channel_post?: TelegramInboundMessage;
  my_chat_member?: TelegramChatMemberUpdate;
  chat_member?: TelegramChatMemberUpdate;
};

export type TelegramChat = {
  id?: number | string;
  type?: string;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
};

export type TelegramInboundMessage = {
  message_id?: number;
  text?: string;
  chat?: TelegramChat;
  from?: {
    id?: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  reply_to_message?: {
    message_id?: number;
  };
};

export type TelegramChatMemberUpdate = {
  chat?: TelegramChat;
};

export type TelegramSendMessagePayload = {
  ok?: boolean;
  result?: {
    message_id?: number;
  };
  description?: string;
};

function getTelegramChatDisplayName(chat: TelegramChat) {
  const nameParts = [chat.first_name, chat.last_name].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );

  if (nameParts.length > 0) {
    return nameParts.join(" ");
  }

  if (typeof chat.title === "string" && chat.title.trim().length > 0) {
    return chat.title.trim();
  }

  if (typeof chat.username === "string" && chat.username.trim().length > 0) {
    return `@${chat.username.trim()}`;
  }

  return "Unknown chat";
}

function normalizeTelegramChatKind(chatType: unknown): TelegramChatOption["kind"] {
  return chatType === "channel" ? "channel" : chatType === "private" ? "dm" : "group";
}

function getTelegramUpdateChat(update: TelegramUpdate) {
  const message = update.message;
  if (
    message?.chat &&
    (typeof message.chat.id === "number" || typeof message.chat.id === "string")
  ) {
    return {
      chat: message.chat,
      username: message.chat.username ?? null,
      firstName: message.chat.first_name ?? message.from?.first_name ?? null,
      lastName: message.chat.last_name ?? message.from?.last_name ?? null,
    };
  }

  const channelPost = update.channel_post;
  if (
    channelPost?.chat &&
    (typeof channelPost.chat.id === "number" || typeof channelPost.chat.id === "string")
  ) {
    return {
      chat: channelPost.chat,
      username: channelPost.chat.username ?? null,
      firstName: channelPost.chat.first_name ?? channelPost.from?.first_name ?? null,
      lastName: channelPost.chat.last_name ?? channelPost.from?.last_name ?? null,
    };
  }

  const memberUpdate = update.my_chat_member ?? update.chat_member;
  if (
    memberUpdate?.chat &&
    (typeof memberUpdate.chat.id === "number" || typeof memberUpdate.chat.id === "string")
  ) {
    return {
      chat: memberUpdate.chat,
      username: memberUpdate.chat.username ?? null,
      firstName: memberUpdate.chat.first_name ?? null,
      lastName: memberUpdate.chat.last_name ?? null,
    };
  }

  return null;
}

export function collectTelegramChatsFromUpdates(updates: TelegramUpdate[]) {
  const uniqueChats = new Map<string, TelegramChatOption>();

  for (const update of [...updates].reverse()) {
    const extracted = getTelegramUpdateChat(update);
    if (!extracted) {
      continue;
    }

    const { chat, firstName, lastName } = extracted;
    const rawUsername = extracted.username ?? null;
    const username =
      typeof rawUsername === "string" && rawUsername.trim().length > 0 ? rawUsername.trim() : null;
    const dedupeKey = `chat:${String(chat.id)}`;
    if (uniqueChats.has(dedupeKey)) {
      continue;
    }

    uniqueChats.set(dedupeKey, {
      chatId: String(chat.id),
      kind: normalizeTelegramChatKind(chat.type),
      username,
      displayName: getTelegramChatDisplayName({
        title: chat.title,
        first_name: chat.first_name ?? firstName,
        last_name: chat.last_name ?? lastName,
        username,
      }),
    });
  }

  return [...uniqueChats.values()];
}

function readKnownTelegramChats(db: Database, botToken: string): TelegramChatOption[] {
  const rows = db
    .query(
      `select chat_id, kind, username, display_name
      from telegram_known_chats
      where bot_token = ?
      order by display_name asc, chat_id asc`,
    )
    .all(botToken) as Array<{
    chat_id: string;
    kind: string;
    username: string | null;
    display_name: string;
  }>;

  return rows.map((row) => ({
    chatId: row.chat_id,
    kind: row.kind === "channel" ? "channel" : row.kind === "dm" ? "dm" : "group",
    username: row.username,
    displayName: row.display_name,
  }));
}

export function upsertKnownTelegramChats(
  db: Database,
  botToken: string,
  chats: TelegramChatOption[],
) {
  if (chats.length === 0) {
    return;
  }

  const upsertChat = db.query(
    `insert into telegram_known_chats (
      bot_token,
      chat_id,
      kind,
      username,
      display_name,
      updated_at
    ) values (?, ?, ?, ?, ?, ?)
    on conflict(bot_token, chat_id) do update set
      kind = excluded.kind,
      username = excluded.username,
      display_name = excluded.display_name,
      updated_at = excluded.updated_at`,
  );
  const updatedAt = nowIsoString();

  for (const chat of chats) {
    upsertChat.run(botToken, chat.chatId, chat.kind, chat.username, chat.displayName, updatedAt);
  }
}

async function enrichTelegramChats(botToken: string, chats: TelegramChatOption[]) {
  const enrichedChats = await Promise.all(
    chats.map(async (chat) => {
      if (chat.kind === "dm") {
        return chat;
      }

      try {
        const details = await fetchTelegramChatDetails(botToken, chat.chatId);
        return {
          ...chat,
          kind: normalizeTelegramChatKind(details.type),
          username:
            typeof details.username === "string" && details.username.trim().length > 0
              ? details.username.trim()
              : null,
          displayName: getTelegramChatDisplayName(details),
        } satisfies TelegramChatOption;
      } catch {
        return chat;
      }
    }),
  );

  return enrichedChats;
}

export async function getTelegramChats(
  botToken: string,
  waitForUpdates = false,
): Promise<TelegramChatOption[]> {
  const normalizedBotToken = botToken.trim();
  if (normalizedBotToken.length === 0) {
    return [];
  }

  const { client } = getLoopndrollDatabase(getLoopndrollPaths().databasePath);
  const cachedChats = readKnownTelegramChats(client, normalizedBotToken);
  const refreshedCachedChats = await enrichTelegramChats(normalizedBotToken, cachedChats);
  upsertKnownTelegramChats(client, normalizedBotToken, refreshedCachedChats);
  if (!waitForUpdates) {
    return filterTelegramDirectMessageChats(readKnownTelegramChats(client, normalizedBotToken));
  }

  const params = new URLSearchParams({
    timeout: "30",
    allowed_updates: JSON.stringify(TELEGRAM_ALLOWED_UPDATES),
  });
  const response = await fetch(
    `${buildTelegramApiUrl(normalizedBotToken, "getUpdates")}?${params.toString()}`,
  );
  if (!response.ok) {
    throw new Error(`Telegram getUpdates failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as TelegramUpdatePayload;

  if (!payload.ok) {
    throw new Error(payload.description || "Telegram getUpdates failed.");
  }

  const updates = Array.isArray(payload.result) ? payload.result : [];
  const discoveredChats = collectTelegramChatsFromUpdates(updates);
  const enrichedChats = await enrichTelegramChats(normalizedBotToken, discoveredChats);
  upsertKnownTelegramChats(client, normalizedBotToken, enrichedChats);
  return filterTelegramDirectMessageChats(readKnownTelegramChats(client, normalizedBotToken));
}

export async function fetchTelegramUpdates(
  botToken: string,
  offset?: number,
): Promise<TelegramUpdate[]> {
  const params = new URLSearchParams();
  if (typeof offset === "number") {
    params.set("offset", String(offset));
  }
  params.set("allowed_updates", JSON.stringify(TELEGRAM_ALLOWED_UPDATES));

  const url =
    params.size > 0
      ? `${buildTelegramApiUrl(botToken, "getUpdates")}?${params.toString()}`
      : buildTelegramApiUrl(botToken, "getUpdates");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Telegram getUpdates failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as TelegramUpdatePayload;
  if (!payload.ok) {
    throw new Error(payload.description || "Telegram getUpdates failed.");
  }

  return Array.isArray(payload.result) ? payload.result : [];
}

export async function sendTelegramBridgeMessage(botToken: string, chatId: string, text: string) {
  const response = await fetch(buildTelegramApiUrl(botToken, "sendMessage"), {
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
    throw new Error(`Telegram sendMessage failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as TelegramSendMessagePayload;
  if (!payload.ok) {
    throw new Error(payload.description || "Telegram sendMessage failed.");
  }

  return payload;
}

async function fetchTelegramChatDetails(botToken: string, chatId: string) {
  const response = await fetch(buildTelegramApiUrl(botToken, "getChat"), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({
      chat_id: chatId,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Telegram getChat failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    ok?: boolean;
    result?: TelegramChat;
    description?: string;
  };
  if (!payload.ok || !payload.result) {
    throw new Error(payload.description || "Telegram getChat failed.");
  }

  return payload.result;
}
