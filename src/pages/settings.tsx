import { ArrowLeft } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAppUpdate } from "@/lib/use-app-update";
import { revealHooksFile } from "@/lib/loopndroll";
import { handleExternalLinkClick } from "./settings/common";
import { CompletionCheckDialog, NotificationDialog } from "./settings/dialogs";
import { useSettingsRouteModel } from "./settings/model";
import {
  AppUpdateSection,
  CompletionChecksSection,
  DefaultPromptSection,
  ExtrasSection,
  HookRegistrationSection,
  NotificationSetupSections,
  NotificationsSection,
  SecretMigrationSection,
} from "./settings/sections";

function SettingsDialogs({ model }: { model: ReturnType<typeof useSettingsRouteModel> }) {
  return (
    <>
      <NotificationDialog
        botTokenError={model.notificationForm.formState.errors.botToken?.message}
        editingNotificationId={model.editingNotificationId}
        form={model.notificationForm}
        isLoadingTelegramChats={model.isLoadingTelegramChats}
        isOpen={model.isNotificationDialogOpen}
        normalizedNotificationBotToken={model.notificationForm.watch("botToken").trim()}
        onDocsClick={(event) => {
          void handleExternalLinkClick(
            event,
            "https://github.com/lnikell/loopndroll?tab=readme-ov-file#telegram-setup",
          );
        }}
        onOpenChange={model.setIsNotificationDialogOpen}
        onSubmit={model.saveHandlers.saveNotification}
        selectedTelegramChat={model.selectedTelegramChat}
        shouldShowTelegramChatsError={model.shouldShowTelegramChatsError}
        telegramChatIdError={model.notificationForm.formState.errors.telegramChatId?.message}
        telegramChatItems={model.telegramChatItems}
        telegramChatsError={model.telegramChatsError}
        webhookUrlError={model.notificationForm.formState.errors.webhookUrl?.message}
      />
      <CompletionCheckDialog
        commandsError={model.completionCheckForm.formState.errors.commandsText?.message}
        editingCompletionCheckId={model.editingCompletionCheckId}
        form={model.completionCheckForm}
        isOpen={model.isCompletionCheckDialogOpen}
        onOpenChange={model.setIsCompletionCheckDialogOpen}
        onSubmit={model.saveHandlers.saveCompletionCheck}
      />
    </>
  );
}

function SettingsBackButton({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return (
    <div className="fixed top-16 left-4 z-20">
      <Button
        aria-label="Go back"
        onClick={() => {
          if (window.history.length > 1) {
            navigate(-1);
          } else {
            navigate("/");
          }
        }}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ArrowLeft weight="regular" />
      </Button>
    </div>
  );
}

function SettingsSections({
  model,
  update,
}: {
  model: ReturnType<typeof useSettingsRouteModel>;
  update: ReturnType<typeof useAppUpdate>;
}) {
  return (
    <div className="space-y-5">
      <DefaultPromptSection
        defaultPromptError={model.settingsForm.formState.errors.defaultPrompt?.message}
        form={model.settingsForm}
        onSubmit={() => {
          void model.saveHandlers.saveDefaultPrompt();
        }}
      />
      <NotificationsSettingsSection model={model} />
      <CompletionChecksSettingsSection model={model} />
      <HookSettingsSection model={model} />
      <AppUpdateSection
        isLoading={update.isLoading}
        state={update.state}
        onApplyUpdate={() => {
          void update.applyUpdate();
        }}
        onCheckForUpdates={() => {
          void update.checkForUpdates();
        }}
        onDownloadUpdate={() => {
          void update.downloadUpdate();
        }}
      />
      <ExtrasSection
        mirrorEnabled={model.mirrorEnabled}
        onToggleMirror={(enabled) => {
          void model.updateMirrorEnabled(enabled);
        }}
      />
      <SecretMigrationSection
        notifications={model.notifications}
        onMigrateSecrets={() => {
          void model.migrateSecrets();
        }}
      />
    </div>
  );
}

function NotificationsSettingsSection({
  model,
}: {
  model: ReturnType<typeof useSettingsRouteModel>;
}) {
  return (
    <>
      <NotificationsSection
        notifications={model.notifications}
        onDocsClick={(event) => {
          void handleExternalLinkClick(
            event,
            "https://github.com/lnikell/loopndroll?tab=readme-ov-file#telegram-commands",
          );
        }}
        onEdit={model.openEditNotificationDialog}
        onRemove={(notificationId) => {
          void model.removeNotification(notificationId);
        }}
      />
      <NotificationSetupSections
        onAddSlackNotification={model.openCreateSlackNotificationDialog}
        onAddTelegramNotification={model.openCreateTelegramNotificationDialog}
      />
    </>
  );
}

function CompletionChecksSettingsSection({
  model,
}: {
  model: ReturnType<typeof useSettingsRouteModel>;
}) {
  return (
    <CompletionChecksSection
      completionChecks={model.completionChecks}
      onAdd={model.openCreateCompletionCheckDialog}
      onDocsClick={(event) => {
        void handleExternalLinkClick(
          event,
          "https://github.com/lnikell/loopndroll?tab=readme-ov-file#4-completion-checks",
        );
      }}
      onEdit={model.openEditCompletionCheckDialog}
      onRemove={(completionCheckId) => {
        void model.removeCompletionCheck(completionCheckId);
      }}
    />
  );
}

function HookSettingsSection({ model }: { model: ReturnType<typeof useSettingsRouteModel> }) {
  return (
    <HookRegistrationSection
      hasResolvedHookState={model.hasResolvedHookState}
      hookLifecycle={model.hookLifecycle}
      hookRemovalWatcher={model.hookRemovalWatcher}
      hooksDetected={model.hooksDetected}
      hookIssues={model.hookIssues}
      runtimeState={model.runtimeState}
      onClearHooks={() => {
        void model.uninstallHooks();
      }}
      onPauseLoopndroll={() => {
        void model.pauseLoopndroll();
      }}
      onRegisterHooks={() => {
        void model.installHooks();
      }}
      onRevealHooksFile={() => {
        void revealHooksFile();
      }}
      onResumeLoopndroll={() => {
        void model.resumeLoopndroll();
      }}
      onStartLoopndroll={() => {
        void model.startLoopndroll();
      }}
      onStopLoopndroll={() => {
        void model.stopLoopndroll();
      }}
    />
  );
}

function SettingsContent({
  model,
  navigate,
  update,
}: {
  model: ReturnType<typeof useSettingsRouteModel>;
  navigate: ReturnType<typeof useNavigate>;
  update: ReturnType<typeof useAppUpdate>;
}) {
  return (
    <section aria-label="Settings" className="relative px-4 pt-16 pb-32 md:px-6">
      <SettingsBackButton navigate={navigate} />
      <div className="mx-auto flex w-full max-w-[816px] flex-col gap-6">
        <div className="space-y-0.5">
          <h1 className="text-4xl leading-tight font-semibold tracking-[-0.03em] text-[#fafafa]">
            Settings
          </h1>
        </div>
        {model.errorMessage ? (
          <p className="text-sm text-destructive">{model.errorMessage}</p>
        ) : null}
        <SettingsSections model={model} update={update} />
      </div>
    </section>
  );
}

export function SettingsRoute() {
  const navigate = useNavigate();
  const model = useSettingsRouteModel();
  const update = useAppUpdate();

  return (
    <>
      <SettingsDialogs model={model} />
      <SettingsContent model={model} navigate={navigate} update={update} />
    </>
  );
}
