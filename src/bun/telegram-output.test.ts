import { describe, expect, test } from "bun:test";

import {
  buildTelegramNotificationChunks,
  formatTelegramSessionLabel,
  normalizeTelegramOutputText,
} from "./telegram-output";

describe("normalizeTelegramOutputText", () => {
  test("cleans common markdown noise into chat-friendly text", () => {
    const input = [
      "## Plan",
      "",
      "- [ ] first item",
      "- [x] done item",
      "",
      "**Bold** and [docs](https://example.com/docs)",
      "",
      "> quoted",
    ].join("\n");

    expect(normalizeTelegramOutputText(input)).toBe(
      [
        "Plan",
        "- first item",
        "- [done] done item",
        "",
        "Bold and docs (https://example.com/docs)",
        "quoted",
      ].join("\n"),
    );
  });
});

describe("formatTelegramSessionLabel", () => {
  test("includes project, session ref and title when available", () => {
    expect(
      formatTelegramSessionLabel({
        cwd: "/Users/example/Documents/ChiefOfStaff",
        sessionRef: "c12",
        title: "Fix bridge",
      }),
    ).toBe("[ChiefOfStaff] [C12]\nThread: Fix bridge");
  });

  test("marks chats without cwd as projectless", () => {
    expect(
      formatTelegramSessionLabel({
        cwd: null,
        sessionRef: "c9",
        title: "Untitled thread",
      }),
    ).toBe("[Projectless] [C9]\nThread: Untitled thread");
  });
});

describe("buildTelegramNotificationChunks", () => {
  test("keeps footer only on the last chunk and adds numbering", () => {
    const chunks = buildTelegramNotificationChunks({
      cwd: "/Users/example/Documents/ChiefOfStaff",
      sessionRef: "C7",
      sessionTitle: "Long report",
      message: Array.from({ length: 140 }, () => "paragraph content").join(" "),
      preset: "await-reply",
      telegramNotificationFooter: "Reply to this message in Telegram to continue this Codex chat.",
      maxLength: 220,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain("[ChiefOfStaff] [C7] (1/");
    expect(chunks[0]).toContain("Thread: Long report\n\n---------\n\nparagraph content");
    expect(chunks[1]).toContain("(2/");
    expect(chunks.at(-1)).toContain(
      "Reply to this message in Telegram to continue this Codex chat.",
    );
    expect(chunks[0]).not.toContain(
      "Reply to this message in Telegram to continue this Codex chat.",
    );
    expect(chunks.every((chunk) => chunk.length <= 220)).toBe(true);
  });

  test("does not derive header context from the outgoing assistant message", () => {
    const chunks = buildTelegramNotificationChunks({
      cwd: null,
      sessionRef: "C8",
      sessionTitle: "Fix hook",
      message: ["Fix hook", "", "The typecheck is failing in hook-management.ts"].join("\n"),
      preset: "await-reply",
      telegramNotificationFooter: "Reply to this message in Telegram to continue this Codex chat.",
      maxLength: 4096,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("[Projectless] [C8]\nThread: Fix hook\n\n---------");
    expect(chunks[0]).not.toContain("Context:");
  });
});
