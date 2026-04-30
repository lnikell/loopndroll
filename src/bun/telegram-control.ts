import type { LoopPreset } from "../shared/app-rpc";
import { formatTelegramSessionLabel } from "./telegram-output";

export function getTelegramRemotePromptDeliveryMode(
  preset: LoopPreset | null,
): "once" | "persistent" {
  return preset === "await-reply" ? "once" : "persistent";
}

export function buildTelegramPromptReceivedText(input: {
  cwd?: string | null;
  sessionRef?: string | null;
  title?: string | null;
}) {
  const label = formatTelegramSessionLabel(input);
  return label.length > 0
    ? `Reply queued for next Codex stop\n${label}`
    : "Reply queued for next Codex stop.";
}

export function buildTelegramWorkingAckText(input: {
  cwd?: string | null;
  sessionRef?: string | null;
  title?: string | null;
}) {
  const label = formatTelegramSessionLabel(input);
  return label.length > 0 ? `Reply delivered to Codex\n${label}` : "Reply delivered to Codex.";
}
