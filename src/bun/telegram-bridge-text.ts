import { type Database } from "bun:sqlite";
import type { LoopPreset, LoopScope, LoopSession, LoopndrollRuntimeState } from "../shared/app-rpc";
import {
  normalizeLoopPreset,
  normalizeLoopndrollRuntimeState,
  normalizeScope,
} from "./loopndroll-core";
import { formatTelegramSessionLabel } from "./telegram-output";

export function buildTelegramSessionListText(sessionsForChat: LoopSession[]) {
  if (sessionsForChat.length === 0) {
    return "No chats are registered to this Telegram destination yet.";
  }

  const lines = sessionsForChat.slice(0, 20).map((session) => {
    const threadName =
      typeof session.threadName === "string" && session.threadName.trim().length > 0
        ? session.threadName.trim()
        : null;
    return formatTelegramSessionLabel({
      cwd: session.cwd,
      sessionRef: session.sessionRef,
      title: threadName,
    });
  });

  const suffix =
    sessionsForChat.length > lines.length
      ? `\n\nShowing ${lines.length} of ${sessionsForChat.length} chats.`
      : "";

  return `Registered chats:\n${lines.join("\n")}${suffix}`;
}

function formatTelegramStatusSessionLabel(input: {
  cwd?: string | null;
  sessionRef?: string | null;
  title?: string | null;
}) {
  return formatTelegramSessionLabel(input).replace("\nThread: ", " ");
}

function getLoopPresetLabel(preset: LoopPreset | null) {
  if (preset === "infinite") {
    return "Infinite";
  }
  if (preset === "await-reply") {
    return "Await Reply";
  }
  if (preset === "completion-checks") {
    return "Completion checks";
  }
  if (preset === "max-turns-1") {
    return "Max Turns 1";
  }
  if (preset === "max-turns-2") {
    return "Max Turns 2";
  }
  if (preset === "max-turns-3") {
    return "Max Turns 3";
  }
  return "Disabled";
}

export function getTelegramStatusSnapshot(db: Database) {
  const row = db
    .query(
      "select scope, runtime_state, global_preset, hooks_auto_registration from settings where id = 1",
    )
    .get() as {
    scope?: unknown;
    runtime_state?: unknown;
    global_preset?: unknown;
    hooks_auto_registration?: number | boolean;
  } | null;

  return {
    scope: normalizeScope(row?.scope),
    runtimeState: normalizeLoopndrollRuntimeState(row?.runtime_state),
    globalPreset: normalizeLoopPreset(row?.global_preset),
    hooksAutoRegistration:
      typeof row?.hooks_auto_registration === "boolean"
        ? row.hooks_auto_registration
        : Boolean(row?.hooks_auto_registration),
  };
}

export function buildTelegramStatusText(
  settingsSnapshot: {
    scope: LoopScope;
    runtimeState: LoopndrollRuntimeState;
    globalPreset: LoopPreset | null;
    hooksAutoRegistration: boolean;
  },
  sessionsForChat: LoopSession[],
  bridgeStates: {
    awaitingReplySessionIds?: ReadonlySet<string>;
    queuedPromptSessionIds?: ReadonlySet<string>;
  } = {},
) {
  const visibleSessions = sessionsForChat.filter((session) => !session.archived);
  const lines = [
    "Current status:",
    `System: ${settingsSnapshot.runtimeState}`,
    `Hooks auto-registration: ${settingsSnapshot.hooksAutoRegistration ? "On" : "Off"}`,
    `Global preset: ${getLoopPresetLabel(settingsSnapshot.globalPreset)}`,
  ];

  if (settingsSnapshot.runtimeState === "paused") {
    lines.push("Remote control is paused. Resume from the app before sending new prompts.");
  } else if (settingsSnapshot.runtimeState === "stopped") {
    lines.push("Loopndroll is stopped. Start it from the app before sending new prompts.");
  }

  if (visibleSessions.length === 0) {
    lines.push("", "Registered chats: none");
    return lines.join("\n");
  }

  lines.push("", "Per-chat presets:");
  for (const session of visibleSessions.slice(0, 20)) {
    const threadName =
      typeof session.threadName === "string" && session.threadName.trim().length > 0
        ? session.threadName.trim()
        : null;
    const presetLabel =
      session.presetSource === "session"
        ? getLoopPresetLabel(session.preset)
        : session.presetSource === "off"
          ? "Off"
          : "Inherit global";
    const bridgeState = bridgeStates.awaitingReplySessionIds?.has(session.sessionId)
      ? "awaiting Telegram reply"
      : bridgeStates.queuedPromptSessionIds?.has(session.sessionId)
        ? "queued Telegram prompt"
        : session.effectivePreset === "await-reply"
          ? "waiting for next Codex stop"
          : "no Telegram input waiting";
    lines.push(
      `${formatTelegramStatusSessionLabel({
        cwd: session.cwd,
        sessionRef: session.sessionRef,
        title: threadName,
      })}: ${presetLabel} - ${bridgeState}`,
    );
  }

  if (visibleSessions.length > 20) {
    lines.push("", `Showing 20 of ${visibleSessions.length} chats.`);
  }

  return lines.join("\n");
}

