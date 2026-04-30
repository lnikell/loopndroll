import { describe, expect, test } from "bun:test";

import {
  filterTelegramDirectMessageChats,
  inferTelegramChatKind,
  isTelegramDirectMessageChatId,
  validateTelegramNotificationChatId,
} from "./telegram-chat-policy";

describe("inferTelegramChatKind", () => {
  test("treats positive ids as direct messages", () => {
    expect(inferTelegramChatKind("123456789")).toBe("dm");
  });

  test("treats negative ids as non-direct chats", () => {
    expect(inferTelegramChatKind("-1001234567890")).toBe("group");
  });
});

describe("isTelegramDirectMessageChatId", () => {
  test("returns true only for direct-message ids", () => {
    expect(isTelegramDirectMessageChatId("42")).toBe(true);
    expect(isTelegramDirectMessageChatId("-42")).toBe(false);
  });
});

describe("validateTelegramNotificationChatId", () => {
  test("rejects non-direct-message chat ids", () => {
    expect(validateTelegramNotificationChatId("-1001234567890")).toBe(
      "Loopndroll currently supports Telegram direct messages only.",
    );
  });

  test("accepts direct-message chat ids", () => {
    expect(validateTelegramNotificationChatId("123456789")).toBeNull();
  });
});

describe("filterTelegramDirectMessageChats", () => {
  test("keeps only direct-message chats in the picker", () => {
    expect(
      filterTelegramDirectMessageChats([
        { chatId: "123", kind: "dm", username: "alice", displayName: "Alice" },
        { chatId: "-200", kind: "group", username: null, displayName: "Team" },
        { chatId: "-100300", kind: "channel", username: "news", displayName: "News" },
      ]),
    ).toEqual([{ chatId: "123", kind: "dm", username: "alice", displayName: "Alice" }]);
  });
});
