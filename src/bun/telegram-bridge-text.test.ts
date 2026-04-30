import { describe, expect, test } from "bun:test";

import {
  buildNoActiveModeForTargetText,
  buildNoSafeActiveChannelText,
  buildTelegramHelpText,
  buildTelegramStatusText,
} from "./telegram-bridge-text";

describe("buildTelegramStatusText", () => {
  test("shows runtime state and paused guidance", () => {
    const text = buildTelegramStatusText(
      {
        scope: "global",
        runtimeState: "paused",
        globalPreset: "await-reply",
        hooksAutoRegistration: true,
      },
      [],
    );

    expect(text).toContain("System: paused");
    expect(text).toContain("Hooks auto-registration: On");
    expect(text).toContain("Global preset: Await Reply");
    expect(text).toContain("Remote control is paused.");
  });

  test("shows stopped guidance", () => {
    const text = buildTelegramStatusText(
      {
        scope: "global",
        runtimeState: "stopped",
        globalPreset: null,
        hooksAutoRegistration: false,
      },
      [],
    );

    expect(text).toContain("System: stopped");
    expect(text).toContain("Hooks auto-registration: Off");
    expect(text).toContain("Loopndroll is stopped.");
  });
});

describe("buildTelegramStatusText per-chat bridge states", () => {
  test("shows per-chat waiting and queued Telegram state", () => {
    const text = buildTelegramStatusText(
      {
        scope: "global",
        runtimeState: "running",
        globalPreset: "await-reply",
        hooksAutoRegistration: true,
      },
      [
        {
          threadId: "thr_waiting",
          sessionId: "thr_waiting",
          sessionRef: "C1",
          source: "startup",
          cwd: "/tmp/project",
          notificationIds: [],
          archived: false,
          firstSeenAt: "2026-04-28T00:00:00.000Z",
          lastSeenAt: "2026-04-28T00:00:00.000Z",
          activeSince: null,
          stopCount: 0,
          preset: "await-reply",
          presetSource: "session",
          effectivePreset: "await-reply",
          completionCheckId: null,
          completionCheckWaitForReply: false,
          effectiveCompletionCheckId: null,
          effectiveCompletionCheckWaitForReply: false,
          threadName: "Waiting chat",
          title: "Waiting chat",
          transcriptPath: null,
          lastAssistantMessage: null,
        },
        {
          threadId: "thr_queued",
          sessionId: "thr_queued",
          sessionRef: "C2",
          source: "startup",
          cwd: "/tmp/project",
          notificationIds: [],
          archived: false,
          firstSeenAt: "2026-04-28T00:00:00.000Z",
          lastSeenAt: "2026-04-28T00:00:00.000Z",
          activeSince: null,
          stopCount: 0,
          preset: "infinite",
          presetSource: "session",
          effectivePreset: "infinite",
          completionCheckId: null,
          completionCheckWaitForReply: false,
          effectiveCompletionCheckId: null,
          effectiveCompletionCheckWaitForReply: false,
          threadName: "Queued chat",
          title: "Queued chat",
          transcriptPath: null,
          lastAssistantMessage: null,
        },
      ],
      {
        awaitingReplySessionIds: new Set(["thr_waiting"]),
        queuedPromptSessionIds: new Set(["thr_queued"]),
      },
    );

    expect(text).toContain("[project] [C1] Waiting chat: Await Reply - awaiting Telegram reply");
    expect(text).toContain("[project] [C2] Queued chat: Infinite - queued Telegram prompt");
  });
});

describe("buildTelegramHelpText", () => {
  test("describes reply behavior and v1 modes clearly", () => {
    const text = buildTelegramHelpText();

    expect(text).toContain("/reply C22 your message - Fallback: send a prompt to a specific chat");
    expect(text).toContain("Use /reply only as a fallback");
    expect(text).toContain(
      "Plain text targets the latest safe Telegram-linked chat when it has an active mode.",
    );
    expect(text).toContain("If that chat is Off, Loopndroll reports that nothing was delivered.");
    expect(text).toContain("Await Reply: sends a notification and keeps Codex waiting");
    expect(text).toContain("does not wake Codex in v1");
    expect(text).not.toContain("Passive:");
  });
});

describe("buildNoSafeActiveChannelText", () => {
  test("states that v1 will not wake Codex without a hook-backed waiting chat", () => {
    const text = buildNoSafeActiveChannelText();

    expect(text).toContain("Reply not delivered: no safe active channel");
    expect(text).toContain("hook-backed chat is active");
    expect(text).toContain("/reply C2 your message");
  });
});

describe("buildNoActiveModeForTargetText", () => {
  test("states that a loose message found a target but cannot deliver while off", () => {
    const text = buildNoActiveModeForTargetText({
      cwd: "/Users/example/Documents/loopndroll-threadmark",
      sessionRef: "C2",
      title: "Verificar loopndroll seguro",
    });

    expect(text).toContain("Reply not delivered: chat is Off");
    expect(text).toContain("[loopndroll-threadmark] [C2]");
    expect(text).toContain("Thread: Verificar loopndroll seguro");
    expect(text).toContain("latest Telegram-linked chat");
    expect(text).toContain("/mode C2 await");
  });
});
