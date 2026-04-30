import type {
  CreateLoopNotificationInput,
  LoopPreset,
  LoopScope,
  TelegramChatOption,
  UpdateLoopNotificationInput,
} from "../shared/app-rpc";
import { getAppRpc } from "./app-rpc";

export type {
  CompletionCheck,
  CreateLoopNotificationInput,
  HookLifecycleStatus,
  HookRemovalWatcherStatus,
  LoopNotification,
  LoopPreset,
  LoopScope,
  LoopndrollRuntimeState,
  LoopndrollSnapshot,
  LoopSession,
  TelegramChatOption,
  UpdateLoopNotificationInput,
} from "../shared/app-rpc";

export async function ensureLoopndrollSetup() {
  const rpc = await getAppRpc();
  return rpc?.request.ensureLoopndrollSetup();
}

export async function getLoopndrollState() {
  const rpc = await getAppRpc();
  return rpc?.request.getLoopndrollState();
}

export async function saveDefaultPrompt(defaultPrompt: string) {
  const rpc = await getAppRpc();
  return rpc?.request.saveDefaultPrompt({ defaultPrompt });
}

export async function createNotification(notification: CreateLoopNotificationInput) {
  const rpc = await getAppRpc();
  return rpc?.request.createNotification({ notification });
}

export async function createCompletionCheck(completionCheck: {
  label?: string;
  commands: string[];
}) {
  const rpc = await getAppRpc();
  return rpc?.request.createCompletionCheck({ completionCheck });
}

export async function getTelegramChats(
  botToken: string,
  waitForUpdates = false,
): Promise<TelegramChatOption[]> {
  const rpc = await getAppRpc();
  return (await rpc?.request.getTelegramChats({ botToken, waitForUpdates })) ?? [];
}

export async function openExternalUrl(url: string): Promise<boolean> {
  const rpc = await getAppRpc();
  return (await rpc?.request.openExternalUrl({ url })) ?? false;
}

export async function updateNotification(notification: UpdateLoopNotificationInput) {
  const rpc = await getAppRpc();
  return rpc?.request.updateNotification({ notification });
}

export async function migrateNotificationSecretsToKeychain() {
  const rpc = await getAppRpc();
  return rpc?.request.migrateNotificationSecretsToKeychain();
}

export async function updateCompletionCheck(completionCheck: {
  id: string;
  label?: string;
  commands: string[];
}) {
  const rpc = await getAppRpc();
  return rpc?.request.updateCompletionCheck({ completionCheck });
}

export async function setSessionNotifications(sessionId: string, notificationIds: string[]) {
  const rpc = await getAppRpc();
  return rpc?.request.setSessionNotifications({ sessionId, notificationIds });
}

export async function deleteNotification(notificationId: string) {
  const rpc = await getAppRpc();
  return rpc?.request.deleteNotification({ notificationId });
}

export async function deleteCompletionCheck(completionCheckId: string) {
  const rpc = await getAppRpc();
  return rpc?.request.deleteCompletionCheck({ completionCheckId });
}

export async function setLoopScope(scope: LoopScope) {
  const rpc = await getAppRpc();
  return rpc?.request.setLoopScope({ scope });
}

export async function setGlobalPreset(preset: LoopPreset | null) {
  const rpc = await getAppRpc();
  return rpc?.request.setGlobalPreset({ preset });
}

export async function setGlobalNotification(notificationId: string | null) {
  const rpc = await getAppRpc();
  return rpc?.request.setGlobalNotification({ notificationId });
}

export async function setGlobalCompletionCheckConfig(
  completionCheckId: string | null,
  waitForReplyAfterCompletion: boolean,
) {
  const rpc = await getAppRpc();
  return rpc?.request.setGlobalCompletionCheckConfig({
    completionCheckId,
    waitForReplyAfterCompletion,
  });
}

export async function setMirrorEnabled(enabled: boolean) {
  const rpc = await getAppRpc();
  return rpc?.request.setMirrorEnabled({ enabled });
}

export async function setSessionPreset(sessionId: string, preset: LoopPreset | null) {
  const rpc = await getAppRpc();
  return rpc?.request.setSessionPreset({ sessionId, preset });
}

export async function setSessionCompletionCheckConfig(
  sessionId: string,
  completionCheckId: string | null,
  waitForReplyAfterCompletion: boolean,
) {
  const rpc = await getAppRpc();
  return rpc?.request.setSessionCompletionCheckConfig({
    sessionId,
    completionCheckId,
    waitForReplyAfterCompletion,
  });
}

export async function setSessionArchived(sessionId: string, archived: boolean) {
  const rpc = await getAppRpc();
  return rpc?.request.setSessionArchived({ sessionId, archived });
}

export async function deleteSession(sessionId: string) {
  const rpc = await getAppRpc();
  return rpc?.request.deleteSession({ sessionId });
}

export async function registerHooks() {
  const rpc = await getAppRpc();
  return rpc?.request.registerHooks();
}

export async function clearHooks() {
  const rpc = await getAppRpc();
  return rpc?.request.clearHooks();
}

export async function pauseLoopndroll() {
  const rpc = await getAppRpc();
  return rpc?.request.pauseLoopndroll();
}

export async function resumeLoopndroll() {
  const rpc = await getAppRpc();
  return rpc?.request.resumeLoopndroll();
}

export async function startLoopndroll() {
  const rpc = await getAppRpc();
  return rpc?.request.startLoopndroll();
}

export async function stopLoopndroll() {
  const rpc = await getAppRpc();
  return rpc?.request.stopLoopndroll();
}

export async function revealHooksFile() {
  const rpc = await getAppRpc();
  return rpc?.request.revealHooksFile();
}
