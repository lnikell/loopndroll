import { describe, expect, test } from "bun:test";

import {
  buildTelegramPromptReceivedText,
  buildTelegramWorkingAckText,
  getTelegramRemotePromptDeliveryMode,
} from "./telegram-control";

describe("getTelegramRemotePromptDeliveryMode", () => {
  test("uses one-shot delivery for await-reply", () => {
    expect(getTelegramRemotePromptDeliveryMode("await-reply")).toBe("once");
  });

  test("keeps persistent delivery for continuous auto-run modes", () => {
    expect(getTelegramRemotePromptDeliveryMode("infinite")).toBe("persistent");
    expect(getTelegramRemotePromptDeliveryMode("completion-checks")).toBe("persistent");
  });
});

describe("Telegram ack text", () => {
  test("formats received acknowledgements with project-aware labels", () => {
    expect(
      buildTelegramPromptReceivedText({
        cwd: "/Users/example/Documents/ChiefOfStaff",
        sessionRef: "c22",
        title: "Fix bridge",
      }),
    ).toBe(
      ["Reply queued for next Codex stop", "[ChiefOfStaff] [C22]", "Thread: Fix bridge"].join("\n"),
    );
  });

  test("formats working acknowledgements with project-aware labels", () => {
    expect(
      buildTelegramWorkingAckText({
        cwd: "/Users/example/Documents/ChiefOfStaff",
        sessionRef: "c22",
        title: "Fix bridge",
      }),
    ).toBe(["Reply delivered to Codex", "[ChiefOfStaff] [C22]", "Thread: Fix bridge"].join("\n"));
  });
});
