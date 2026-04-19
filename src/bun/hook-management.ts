import { spawn } from "node:child_process";
import { chmod, copyFile, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { eq } from "drizzle-orm";
import type { LoopndrollSnapshot } from "../shared/app-rpc";
import { getLoopndrollDatabase } from "./db/client";
import { settings } from "./db/schema";
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
  readSnapshotFromDatabase,
} from "./loopndroll-core";

async function loadHooksDocument(paths: LoopndrollPaths) {
  try {
    const raw = await readFile(paths.codexHooksPath, "utf8");
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

    const backupPath = `${paths.codexHooksPath}.corrupt.${Date.now()}`;
    try {
      await copyFile(paths.codexHooksPath, backupPath);
    } catch {
      // Ignore backup failures and continue with a clean hooks file.
    }

    return { hooks: {} };
  }
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
  if (process.platform === "win32") {
    return `"${path.replaceAll('"', '""')}"`;
  }

  return `'${path.replaceAll("'", `'\\''`)}'`;
}

function buildWindowsManagedHookLauncher(paths: LoopndrollPaths) {
  return [
    "@echo off",
    "setlocal",
    `bun "%~dp0${basename(paths.managedHookScriptPath)}" %*`,
    "",
  ].join("\r\n");
}

function isManagedHookCommand(command: string | undefined) {
  return typeof command === "string" && command.includes(MANAGED_HOOK_MARKER);
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
  const existingContent = await readFile(paths.managedHookScriptPath, "utf8").catch(() => null);
  if (existingContent && !existingContent.includes(MANAGED_HOOK_SCRIPT_MARKER)) {
    const backupPath = `${paths.managedHookScriptPath}.bak.${Date.now()}`;
    await copyFile(paths.managedHookScriptPath, backupPath);
  }

  await writeFile(paths.managedHookScriptPath, buildManagedHookScript(paths), "utf8");

  if (process.platform === "win32") {
    await writeFile(paths.managedHookPath, buildWindowsManagedHookLauncher(paths), "utf8");
    return;
  }

  await chmod(paths.managedHookScriptPath, 0o755);
}

async function computeHealth(paths: LoopndrollPaths) {
  const issues: string[] = [];
  const configContents = await readFile(paths.codexConfigPath, "utf8").catch(() => null);
  const hooksDocument = await loadHooksDocument(paths);
  const commandExists = await stat(paths.managedHookPath)
    .then(() => true)
    .catch(() => false);
  const scriptExists =
    paths.managedHookScriptPath === paths.managedHookPath
      ? commandExists
      : await stat(paths.managedHookScriptPath)
          .then(() => true)
          .catch(() => false);
  const hookEvents = hooksDocument.hooks ?? {};
  const hasManagedSessionStart = (hookEvents.SessionStart ?? []).some((group) =>
    (group.hooks ?? []).some((hook) => isManagedHookCommand(hook.command)),
  );
  const hasManagedStop = (hookEvents.Stop ?? []).some((group) =>
    (group.hooks ?? []).some((hook) => isManagedHookCommand(hook.command)),
  );
  const hasManagedUserPromptSubmit = (hookEvents.UserPromptSubmit ?? []).some((group) =>
    (group.hooks ?? []).some((hook) => isManagedHookCommand(hook.command)),
  );

  if (!configContents || !/\bcodex_hooks\s*=\s*true\b/.test(configContents)) {
    issues.push("Codex hooks are not enabled in ~/.codex/config.toml.");
  }
  if (!hasManagedSessionStart) {
    issues.push("Managed SessionStart hook is not registered.");
  }
  if (!hasManagedStop) {
    issues.push("Managed Stop hook is not registered.");
  }
  if (!hasManagedUserPromptSubmit) {
    issues.push("Managed UserPromptSubmit hook is not registered.");
  }
  if (!commandExists) {
    issues.push("Managed hook launcher is missing.");
  }
  if (!scriptExists) {
    issues.push("Managed hook script is missing.");
  }

  return {
    registered: issues.length === 0,
    issues,
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

export async function loadSnapshot(paths: LoopndrollPaths) {
  getLoopndrollDatabase(paths.databasePath);
  const baseSnapshot = readSnapshotFromDatabase();
  const health = await computeHealth(paths);

  return {
    ...baseSnapshot,
    health,
  } satisfies LoopndrollSnapshot;
}

export async function ensureLoopndrollSetup() {
  const paths = getLoopndrollPaths();
  getLoopndrollDatabase(paths.databasePath);

  if (getSettingsRow().hooksAutoRegistration) {
    await ensureRegistered(paths);
  }

  return loadSnapshot(paths);
}

export async function getLoopndrollSnapshot() {
  const paths = getLoopndrollPaths();
  return loadSnapshot(paths);
}

export async function registerHooks() {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  await ensureRegistered(paths);
  db.update(settings).set({ hooksAutoRegistration: true }).where(eq(settings.id, 1)).run();

  return loadSnapshot(paths);
}

export async function clearHooks() {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);
  const hooksDocument = await loadHooksDocument(paths);

  removeManagedHooks(hooksDocument);
  await writeFile(paths.codexHooksPath, `${JSON.stringify(hooksDocument, null, 2)}\n`, "utf8");
  db.update(settings).set({ hooksAutoRegistration: false }).where(eq(settings.id, 1)).run();

  await appendHookDebugLog(paths, {
    type: "setup",
    action: "clear-hooks",
    hooksFilePath: paths.codexHooksPath,
  });

  return loadSnapshot(paths);
}

export async function revealHooksFile() {
  const paths = getLoopndrollPaths();
  await ensureDirectory(paths.codexDirectoryPath);

  const revealCommand =
    process.platform === "win32"
      ? {
          command: "explorer.exe",
          args: [`/select,${paths.codexHooksPath.replaceAll("/", "\\")}`],
        }
      : process.platform === "darwin"
        ? {
            command: "open",
            args: ["-R", paths.codexHooksPath],
          }
        : {
            command: "xdg-open",
            args: [dirname(paths.codexHooksPath)],
          };

  const child = spawn(revealCommand.command, revealCommand.args, {
    stdio: "ignore",
    detached: true,
  });

  child.unref();

  return {
    revealed: true,
    path: paths.codexHooksPath,
  };
}
