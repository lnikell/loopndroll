import type { TelegramChatOption } from "./app-rpc";

export const TELEGRAM_DIRECT_MESSAGES_ONLY_ERROR =
  "Loopndroll currently supports Telegram direct messages only.";

export function inferTelegramChatKind(chatId: string): TelegramChatOption["kind"] {
  return chatId.trim().startsWith("-") ? "group" : "dm";
}

export function isTelegramDirectMessageKind(kind: TelegramChatOption["kind"] | null | undefined) {
  return kind === "dm";
}

export function isTelegramDirectMessageChatId(chatId: string) {
  return isTelegramDirectMessageKind(inferTelegramChatKind(chatId));
}

export function validateTelegramNotificationChatId(chatId: string) {
  return isTelegramDirectMessageChatId(chatId) ? null : TELEGRAM_DIRECT_MESSAGES_ONLY_ERROR;
}

export function filterTelegramDirectMessageChats<T extends Pick<TelegramChatOption, "kind">>(
  chats: T[],
) {
  return chats.filter((chat) => isTelegramDirectMessageKind(chat.kind));
}
