import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { LoopNotification, LoopPreset, LoopSession } from "@/lib/loopndroll";
import { useLoopndrollState } from "@/lib/use-loopndroll-state";
import { getSessionRef } from "./ui";

const EMPTY_SESSIONS: LoopSession[] = [];

function createSessionRefs(sessions: LoopSession[]) {
  return new Map(
    [...sessions]
      .sort((left, right) => left.firstSeenAt.localeCompare(right.firstSeenAt))
      .map((session, index) => [session.sessionId, getSessionRef(session, index + 1)]),
  );
}

function syncPendingSessionPresets(
  current: Record<string, LoopPreset>,
  displaySessions: LoopSession[],
) {
  const next: Record<string, LoopPreset> = {};

  for (const session of displaySessions) {
    next[session.sessionId] =
      current[session.sessionId] ?? session.preset ?? session.effectivePreset ?? "infinite";
  }

  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  return currentKeys.length === nextKeys.length &&
    nextKeys.every((key) => current[key] === next[key])
    ? current
    : next;
}

function usePendingSessionPresets(displaySessions: LoopSession[]) {
  const [pendingSessionPresets, setPendingSessionPresets] = useState<Record<string, LoopPreset>>(
    {},
  );

  useEffect(() => {
    setPendingSessionPresets((current) => syncPendingSessionPresets(current, displaySessions));
  }, [displaySessions]);

  return {
    pendingSessionPresets,
    setPendingSessionPresets,
  };
}

function useSessionClock() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return now;
}

function hasAttachedTelegramNotification(session: LoopSession, notifications: LoopNotification[]) {
  return session.notificationIds.some((notificationId) =>
    notifications.some(
      (notification) => notification.id === notificationId && notification.channel === "telegram",
    ),
  );
}

function showTelegramNotificationToast(session: LoopSession, sessionRefs: Map<string, string>) {
  const sessionRef = sessionRefs.get(session.sessionId) ?? "C0";
  toast.error(
    `[${sessionRef}] Attach a Telegram notification from the three-dot menu before using Await Reply.`,
  );
}

function showCompletionCheckConfigToast(
  context: "global" | LoopSession,
  sessionRefs: Map<string, string>,
) {
  if (context === "global") {
    toast.error("Select a registered Completion check first.");
    return;
  }

  const sessionRef = sessionRefs.get(context.sessionId) ?? "C0";
  toast.error(`[${sessionRef}] Select a registered Completion check first.`);
}

