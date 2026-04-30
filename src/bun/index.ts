import {
  ApplicationMenu,
  BrowserWindow,
  Utils,
  Updater,
  defineElectrobunRPC,
  type UpdateStatusEntry,
} from "electrobun/bun";
import type {
  AppRpcSchema,
  AppUpdateState,
  WindowControlAction,
  WindowControlsState,
} from "../shared/app-rpc";
import {
  clearHooks,
  createCompletionCheck,
  createLoopNotification,
  clearStartupRecoveryMarker,
  deleteCompletionCheck,
  deleteLoopNotification,
  ensureLoopndrollSetup,
  getTelegramChats as fetchTelegramChats,
  getLoopndrollSnapshot,
  migrateNotificationSecretsToKeychain,
  pauseLoopndroll,
  registerHooks,
  revealHooksFile,
  resetActiveLoopStateOnStartup,
  resumeLoopndroll,
  saveDefaultPrompt,
  deleteSession,
  setGlobalCompletionCheckConfig,
  setGlobalNotification,
  setGlobalPreset,
  setMirrorEnabled,
  setSessionArchived as persistSessionArchived,
  setSessionCompletionCheckConfig,
  setSessionNotifications as persistSessionNotifications,
  setLoopScope,
  setSessionPreset,
  startLoopndroll,
  startHookRemovalPendingMonitor,
  startLoopndrollTelegramBridge,
  stopLoopndroll,
  updateCompletionCheck,
  updateLoopNotification,
} from "./loopndroll";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const DEV_SERVER_WAIT_MS = 15000;
const DEV_SERVER_RETRY_MS = 250;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDevServer() {
  const deadline = Date.now() + DEV_SERVER_WAIT_MS;

  while (Date.now() < deadline) {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      return true;
    } catch {
      await sleep(DEV_SERVER_RETRY_MS);
    }
  }

  return false;
}

