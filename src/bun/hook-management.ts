import { spawn } from "node:child_process";
import { chmod, copyFile, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import type {
  HookLifecycleRequestedAction,
  HookLifecycleStatus,
  LoopndrollSnapshot,
} from "../shared/app-rpc";
import {
  createSpawnedCodexAppServerTransport,
  inspectCodexRuntimeActivity,
  type CodexRuntimeActivityInspection,
} from "./codex-app-server-client";
import { getLoopndrollDatabase } from "./db/client";
import { settings } from "./db/schema";
import {
  acquireHookRemovalWatchLock,
  getHookRemovalWatcherStatus,
  releaseHookRemovalWatchLock,
  releaseHookRemovalWatchLockSync,
} from "./hook-removal-watch-lock";
import { buildManagedHookScript } from "./managed-hook-script";
import {
  type HookMatcherGroup,
  MANAGED_HOOK_MARKER,
  MANAGED_HOOK_SCRIPT_MARKER,
  PROMPT_STATUS_MESSAGE,
  SESSION_STATUS_MESSAGE,
  STOP_STATUS_MESSAGE,
  type HooksDocument,
  type LoopndrollPaths,
  appendHookDebugLog,
  ensureDirectory,
  getLoopndrollPaths,
  getSettingsRow,
  normalizeLoopndrollRuntimeState,
  nowIsoString,
  readSnapshotFromDatabase,
} from "./loopndroll-core";
import { refreshCanonicalThreadNames } from "./thread-name-refresh";

const PENDING_HOOK_REMOVAL_RECHECK_MS = 30_000;
const PENDING_HOOK_REMOVAL_RECHECK_MAX_MS = 5 * 60_000;
const PENDING_HOOK_REMOVAL_JITTER_MS = 2_000;

type HookFileTarget = {
  path: string;
  scope: "global" | "repo-local";
};

type ManagedHookRemovalResult = {
  inspectedPaths: string[];
  changedPaths: string[];
  managedHookCountBefore: number;
};

export function buildHookFileTargets(
  codexHooksPath: string,
  repoCwds: readonly string[],
): HookFileTarget[] {
  const targets = new Map<string, HookFileTarget>();
  targets.set(codexHooksPath, {
    path: codexHooksPath,
    scope: "global",
  });

  for (const repoCwd of repoCwds) {
    const cwd = repoCwd.trim();
    if (cwd.length === 0) {
      continue;
    }

    const hookPath = join(cwd, ".codex", "hooks.json");
    targets.set(hookPath, {
      path: hookPath,
      scope: "repo-local",
    });
  }

  return [...targets.values()];
}

async function loadHooksDocumentAtPath(path: string) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as HooksDocument;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return { hooks: {} };
    }

    const backupPath = `${path}.corrupt.${Date.now()}`;
    try {
      await copyFile(path, backupPath);
    } catch {
      // Ignore backup failures and continue with a clean hooks file.
    }

    return { hooks: {} };
  }
}

async function loadHooksDocument(paths: LoopndrollPaths) {
  return loadHooksDocumentAtPath(paths.codexHooksPath);
}

function ensureCodexHooksFeature(configText: string) {
  const hasTrailingNewline = configText.endsWith("\n");
  const lines = configText.split("\n");
  const featuresIndex = lines.findIndex((line) => line.trim() === "[features]");

  if (featuresIndex === -1) {
    const trimmed = configText.trimEnd();
    return `${trimmed}${trimmed.length > 0 ? "\n\n" : ""}[features]\ncodex_hooks = true\n`;
  }

  let blockEndIndex = lines.length;
  for (let index = featuresIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && /^\s*\[.*\]\s*$/.test(line)) {
      blockEndIndex = index;
      break;
    }
  }

  const nextBlockLines = lines
    .slice(featuresIndex + 1, blockEndIndex)
    .filter((line) => !/^\s*codex_hooks\s*=/.test(line));

  nextBlockLines.push("codex_hooks = true");

  const nextLines = [
    ...lines.slice(0, featuresIndex + 1),
    ...nextBlockLines,
    ...lines.slice(blockEndIndex),
  ];

  const nextConfig = nextLines.join("\n");
  return hasTrailingNewline || nextConfig.length === 0
    ? `${nextConfig.replace(/\n*$/, "")}\n`
    : nextConfig;
}

async function ensureCodexConfig(paths: LoopndrollPaths) {
  const current = (await readFile(paths.codexConfigPath, "utf8").catch(() => "")) ?? "";
  const next = ensureCodexHooksFeature(current);

  if (next !== current) {
    await ensureDirectory(paths.codexDirectoryPath);
    await writeFile(paths.codexConfigPath, next, "utf8");
  }
}

