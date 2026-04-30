import { useEffect, useState } from "react";
import type {
  CreateLoopNotificationInput,
  LoopPreset,
  LoopScope,
  LoopndrollSnapshot,
  UpdateLoopNotificationInput,
} from "./loopndroll";
import {
  clearHooks,
  createCompletionCheck,
  createNotification,
  deleteCompletionCheck,
  deleteNotification,
  deleteSession,
  ensureLoopndrollSetup,
  getLoopndrollState,
  migrateNotificationSecretsToKeychain,
  pauseLoopndroll,
  registerHooks,
  resumeLoopndroll,
  saveDefaultPrompt,
  setGlobalCompletionCheckConfig,
  setGlobalNotification,
  setGlobalPreset,
  setMirrorEnabled,
  setSessionArchived,
  setSessionNotifications,
  setLoopScope,
  setSessionCompletionCheckConfig,
  setSessionPreset,
  startLoopndroll,
  stopLoopndroll,
  updateCompletionCheck,
  updateNotification,
} from "./loopndroll";

type UseLoopndrollStateResult = {
  snapshot: LoopndrollSnapshot | null;
  isLoading: boolean;
  errorMessage: string | null;
  savePrompt: (defaultPrompt: string) => Promise<void>;
  addNotification: (notification: CreateLoopNotificationInput) => Promise<void>;
  addCompletionCheck: (completionCheck: { label?: string; commands: string[] }) => Promise<void>;
  editNotification: (notification: UpdateLoopNotificationInput) => Promise<void>;
  editCompletionCheck: (completionCheck: {
    id: string;
    label?: string;
    commands: string[];
  }) => Promise<void>;
  removeNotification: (notificationId: string) => Promise<void>;
  removeCompletionCheck: (completionCheckId: string) => Promise<void>;
  migrateSecrets: () => Promise<void>;
  updateScope: (scope: LoopScope) => Promise<void>;
  updateGlobalPreset: (preset: LoopPreset | null) => Promise<void>;
  updateGlobalNotification: (notificationId: string | null) => Promise<void>;
  updateGlobalCompletionCheckConfig: (
    completionCheckId: string | null,
    waitForReplyAfterCompletion: boolean,
  ) => Promise<void>;
  updateMirrorEnabled: (enabled: boolean) => Promise<void>;
  updateSessionNotifications: (sessionId: string, notificationIds: string[]) => Promise<void>;
  updateSessionPreset: (sessionId: string, preset: LoopPreset | null) => Promise<void>;
  updateSessionCompletionCheckConfig: (
    sessionId: string,
    completionCheckId: string | null,
    waitForReplyAfterCompletion: boolean,
  ) => Promise<void>;
  updateSessionArchived: (sessionId: string, archived: boolean) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
  installHooks: () => Promise<void>;
  uninstallHooks: () => Promise<void>;
  pauseLoopndroll: () => Promise<void>;
  resumeLoopndroll: () => Promise<void>;
  startLoopndroll: () => Promise<void>;
  stopLoopndroll: () => Promise<void>;
  refresh: () => Promise<void>;
};

const LOOPNDROLL_POLL_INTERVAL_MS = 2000;

