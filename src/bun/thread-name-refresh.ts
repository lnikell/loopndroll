import { readFile } from "node:fs/promises";
import type { Database } from "bun:sqlite";
import type { LoopSession } from "../shared/app-rpc";
import {
  createSpawnedCodexAppServerTransport,
  listThreadsForCwdViaCodexAppServer,
  type CanonicalThreadDiscoveryRecord,
} from "./codex-app-server-client";
import {
  looksInternalThreadNameArtifact,
  looksStaleStoredThreadName,
} from "./thread-name-artifact";
import { deriveThreadNameFromTranscript } from "./thread-name-transcript";

type ThreadNameRefreshCandidate = Pick<
  LoopSession,
  "threadId" | "cwd" | "threadName" | "transcriptPath"
>;

type ThreadNameRefreshUpdate = {
  threadId: string;
  threadName: string;
};

type ThreadOrphanRefreshCandidate = ThreadNameRefreshCandidate & {
  orphanedRefreshMissCount: number;
};

type ThreadOrphanAction =
  | {
      type: "reset";
      threadId: string;
    }
  | {
      type: "increment";
      threadId: string;
      nextMissCount: number;
    }
  | {
      type: "delete";
      threadId: string;
    };

export type ThreadNameRefreshResult = {
  refreshedCount: number;
  orphanedMissCountUpdated: number;
  prunedCount: number;
  resetCount: number;
};

export const ORPHANED_THREAD_PRUNE_RELAUNCH_LIMIT = 3;