function quoteCommandPath(path: string) {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

function isManagedHookCommand(command: string | undefined) {
  return typeof command === "string" && command.includes(MANAGED_HOOK_MARKER);
}

function countManagedHooks(hooksDocument: HooksDocument) {
  let count = 0;
  for (const groups of Object.values(hooksDocument.hooks ?? {})) {
    for (const group of groups) {
      count += (group.hooks ?? []).filter((hook) => isManagedHookCommand(hook.command)).length;
    }
  }

  return count;
}

function removeManagedHooks(hooksDocument: HooksDocument) {
  const nextHooks: Record<string, HookMatcherGroup[]> = {};

  for (const [eventName, groups] of Object.entries(hooksDocument.hooks ?? {})) {
    const nextGroups: HookMatcherGroup[] = [];

    for (const group of groups) {
      const nextHandlers = (group.hooks ?? []).filter(
        (hook) => !isManagedHookCommand(hook.command),
      );
      if (nextHandlers.length > 0) {
        nextGroups.push({ ...group, hooks: nextHandlers });
      }
    }

    if (nextGroups.length > 0) {
      nextHooks[eventName] = nextGroups;
    }
  }

  hooksDocument.hooks = nextHooks;
}

function getHookFileTargets(paths: LoopndrollPaths, sqlite: Database): HookFileTarget[] {
  const rows = sqlite
    .query("select distinct cwd from sessions where cwd is not null and trim(cwd) != ''")
    .all() as Array<{ cwd: string }>;
  return buildHookFileTargets(
    paths.codexHooksPath,
    rows.flatMap((row) => (typeof row.cwd === "string" ? [row.cwd] : [])),
  );
}

async function writeHooksDocument(path: string, hooksDocument: HooksDocument) {
  await ensureDirectory(join(path, ".."));
  await writeFile(path, `${JSON.stringify(hooksDocument, null, 2)}\n`, "utf8");
}

function upsertManagedHooks(paths: LoopndrollPaths, hooksDocument: HooksDocument) {
  if (!hooksDocument.hooks) {
    hooksDocument.hooks = {};
  }

  removeManagedHooks(hooksDocument);

  const command = `${quoteCommandPath(paths.managedHookPath)} --hook ${MANAGED_HOOK_MARKER}`;

  hooksDocument.hooks.SessionStart = [
    ...(hooksDocument.hooks.SessionStart ?? []),
    {
      matcher: "startup|resume",
      hooks: [
        {
          type: "command",
          command,
          timeout: 30,
          statusMessage: SESSION_STATUS_MESSAGE,
        },
      ],
    },
  ];
  hooksDocument.hooks.Stop = [
    ...(hooksDocument.hooks.Stop ?? []),
    {
      hooks: [
        {
          type: "command",
          command,
          timeout: 86_400,
          statusMessage: STOP_STATUS_MESSAGE,
        },
      ],
    },
  ];
  hooksDocument.hooks.UserPromptSubmit = [
    ...(hooksDocument.hooks.UserPromptSubmit ?? []),
    {
      hooks: [
        {
          type: "command",
          command,
          timeout: 30,
          statusMessage: PROMPT_STATUS_MESSAGE,
        },
      ],
    },
  ];
}

async function ensureManagedHookScript(paths: LoopndrollPaths) {
  await ensureDirectory(paths.binDirectoryPath);
  const existingContent = await readFile(paths.managedHookPath, "utf8").catch(() => null);
  if (existingContent && !existingContent.includes(MANAGED_HOOK_SCRIPT_MARKER)) {
    const backupPath = `${paths.managedHookPath}.bak.${Date.now()}`;
    await copyFile(paths.managedHookPath, backupPath);
  }

  await writeFile(paths.managedHookPath, buildManagedHookScript(paths), "utf8");
  await chmod(paths.managedHookPath, 0o755);
}

async function computeHealth(paths: LoopndrollPaths) {
  const issues: string[] = [];
  const configContents = await readFile(paths.codexConfigPath, "utf8").catch(() => null);
  const { client } = getLoopndrollDatabase(paths.databasePath);
  const hookTargets = getHookFileTargets(paths, client);
  const runtimeState = normalizeLoopndrollRuntimeState(getSettingsRow().runtimeState);
  const scriptExists = await stat(paths.managedHookPath)
    .then(() => true)
    .catch(() => false);
  let hasManagedSessionStart = false;
  let hasManagedStop = false;
  let hasManagedUserPromptSubmit = false;
  const managedHookPaths: string[] = [];

  for (const target of hookTargets) {
    const exists = await stat(target.path)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      continue;
    }

    const hooksDocument = await loadHooksDocumentAtPath(target.path);
    const hookEvents = hooksDocument.hooks ?? {};
    const targetHasSessionStart = (hookEvents.SessionStart ?? []).some((group) =>
      (group.hooks ?? []).some((hook) => isManagedHookCommand(hook.command)),
    );
    const targetHasStop = (hookEvents.Stop ?? []).some((group) =>
      (group.hooks ?? []).some((hook) => isManagedHookCommand(hook.command)),
    );
    const targetHasUserPromptSubmit = (hookEvents.UserPromptSubmit ?? []).some((group) =>
      (group.hooks ?? []).some((hook) => isManagedHookCommand(hook.command)),
    );

    if (targetHasSessionStart || targetHasStop || targetHasUserPromptSubmit) {
      managedHookPaths.push(target.path);
    }

    hasManagedSessionStart = hasManagedSessionStart || targetHasSessionStart;
    hasManagedStop = hasManagedStop || targetHasStop;
    hasManagedUserPromptSubmit = hasManagedUserPromptSubmit || targetHasUserPromptSubmit;
  }

  if (runtimeState === "stopped" && managedHookPaths.length > 0) {
    issues.push("Managed hook entries still exist after stopped state.");
  }

  if (
    runtimeState !== "stopped" &&
    (!configContents || !/\bcodex_hooks\s*=\s*true\b/.test(configContents))
  ) {
    issues.push("Codex hooks are not enabled in ~/.codex/config.toml.");
  }
  if (runtimeState !== "stopped" && !hasManagedSessionStart) {
    issues.push("Managed SessionStart hook is not registered.");
  }
  if (runtimeState !== "stopped" && !hasManagedStop) {
    issues.push("Managed Stop hook is not registered.");
  }
  if (runtimeState !== "stopped" && !hasManagedUserPromptSubmit) {
    issues.push("Managed UserPromptSubmit hook is not registered.");
  }
  if (runtimeState !== "stopped" && !scriptExists) {
    issues.push("Managed hook executable is missing.");
  }

  const allRequiredHooksRegistered =
    hasManagedSessionStart && hasManagedStop && hasManagedUserPromptSubmit;
  const codexHooksEnabled =
    runtimeState === "stopped" ||
    Boolean(configContents && /\bcodex_hooks\s*=\s*true\b/.test(configContents));
  const fullyRegistered =
    runtimeState === "stopped"
      ? managedHookPaths.length > 0
      : allRequiredHooksRegistered && codexHooksEnabled && scriptExists;

  return {
    registered: fullyRegistered,
    issues,
    hookRemovalWatcher: await getHookRemovalWatcherStatus(paths),
  };
}