async function getRendererUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();

  if (channel === "dev") {
    if (await waitForDevServer()) {
      console.log(`Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    }

    console.log("Vite dev server was not reachable in time. Falling back to bundled renderer.");
  }

  return "views://app/index.html";
}

const isMac = process.platform === "darwin";
const APP_UPDATE_CHECK_DELAY_MS = 5000;
const APP_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

let mainWindow: BrowserWindow<ReturnType<typeof createWindowRpc>>;
let updateCheckPromise: Promise<AppUpdateState> | null = null;
let updateDownloadPromise: Promise<void> | null = null;

let appUpdateState: AppUpdateState = {
  currentVersion: null,
  currentChannel: null,
  releaseBaseUrl: null,
  availableVersion: null,
  stage: "idle",
  isConfigured: false,
  isChecking: false,
  isDownloading: false,
  isUpdateAvailable: false,
  isUpdateReady: false,
  statusMessage: null,
  errorMessage: null,
  lastCheckedAt: null,
};

function getCurrentTimestamp() {
  return new Date().toISOString();
}

function setAppUpdateState(nextState: Partial<AppUpdateState>) {
  appUpdateState = {
    ...appUpdateState,
    ...nextState,
  };

  return appUpdateState;
}

async function syncLocalUpdateState() {
  const [currentVersion, currentChannel, releaseBaseUrl] = await Promise.all([
    Updater.localInfo.version(),
    Updater.localInfo.channel(),
    Updater.localInfo.baseUrl(),
  ]);
  const normalizedBaseUrl = releaseBaseUrl.trim();

  return setAppUpdateState({
    currentVersion,
    currentChannel,
    releaseBaseUrl: normalizedBaseUrl || null,
    isConfigured: normalizedBaseUrl.length > 0,
  });
}

function applyUpdaterStatus(entry: UpdateStatusEntry) {
  switch (entry.status) {
    case "checking":
      setAppUpdateState({
        stage: "checking",
        isChecking: true,
        errorMessage: null,
        statusMessage: entry.message,
      });
      return;
    case "no-update":
      setAppUpdateState({
        stage: "idle",
        availableVersion: null,
        isChecking: false,
        isDownloading: false,
        isUpdateAvailable: false,
        isUpdateReady: false,
        errorMessage: null,
        statusMessage: null,
        lastCheckedAt: getCurrentTimestamp(),
      });
      return;
    case "update-available":
      setAppUpdateState({
        stage: "available",
        isChecking: false,
        isDownloading: false,
        isUpdateAvailable: true,
        isUpdateReady: false,
        errorMessage: null,
        statusMessage: entry.message,
        lastCheckedAt: getCurrentTimestamp(),
      });
      return;
    case "download-starting":
    case "checking-local-tar":
    case "local-tar-found":
    case "local-tar-missing":
    case "fetching-patch":
    case "patch-found":
    case "patch-not-found":
    case "downloading-patch":
    case "applying-patch":
    case "patch-applied":
    case "extracting-version":
    case "patch-chain-complete":
    case "downloading-full-bundle":
    case "download-progress":
    case "decompressing":
      setAppUpdateState({
        stage: "downloading",
        isChecking: false,
        isDownloading: true,
        isUpdateAvailable: true,
        errorMessage: null,
        statusMessage: entry.message,
      });
      return;
    case "download-complete":
      setAppUpdateState({
        stage: "ready",
        isChecking: false,
        isDownloading: false,
        isUpdateAvailable: true,
        isUpdateReady: true,
        errorMessage: null,
        statusMessage: "Update ready to install.",
        lastCheckedAt: getCurrentTimestamp(),
      });
      return;
    case "applying":
    case "extracting":
    case "replacing-app":
    case "launching-new-version":
    case "complete":
      setAppUpdateState({
        stage: "ready",
        isChecking: false,
        isDownloading: false,
        isUpdateAvailable: true,
        isUpdateReady: true,
        errorMessage: null,
        statusMessage: entry.message,
      });
      return;
    case "error":
      setAppUpdateState({
        stage: appUpdateState.isUpdateAvailable ? "available" : "error",
        isChecking: false,
        isDownloading: false,
        errorMessage: entry.message,
        statusMessage: entry.message,
        lastCheckedAt: getCurrentTimestamp(),
      });
      return;
    default:
      return;
  }
}

async function checkForAppUpdate() {
  await syncLocalUpdateState();

  if (!appUpdateState.isConfigured || appUpdateState.currentChannel === "dev") {
    return setAppUpdateState({
      stage: "idle",
      availableVersion: null,
      isChecking: false,
      isDownloading: false,
      isUpdateAvailable: false,
      isUpdateReady: false,
      statusMessage: null,
      errorMessage: null,
    });
  }

  if (updateCheckPromise) {
    return updateCheckPromise;
  }

  updateCheckPromise = (async () => {
    setAppUpdateState({
      stage: "checking",
      isChecking: true,
      errorMessage: null,
      statusMessage: "Checking for updates...",
    });

    try {
      const updateInfo = await Updater.checkForUpdate();

      if (updateInfo.error) {
        return setAppUpdateState({
          stage: appUpdateState.isUpdateAvailable ? "available" : "error",
          availableVersion: null,
          isChecking: false,
          isDownloading: false,
          isUpdateAvailable: false,
          isUpdateReady: false,
          statusMessage: updateInfo.error,
          errorMessage: updateInfo.error,
          lastCheckedAt: getCurrentTimestamp(),
        });
      }

      if (updateInfo.updateReady) {
        return setAppUpdateState({
          stage: "ready",
          availableVersion: updateInfo.version || null,
          isChecking: false,
          isDownloading: false,
          isUpdateAvailable: true,
          isUpdateReady: true,
          errorMessage: null,
          statusMessage: "Update ready to install.",
          lastCheckedAt: getCurrentTimestamp(),
        });
      }

      if (updateInfo.updateAvailable) {
        return setAppUpdateState({
          stage: "available",
          availableVersion: updateInfo.version || null,
          isChecking: false,
          isDownloading: false,
          isUpdateAvailable: true,
          isUpdateReady: false,
          errorMessage: null,
          statusMessage: "Update available.",
          lastCheckedAt: getCurrentTimestamp(),
        });
      }

      return setAppUpdateState({
        stage: "idle",
        availableVersion: null,
        isChecking: false,
        isDownloading: false,
        isUpdateAvailable: false,
        isUpdateReady: false,
        errorMessage: null,
        statusMessage: null,
        lastCheckedAt: getCurrentTimestamp(),
      });
    } catch (error) {
      return setAppUpdateState({
        stage: appUpdateState.isUpdateAvailable ? "available" : "error",
        isChecking: false,
        errorMessage: error instanceof Error ? error.message : "Failed to check for updates.",
        statusMessage: error instanceof Error ? error.message : "Failed to check for updates.",
        lastCheckedAt: getCurrentTimestamp(),
      });
    } finally {
      updateCheckPromise = null;
    }
  })();

  return updateCheckPromise;
}

async function downloadAppUpdate() {
  await syncLocalUpdateState();

  if (appUpdateState.isUpdateReady || appUpdateState.isDownloading) {
    return appUpdateState;
  }

  if (!appUpdateState.isUpdateAvailable) {
    await checkForAppUpdate();
  }

  if (!appUpdateState.isUpdateAvailable || updateDownloadPromise) {
    return appUpdateState;
  }

  setAppUpdateState({
    stage: "downloading",
    isDownloading: true,
    errorMessage: null,
    statusMessage: "Downloading update...",
  });

  updateDownloadPromise = (async () => {
    try {
      await Updater.downloadUpdate();

      if (Updater.updateInfo()?.updateReady) {
        setAppUpdateState({
          stage: "ready",
          isDownloading: false,
          isUpdateAvailable: true,
          isUpdateReady: true,
          errorMessage: null,
          statusMessage: "Update ready to install.",
          lastCheckedAt: getCurrentTimestamp(),
        });
      }
    } catch (error) {
      setAppUpdateState({
        stage: appUpdateState.isUpdateAvailable ? "available" : "error",
        isDownloading: false,
        errorMessage: error instanceof Error ? error.message : "Failed to download update.",
        statusMessage: error instanceof Error ? error.message : "Failed to download update.",
      });
    } finally {
      updateDownloadPromise = null;
    }
  })();

  return appUpdateState;
}

async function applyAppUpdate() {
  if (!appUpdateState.isUpdateReady) {
    return appUpdateState;
  }

  setAppUpdateState({
    statusMessage: "Restarting to update...",
  });

  void Updater.applyUpdate().catch((error) => {
    setAppUpdateState({
      stage: "ready",
      errorMessage: error instanceof Error ? error.message : "Failed to apply update.",
      statusMessage: error instanceof Error ? error.message : "Failed to apply update.",
    });
  });

  return appUpdateState;
}

async function initializeUpdater() {
  await syncLocalUpdateState();

  if (!appUpdateState.isConfigured || appUpdateState.currentChannel === "dev") {
    return;
  }

  Updater.onStatusChange(applyUpdaterStatus);

  setTimeout(() => {
    void checkForAppUpdate();
  }, APP_UPDATE_CHECK_DELAY_MS);

  setInterval(() => {
    void checkForAppUpdate();
  }, APP_UPDATE_CHECK_INTERVAL_MS);
}

function installApplicationMenu() {
  if (!isMac) {
    return;
  }

  ApplicationMenu.setApplicationMenu([
    {
      label: "Loopndroll",
      submenu: [
        { role: "about" },
        { type: "divider" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "showAll" },
        { type: "divider" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "divider" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "divider" },
        { role: "bringAllToFront" },
      ],
    },
  ]);
}

function getWindowState(): WindowControlsState {
  return {
    isFullScreen: mainWindow.isFullScreen(),
    isMaximized: mainWindow.isMaximized(),
    platform: process.platform,
  };
}

function handleWindowControl({ action }: { action: WindowControlAction }) {
  switch (action) {
    case "close":
      mainWindow.close();
      break;
    case "minimize":
      mainWindow.minimize();
      break;
    case "toggle-primary":
      if (isMac) {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      } else if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      break;
  }

  return getWindowState();
}

function getAppRpcRequestHandlers() {
  return {
    getWindowState,
    windowControl: handleWindowControl,
    getAppUpdateState() {
      return appUpdateState;
    },
    checkForAppUpdate,
    downloadAppUpdate,
    applyAppUpdate,
    openExternalUrl({ url }: { url: string }) {
      return Utils.openExternal(url);
    },
  };
}

function getLoopndrollSessionRpcRequestHandlers() {
  return {
    setSessionNotifications({
      sessionId,
      notificationIds,
    }: {
      sessionId: string;
      notificationIds: string[];
    }) {
      return persistSessionNotifications(sessionId, notificationIds);
    },
    setSessionPreset({
      sessionId,
      preset,
    }: {
      sessionId: string;
      preset: Parameters<typeof setSessionPreset>[1];
    }) {
      return setSessionPreset(sessionId, preset);
    },
    setSessionCompletionCheckConfig({
      sessionId,
      completionCheckId,
      waitForReplyAfterCompletion,
    }: {
      sessionId: string;
      completionCheckId: string | null;
      waitForReplyAfterCompletion: boolean;
    }) {
      return setSessionCompletionCheckConfig(
        sessionId,
        completionCheckId,
        waitForReplyAfterCompletion,
      );
    },
    setSessionArchived({ sessionId, archived }: { sessionId: string; archived: boolean }) {
      return persistSessionArchived(sessionId, archived);
    },
    deleteSession({ sessionId }: { sessionId: string }) {
      return deleteSession(sessionId);
    },
  };
}

function getLoopndrollLifecycleRpcRequestHandlers() {
  return {
    registerHooks,
    clearHooks,
    pauseLoopndroll,
    resumeLoopndroll,
    startLoopndroll,
    stopLoopndroll,
    revealHooksFile,
  };
}

function getLoopndrollRpcRequestHandlers() {
  return {
    ensureLoopndrollSetup,
    getLoopndrollState: getLoopndrollSnapshot,
    saveDefaultPrompt({ defaultPrompt }: { defaultPrompt: string }) {
      return saveDefaultPrompt(defaultPrompt);
    },
    createNotification({
      notification,
    }: {
      notification: Parameters<typeof createLoopNotification>[0];
    }) {
      return createLoopNotification(notification);
    },
    createCompletionCheck({
      completionCheck,
    }: {
      completionCheck: Parameters<typeof createCompletionCheck>[0];
    }) {
      return createCompletionCheck(completionCheck);
    },
    getTelegramChats({ botToken, waitForUpdates }: { botToken: string; waitForUpdates?: boolean }) {
      return fetchTelegramChats(botToken, waitForUpdates);
    },
    updateNotification({
      notification,
    }: {
      notification: Parameters<typeof updateLoopNotification>[0];
    }) {
      return updateLoopNotification(notification);
    },
    migrateNotificationSecretsToKeychain,
    updateCompletionCheck({
      completionCheck,
    }: {
      completionCheck: Parameters<typeof updateCompletionCheck>[0];
    }) {
      return updateCompletionCheck(completionCheck);
    },
    deleteNotification({ notificationId }: { notificationId: string }) {
      return deleteLoopNotification(notificationId);
    },
    deleteCompletionCheck({ completionCheckId }: { completionCheckId: string }) {
      return deleteCompletionCheck(completionCheckId);
    },
    setLoopScope({ scope }: { scope: Parameters<typeof setLoopScope>[0] }) {
      return setLoopScope(scope);
    },
    setGlobalPreset({ preset }: { preset: Parameters<typeof setGlobalPreset>[0] }) {
      return setGlobalPreset(preset);
    },
    setGlobalNotification({ notificationId }: { notificationId: string | null }) {
      return setGlobalNotification(notificationId);
    },
    setGlobalCompletionCheckConfig({
      completionCheckId,
      waitForReplyAfterCompletion,
    }: {
      completionCheckId: string | null;
      waitForReplyAfterCompletion: boolean;
    }) {
      return setGlobalCompletionCheckConfig(completionCheckId, waitForReplyAfterCompletion);
    },
    setMirrorEnabled({ enabled }: { enabled: boolean }) {
      return setMirrorEnabled(enabled);
    },
    ...getLoopndrollSessionRpcRequestHandlers(),
    ...getLoopndrollLifecycleRpcRequestHandlers(),
  };
}

function createWindowRpc() {
  return defineElectrobunRPC<AppRpcSchema>("bun", {
    maxRequestTime: 60_000,
    handlers: {
      requests: {
        ...getAppRpcRequestHandlers(),
        ...getLoopndrollRpcRequestHandlers(),
      },
    },
  });
}

const windowRpc = createWindowRpc();

function registerStartupRecoveryCleanup() {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    clearStartupRecoveryMarker();
  };

  process.once("exit", cleanup);
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.once("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
}

installApplicationMenu();
try {
  resetActiveLoopStateOnStartup();
  registerStartupRecoveryCleanup();
} catch (error) {
  console.error("Loopndroll startup active-state reset failed.", error);
}
if (process.env["LOOPNDROLL_DISABLE_HOOK_REMOVAL_MONITOR"] !== "1") {
  void startHookRemovalPendingMonitor();
}
if (process.env["LOOPNDROLL_DISABLE_TELEGRAM_BRIDGE"] !== "1") {
  startLoopndrollTelegramBridge();
}
void initializeUpdater();

mainWindow = new BrowserWindow({
  title: "Loopndroll",
  url: await getRendererUrl(),
  rpc: windowRpc,
  titleBarStyle: isMac ? "hidden" : "default",
  transparent: isMac,
  frame: {
    width: 1024,
    height: 768,
    x: 160,
    y: 120,
  },
});

console.log(`Started Electrobun window ${mainWindow.id}`);