export function buildTelegramHelpText() {
  return [
    "Available commands:",
    "/list - List chats registered to this Telegram destination",
    "/status - Show the system state, global preset, and per-chat presets",
    "/reply C22 your message - Fallback: send a prompt to a specific chat",
    "/mode global infinite - Set the global preset to Infinite",
    "/mode global await - Set the global preset to Await Reply",
    "/mode global checks - Set the global preset to Completion checks",
    "/mode global off - Disable the global preset",
    "/mode C22 infinite - Set chat C22 to Infinite",
    "/mode C22 await - Set chat C22 to Await Reply",
    "/mode C22 off - Stop chat C22",
    "/failsafe C22 - Immediately disable control for chat C22 and clear its pending prompts",
    "/failsafe all - Immediately disable the global mode, every chat mode, and all pending prompts",
    "",
    "Reply behavior:",
    "Reply directly to a Telegram notification to target that chat.",
    "Use /reply only as a fallback when you do not want to reply to the Telegram message directly.",
    "Plain text targets the latest safe Telegram-linked chat when it has an active mode.",
    "If that chat is Off, Loopndroll reports that nothing was delivered.",
    "Loopndroll does not wake Codex in v1.",
    "",
    "Modes:",
    "Await Reply: sends a notification and keeps Codex waiting for your reply.",
    "Infinite: keeps sending a persistent prompt until you change the mode.",
    "Off: disables the preset for that chat or global default.",
    "",
    "Examples:",
    "/list",
    "/status",
    "/reply C22 fix the failing test",
    "/mode global await",
    "/mode C22 await",
    "/failsafe C22",
    "/failsafe all",
    "/mode C22 off",
  ].join("\n");
}

export function buildNoSafeActiveChannelText() {
  return [
    "Reply not delivered: no safe active channel",
    "",
    "Loopndroll v1 only accepts Telegram input when a hook-backed chat is active.",
    "Reply to a Loopndroll notification, use /reply C2 your message, or run /status.",
  ].join("\n");
}

export function buildNoActiveModeForTargetText(input: {
  cwd?: string | null;
  sessionRef?: string | null;
  title?: string | null;
}) {
  return [
    "Reply not delivered: chat is Off",
    formatTelegramSessionLabel(input),
    "",
    "---------",
    "",
    "Loopndroll found this as the latest Telegram-linked chat, but it is Off.",
    `Use /mode ${input.sessionRef ?? "C22"} await, then wait for the next Codex stop.`,
  ].join("\n");
}

export function getModeCommandLabel(preset: LoopPreset | null) {
  if (preset === "infinite") {
    return "Infinite";
  }
  if (preset === "await-reply") {
    return "Await Reply";
  }
  if (preset === "completion-checks") {
    return "Completion checks";
  }
  return "Off";
}