async function ensureRegistered(paths: LoopndrollPaths) {
  await ensureDirectory(paths.codexDirectoryPath);
  await ensureManagedHookScript(paths);
  await ensureCodexConfig(paths);

  const hooksDocument = await loadHooksDocument(paths);
  upsertManagedHooks(paths, hooksDocument);
  await writeFile(paths.codexHooksPath, `${JSON.stringify(hooksDocument, null, 2)}\n`, "utf8");

  await appendHookDebugLog(paths, {
    type: "setup",
    action: "register-hooks",
    managedHookPath: paths.managedHookPath,
    hooksFilePath: paths.codexHooksPath,
  });
}

async function clearManagedHookRegistration(
  paths: LoopndrollPaths,
): Promise<ManagedHookRemovalResult> {
  const { client } = getLoopndrollDatabase(paths.databasePath);
  const targets = getHookFileTargets(paths, client);
  const inspectedPaths: string[] = [];
  const changedPaths: string[] = [];
  let managedHookCountBefore = 0;

  for (const target of targets) {
    const exists = await stat(target.path)
      .then(() => true)
      .catch(() => false);
    if (!exists && target.scope === "repo-local") {
      continue;
    }

    inspectedPaths.push(target.path);
    const hooksDocument = await loadHooksDocumentAtPath(target.path);
    const before = countManagedHooks(hooksDocument);
    managedHookCountBefore += before;
    removeManagedHooks(hooksDocument);

    if (before > 0 || target.scope === "global") {
      await writeHooksDocument(target.path, hooksDocument);
      changedPaths.push(target.path);
    }
  }

  return {
    inspectedPaths,
    changedPaths,
    managedHookCountBefore,
  };
}

