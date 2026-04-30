import { DotsThreeVertical, Play, Stop } from "@phosphor-icons/react";
import { intlFormatDistance } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { ChatStatusIndicator } from "@/components/chat-status-indicator";
import { getChatCardThemeForPreset } from "@/components/chat-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type {
  CompletionCheck,
  LoopNotification,
  LoopPreset,
  LoopSession,
  LoopndrollSnapshot,
} from "@/lib/loopndroll";
import {
  AnimatedEmptyStateMessage,
  contentFadeVariants,
  emptyStateVariants,
  getSessionPrompt,
  rowStaggerVariants,
  SessionTimingText,
  staggerContainerVariants,
  sessionPresetItems,
} from "./ui";

function getSectionTitle(showArchivedSessions: boolean) {
  return showArchivedSessions ? "Archived chats" : "Registered chats";
}

function getSectionDescription(showArchivedSessions: boolean) {
  return showArchivedSessions
    ? "stored separately from active hook controls"
    : "and per-task mode controls";
}

function getEmptyStateMessage(showArchivedSessions: boolean) {
  return showArchivedSessions
    ? "No archived chats yet."
    : "Start a chat in Codex so it appears here...";
}

function getProjectLabel(cwd: string | null | undefined) {
  if (typeof cwd !== "string" || cwd.trim().length === 0) {
    return "Projectless";
  }

  const segments = cwd
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.at(-1) ?? "Projectless";
}

function groupSessionsByProject(sessions: LoopSession[]) {
  const grouped = new Map<string, LoopSession[]>();
  for (const session of sessions) {
    const projectLabel = getProjectLabel(session.cwd);
    const current = grouped.get(projectLabel);
    if (current) {
      current.push(session);
      continue;
    }
    grouped.set(projectLabel, [session]);
  }

  return [...grouped.entries()].map(([projectLabel, projectSessions]) => ({
    projectLabel,
    sessions: projectSessions,
  }));
}

function getSessionTimingLabel(session: LoopSession, showArchivedSessions: boolean, now: number) {
  if (showArchivedSessions) {
    return "";
  }

  const getRelativeLabel = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    const formatted = intlFormatDistance(date, now, { style: "narrow" });
    return formatted === "now" ? "1s ago" : formatted;
  };

  const registeredText = getRelativeLabel(session.firstSeenAt);
  const activeText = session.activeSince
    ? getRelativeLabel(session.activeSince).replace(/ ago$/, "")
    : "";

  if (session.effectivePreset !== null) {
    return activeText ? `Working for ${activeText}` : "Working";
  }

  return registeredText ? `Registered ${registeredText}` : "";
}

function ProjectGroupHeading({ projectLabel, count }: { projectLabel: string; count: number }) {
  const isProjectless = projectLabel === "Projectless";

  return (
    <div className="flex items-center justify-between border-b border-[#292929] pb-2">
      <div className="min-w-0">
        <p className="truncate text-sm tracking-[0.18em] text-foreground/45 uppercase">
          {isProjectless ? "Projectless" : "Project"}
        </p>
        <h3 className="truncate text-base leading-snug text-foreground">{projectLabel}</h3>
      </div>
      <span className="shrink-0 text-xs text-foreground/45">
        {count} {count === 1 ? "chat" : "chats"}
      </span>
    </div>
  );
}

function HeaderLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      className="ml-auto inline-flex h-auto shrink-0 items-center p-0 text-sm leading-none text-foreground/70 transition-colors hover:text-foreground"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function SectionHeading({
  showArchivedSessions,
  onToggleArchivedSessions,
}: {
  showArchivedSessions: boolean;
  onToggleArchivedSessions: () => void;
}) {
  return (
    <div className="flex w-full items-end gap-4">
      <h2 className="min-w-0 flex-1 text-[20px] leading-snug tracking-tight font-normal">
        <span className="text-foreground">{getSectionTitle(showArchivedSessions)}</span>
        <br />
        <span className="text-foreground/60">{getSectionDescription(showArchivedSessions)}</span>
      </h2>
      <HeaderLink onClick={onToggleArchivedSessions}>
        {showArchivedSessions ? "Registered" : "Archived"}
      </HeaderLink>
    </div>
  );
}

