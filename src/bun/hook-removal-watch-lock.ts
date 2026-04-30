import { open, readFile, unlink } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import type { HookRemovalWatcherStatus } from "../shared/app-rpc";
import type { LoopndrollPaths } from "./loopndroll-core";
import { ensureDirectory, nowIsoString } from "./loopndroll-core";

export type HookRemovalWatchLock = {
  pid: number;
  started_at: string;
  repo_root: string;
  hooks_path: string;
  runtime_state_path: string;
};

export type HookRemovalWatchLockAcquireResult =
  | { status: "acquired"; lock: HookRemovalWatchLock; message: string }
  | { status: "already-running"; lock: HookRemovalWatchLock; message: string }
  | {
      status: "replaced-stale";
      lock: HookRemovalWatchLock;
      previousLock: HookRemovalWatchLock | null;
      message: string;
    };

function isErrno(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === code
  );
}

function createHookRemovalWatchLock(paths: LoopndrollPaths, repoRoot: string) {
  return {
    pid: process.pid,
    started_at: nowIsoString(),
    repo_root: repoRoot,
    hooks_path: paths.codexHooksPath,
    runtime_state_path: paths.databasePath,
  } satisfies HookRemovalWatchLock;
}

export function isProcessAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isErrno(error, "ESRCH");
  }
}

function parseHookRemovalWatchLock(raw: string | null): HookRemovalWatchLock | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<HookRemovalWatchLock>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.started_at !== "string" ||
      typeof parsed.repo_root !== "string" ||
      typeof parsed.hooks_path !== "string" ||
      typeof parsed.runtime_state_path !== "string"
    ) {
      return null;
    }

    return {
      pid: parsed.pid,
      started_at: parsed.started_at,
      repo_root: parsed.repo_root,
      hooks_path: parsed.hooks_path,
      runtime_state_path: parsed.runtime_state_path,
    };
  } catch {
    return null;
  }
}

async function readHookRemovalWatchLock(lockPath: string) {
  return parseHookRemovalWatchLock(await readFile(lockPath, "utf8").catch(() => null));
}

async function writeHookRemovalWatchLockAtomically(lockPath: string, lock: HookRemovalWatchLock) {
  const handle = await open(lockPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
}

export async function acquireHookRemovalWatchLock(
  paths: LoopndrollPaths,
  repoRoot = process.cwd(),
): Promise<HookRemovalWatchLockAcquireResult> {
  await ensureDirectory(paths.stateDirectoryPath);
  let staleLock: HookRemovalWatchLock | null = null;

  for (;;) {
    const lock = createHookRemovalWatchLock(paths, repoRoot);
    try {
      await writeHookRemovalWatchLockAtomically(paths.hookRemovalWatchLockPath, lock);
      return staleLock
        ? {
            status: "replaced-stale",
            lock,
            previousLock: staleLock,
            message: "stale watcher lock replaced",
          }
        : { status: "acquired", lock, message: "watcher lock acquired" };
    } catch (error) {
      if (!isErrno(error, "EEXIST")) {
        throw error;
      }
    }

    const existingLock = await readHookRemovalWatchLock(paths.hookRemovalWatchLockPath);
    if (existingLock && isProcessAlive(existingLock.pid)) {
      return {
        status: "already-running",
        lock: existingLock,
        message: "watcher already running",
      };
    }

    staleLock = existingLock;
    await unlink(paths.hookRemovalWatchLockPath).catch((error) => {
      if (!isErrno(error, "ENOENT")) {
        throw error;
      }
    });
  }
}

export async function releaseHookRemovalWatchLock(paths: LoopndrollPaths, pid = process.pid) {
  const lock = await readHookRemovalWatchLock(paths.hookRemovalWatchLockPath);
  if (!lock || lock.pid !== pid) {
    return false;
  }

  await unlink(paths.hookRemovalWatchLockPath).catch((error) => {
    if (!isErrno(error, "ENOENT")) {
      throw error;
    }
  });
  return true;
}

export function releaseHookRemovalWatchLockSync(paths: LoopndrollPaths, pid = process.pid) {
  const lock = parseHookRemovalWatchLock(
    (() => {
      try {
        return readFileSync(paths.hookRemovalWatchLockPath, "utf8");
      } catch {
        return null;
      }
    })(),
  );
  if (!lock || lock.pid !== pid) {
    return false;
  }

  try {
    unlinkSync(paths.hookRemovalWatchLockPath);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return true;
    }
    return false;
  }
}

export async function getHookRemovalWatcherStatus(
  paths: LoopndrollPaths,
): Promise<HookRemovalWatcherStatus> {
  const lock = await readHookRemovalWatchLock(paths.hookRemovalWatchLockPath);
  const active = lock ? isProcessAlive(lock.pid) : false;

  return {
    active,
    pid: lock?.pid ?? null,
    lockPath: paths.hookRemovalWatchLockPath,
    startedAt: lock?.started_at ?? null,
    repoRoot: lock?.repo_root ?? null,
    hooksPath: lock?.hooks_path ?? null,
    runtimeStatePath: lock?.runtime_state_path ?? null,
    message: active ? `watcher active: pid ${lock?.pid}` : "watcher not running",
  };
}
