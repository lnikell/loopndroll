import type {
  LoopNotification,
  LoopPreset,
  LoopScope,
  LoopSession,
  HookLifecycleAppliedAction,
  HookLifecycleDeferredAction,
  HookLifecycleRequestedAction,
  HookLifecycleRisk,
  LoopndrollRuntimeState,
} from "../shared/app-rpc";

export const DEFAULT_PROMPT = "Keep working on the task. Do not finish yet.";

export const LOOP_SCOPE_VALUES = ["global", "per-task"] as const satisfies readonly LoopScope[];

export const LOOP_PRESET_VALUES = [
  "infinite",
  "await-reply",
  "completion-checks",
  "max-turns-1",
  "max-turns-2",
  "max-turns-3",
] as const satisfies readonly LoopPreset[];

export const LOOP_SESSION_SOURCE_VALUES = [
  "startup",
  "resume",
  "stop",
] as const satisfies readonly LoopSession["source"][];

export const NOTIFICATION_CHANNEL_VALUES = [
  "slack",
  "telegram",
] as const satisfies readonly LoopNotification["channel"][];

export const LOOPNDROLL_RUNTIME_STATE_VALUES = [
  "running",
  "paused",
  "stopped",
] as const satisfies readonly LoopndrollRuntimeState[];

export const HOOK_LIFECYCLE_REQUESTED_ACTION_VALUES = [
  "none",
  "pause",
  "resume",
  "start",
  "stop",
  "clear-managed-hook",
] as const satisfies readonly HookLifecycleRequestedAction[];

export const HOOK_LIFECYCLE_APPLIED_ACTION_VALUES = [
  "none",
  "running",
  "soft-pause",
  "full-removal",
  "full-removal-deferred",
] as const satisfies readonly HookLifecycleAppliedAction[];

export const HOOK_LIFECYCLE_DEFERRED_ACTION_VALUES = [
  "none",
  "remove-managed-hooks-and-unload-runtime",
] as const satisfies readonly HookLifecycleDeferredAction[];

export const HOOK_LIFECYCLE_RISK_VALUES = [
  "none",
  "active-processes-detected",
  "activity-unknown",
  "runtime-unload-unproven",
] as const satisfies readonly HookLifecycleRisk[];