function setRuntimeState(value: "running" | "paused" | "stopped") {
  const { db } = getLoopndrollDatabase(getLoopndrollPaths().databasePath);
  db.update(settings).set({ runtimeState: value }).where(eq(settings.id, 1)).run();
}

function buildHookLifecycleStatus(
  status: Omit<HookLifecycleStatus, "checkedAt"> & { checkedAt?: string | null },
): HookLifecycleStatus {
  return {
    ...status,
    checkedAt: status.checkedAt ?? nowIsoString(),
  };
}

function persistHookLifecycleStatus(status: HookLifecycleStatus) {
  const { db } = getLoopndrollDatabase(getLoopndrollPaths().databasePath);
  db.update(settings)
    .set({
      hookLifecycleStatusJson: JSON.stringify(status),
      hookRemovalPending: status.pending,
      hookRemovalNextAttemptAt: status.pending
        ? new Date(Date.now() + PENDING_HOOK_REMOVAL_RECHECK_MS).toISOString()
        : null,
    })
    .where(eq(settings.id, 1))
    .run();
}

function setHookLifecycleStatus(status: HookLifecycleStatus) {
  persistHookLifecycleStatus(status);
  return status;
}

function buildSoftPauseStatus(
  requestedAction: HookLifecycleRequestedAction,
  inspection: CodexRuntimeActivityInspection,
): HookLifecycleStatus {
  const remainingRisk =
    inspection.status === "active" ? "active-processes-detected" : "activity-unknown";

  return buildHookLifecycleStatus({
    requestedAction,
    appliedAction: "soft-pause",
    deferredAction: "remove-managed-hooks-and-unload-runtime",
    remainingRisk,
    nextAutomaticStep:
      "Recheck Codex runtime activity; when idle, remove managed hooks. Live runtime unload is not claimed until Codex reloads hooks.",
    message:
      inspection.status === "active"
        ? "soft pause applied because active processes were detected"
        : "full removal deferred until system is idle",
    pending: true,
    objectives: {
      inertNow: true,
      removedFromHooksJson: false,
      unloadedFromLiveRuntime: false,
    },
  });
}

