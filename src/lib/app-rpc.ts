import type { AppRpcSchema } from "../shared/app-rpc";

type AppRpc = {
  request: {
    getWindowState: AppRpcSchema["bun"]["requests"]["getWindowState"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["getWindowState"]["response"]>
      : never;
    windowControl: (
      params: AppRpcSchema["bun"]["requests"]["windowControl"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["windowControl"]["response"]>;
    getAppUpdateState: AppRpcSchema["bun"]["requests"]["getAppUpdateState"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["getAppUpdateState"]["response"]>
      : never;
    checkForAppUpdate: AppRpcSchema["bun"]["requests"]["checkForAppUpdate"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["checkForAppUpdate"]["response"]>
      : never;
    downloadAppUpdate: AppRpcSchema["bun"]["requests"]["downloadAppUpdate"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["downloadAppUpdate"]["response"]>
      : never;
    applyAppUpdate: AppRpcSchema["bun"]["requests"]["applyAppUpdate"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["applyAppUpdate"]["response"]>
      : never;
    ensureLoopndrollSetup: AppRpcSchema["bun"]["requests"]["ensureLoopndrollSetup"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["ensureLoopndrollSetup"]["response"]>
      : never;
    getLoopndrollState: AppRpcSchema["bun"]["requests"]["getLoopndrollState"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["getLoopndrollState"]["response"]>
      : never;
    saveDefaultPrompt: (
      params: AppRpcSchema["bun"]["requests"]["saveDefaultPrompt"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["saveDefaultPrompt"]["response"]>;
    createNotification: (
      params: AppRpcSchema["bun"]["requests"]["createNotification"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["createNotification"]["response"]>;
    createCompletionCheck: (
      params: AppRpcSchema["bun"]["requests"]["createCompletionCheck"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["createCompletionCheck"]["response"]>;
    getTelegramChats: (
      params: AppRpcSchema["bun"]["requests"]["getTelegramChats"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["getTelegramChats"]["response"]>;
    openExternalUrl: (
      params: AppRpcSchema["bun"]["requests"]["openExternalUrl"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["openExternalUrl"]["response"]>;
    updateNotification: (
      params: AppRpcSchema["bun"]["requests"]["updateNotification"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["updateNotification"]["response"]>;
    migrateNotificationSecretsToKeychain: AppRpcSchema["bun"]["requests"]["migrateNotificationSecretsToKeychain"]["params"] extends undefined
      ? () => Promise<
          AppRpcSchema["bun"]["requests"]["migrateNotificationSecretsToKeychain"]["response"]
        >
      : never;
    updateCompletionCheck: (
      params: AppRpcSchema["bun"]["requests"]["updateCompletionCheck"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["updateCompletionCheck"]["response"]>;
    setSessionNotifications: (
      params: AppRpcSchema["bun"]["requests"]["setSessionNotifications"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["setSessionNotifications"]["response"]>;
    deleteNotification: (
      params: AppRpcSchema["bun"]["requests"]["deleteNotification"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["deleteNotification"]["response"]>;
    deleteCompletionCheck: (
      params: AppRpcSchema["bun"]["requests"]["deleteCompletionCheck"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["deleteCompletionCheck"]["response"]>;
    setLoopScope: (
      params: AppRpcSchema["bun"]["requests"]["setLoopScope"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["setLoopScope"]["response"]>;
    setGlobalPreset: (
      params: AppRpcSchema["bun"]["requests"]["setGlobalPreset"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["setGlobalPreset"]["response"]>;
    setGlobalNotification: (
      params: AppRpcSchema["bun"]["requests"]["setGlobalNotification"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["setGlobalNotification"]["response"]>;
    setGlobalCompletionCheckConfig: (
      params: AppRpcSchema["bun"]["requests"]["setGlobalCompletionCheckConfig"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["setGlobalCompletionCheckConfig"]["response"]>;
    setMirrorEnabled: (
      params: AppRpcSchema["bun"]["requests"]["setMirrorEnabled"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["setMirrorEnabled"]["response"]>;
    setSessionPreset: (
      params: AppRpcSchema["bun"]["requests"]["setSessionPreset"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["setSessionPreset"]["response"]>;
    setSessionCompletionCheckConfig: (
      params: AppRpcSchema["bun"]["requests"]["setSessionCompletionCheckConfig"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["setSessionCompletionCheckConfig"]["response"]>;
    setSessionArchived: (
      params: AppRpcSchema["bun"]["requests"]["setSessionArchived"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["setSessionArchived"]["response"]>;
    deleteSession: (
      params: AppRpcSchema["bun"]["requests"]["deleteSession"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["deleteSession"]["response"]>;
    registerHooks: AppRpcSchema["bun"]["requests"]["registerHooks"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["registerHooks"]["response"]>
      : never;
    clearHooks: AppRpcSchema["bun"]["requests"]["clearHooks"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["clearHooks"]["response"]>
      : never;
    pauseLoopndroll: AppRpcSchema["bun"]["requests"]["pauseLoopndroll"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["pauseLoopndroll"]["response"]>
      : never;
    resumeLoopndroll: AppRpcSchema["bun"]["requests"]["resumeLoopndroll"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["resumeLoopndroll"]["response"]>
      : never;
    startLoopndroll: AppRpcSchema["bun"]["requests"]["startLoopndroll"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["startLoopndroll"]["response"]>
      : never;
    stopLoopndroll: AppRpcSchema["bun"]["requests"]["stopLoopndroll"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["stopLoopndroll"]["response"]>
      : never;
    revealHooksFile: AppRpcSchema["bun"]["requests"]["revealHooksFile"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["revealHooksFile"]["response"]>
      : never;
  };
};

let rpcPromise: Promise<AppRpc | null> | null = null;

function hasElectrobunBridge() {
  return typeof window !== "undefined" && "__electrobunWindowId" in window;
}

export async function getAppRpc() {
  if (!hasElectrobunBridge()) {
    return null;
  }

  if (!rpcPromise) {
    rpcPromise = import("electrobun/view").then(({ Electroview }) => {
      const rpc = Electroview.defineRPC<AppRpcSchema>({
        handlers: {},
      });

      new Electroview({ rpc });

      return rpc as AppRpc;
    });
  }

  return rpcPromise;
}