function EmptySessionsState({
  showArchivedSessions,
  onToggleArchivedSessions,
}: {
  showArchivedSessions: boolean;
  onToggleArchivedSessions: () => void;
}) {
  return (
    <motion.div
      key={showArchivedSessions ? "empty-archived-chats" : "empty-registered-chats"}
      animate="show"
      className="space-y-3"
      exit="exit"
      initial="hidden"
      variants={emptyStateVariants}
    >
      <SectionHeading
        showArchivedSessions={showArchivedSessions}
        onToggleArchivedSessions={onToggleArchivedSessions}
      />
      <p className="py-2 text-sm">
        <AnimatedEmptyStateMessage text={getEmptyStateMessage(showArchivedSessions)} />
      </p>
    </motion.div>
  );
}

function SessionPromptCell({ session, sessionRef }: { session: LoopSession; sessionRef: string }) {
  const prompt = getSessionPrompt(session);
  if (!prompt) {
    return null;
  }

  return (
    <div className="flex min-w-0 items-center text-base">
      <span className="mr-3 shrink-0 text-sm text-foreground/50">[{sessionRef}]</span>
      <span className="block max-w-[400px] min-w-0 truncate text-foreground">{prompt}</span>
    </div>
  );
}

function SessionPresetControls({
  isSessionActive,
  selectedSessionPreset,
  session,
  onPresetAction,
  onPresetSelection,
}: {
  isSessionActive: boolean;
  selectedSessionPreset: LoopPreset;
  session: LoopSession;
  onPresetAction: (session: LoopSession) => void;
  onPresetSelection: (session: LoopSession, nextPreset: LoopPreset) => void;
}) {
  return (
    <>
      <Select
        items={sessionPresetItems}
        onValueChange={(value) => {
          if (value) {
            onPresetSelection(session, value as LoopPreset);
          }
        }}
        value={selectedSessionPreset}
      >
        <SelectTrigger
          className="ml-auto w-44 bg-transparent hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent"
          size="sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end" className="w-44">
          <SelectGroup>
            <SelectLabel>Continuous</SelectLabel>
            <SelectItem value="infinite">Infinite</SelectItem>
            <SelectItem value="await-reply">Await Reply</SelectItem>
            <SelectItem value="completion-checks">Completion Checks</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Max Turns</SelectLabel>
            <SelectItem value="max-turns-1">Max Turns 1</SelectItem>
            <SelectItem value="max-turns-2">Max Turns 2</SelectItem>
            <SelectItem value="max-turns-3">Max Turns 3</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button
        aria-label={`${isSessionActive ? "Stop" : "Start"} preset for ${session.sessionRef ?? "C0"}`}
        aria-pressed={isSessionActive}
        className="bg-transparent hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent"
        onClick={() => {
          onPresetAction(session);
        }}
        size="icon-sm"
        type="button"
        variant="outline"
      >
        {isSessionActive ? <Stop weight="fill" /> : <Play className="-ml-0.5" weight="fill" />}
      </Button>
    </>
  );
}

