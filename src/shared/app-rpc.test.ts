import type { LoopSession } from "./app-rpc";

const canonicalThreadSession = {
  threadId: "thr_123",
  sessionId: "thr_123",
  sessionRef: "C1",
  source: "startup",
  cwd: "/tmp/project",
  notificationIds: [],
  archived: false,
  firstSeenAt: "2026-04-22T00:00:00.000Z",
  lastSeenAt: "2026-04-22T00:00:00.000Z",
  activeSince: null,
  stopCount: 0,
  preset: null,
  presetSource: "off",
  effectivePreset: null,
  completionCheckId: null,
  completionCheckWaitForReply: false,
  effectiveCompletionCheckId: null,
  effectiveCompletionCheckWaitForReply: false,
  threadName: "Fix hook lifecycle",
  title: "Fix hook lifecycle",
  transcriptPath: null,
  lastAssistantMessage: null,
} satisfies LoopSession;

const canonicalThreadId: string = canonicalThreadSession.threadId;
const canonicalThreadName: string | null = canonicalThreadSession.threadName;

void [canonicalThreadId, canonicalThreadName];