function createHomeRouteActions(args: {
  completionChecks: Array<{ id: string }>;
  notifications: LoopNotification[];
  pendingSessionPresets: Record<string, LoopPreset>;
  sessionRefs: Map<string, string>;
  setPendingSessionPresets: React.Dispatch<React.SetStateAction<Record<string, LoopPreset>>>;
  snapshot: ReturnType<typeof useLoopndrollState>["snapshot"];
  updateGlobalPreset: ReturnType<typeof useLoopndrollState>["updateGlobalPreset"];
  updateSessionNotifications: ReturnType<typeof useLoopndrollState>["updateSessionNotifications"];
  updateSessionPreset: ReturnType<typeof useLoopndrollState>["updateSessionPreset"];
}) {
  const hasConfiguredGlobalCompletionCheck = () =>
    args.completionChecks.some(
      (completionCheck) => completionCheck.id === args.snapshot?.globalCompletionCheckId,
    );

  return {
    hasConfiguredGlobalCompletionCheck,
    handleGlobalPresetToggle(preset: LoopPreset) {
      if (preset === "completion-checks" && !hasConfiguredGlobalCompletionCheck()) {
        showCompletionCheckConfigToast("global", args.sessionRefs);
        return;
      }

      const nextPreset = args.snapshot?.globalPreset === preset ? null : preset;
      void args.updateGlobalPreset(nextPreset);
    },
    async handleSessionPresetAction(session: LoopSession) {
      const pendingPreset =
        args.pendingSessionPresets[session.sessionId] ??
        session.preset ??
        session.effectivePreset ??
        "infinite";

      if (session.effectivePreset !== null) {
        await args.updateSessionPreset(session.sessionId, null);
        return;
      }

      if (
        pendingPreset === "await-reply" &&
        !hasAttachedTelegramNotification(session, args.notifications)
      ) {
        showTelegramNotificationToast(session, args.sessionRefs);
        return;
      }

      await args.updateSessionPreset(session.sessionId, pendingPreset);
    },
    handleSessionPresetSelection(session: LoopSession, nextPreset: LoopPreset) {
      if (
        nextPreset === "await-reply" &&
        !hasAttachedTelegramNotification(session, args.notifications)
      ) {
        showTelegramNotificationToast(session, args.sessionRefs);
        return;
      }

      args.setPendingSessionPresets((current) => ({
        ...current,
        [session.sessionId]: nextPreset,
      }));

      if (
        session.effectivePreset !== null &&
        ((session.presetSource === "session" && session.preset !== nextPreset) ||
          (session.presetSource !== "session" && session.effectivePreset !== nextPreset))
      ) {
        void args.updateSessionPreset(session.sessionId, nextPreset);
      }
    },
    async handleSessionNotificationToggle(
      session: LoopSession,
      notificationId: string,
      checked: boolean,
    ) {
      const nextNotificationIds = checked
        ? [...session.notificationIds, notificationId]
        : session.notificationIds.filter((id) => id !== notificationId);

      await args.updateSessionNotifications(session.sessionId, [...new Set(nextNotificationIds)]);
    },
    async handleSessionNotificationClear(sessionId: string) {
      await args.updateSessionNotifications(sessionId, []);
    },
    showSessionCompletionCheckConfigToast(session: LoopSession) {
      showCompletionCheckConfigToast(session, args.sessionRefs);
    },
  };
}

export function useHomeRouteModel() {
  const loopndrollState = useLoopndrollState();
  const sessions = loopndrollState.snapshot?.sessions ?? EMPTY_SESSIONS;
  const notifications = loopndrollState.snapshot?.notifications ?? [];
  const completionChecks = loopndrollState.snapshot?.completionChecks ?? [];
  const [showArchivedSessions, setShowArchivedSessions] = useState(false);
  const [openActionsSessionId, setOpenActionsSessionId] = useState<string | null>(null);
  const displaySessions = useMemo(
    () =>
      sessions.filter((session) => (showArchivedSessions ? session.archived : !session.archived)),
    [sessions, showArchivedSessions],
  );
  const sortedSessions = useMemo(
    () =>
      [...displaySessions].sort((left, right) => right.firstSeenAt.localeCompare(left.firstSeenAt)),
    [displaySessions],
  );
  const { pendingSessionPresets, setPendingSessionPresets } =
    usePendingSessionPresets(displaySessions);
  const now = useSessionClock();
  const visibleSessions = sessions;
  const sessionRefs = useMemo(() => createSessionRefs(visibleSessions), [visibleSessions]);
  const actions = createHomeRouteActions({
    completionChecks,
    notifications,
    pendingSessionPresets,
    sessionRefs,
    setPendingSessionPresets,
    snapshot: loopndrollState.snapshot,
    updateGlobalPreset: loopndrollState.updateGlobalPreset,
    updateSessionNotifications: loopndrollState.updateSessionNotifications,
    updateSessionPreset: loopndrollState.updateSessionPreset,
  });

  return {
    ...loopndrollState,
    completionChecks,
    notifications,
    now,
    openActionsSessionId,
    pendingSessionPresets,
    sessionRefs,
    showArchivedSessions,
    sortedSessions,
    displaySessions,
    setOpenActionsSessionId,
    setPendingSessionPresets,
    toggleArchivedSessions() {
      setShowArchivedSessions((current) => !current);
      setOpenActionsSessionId(null);
    },
    ...actions,
  };
}
