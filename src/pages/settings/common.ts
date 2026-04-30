import { type MouseEvent } from "react";
import { z } from "zod/v4";
import { openExternalUrl, type LoopNotification, type TelegramChatOption } from "@/lib/loopndroll";
import { validateTelegramNotificationChatId } from "@/shared/telegram-chat-policy";

export const TELEGRAM_BOT_TOKEN_KEYCHAIN_REF_PREFIX = "keychain://loopndroll/telegram-bot-token/";
export const SLACK_WEBHOOK_URL_KEYCHAIN_REF_PREFIX = "keychain://loopndroll/slack-webhook-url/";

export const settingsSchema = z.object({
  defaultPrompt: z
    .string()
    .trim()
    .min(1, "Default prompt is required.")
    .max(500, "Default prompt must be 500 characters or fewer."),
});

export const notificationSchema = z
  .object({
    label: z.string(),
    channel: z.enum(["slack", "telegram"]),
    webhookUrl: z.string(),
    botToken: z.string(),
    telegramChatId: z.string(),
    telegramChatUsername: z.string(),
    telegramChatDisplayName: z.string(),
  })
  .superRefine((values, context) => {
    if (values.channel === "slack") {
      if (values.webhookUrl.trim().length === 0) {
        context.addIssue({
          code: "custom",
          message: "Webhook URL is required.",
          path: ["webhookUrl"],
        });
        return;
      }

      const webhookUrl = values.webhookUrl.trim();
      const isKeychainRef = webhookUrl.startsWith(SLACK_WEBHOOK_URL_KEYCHAIN_REF_PREFIX);
      if (!isKeychainRef && !z.string().url().safeParse(webhookUrl).success) {
        context.addIssue({
          code: "custom",
          message: "Webhook URL must be a valid URL.",
          path: ["webhookUrl"],
        });
      }

      return;
    }

    if (values.botToken.trim().length === 0) {
      context.addIssue({ code: "custom", message: "API token is required.", path: ["botToken"] });
    }

    if (values.telegramChatId.trim().length === 0) {
      context.addIssue({
        code: "custom",
        message: "Select a Telegram chat.",
        path: ["telegramChatId"],
      });
      return;
    }

    const chatError = validateTelegramNotificationChatId(values.telegramChatId.trim());
    if (chatError) {
      context.addIssue({
        code: "custom",
        message: chatError,
        path: ["telegramChatId"],
      });
    }
  });

export const completionCheckSchema = z.object({
  label: z.string(),
  commandsText: z
    .string()
    .transform((value) => value.trim())
    .refine(
      (value) => value.split(/\r?\n/).some((line) => line.trim().length > 0),
      "At least one command is required.",
    ),
});

export type SettingsFormValues = z.infer<typeof settingsSchema>;
export type NotificationFormValues = z.infer<typeof notificationSchema>;
export type CompletionCheckFormValues = z.input<typeof completionCheckSchema>;

export const notificationChannelItems = [
  { label: "Slack", value: "slack" },
  { label: "Telegram", value: "telegram" },
] as const;

export const settingsSectionCardClassName = "gap-6 pt-5 pb-0 shadow-sm";
export const settingsSectionFooterClassName =
  "flex items-center justify-between border-t gap-4 pb-4 [.border-t]:pt-4";

export type TelegramChatItem = TelegramChatOption & {
  value: string;
  label: string;
  primaryLabel: string;
};

export function createEmptyNotificationValues(): NotificationFormValues {
  return {
    label: "",
    channel: "slack",
    webhookUrl: "",
    botToken: "",
    telegramChatId: "",
    telegramChatUsername: "",
    telegramChatDisplayName: "",
  };
}

export function createEmptyCompletionCheckValues(): CompletionCheckFormValues {
  return {
    label: "",
    commandsText: "",
  };
}

export function getNotificationChannelLabel(notification: LoopNotification) {
  return notification.channel === "slack" ? "Slack" : "Telegram";
}

export function toTelegramChatItem(chat: TelegramChatOption): TelegramChatItem {
  const primaryLabel =
    chat.kind === "dm"
      ? chat.username
        ? `@${chat.username}`
        : chat.displayName
      : chat.displayName || (chat.username ? `@${chat.username}` : "Unknown chat");

  return {
    ...chat,
    value: chat.chatId,
    label: primaryLabel,
    primaryLabel,
  };
}

export function mergeTelegramChats(
  currentChats: TelegramChatOption[],
  nextChats: TelegramChatOption[],
) {
  const mergedChats = new Map<string, TelegramChatOption>();

  for (const chat of currentChats) {
    mergedChats.set(chat.chatId, chat);
  }

  for (const chat of nextChats) {
    mergedChats.set(chat.chatId, chat);
  }

  return [...mergedChats.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

export function getTelegramChatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Failed to load Telegram chats.";
}

export function isTransientTelegramChatError(message: string) {
  const normalized = message.trim().toLowerCase();
  return normalized.includes("timed out") || normalized.includes("timeout");
}

export function parseCommandsText(commandsText: string) {
  return commandsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function handleExternalLinkClick(event: MouseEvent<HTMLAnchorElement>, url: string) {
  event.preventDefault();

  const opened = await openExternalUrl(url);
  if (!opened) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
