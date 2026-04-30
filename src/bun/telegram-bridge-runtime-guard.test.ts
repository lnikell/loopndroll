import { describe, expect, test } from "bun:test";

import {
  buildTelegramPromptReceivedText,
  buildTelegramWorkingAckText,
  getTelegramRemotePromptDeliveryMode,
} from "./telegram-control";
import { isTelegramCommandAllowedInRuntimeState } from "./telegram-bridge";

describe("telegram bridge await-reply runtime guard", () => {
  test("keeps one-shot delivery for await-reply freeform replies", () => {
    expect(getTelegramRemotePromptDeliveryMode("await-reply")).toBe("once");
  });

  test("keeps the received acknowledgement contract for await-reply /reply fallback", () => {
    const targetSession = {
      cwd: "/Users/example/Documents/ChiefOfStaff",
      sessionRef: "c22",
      title: "Fix bridge",
    };

    expect(buildTelegramPromptReceivedText(targetSession)).toBe(
      ["Reply queued for next Codex stop", "[ChiefOfStaff] [C22]", "Thread: Fix bridge"].join("\n"),
    );
    expect(buildTelegramWorkingAckText(targetSession)).toBe(
      ["Reply delivered to Codex", "[ChiefOfStaff] [C22]", "Thread: Fix bridge"].join("\n"),
    );
  });
});

describe("telegram bridge inactive runtime command policy", () => {
  test("keeps administrative Telegram commands available while stopped", () => {
    expect(isTelegramCommandAllowedInRuntimeState("stopped", "status")).toBe(true);
    expect(isTelegramCommandAllowedInRuntimeState("stopped", "help")).toBe(true);
    expect(isTelegramCommandAllowedInRuntimeState("stopped", "list")).toBe(true);
    expect(isTelegramCommandAllowedInRuntimeState("stopped", "mode")).toBe(true);
    expect(isTelegramCommandAllowedInRuntimeState("stopped", "failsafe")).toBe(true);
  });

  test("blocks freeform Telegram input while stopped", () => {
    expect(isTelegramCommandAllowedInRuntimeState("stopped", null)).toBe(false);
    expect(isTelegramCommandAllowedInRuntimeState("stopped", "unknown")).toBe(false);
  });
});