function normalizeThreadName(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCwd(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function readTranscriptSessionMetaCwd(transcriptPath: string | null | undefined) {
  const normalizedTranscriptPath = normalizeCwd(transcriptPath);
  if (normalizedTranscriptPath === null) {
    return null;
  }

  try {
    const raw = await readFile(normalizedTranscriptPath, "utf8");
    const firstLine = raw.split("\n", 1)[0]?.trim();
    if (!firstLine) {
      return null;
    }

    const parsed = JSON.parse(firstLine) as {
      type?: string;
      payload?: { cwd?: string | null };
    };
    if (parsed.type !== "session_meta") {
      return null;
    }

    return normalizeCwd(parsed.payload?.cwd);
  } catch {
    return null;
  }
}

async function collectDiscoveryCwds(candidates: ThreadNameRefreshCandidate[]) {
  const discoveryCwds = new Set<string>();

  for (const candidate of candidates) {
    const storedCwd = normalizeCwd(candidate.cwd);
    if (storedCwd !== null) {
      discoveryCwds.add(storedCwd);
    }

    const transcriptCwd = await readTranscriptSessionMetaCwd(candidate.transcriptPath);
    if (transcriptCwd !== null) {
      discoveryCwds.add(transcriptCwd);
    }
  }

  return [...discoveryCwds];
}

export function collectCanonicalThreadNameUpdates(
  candidates: ThreadNameRefreshCandidate[],
  discoveredThreads: CanonicalThreadDiscoveryRecord[],
) {
  const discoveredByThreadId = new Map(
    discoveredThreads.map((thread) => [thread.threadId, normalizeThreadName(thread.threadName)]),
  );

  const updates: ThreadNameRefreshUpdate[] = [];

  for (const candidate of candidates) {
    const nextThreadName = discoveredByThreadId.get(candidate.threadId) ?? null;
    const currentThreadName = normalizeThreadName(candidate.threadName);

    if (nextThreadName === null || nextThreadName === currentThreadName) {
      continue;
    }

    updates.push({
      threadId: candidate.threadId,
      threadName: nextThreadName,
    });
  }

  return updates;
}

async function collectTranscriptThreadNameUpdates(
  candidates: ThreadNameRefreshCandidate[],
  canonicalUpdates: ThreadNameRefreshUpdate[],
) {
  const canonicalUpdatedThreadIds = new Set(canonicalUpdates.map((update) => update.threadId));
  const updates: ThreadNameRefreshUpdate[] = [];

  for (const candidate of candidates) {
    if (canonicalUpdatedThreadIds.has(candidate.threadId)) {
      continue;
    }

    if (!looksStaleStoredThreadName(candidate.threadName)) {
      continue;
    }

    const derivedThreadName = await deriveThreadNameFromTranscript(candidate.transcriptPath);
    const currentThreadName = normalizeThreadName(candidate.threadName);

    if (derivedThreadName === null || derivedThreadName === currentThreadName) {
      continue;
    }

    updates.push({
      threadId: candidate.threadId,
      threadName: derivedThreadName,
    });
  }

  return updates;
}

function getEffectiveThreadName(
  candidate: Pick<ThreadNameRefreshCandidate, "threadId" | "threadName">,
  updates: ThreadNameRefreshUpdate[],
) {
  const matchingUpdate = updates.find((update) => update.threadId === candidate.threadId);
  return matchingUpdate?.threadName ?? candidate.threadName;
}

export function collectOrphanedThreadArtifactActions(
  candidates: ThreadOrphanRefreshCandidate[],
  discoveredThreads: CanonicalThreadDiscoveryRecord[],
  updates: ThreadNameRefreshUpdate[],
  pruneRelaunchLimit = ORPHANED_THREAD_PRUNE_RELAUNCH_LIMIT,
) {
  const discoveredThreadIds = new Set(discoveredThreads.map((thread) => thread.threadId));
  const actions: ThreadOrphanAction[] = [];

  for (const candidate of candidates) {
    const effectiveThreadName = getEffectiveThreadName(candidate, updates);
    const canVerifyCanonicalAbsence = normalizeCwd(candidate.cwd) !== null;
    const looksLikeHiddenArtifact = looksInternalThreadNameArtifact(effectiveThreadName);
    const isMissingCanonically = !discoveredThreadIds.has(candidate.threadId);
    const shouldCountAsOrphanedArtifact =
      canVerifyCanonicalAbsence && looksLikeHiddenArtifact && isMissingCanonically;

    if (shouldCountAsOrphanedArtifact) {
      const nextMissCount = candidate.orphanedRefreshMissCount + 1;
      actions.push(
        nextMissCount >= pruneRelaunchLimit
          ? { type: "delete", threadId: candidate.threadId }
          : {
              type: "increment",
              threadId: candidate.threadId,
              nextMissCount,
            },
      );
      continue;
    }

    if (candidate.orphanedRefreshMissCount > 0) {
      actions.push({
        type: "reset",
        threadId: candidate.threadId,
      });
    }
  }

  return actions;
}

export async function refreshCanonicalThreadNames(
  db: Database,
  listThreadsForCwd = async (cwd: string) => {
    const transport = await createSpawnedCodexAppServerTransport();
    try {
      return await listThreadsForCwdViaCodexAppServer(transport, cwd);
    } finally {
      await transport.close();
    }
  },
) {
  const candidates = db
    .query(
      `select
      thread_id as threadId,
      cwd,
      thread_name as threadName,
      orphaned_refresh_miss_count as orphanedRefreshMissCount,
      transcript_path as transcriptPath
    from sessions`,
    )
    .all() as ThreadOrphanRefreshCandidate[];

  const discoveryCwds = await collectDiscoveryCwds(candidates);
  const discoveredThreads: CanonicalThreadDiscoveryRecord[] = [];

  for (const cwd of discoveryCwds) {
    discoveredThreads.push(...(await listThreadsForCwd(cwd)));
  }

  const canonicalUpdates = collectCanonicalThreadNameUpdates(candidates, discoveredThreads);
  const transcriptUpdates = await collectTranscriptThreadNameUpdates(candidates, canonicalUpdates);
  const updates = [...canonicalUpdates, ...transcriptUpdates];
  const orphanActions = collectOrphanedThreadArtifactActions(
    candidates,
    discoveredThreads,
    updates,
  );

  for (const update of updates) {
    db.query("update sessions set thread_name = ? where thread_id = ?").run(
      update.threadName,
      update.threadId,
    );
  }

  let orphanedMissCountUpdated = 0;
  let prunedCount = 0;
  let resetCount = 0;

  for (const action of orphanActions) {
    if (action.type === "delete") {
      db.query("delete from sessions where thread_id = ?").run(action.threadId);
      prunedCount += 1;
      continue;
    }

    db.query("update sessions set orphaned_refresh_miss_count = ? where thread_id = ?").run(
      action.type === "increment" ? action.nextMissCount : 0,
      action.threadId,
    );

    if (action.type === "increment") {
      orphanedMissCountUpdated += 1;
    } else {
      resetCount += 1;
    }
  }

  return {
    refreshedCount: updates.length,
    orphanedMissCountUpdated,
    prunedCount,
    resetCount,
  } satisfies ThreadNameRefreshResult;
}
