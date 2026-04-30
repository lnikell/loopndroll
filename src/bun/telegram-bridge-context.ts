import { type Database } from "bun:sqlite";
import { formatTelegramSessionLabel } from "./telegram-output";
import { appendHookDebugLog, type LoopndrollPaths } from "./loopndroll-core";
import {
  collectTelegramChatsFromUpdates,
  type TelegramInboundMessage,
  type TelegramUpdate,
  upsertKnownTelegramChats,
} from "./telegram-utils";

export type TelegramBridgeUpdateContext = {
  paths: LoopndrollPaths;
  db: Database;
  botToken: string;
  update: TelegramUpdate;
  message: TelegramInboundMessage;
  trimmedText: string;
  chatId: string;
};

export function createTelegramBridgeUpdateContext(
  paths: LoopndrollPaths,
  db: Database,
  botToken: string,
  update: TelegramUpdate,
): TelegramBridgeUpdateContext | null {
  const message = update.message;
  if (!message || typeof message.text !== "string") {
    return null;
  }

  const trimmedText = message.text.trim();
  if (trimmedText.length === 0) {
    return null;
  }

  const chatId =
    typeof message.chat?.id === "number" || typeof message.chat?.id === "string"
      ? String(message.chat.id)
      : null;
  if (!chatId) {
    return null;
  }

  return { paths, db, botToken, update, message, trimmedText, chatId };
}

export async function prepareTelegramBridgeUpdate(
  context: TelegramBridgeUpdateContext,
  isAuthorizedTelegramBridgeChat: (db: Database, botToken: string, chatId: string) => boolean,
) {
  if (context.message.chat?.type !== "private") {
    await appendHookDebugLog(context.paths, {
      type: "telegram-bridge",
      action: "ignored-message",
      reason: "non-dm-chat",
      botToken: context.botToken,
      updateId: context.update.update_id ?? null,
      chatId: context.chatId,
    });
    return false;
  }

  if (!isAuthorizedTelegramBridgeChat(context.db, context.botToken, context.chatId)) {
    await appendHookDebugLog(context.paths, {
      type: "telegram-bridge",
      action: "ignored-message",
      reason: "unauthorized-chat",
      botToken: context.botToken,
      updateId: context.update.update_id ?? null,
      chatId: context.chatId,
    });
    return false;
  }

  const discoveredChats = collectTelegramChatsFromUpdates([context.update]);
  if (discoveredChats.length > 0) {
    upsertKnownTelegramChats(context.db, context.botToken, discoveredChats);
  }

  return true;
}

export function formatTelegramTargetSessionLabel(targetSession: {
  cwd?: string | null;
  sessionRef: string;
  title: string | null;
}) {
  return formatTelegramSessionLabel({
    cwd: targetSession.cwd ?? null,
    sessionRef: targetSession.sessionRef,
    title: targetSession.title,
  });
}
