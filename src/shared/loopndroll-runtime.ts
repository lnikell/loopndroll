export type LoopndrollRuntimeState = "running" | "paused" | "stopped";

export const LOOPNDROLL_RUNTIME_STATE_VALUES = [
  "running",
  "paused",
  "stopped",
] as const satisfies readonly LoopndrollRuntimeState[];

export function normalizeLoopndrollRuntimeState(value: unknown): LoopndrollRuntimeState {
  return LOOPNDROLL_RUNTIME_STATE_VALUES.includes(value as LoopndrollRuntimeState)
    ? (value as LoopndrollRuntimeState)
    : "running";
}

export function isLoopndrollRunning(value: unknown) {
  return normalizeLoopndrollRuntimeState(value) === "running";
}