function SessionCompletionChecksSection({
  completionChecks,
  currentCompletionCheckId,
  currentWaitForReplyAfterCompletion,
  onClose,
  onUpdateConfig,
}: {
  completionChecks: CompletionCheck[];
  currentCompletionCheckId: string | null;
  currentWaitForReplyAfterCompletion: boolean;
  onClose: () => void;
  onUpdateConfig: (completionCheckId: string | null, waitForReplyAfterCompletion: boolean) => void;
}) {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Completion Checks</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={currentCompletionCheckId === null}
          onCheckedChange={() => {
            onUpdateConfig(null, false);
            onClose();
          }}
        >
          None
        </DropdownMenuCheckboxItem>
        {completionChecks.length === 0 ? (
          <DropdownMenuItem disabled>No checks available</DropdownMenuItem>
        ) : (
          completionChecks.map((completionCheck) => (
            <DropdownMenuCheckboxItem
              key={completionCheck.id}
              checked={currentCompletionCheckId === completionCheck.id}
              onCheckedChange={() => {
                onUpdateConfig(completionCheck.id, currentWaitForReplyAfterCompletion);
                onClose();
              }}
            >
              {completionCheck.label}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuCheckboxItem
          checked={currentWaitForReplyAfterCompletion}
          disabled={currentCompletionCheckId === null}
          onCheckedChange={(checked) => {
            onUpdateConfig(currentCompletionCheckId, Boolean(checked));
            onClose();
          }}
        >
          Wait for reply
        </DropdownMenuCheckboxItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
    </>
  );
}

function resolveDisplayedCompletionCheckConfig(
  session: LoopSession,
  selectedSessionPreset: LoopPreset,
) {
  if (selectedSessionPreset !== "completion-checks") {
    return {
      completionCheckId: session.completionCheckId,
      waitForReplyAfterCompletion: session.completionCheckWaitForReply,
    };
  }

  if (session.effectivePreset === "completion-checks") {
    return {
      completionCheckId: session.effectiveCompletionCheckId,
      waitForReplyAfterCompletion: session.effectiveCompletionCheckWaitForReply,
    };
  }

  return {
    completionCheckId: session.completionCheckId,
    waitForReplyAfterCompletion: session.completionCheckWaitForReply,
  };
}

function SessionNotificationsMenuSection({
  notifications,
  onClose,
  onNotificationClear,
  onNotificationToggle,
  session,
}: {
  notifications: LoopNotification[];
  onClose: () => void;
  onNotificationClear: (sessionId: string) => void;
  onNotificationToggle: (session: LoopSession, notificationId: string, checked: boolean) => void;
  session: LoopSession;
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Notifications</DropdownMenuLabel>
      <DropdownMenuItem disabled className="text-xs leading-relaxed opacity-80">
        Attach Telegram here before using Await Reply.
      </DropdownMenuItem>
      <DropdownMenuCheckboxItem
        checked={session.notificationIds.length === 0}
        onCheckedChange={() => {
          onNotificationClear(session.sessionId);
          onClose();
        }}
      >
        None
      </DropdownMenuCheckboxItem>
      {notifications.map((notification) => (
        <DropdownMenuCheckboxItem
          key={notification.id}
          checked={session.notificationIds.includes(notification.id)}
          onCheckedChange={(checked) => {
            onNotificationToggle(session, notification.id, Boolean(checked));
            onClose();
          }}
        >
          {notification.label}
        </DropdownMenuCheckboxItem>
      ))}
    </DropdownMenuGroup>
  );
}

function SessionActionsTrigger({ sessionRef }: { sessionRef: string }) {
  return (
    <DropdownMenuTrigger
      aria-label={`Open actions and notification settings for ${sessionRef}`}
      className="inline-flex size-8 items-center justify-center rounded-md border border-input bg-transparent shadow-xs transition-colors hover:bg-muted"
      title="Notifications and chat actions"
    >
      <DotsThreeVertical aria-hidden="true" weight="bold" />
    </DropdownMenuTrigger>
  );
}

function SessionActionsContent({
  completionChecks,
  notifications,
  onClose,
  onDelete,
  onNotificationClear,
  onNotificationToggle,
  onSetArchived,
  onUpdateSessionCompletionCheckConfig,
  selectedSessionPreset,
  session,
  showArchivedSessions,
}: {
  completionChecks: CompletionCheck[];
  notifications: LoopNotification[];
  onClose: () => void;
  onDelete: (sessionId: string) => void;
  onNotificationClear: (sessionId: string) => void;
  onNotificationToggle: (session: LoopSession, notificationId: string, checked: boolean) => void;
  onSetArchived: (sessionId: string, archived: boolean) => void;
  onUpdateSessionCompletionCheckConfig: (
    sessionId: string,
    completionCheckId: string | null,
    waitForReplyAfterCompletion: boolean,
  ) => void;
  selectedSessionPreset: LoopPreset;
  session: LoopSession;
  showArchivedSessions: boolean;
}) {
  const currentCompletionCheckConfig = resolveDisplayedCompletionCheckConfig(
    session,
    selectedSessionPreset,
  );

  return (
    <DropdownMenuContent className="w-58" align="end">
      {showArchivedSessions ? null : (
        <>
          <SessionNotificationsMenuSection
            notifications={notifications}
            onClose={onClose}
            onNotificationClear={onNotificationClear}
            onNotificationToggle={onNotificationToggle}
            session={session}
          />
          {selectedSessionPreset === "completion-checks" ? (
            <SessionCompletionChecksSection
              completionChecks={completionChecks}
              currentCompletionCheckId={currentCompletionCheckConfig.completionCheckId}
              currentWaitForReplyAfterCompletion={
                currentCompletionCheckConfig.waitForReplyAfterCompletion
              }
              onClose={onClose}
              onUpdateConfig={(completionCheckId, waitForReplyAfterCompletion) => {
                onUpdateSessionCompletionCheckConfig(
                  session.sessionId,
                  completionCheckId,
                  waitForReplyAfterCompletion,
                );
              }}
            />
          ) : null}
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuGroup>
        <DropdownMenuItem
          onClick={() => {
            if (showArchivedSessions) {
              onDelete(session.sessionId);
            } else {
              onSetArchived(session.sessionId, true);
            }
          }}
          variant={showArchivedSessions ? "destructive" : undefined}
        >
          {showArchivedSessions ? "Delete" : "Archive"}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  );
}

function SessionActionsMenu(props: {
  completionChecks: CompletionCheck[];
  notifications: LoopNotification[];
  onClose: () => void;
  onDelete: (sessionId: string) => void;
  onNotificationClear: (sessionId: string) => void;
  onNotificationToggle: (session: LoopSession, notificationId: string, checked: boolean) => void;
  onSetArchived: (sessionId: string, archived: boolean) => void;
  onUpdateSessionCompletionCheckConfig: (
    sessionId: string,
    completionCheckId: string | null,
    waitForReplyAfterCompletion: boolean,
  ) => void;
  open: boolean;
  selectedSessionPreset: LoopPreset;
  session: LoopSession;
  sessionRef: string;
  setOpen: (open: boolean) => void;
  showArchivedSessions: boolean;
}) {
  return (
    <DropdownMenu open={props.open} onOpenChange={props.setOpen}>
      <SessionActionsTrigger sessionRef={props.sessionRef} />
      <SessionActionsContent {...props} />
    </DropdownMenu>
  );
}

type HomeSessionRowProps = {
  completionChecks: CompletionCheck[];
  notifications: LoopNotification[];
  now: number;
  onDelete: (sessionId: string) => void;
  onNotificationClear: (sessionId: string) => void;
  onNotificationToggle: (session: LoopSession, notificationId: string, checked: boolean) => void;
  onPresetAction: (session: LoopSession) => void;
  onPresetSelection: (session: LoopSession, nextPreset: LoopPreset) => void;
  onSetArchived: (sessionId: string, archived: boolean) => void;
  onUpdateSessionCompletionCheckConfig: (
    sessionId: string,
    completionCheckId: string | null,
    waitForReplyAfterCompletion: boolean,
  ) => void;
  openActionsSessionId: string | null;
  selectedSessionPreset: LoopPreset;
  session: LoopSession;
  sessionRef: string;
  setOpenActionsSessionId: (sessionId: string | null) => void;
  showArchivedSessions: boolean;
  tableIndex: number;
};

function HomeSessionRow({
  completionChecks,
  notifications,
  now,
  onDelete,
  onNotificationClear,
  onNotificationToggle,
  onPresetAction,
  onPresetSelection,
  onSetArchived,
  onUpdateSessionCompletionCheckConfig,
  openActionsSessionId,
  selectedSessionPreset,
  session,
  sessionRef,
  setOpenActionsSessionId,
  showArchivedSessions,
  tableIndex,
}: HomeSessionRowProps) {
  const isSessionActive = session.effectivePreset !== null;
  const sessionStatusTheme = getChatCardThemeForPreset(
    session.effectivePreset ?? session.preset ?? "infinite",
  );
  const sessionTimingLabel = getSessionTimingLabel(session, showArchivedSessions, now);

  return (
    <motion.tr
      key={session.sessionId}
      className={cn(
        "border-b border-[#292929] hover:bg-transparent has-aria-expanded:bg-transparent",
        tableIndex === 0 && "border-t border-[#292929]",
      )}
      variants={contentFadeVariants}
    >
      <TableCell className="w-0 pl-0 pr-3 py-3">
        <ChatStatusIndicator active={isSessionActive} theme={sessionStatusTheme} />
      </TableCell>
      <TableCell className="w-full min-w-0 px-0 py-3">
        <SessionPromptCell session={session} sessionRef={sessionRef} />
      </TableCell>
      <TableCell className="w-36 min-w-36 px-0 py-3 pr-6 whitespace-nowrap text-sm tabular-nums text-foreground/80">
        {sessionTimingLabel ? <SessionTimingText text={sessionTimingLabel} /> : null}
      </TableCell>
      <TableCell className="w-[1%] px-0 py-3 whitespace-nowrap">
        <div className="flex items-center justify-end gap-2">
          {showArchivedSessions ? null : (
            <SessionPresetControls
              isSessionActive={isSessionActive}
              onPresetAction={onPresetAction}
              onPresetSelection={onPresetSelection}
              selectedSessionPreset={selectedSessionPreset}
              session={session}
            />
          )}
          {showArchivedSessions ? (
            <Button
              aria-label={`Unarchive ${sessionRef}`}
              onClick={() => {
                onSetArchived(session.sessionId, false);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Unarchive
            </Button>
          ) : null}
          <SessionActionsMenu
            completionChecks={completionChecks}
            notifications={notifications}
            onClose={() => {
              setOpenActionsSessionId(null);
            }}
            onDelete={onDelete}
            onNotificationClear={onNotificationClear}
            onNotificationToggle={onNotificationToggle}
            onSetArchived={onSetArchived}
            onUpdateSessionCompletionCheckConfig={onUpdateSessionCompletionCheckConfig}
            open={openActionsSessionId === session.sessionId}
            selectedSessionPreset={selectedSessionPreset}
            session={session}
            sessionRef={sessionRef}
            setOpen={(open) => {
              setOpenActionsSessionId(open ? session.sessionId : null);
            }}
            showArchivedSessions={showArchivedSessions}
          />
        </div>
      </TableCell>
    </motion.tr>
  );
}

function HomeSessionsTable({
  completionChecks,
  notifications,
  now,
  onDelete,
  onNotificationClear,
  onNotificationToggle,
  onPresetAction,
  onPresetSelection,
  onSetArchived,
  onUpdateSessionCompletionCheckConfig,
  openActionsSessionId,
  pendingSessionPresets,
  sessionRefs,
  sessions,
  setOpenActionsSessionId,
  showArchivedSessions,
}: {
  completionChecks: CompletionCheck[];
  notifications: LoopNotification[];
  now: number;
  onDelete: (sessionId: string) => void;
  onNotificationClear: (sessionId: string) => void;
  onNotificationToggle: (session: LoopSession, notificationId: string, checked: boolean) => void;
  onPresetAction: (session: LoopSession) => void;
  onPresetSelection: (session: LoopSession, nextPreset: LoopPreset) => void;
  onSetArchived: (sessionId: string, archived: boolean) => void;
  onUpdateSessionCompletionCheckConfig: (
    sessionId: string,
    completionCheckId: string | null,
    waitForReplyAfterCompletion: boolean,
  ) => void;
  openActionsSessionId: string | null;
  pendingSessionPresets: Record<string, LoopPreset>;
  sessionRefs: Map<string, string>;
  sessions: LoopSession[];
  setOpenActionsSessionId: (sessionId: string | null) => void;
  showArchivedSessions: boolean;
}) {
  return (
    <motion.div variants={contentFadeVariants}>
      <Table className="border-collapse">
        <TableHeader className="sr-only">
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Task</TableHead>
            <TableHead>Last seen</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <motion.tbody className="[&_tr:last-child]:border-b-0" variants={rowStaggerVariants}>
          {sessions.map((session, index) => (
            <HomeSessionRow
              key={session.sessionId}
              completionChecks={completionChecks}
              notifications={notifications}
              now={now}
              onDelete={onDelete}
              onNotificationClear={onNotificationClear}
              onNotificationToggle={onNotificationToggle}
              onPresetAction={onPresetAction}
              onPresetSelection={onPresetSelection}
              onSetArchived={onSetArchived}
              onUpdateSessionCompletionCheckConfig={onUpdateSessionCompletionCheckConfig}
              openActionsSessionId={openActionsSessionId}
              selectedSessionPreset={
                pendingSessionPresets[session.sessionId] ??
                session.preset ??
                session.effectivePreset ??
                "infinite"
              }
              session={session}
              sessionRef={sessionRefs.get(session.sessionId) ?? "C0"}
              setOpenActionsSessionId={setOpenActionsSessionId}
              showArchivedSessions={showArchivedSessions}
              tableIndex={index}
            />
          ))}
        </motion.tbody>
      </Table>
    </motion.div>
  );
}

function SessionsListSection({
  completionChecks,
  notifications,
  now,
  onDelete,
  onNotificationClear,
  onNotificationToggle,
  onPresetAction,
  onPresetSelection,
  onSetArchived,
  onToggleArchivedSessions,
  onUpdateSessionCompletionCheckConfig,
  openActionsSessionId,
  pendingSessionPresets,
  sessionRefs,
  setOpenActionsSessionId,
  sessions,
  showArchivedSessions,
}: {
  completionChecks: CompletionCheck[];
  notifications: LoopNotification[];
  now: number;
  onDelete: (sessionId: string) => void;
  onNotificationClear: (sessionId: string) => void;
  onNotificationToggle: (session: LoopSession, notificationId: string, checked: boolean) => void;
  onPresetAction: (session: LoopSession) => void;
  onPresetSelection: (session: LoopSession, nextPreset: LoopPreset) => void;
  onSetArchived: (sessionId: string, archived: boolean) => void;
  onToggleArchivedSessions: () => void;
  onUpdateSessionCompletionCheckConfig: (
    sessionId: string,
    completionCheckId: string | null,
    waitForReplyAfterCompletion: boolean,
  ) => void;
  openActionsSessionId: string | null;
  pendingSessionPresets: Record<string, LoopPreset>;
  sessionRefs: Map<string, string>;
  setOpenActionsSessionId: (sessionId: string | null) => void;
  sessions: LoopSession[];
  showArchivedSessions: boolean;
}) {
  const groupedSessions = groupSessionsByProject(sessions);

  return (
    <motion.div
      key={showArchivedSessions ? "archived-chats" : "registered-chats"}
      animate="show"
      className="space-y-3"
      exit="exit"
      initial="hidden"
      variants={staggerContainerVariants}
    >
      <motion.div className="flex items-end justify-between gap-4" variants={contentFadeVariants}>
        <SectionHeading
          showArchivedSessions={showArchivedSessions}
          onToggleArchivedSessions={onToggleArchivedSessions}
        />
      </motion.div>
      <div className="space-y-7">
        {groupedSessions.map((group) => (
          <section key={group.projectLabel} className="space-y-1.5">
            <ProjectGroupHeading count={group.sessions.length} projectLabel={group.projectLabel} />
            <HomeSessionsTable
              completionChecks={completionChecks}
              notifications={notifications}
              now={now}
              onDelete={onDelete}
              onNotificationClear={onNotificationClear}
              onNotificationToggle={onNotificationToggle}
              onPresetAction={onPresetAction}
              onPresetSelection={onPresetSelection}
              onSetArchived={onSetArchived}
              onUpdateSessionCompletionCheckConfig={onUpdateSessionCompletionCheckConfig}
              openActionsSessionId={openActionsSessionId}
              pendingSessionPresets={pendingSessionPresets}
              sessionRefs={sessionRefs}
              sessions={group.sessions}
              setOpenActionsSessionId={setOpenActionsSessionId}
              showArchivedSessions={showArchivedSessions}
            />
          </section>
        ))}
      </div>
    </motion.div>
  );
}

export function HomeSessionsSection({
  completionChecks,
  isLoading,
  notifications,
  now,
  onDelete,
  onNotificationClear,
  onNotificationToggle,
  onPresetAction,
  onPresetSelection,
  onSetArchived,
  onToggleArchivedSessions,
  onUpdateSessionCompletionCheckConfig,
  openActionsSessionId,
  pendingSessionPresets,
  sessionRefs,
  sessions,
  setOpenActionsSessionId,
  showArchivedSessions,
  snapshot,
}: {
  completionChecks: CompletionCheck[];
  isLoading: boolean;
  notifications: LoopNotification[];
  now: number;
  onDelete: (sessionId: string) => void;
  onNotificationClear: (sessionId: string) => void;
  onNotificationToggle: (session: LoopSession, notificationId: string, checked: boolean) => void;
  onPresetAction: (session: LoopSession) => void;
  onPresetSelection: (session: LoopSession, nextPreset: LoopPreset) => void;
  onSetArchived: (sessionId: string, archived: boolean) => void;
  onToggleArchivedSessions: () => void;
  onUpdateSessionCompletionCheckConfig: (
    sessionId: string,
    completionCheckId: string | null,
    waitForReplyAfterCompletion: boolean,
  ) => void;
  openActionsSessionId: string | null;
  pendingSessionPresets: Record<string, LoopPreset>;
  sessionRefs: Map<string, string>;
  sessions: LoopSession[];
  setOpenActionsSessionId: (sessionId: string | null) => void;
  showArchivedSessions: boolean;
  snapshot: LoopndrollSnapshot | null;
}) {
  return (
    <AnimatePresence initial={false} mode="wait">
      {sessions.length === 0 ? (
        isLoading || !snapshot ? null : (
          <EmptySessionsState
            showArchivedSessions={showArchivedSessions}
            onToggleArchivedSessions={onToggleArchivedSessions}
          />
        )
      ) : (
        <SessionsListSection
          completionChecks={completionChecks}
          notifications={notifications}
          now={now}
          onDelete={onDelete}
          onNotificationClear={onNotificationClear}
          onNotificationToggle={onNotificationToggle}
          onPresetAction={onPresetAction}
          onPresetSelection={onPresetSelection}
          onSetArchived={onSetArchived}
          onToggleArchivedSessions={onToggleArchivedSessions}
          onUpdateSessionCompletionCheckConfig={onUpdateSessionCompletionCheckConfig}
          openActionsSessionId={openActionsSessionId}
          pendingSessionPresets={pendingSessionPresets}
          sessionRefs={sessionRefs}
          setOpenActionsSessionId={setOpenActionsSessionId}
          sessions={sessions}
          showArchivedSessions={showArchivedSessions}
        />
      )}
    </AnimatePresence>
  );
}