function useLoopndrollSnapshotState() {
  const [snapshot, setSnapshot] = useState<LoopndrollSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const nextSnapshot = await ensureLoopndrollSetup();
        if (!cancelled && nextSnapshot) {
          setSnapshot(nextSnapshot);
          setErrorMessage(null);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load Loopndroll.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void hydrate();

    const intervalId = window.setInterval(() => {
      void getLoopndrollState()
        .then((nextSnapshot) => {
          if (!cancelled && nextSnapshot) {
            setSnapshot(nextSnapshot);
            setErrorMessage(null);
          }
        })
        .catch(() => {
          // Polling should not replace the last good state with a transient error.
        });
    }, LOOPNDROLL_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  return {
    errorMessage,
    isLoading,
    setErrorMessage,
    setSnapshot,
    snapshot,
  };
}

async function runLoopndrollMutation(
  action: () => Promise<LoopndrollSnapshot | undefined>,
  setErrorMessage: (message: string | null) => void,
  setSnapshot: (snapshot: LoopndrollSnapshot) => void,
) {
  setErrorMessage(null);

  try {
    const nextSnapshot = await action();
    if (nextSnapshot) {
      setSnapshot(nextSnapshot);
    }
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : "Loopndroll update failed.");
    throw error;
  }
}

function createLoopndrollActions(
  runMutation: (action: () => Promise<LoopndrollSnapshot | undefined>) => Promise<void>,
) {
  return {
    savePrompt(defaultPrompt: string) {
      return runMutation(() => saveDefaultPrompt(defaultPrompt));
    },
    addNotification(notification: CreateLoopNotificationInput) {
      return runMutation(() => createNotification(notification));
    },
    addCompletionCheck(completionCheck: { label?: string; commands: string[] }) {
      return runMutation(() => createCompletionCheck(completionCheck));
    },
    editNotification(notification: UpdateLoopNotificationInput) {
      return runMutation(() => updateNotification(notification));
    },
    editCompletionCheck(completionCheck: { id: string; label?: string; commands: string[] }) {
      return runMutation(() => updateCompletionCheck(completionCheck));
    },
    removeNotification(notificationId: string) {
      return runMutation(() => deleteNotification(notificationId));
    },
    removeCompletionCheck(completionCheckId: string) {
      return runMutation(() => deleteCompletionCheck(completionCheckId));
    },
    migrateSecrets() {
      return runMutation(() => migrateNotificationSecretsToKeychain());
    },
    updateScope(scope: LoopScope) {
      return runMutation(() => setLoopScope(scope));
    },
    updateGlobalPreset(preset: LoopPreset | null) {
      return runMutation(() => setGlobalPreset(preset));
    },
    updateGlobalNotification(notificationId: string | null) {
      return runMutation(() => setGlobalNotification(notificationId));
    },
    updateGlobalCompletionCheckConfig(
      completionCheckId: string | null,
      waitForReplyAfterCompletion: boolean,
    ) {
      return runMutation(() =>
        setGlobalCompletionCheckConfig(completionCheckId, waitForReplyAfterCompletion),
      );
    },
    updateMirrorEnabled(enabled: boolean) {
      return runMutation(() => setMirrorEnabled(enabled));
    },
    updateSessionNotifications(sessionId: string, notificationIds: string[]) {
      return runMutation(() => setSessionNotifications(sessionId, notificationIds));
    },
    updateSessionPreset(sessionId: string, preset: LoopPreset | null) {
      return runMutation(() => setSessionPreset(sessionId, preset));
    },
    updateSessionCompletionCheckConfig(
      sessionId: string,
      completionCheckId: string | null,
      waitForReplyAfterCompletion: boolean,
    ) {
      return runMutation(() =>
        setSessionCompletionCheckConfig(sessionId, completionCheckId, waitForReplyAfterCompletion),
      );
    },
    updateSessionArchived(sessionId: string, archived: boolean) {
      return runMutation(() => setSessionArchived(sessionId, archived));
    },
    removeSession(sessionId: string) {
      return runMutation(() => deleteSession(sessionId));
    },
    installHooks() {
      return runMutation(() => registerHooks());
    },
    uninstallHooks() {
      return runMutation(() => clearHooks());
    },
    pauseLoopndroll() {
      return runMutation(() => pauseLoopndroll());
    },
    resumeLoopndroll() {
      return runMutation(() => resumeLoopndroll());
    },
    startLoopndroll() {
      return runMutation(() => startLoopndroll());
    },
    stopLoopndroll() {
      return runMutation(() => stopLoopndroll());
    },
    refresh() {
      return runMutation(() => getLoopndrollState());
    },
  } satisfies Omit<UseLoopndrollStateResult, "snapshot" | "isLoading" | "errorMessage">;
}

export function useLoopndrollState(): UseLoopndrollStateResult {
  const { snapshot, isLoading, errorMessage, setErrorMessage, setSnapshot } =
    useLoopndrollSnapshotState();

  const runMutation = (action: () => Promise<LoopndrollSnapshot | undefined>) =>
    runLoopndrollMutation(action, setErrorMessage, setSnapshot);

  return {
    snapshot,
    isLoading,
    errorMessage,
    ...createLoopndrollActions(runMutation),
  };
}