async function inspectRuntimeActivity(): Promise<CodexRuntimeActivityInspection> {
  let transport = null;
  try {
    transport = await createSpawnedCodexAppServerTransport();
    return await inspectCodexRuntimeActivity(transport);
  } catch (error) {
    return {
      status: "unknown",
      loadedThreadIds: [],
      activeThreadIds: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await transport?.close().catch(() => {});
  }
}

async function completeManagedHookRemoval(
  requestedAction: HookLifecycleRequestedAction,
  paths: LoopndrollPaths,
) {
  const removal = await clearManagedHookRegistration(paths);
  const status = buildHookLifecycleStatus({
    requestedAction,
    appliedAction: "full-removal-deferred",
    deferredAction: "none",
    remainingRisk: "runtime-unload-unproven",
    nextAutomaticStep: null,
    message:
      "managed hooks were removed from hooks.json; live Codex runtime unload is not proven until Codex reloads hooks",
    pending: false,
    objectives: {
      inertNow: true,
      removedFromHooksJson: true,
      unloadedFromLiveRuntime: false,
    },
  });

  const { db } = getLoopndrollDatabase(paths.databasePath);
  db.update(settings)
    .set({
      hooksAutoRegistration: false,
      runtimeState: "stopped",
    })
    .where(eq(settings.id, 1))
    .run();

  await appendHookDebugLog(paths, {
    type: "setup",
    action: "managed-hook-full-removal",
    requestedAction,
    inspectedPaths: removal.inspectedPaths,
    changedPaths: removal.changedPaths,
    managedHookCountBefore: removal.managedHookCountBefore,
    runtimeUnloadProven: false,
  });

  return setHookLifecycleStatus(status);
}

async function applyIntelligentManagedHookRemoval(requestedAction: HookLifecycleRequestedAction) {
  const paths = getLoopndrollPaths();
  const inspection = await inspectRuntimeActivity();

  if (inspection.status !== "idle") {
    setRuntimeState("paused");
    const status = setHookLifecycleStatus(buildSoftPauseStatus(requestedAction, inspection));
    await appendHookDebugLog(paths, {
      type: "setup",
      action: "managed-hook-removal-deferred",
      requestedAction,
      inspection,
    });
    return status;
  }

  return completeManagedHookRemoval(requestedAction, paths);
}

export async function completePendingHookRemovalIfSafe() {
  const settingsRow = getSettingsRow();
  if (!settingsRow.hookRemovalPending) {
    return false;
  }

  const nextAttemptAt = settingsRow.hookRemovalNextAttemptAt
    ? Date.parse(settingsRow.hookRemovalNextAttemptAt)
    : 0;
  if (Number.isFinite(nextAttemptAt) && nextAttemptAt > Date.now()) {
    return false;
  }

  await applyIntelligentManagedHookRemoval("stop");
  return true;
}

let pendingHookRemovalMonitorStarted = false;
let pendingHookRemovalMonitorTimer: ReturnType<typeof setTimeout> | null = null;
let pendingHookRemovalMonitorBackoffMs = PENDING_HOOK_REMOVAL_RECHECK_MS;
let pendingHookRemovalMonitorCleanupRegistered = false;

function withPendingHookRemovalJitter(delayMs: number) {
  return delayMs + Math.floor(Math.random() * PENDING_HOOK_REMOVAL_JITTER_MS);
}

function registerHookRemovalMonitorCleanup(paths: LoopndrollPaths) {
  if (pendingHookRemovalMonitorCleanupRegistered) {
    return;
  }

  pendingHookRemovalMonitorCleanupRegistered = true;
  const cleanupAndExit = () => {
    releaseHookRemovalWatchLockSync(paths);
    process.exit(0);
  };
  process.once("SIGTERM", cleanupAndExit);
  process.once("SIGINT", cleanupAndExit);
  process.once("exit", () => {
    releaseHookRemovalWatchLockSync(paths);
  });
}

function schedulePendingHookRemovalMonitor(paths: LoopndrollPaths) {
  pendingHookRemovalMonitorTimer = setTimeout(() => {
    void runPendingHookRemovalMonitorTick(paths);
  }, withPendingHookRemovalJitter(pendingHookRemovalMonitorBackoffMs));
}

async function runPendingHookRemovalMonitorTick(paths: LoopndrollPaths) {
  try {
    const didRun = await completePendingHookRemovalIfSafe();
    pendingHookRemovalMonitorBackoffMs = didRun
      ? PENDING_HOOK_REMOVAL_RECHECK_MS
      : Math.min(
          Math.floor(pendingHookRemovalMonitorBackoffMs * 1.5),
          PENDING_HOOK_REMOVAL_RECHECK_MAX_MS,
        );
  } catch (error) {
    pendingHookRemovalMonitorBackoffMs = Math.min(
      pendingHookRemovalMonitorBackoffMs * 2,
      PENDING_HOOK_REMOVAL_RECHECK_MAX_MS,
    );
    await appendHookDebugLog(paths, {
      type: "setup",
      action: "pending-hook-removal-recheck-failed",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (pendingHookRemovalMonitorStarted) {
      schedulePendingHookRemovalMonitor(paths);
    }
  }
}

export async function startHookRemovalPendingMonitor() {
  if (pendingHookRemovalMonitorStarted) {
    return "watcher already running";
  }

  const paths = getLoopndrollPaths();
  const lock = await acquireHookRemovalWatchLock(paths);
  if (lock.status === "already-running") {
    console.log(lock.message);
    return lock.message;
  }

  pendingHookRemovalMonitorStarted = true;
  registerHookRemovalMonitorCleanup(paths);
  schedulePendingHookRemovalMonitor(paths);
  return lock.message;
}

export async function stopHookRemovalPendingMonitorForEmergency() {
  if (pendingHookRemovalMonitorTimer) {
    clearTimeout(pendingHookRemovalMonitorTimer);
    pendingHookRemovalMonitorTimer = null;
  }
  pendingHookRemovalMonitorStarted = false;
  return releaseHookRemovalWatchLock(getLoopndrollPaths());
}

export function buildLoopndrollSetupSnapshot(
  baseSnapshot: Omit<LoopndrollSnapshot, "health">,
  health: LoopndrollSnapshot["health"],
): LoopndrollSnapshot {
  return {
    ...baseSnapshot,
    health,
  };
}

export async function loadSnapshot(paths: LoopndrollPaths) {
  getLoopndrollDatabase(paths.databasePath);
  const baseSnapshot = readSnapshotFromDatabase();
  const health = await computeHealth(paths);

  return buildLoopndrollSetupSnapshot(baseSnapshot, health);
}

export async function ensureLoopndrollSetup() {
  const paths = getLoopndrollPaths();
  const { client } = getLoopndrollDatabase(paths.databasePath);

  const settingsRow = getSettingsRow();
  if (
    settingsRow.hooksAutoRegistration &&
    normalizeLoopndrollRuntimeState(settingsRow.runtimeState) !== "stopped"
  ) {
    await ensureRegistered(paths);
  }

  try {
    await completePendingHookRemovalIfSafe();
  } catch (error) {
    await appendHookDebugLog(paths, {
      type: "setup",
      action: "pending-hook-removal-recheck-failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const refreshResult = await refreshCanonicalThreadNames(client);
    if (
      refreshResult.refreshedCount > 0 ||
      refreshResult.orphanedMissCountUpdated > 0 ||
      refreshResult.prunedCount > 0 ||
      refreshResult.resetCount > 0
    ) {
      await appendHookDebugLog(paths, {
        type: "setup",
        action: "refresh-canonical-thread-names",
        ...refreshResult,
      });
    }
  } catch (error) {
    await appendHookDebugLog(paths, {
      type: "setup",
      action: "refresh-canonical-thread-names",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return loadSnapshot(paths);
}

export async function getLoopndrollSnapshot() {
  const paths = getLoopndrollPaths();
  await completePendingHookRemovalIfSafe();
  return loadSnapshot(paths);
}

export async function registerHooks() {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  await ensureRegistered(paths);
  db.update(settings)
    .set({
      hooksAutoRegistration: true,
      runtimeState: "running",
      hookRemovalPending: false,
      hookRemovalNextAttemptAt: null,
    })
    .where(eq(settings.id, 1))
    .run();
  setHookLifecycleStatus(
    buildHookLifecycleStatus({
      requestedAction: "start",
      appliedAction: "running",
      deferredAction: "none",
      remainingRisk: "runtime-unload-unproven",
      nextAutomaticStep:
        "Start a new Codex turn or restart the app-server lane if live hook load is stale.",
      message:
        "Loopndroll hooks were installed in hooks.json; live Codex runtime load is not assumed.",
      pending: false,
      objectives: {
        inertNow: false,
        removedFromHooksJson: false,
        unloadedFromLiveRuntime: false,
      },
    }),
  );

  return loadSnapshot(paths);
}

export async function clearHooks() {
  await applyIntelligentManagedHookRemoval("clear-managed-hook");
  return loadSnapshot(getLoopndrollPaths());
}

export async function pauseLoopndroll() {
  const paths = getLoopndrollPaths();
  setRuntimeState("paused");
  setHookLifecycleStatus(
    buildHookLifecycleStatus({
      requestedAction: "pause",
      appliedAction: "soft-pause",
      deferredAction: "none",
      remainingRisk: "none",
      nextAutomaticStep: null,
      message: "soft pause applied because active processes were detected",
      pending: false,
      objectives: {
        inertNow: true,
        removedFromHooksJson: false,
        unloadedFromLiveRuntime: false,
      },
    }),
  );
  await appendHookDebugLog(paths, {
    type: "setup",
    action: "pause-loopndroll",
  });
  return loadSnapshot(paths);
}

export async function resumeLoopndroll() {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);
  db.update(settings)
    .set({
      runtimeState: "running",
      hookRemovalPending: false,
      hookRemovalNextAttemptAt: null,
    })
    .where(eq(settings.id, 1))
    .run();
  setHookLifecycleStatus(
    buildHookLifecycleStatus({
      requestedAction: "resume",
      appliedAction: "running",
      deferredAction: "none",
      remainingRisk: "none",
      nextAutomaticStep: null,
      message: "Loopndroll resumed; pending hook removal was cancelled.",
      pending: false,
      objectives: {
        inertNow: false,
        removedFromHooksJson: false,
        unloadedFromLiveRuntime: false,
      },
    }),
  );
  await appendHookDebugLog(paths, {
    type: "setup",
    action: "resume-loopndroll",
  });
  return loadSnapshot(paths);
}

export async function stopLoopndroll() {
  await applyIntelligentManagedHookRemoval("stop");
  return loadSnapshot(getLoopndrollPaths());
}

export async function startLoopndroll() {
  return registerHooks();
}

export async function revealHooksFile() {
  const paths = getLoopndrollPaths();
  await ensureDirectory(paths.codexDirectoryPath);

  const child = spawn("open", ["-R", paths.codexHooksPath], {
    stdio: "ignore",
    detached: true,
  });

  child.unref();

  return {
    revealed: true,
    path: paths.codexHooksPath,
  };
}
