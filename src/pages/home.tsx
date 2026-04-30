import { GlobalCompletionCheckFooter, ChatCardRail } from "./home/ui";
import { useHomeRouteModel } from "./home/model";
import { HomeSessionsSection } from "./home/sessions-section";

export function HomeRoute() {
  const model = useHomeRouteModel();

  return (
    <section
      aria-label="Home"
      className="flex min-h-full min-w-0 flex-col overflow-hidden px-16 pt-12"
    >
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col">
        <h1 className="text-2xl leading-snug tracking-tight font-normal">
          Let Codex run until it’s actually done.
          <br />
          Get notified and reply in Telegram.
        </h1>

        {model.errorMessage ? (
          <p className="text-sm text-destructive">{model.errorMessage}</p>
        ) : null}

        <div className="-mx-16 min-h-0 min-w-0 flex-1 pb-10">
          <div className="flex min-h-full min-w-0 flex-col gap-4 px-16 pt-5">
            <ChatCardRail
              activePreset={model.snapshot?.globalPreset ?? null}
              onToggle={model.handleGlobalPresetToggle}
              renderFooterStart={(preset) =>
                preset === "completion-checks" ? (
                  <GlobalCompletionCheckFooter
                    completionChecks={model.completionChecks}
                    onUpdateConfig={(completionCheckId, waitForReplyAfterCompletion) => {
                      void model.updateGlobalCompletionCheckConfig(
                        completionCheckId,
                        waitForReplyAfterCompletion,
                      );
                    }}
                    snapshot={model.snapshot}
                  />
                ) : null
              }
            />

            <HomeSessionsSection
              completionChecks={model.completionChecks}
              isLoading={model.isLoading}
              notifications={model.notifications}
              now={model.now}
              onDelete={(sessionId) => {
                void model.removeSession(sessionId);
              }}
              onNotificationClear={(sessionId) => {
                void model.handleSessionNotificationClear(sessionId);
              }}
              onNotificationToggle={(session, notificationId, checked) => {
                void model.handleSessionNotificationToggle(session, notificationId, checked);
              }}
              onPresetAction={(session) => {
                void model.handleSessionPresetAction(session);
              }}
              onPresetSelection={model.handleSessionPresetSelection}
              onSetArchived={(sessionId, archived) => {
                void model.updateSessionArchived(sessionId, archived);
              }}
              onToggleArchivedSessions={model.toggleArchivedSessions}
              onUpdateSessionCompletionCheckConfig={(
                sessionId,
                completionCheckId,
                waitForReplyAfterCompletion,
              ) => {
                void model.updateSessionCompletionCheckConfig(
                  sessionId,
                  completionCheckId,
                  waitForReplyAfterCompletion,
                );
              }}
              openActionsSessionId={model.openActionsSessionId}
              pendingSessionPresets={model.pendingSessionPresets}
              sessionRefs={model.sessionRefs}
              sessions={model.sortedSessions}
              setOpenActionsSessionId={model.setOpenActionsSessionId}
              showArchivedSessions={model.showArchivedSessions}
              snapshot={model.snapshot}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
