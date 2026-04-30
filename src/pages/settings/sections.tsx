import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
  CheckCircle,
  DownloadSimple,
  DotsThree,
  Info,
  Plus,
  ShieldCheck,
  SlackLogo,
  TelegramLogo,
} from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  CompletionCheck,
  HookLifecycleStatus,
  HookRemovalWatcherStatus,
  LoopNotification,
} from "@/lib/loopndroll";
import type { AppUpdateState } from "@/lib/app-update";
import {
  getNotificationChannelLabel,
  SLACK_WEBHOOK_URL_KEYCHAIN_REF_PREFIX,
  settingsSectionCardClassName,
  settingsSectionFooterClassName,
  TELEGRAM_BOT_TOKEN_KEYCHAIN_REF_PREFIX,
  type SettingsFormValues,
} from "./common";

export function DefaultPromptSection(props: {
  defaultPromptError: string | undefined;
  form: {
    register: ReturnType<typeof import("react-hook-form").useForm<SettingsFormValues>>["register"];
  };
  onSubmit: () => void;
}) {
  return (
    <Card className={`${settingsSectionCardClassName} gap-4 pt-4`}>
      <CardHeader className="gap-2">
        <CardTitle className="font-semibold">Continue prompt</CardTitle>
        <CardDescription className="leading-normal">
          Sent to Codex when completion is blocked, so the task continues instead of stopping.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <form
            className="space-y-8"
            id="default-prompt-form"
            onSubmit={(event) => {
              event.preventDefault();
              props.onSubmit();
            }}
          >
            <Field data-invalid={Boolean(props.defaultPromptError)}>
              <FieldContent>
                <FieldLabel className="sr-only" htmlFor="default-prompt">
                  Prompt
                </FieldLabel>
                <Textarea
                  aria-invalid={Boolean(props.defaultPromptError)}
                  className="min-h-24 w-full bg-input px-3 py-2.5 tracking-tight focus-visible:bg-background"
                  id="default-prompt"
                  rows={4}
                  {...props.form.register("defaultPrompt")}
                />
                {props.defaultPromptError ? (
                  <FieldError>{props.defaultPromptError}</FieldError>
                ) : null}
              </FieldContent>
            </Field>
          </form>
        </FieldGroup>
      </CardContent>
      <CardFooter className={`${settingsSectionFooterClassName} justify-end`}>
        <Button form="default-prompt-form" size="sm" type="submit">
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}

function formatUpdateTimestamp(value: string | null) {
  if (!value) {
    return "Never checked";
  }

  return new Date(value).toLocaleString();
}

function getUpdateStatusLabel(state: AppUpdateState | null, isLoading: boolean) {
  if (isLoading) {
    return "Loading update state...";
  }

  if (!state) {
    return "Update state unavailable.";
  }

  if (!state.isConfigured || state.currentChannel === "dev") {
    return "Auto-updates are disabled for this build.";
  }

  if (state.isUpdateReady) {
    return "Update downloaded. Restart to install.";
  }

  if (state.isDownloading) {
    return state.statusMessage ?? "Downloading update...";
  }

  if (state.isUpdateAvailable) {
    return state.availableVersion
      ? `Version ${state.availableVersion} is available.`
      : "An update is available.";
  }

  if (state.errorMessage) {
    return state.errorMessage;
  }

  return "No update available.";
}

function isMutableGithubLatestFeed(releaseBaseUrl: string | null) {
  return releaseBaseUrl?.includes("/releases/latest/download") ?? false;
}

type AppUpdateSectionProps = {
  isLoading: boolean;
  state: AppUpdateState | null;
  onApplyUpdate: () => void;
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
};

function AppUpdateDetails(props: { isLoading: boolean; state: AppUpdateState | null }) {
  const statusLabel = getUpdateStatusLabel(props.state, props.isLoading);

  return (
    <CardContent>
      <div className="grid gap-3 rounded-xl border border-border/60 bg-muted/20 p-3 text-sm md:grid-cols-2">
        <div>
          <div className="text-xs text-muted-foreground">Current version</div>
          <div className="font-medium text-foreground">
            {props.state?.currentVersion ?? "Unknown"}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Channel</div>
          <div className="font-medium text-foreground">
            {props.state?.currentChannel ?? "Unknown"}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Last checked</div>
          <div className="font-medium text-foreground">
            {formatUpdateTimestamp(props.state?.lastCheckedAt ?? null)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Status</div>
          <div className="font-medium text-foreground">{statusLabel}</div>
        </div>
        <div className="md:col-span-2">
          <div className="text-xs text-muted-foreground">Release feed</div>
          <div className="break-all font-mono text-xs text-foreground">
            {props.state?.releaseBaseUrl ?? "Not configured"}
          </div>
        </div>
      </div>
      {isMutableGithubLatestFeed(props.state?.releaseBaseUrl ?? null) ? (
        <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
          This build uses GitHub's mutable latest-release feed. That is the Electrobun-supported
          GitHub auto-update path, but release builds should opt into it explicitly or use a
          controlled stable feed.
        </p>
      ) : null}
    </CardContent>
  );
}

function AppUpdateAction(props: AppUpdateSectionProps) {
  const canCheck =
    !props.isLoading &&
    !!props.state &&
    props.state.isConfigured &&
    props.state.currentChannel !== "dev" &&
    !props.state.isChecking &&
    !props.state.isDownloading;
  const actionLabel = props.state?.isUpdateReady
    ? "Restart to Update"
    : props.state?.isUpdateAvailable
      ? "Download Update"
      : "Check for Updates";

  return (
    <Button
      disabled={!canCheck && !props.state?.isUpdateReady && !props.state?.isUpdateAvailable}
      onClick={() => {
        if (props.state?.isUpdateReady) {
          props.onApplyUpdate();
          return;
        }

        if (props.state?.isUpdateAvailable) {
          props.onDownloadUpdate();
          return;
        }

        props.onCheckForUpdates();
      }}
      size="sm"
      type="button"
    >
      <ArrowClockwise weight="bold" />
      {actionLabel}
    </Button>
  );
}

export function AppUpdateSection(props: AppUpdateSectionProps) {
  return (
    <Card className={`${settingsSectionCardClassName} gap-3 pt-4`}>
      <CardHeader className="pb-0">
        <div className="flex items-center gap-2">
          <DownloadSimple aria-hidden="true" className="text-blue-300" size={22} weight="fill" />
          <CardTitle className="font-semibold">App updates</CardTitle>
        </div>
        <CardDescription className="leading-normal">
          Check, download, and apply signed release updates from the configured release feed.
        </CardDescription>
      </CardHeader>
      <AppUpdateDetails isLoading={props.isLoading} state={props.state} />
      <CardFooter className={`${settingsSectionFooterClassName} gap-2 [.border-t]:pt-3 pb-3`}>
        <p className="text-sm text-muted-foreground">
          Direct downloads should point at a versioned release artifact, not a mutable latest URL.
        </p>
        <div className="flex min-h-8 min-w-[220px] items-center justify-end gap-2">
          <AppUpdateAction {...props} />
        </div>
      </CardFooter>
    </Card>
  );
}

function EmptyState({ description, title }: { description: string; title: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-6 text-center">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

const telegramSetupSteps = [
  {
    title: "Open BotFather in Telegram",
    description: "Start a chat with @BotFather. This is Telegram's official bot manager.",
  },
  {
    title: "Send /newbot",
    description: "BotFather starts the bot creation flow. Loopndroll does not create bots itself.",
  },
  {
    title: "Choose the display name",
    description: "This is the human-facing name people see in Telegram, for example Loopndroll.",
  },
  {
    title: "Choose the username",
    description:
      "Telegram requires a unique username ending in bot, for example my_loopndroll_bot.",
  },
  {
    title: "Copy the bot token",
    description:
      "Paste it only into Loopndroll. New tokens are stored in macOS Keychain by default.",
  },
  {
    title: "Send one direct message to the bot",
    description: "Telegram only exposes your DM chat to Loopndroll after you message the bot once.",
  },
  {
    title: "Select the DM chat and save",
    description:
      "Loopndroll filters out groups and channels. v1 remote control is direct-message only.",
  },
  {
    title: "Attach the notification to chats",
    description:
      "Use Home to attach this Telegram notification globally or to specific Codex chats.",
  },
] as const;

const telegramSecurityDefaults = [
  "Direct messages only",
  "Groups and channels blocked for control",
  "No public webhook or external server required",
  "New tokens stored in macOS Keychain",
  "SQLite stores only a non-secret Keychain reference",
  "Passive wake disabled in v1",
  "Telegram input only works while a hook-backed chat is waiting",
] as const;

const slackSetupSteps = [
  {
    title: "Open Slack App settings",
    description: "Create or reuse a Slack app in the workspace that should receive stop updates.",
  },
  {
    title: "Enable Incoming Webhooks",
    description: "Slack generates the destination URL after you choose a channel.",
  },
  {
    title: "Choose the target channel",
    description: "Pick a channel that is safe for Codex final replies and operator visibility.",
  },
  {
    title: "Copy the webhook URL",
    description: "Paste the URL into Loopndroll. It is stored locally for Stop-event delivery.",
  },
  {
    title: "Save the notification",
    description: "Use the Slack option in Add Notification and give it a recognizable label.",
  },
  {
    title: "Attach it to chats",
    description: "Use Home to attach this Slack notification globally or to specific Codex chats.",
  },
] as const;

const slackDeliveryDefaults = [
  "Outgoing Stop-event delivery only",
  "No inbound Slack control in v1",
  "No public Loopndroll server required",
  "Uses Slack Incoming Webhook URL",
  "Attach globally or per chat",
  "Delivery failures stay visible in app state",
] as const;

function SetupChecklistStep(props: {
  checked: boolean;
  description: string;
  index: number;
  onCheckedChange: (checked: boolean) => void;
  title: string;
}) {
  return (
    <li className="rounded-xl border border-border/60 bg-muted/20 p-3">
      <div className="flex items-start gap-3">
        <Checkbox
          aria-label={`Mark step ${props.index + 1} complete`}
          checked={props.checked}
          className="mt-0.5"
          onCheckedChange={(checked) => props.onCheckedChange(checked === true)}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start gap-2">
            <p className="text-sm font-medium text-foreground">
              {props.index + 1}. {props.title}
            </p>
            <Info aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" size={15} />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{props.description}</p>
        </div>
      </div>
    </li>
  );
}

function SetupDefaultsPanel(props: { defaults: readonly string[]; title: string }) {
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-200">
        <ShieldCheck aria-hidden="true" size={18} weight="fill" />
        {props.title}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {props.defaults.map((item) => (
          <div key={item} className="flex items-start gap-2 text-xs text-muted-foreground">
            <CheckCircle aria-hidden="true" className="mt-0.5 text-emerald-300" size={15} />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationSetupCard(props: {
  accentClassName: string;
  buttonLabel: string;
  defaults: readonly string[];
  defaultsTitle: string;
  description: string;
  footerText: string;
  icon: ReactNode;
  onAdd: () => void;
  steps: readonly { description: string; title: string }[];
  title: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [checkedSteps, setCheckedSteps] = useState(() => new Set<number>());

  function setStepChecked(index: number, checked: boolean) {
    setCheckedSteps((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return next;
    });
  }

  return (
    <Card className={`${settingsSectionCardClassName} gap-3 pt-4`}>
      <CardHeader className="pb-0">
        <button
          aria-expanded={isOpen}
          className="flex w-full items-center justify-between gap-4 text-left"
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={props.accentClassName}>{props.icon}</span>
              <CardTitle className="font-semibold">{props.title}</CardTitle>
            </div>
            <CardDescription className="max-w-[620px] leading-normal">
              {props.description}
            </CardDescription>
          </div>
          <span className="rounded-full border border-border bg-muted/30 p-1 text-muted-foreground">
            {isOpen ? (
              <CaretDown aria-hidden="true" size={16} weight="bold" />
            ) : (
              <CaretRight aria-hidden="true" size={16} weight="bold" />
            )}
          </span>
        </button>
      </CardHeader>
      {isOpen ? (
        <CardContent className="space-y-5">
          <ol className="grid gap-2 md:grid-cols-2">
            {props.steps.map((step, index) => (
              <SetupChecklistStep
                key={step.title}
                checked={checkedSteps.has(index)}
                description={step.description}
                index={index}
                title={step.title}
                onCheckedChange={(checked) => setStepChecked(index, checked)}
              />
            ))}
          </ol>
          <SetupDefaultsPanel defaults={props.defaults} title={props.defaultsTitle} />
        </CardContent>
      ) : null}
      <CardFooter className={`${settingsSectionFooterClassName} gap-2 [.border-t]:pt-3 pb-3`}>
        <p className="text-sm text-muted-foreground">{props.footerText}</p>
        <div className="flex min-h-8 min-w-[220px] items-center justify-end gap-2">
          <Button onClick={props.onAdd} size="sm" type="button">
            <Plus weight="bold" />
            {props.buttonLabel}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

export function NotificationSetupSections(props: {
  onAddSlackNotification: () => void;
  onAddTelegramNotification: () => void;
}) {
  return (
    <div className="space-y-5">
      <NotificationSetupCard
        accentClassName="text-blue-400"
        buttonLabel="Add Telegram Notification"
        defaults={telegramSecurityDefaults}
        defaultsTitle="Security defaults"
        description="Create a private Telegram bot, connect your direct message chat, and keep the token out of the local database."
        footerText="Loopndroll builds the Telegram API URL, discovers chats, filters unsafe destinations, and stores new tokens in Keychain."
        icon={<TelegramLogo aria-hidden="true" size={22} weight="fill" />}
        steps={telegramSetupSteps}
        title="Telegram setup instructions"
        onAdd={props.onAddTelegramNotification}
      />
      <NotificationSetupCard
        accentClassName="text-emerald-300"
        buttonLabel="Add Slack Notification"
        defaults={slackDeliveryDefaults}
        defaultsTitle="Delivery defaults"
        description="Create a Slack Incoming Webhook destination for Codex Stop-event replies."
        footerText="Loopndroll sends final replies to a Slack Incoming Webhook URL; Slack is outbound delivery only in v1."
        icon={<SlackLogo aria-hidden="true" size={22} weight="fill" />}
        steps={slackSetupSteps}
        title="Slack setup instructions"
        onAdd={props.onAddSlackNotification}
      />
    </div>
  );
}

export function NotificationsSection(props: {
  notifications: LoopNotification[];
  onDocsClick: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  onEdit: (notification: LoopNotification) => void;
  onRemove: (notificationId: string) => void;
}) {
  return (
    <Card className={settingsSectionCardClassName}>
      <CardHeader>
        <CardTitle className="font-semibold">Notifications</CardTitle>
        <CardDescription className="leading-normal">
          Control-mode notifications require an active Loopndroll mode. Add Slack or Telegram
          destinations, then attach them globally or to specific chats.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {props.notifications.length === 0 ? (
          <EmptyState
            description="Add a Slack or Telegram destination for Stop-event delivery."
            title="No notifications yet"
          />
        ) : (
          <Table>
            <TableBody>
              {props.notifications.map((notification) => (
                <TableRow key={notification.id} className="hover:bg-transparent">
                  <TableCell className="pl-0 font-medium">{notification.label}</TableCell>
                  <TableCell className="pr-0 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`Open actions for ${getNotificationChannelLabel(notification)} notification`}
                        className="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-muted"
                      >
                        <DotsThree aria-hidden="true" weight="bold" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => props.onEdit(notification)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => props.onRemove(notification.id)}
                            variant="destructive"
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <CardFooter className={`${settingsSectionFooterClassName} gap-2`}>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <span>Learn more in the </span>
          <a
            className="text-blue-400 transition-colors hover:text-blue-300"
            href="https://github.com/lnikell/loopndroll?tab=readme-ov-file#telegram-commands"
            onClick={props.onDocsClick}
            rel="noreferrer"
            target="_blank"
          >
            documentation
          </a>
        </div>
        <div className="text-sm text-muted-foreground">
          Use the setup cards below to add a channel.
        </div>
      </CardFooter>
    </Card>
  );
}

export function ExtrasSection(props: {
  mirrorEnabled: boolean;
  onToggleMirror: (enabled: boolean) => void;
}) {
  return (
    <Card className={`${settingsSectionCardClassName} gap-3 pt-4`}>
      <CardHeader className="pb-0">
        <CardTitle className="font-semibold">Extras</CardTitle>
        <CardDescription className="leading-normal">
          Optional delivery behavior that is separate from control modes.
        </CardDescription>
      </CardHeader>
      <CardFooter className={`${settingsSectionFooterClassName} gap-2 [.border-t]:pt-3 pb-3`}>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            Mirror conversation to connected channels
          </p>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Sends observed Codex user prompts and assistant Stop replies to attached Telegram and
            Slack destinations. Telegram replies are still ignored unless Await Reply is active.
          </p>
        </div>
        <Switch
          aria-label="Mirror conversation to connected channels"
          checked={props.mirrorEnabled}
          onCheckedChange={props.onToggleMirror}
        />
      </CardFooter>
    </Card>
  );
}

export function CompletionChecksSection(props: {
  completionChecks: CompletionCheck[];
  onAdd: () => void;
  onDocsClick: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  onEdit: (completionCheck: CompletionCheck) => void;
  onRemove: (completionCheckId: string) => void;
}) {
  return (
    <Card className={settingsSectionCardClassName}>
      <CardHeader>
        <CardTitle className="font-semibold">Completion Checks</CardTitle>
        <CardDescription className="leading-normal">
          Register reusable command groups that Completion checks mode can run before a chat is
          allowed to finish.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {props.completionChecks.length === 0 ? (
          <EmptyState
            description="Add named command groups, then attach one from the Completion checks card on Home."
            title="No completion checks yet"
          />
        ) : (
          <Table>
            <TableBody>
              {props.completionChecks.map((completionCheck) => (
                <TableRow key={completionCheck.id} className="hover:bg-transparent">
                  <TableCell className="pl-0">
                    <div className="space-y-0.5">
                      <p className="font-medium">{completionCheck.label}</p>
                      <p className="text-sm text-muted-foreground">
                        {completionCheck.commands.length}{" "}
                        {completionCheck.commands.length === 1 ? "command" : "commands"}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="pr-0 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`Open actions for ${completionCheck.label}`}
                        className="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-muted"
                      >
                        <DotsThree aria-hidden="true" weight="bold" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => props.onEdit(completionCheck)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => props.onRemove(completionCheck.id)}
                            variant="destructive"
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <CardFooter className={`${settingsSectionFooterClassName} gap-2`}>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <span>Learn more in the </span>
          <a
            className="text-blue-400 transition-colors hover:text-blue-300"
            href="https://github.com/lnikell/loopndroll?tab=readme-ov-file#modes"
            onClick={props.onDocsClick}
            rel="noreferrer"
            target="_blank"
          >
            documentation
          </a>
        </div>
        <div className="flex min-h-8 min-w-[220px] items-center justify-end gap-2">
          <Button onClick={props.onAdd} size="sm" type="button">
            <Plus weight="bold" />
            Add Check
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

export function HookRegistrationSection(props: {
  hasResolvedHookState: boolean;
  hookLifecycle: HookLifecycleStatus | null;
  hookRemovalWatcher: HookRemovalWatcherStatus | null;
  hooksDetected: boolean;
  hookIssues: string[];
  runtimeState: "running" | "paused" | "stopped";
  onClearHooks: () => void;
  onPauseLoopndroll: () => void;
  onRegisterHooks: () => void;
  onRevealHooksFile: () => void;
  onResumeLoopndroll: () => void;
  onStartLoopndroll: () => void;
  onStopLoopndroll: () => void;
}) {
  const runtimeStateLabel =
    props.runtimeState !== "stopped" && !props.hooksDetected
      ? "Needs registration"
      : props.runtimeState === "paused"
        ? "Paused"
        : props.runtimeState === "stopped"
          ? "Stopped"
          : "Running";

  return (
    <Card className={settingsSectionCardClassName}>
      <CardHeader>
        <CardTitle className="font-semibold">Hook Registration</CardTitle>
        <CardDescription className="leading-normal">
          Control the managed Loopndroll hook without touching other Codex hooks. Pause keeps the
          hook installed but inert. Stop removes only the Loopndroll-managed hook.
        </CardDescription>
      </CardHeader>
      {props.hookLifecycle ? (
        <CardContent>
          <div className="space-y-3 rounded-xl border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
            <div>
              <div className="font-medium text-foreground">
                Managed hooks in files: {props.hooksDetected ? "present" : "missing/incomplete"}
              </div>
              <div>Live Codex runtime load: not assumed from file state</div>
            </div>
            {props.hookIssues.length > 0 ? (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-amber-100">
                {props.hookIssues.map((issue) => (
                  <div key={issue}>{issue}</div>
                ))}
              </div>
            ) : null}
            <div className="font-medium text-foreground">{props.hookLifecycle.message}</div>
            <div>Requested: {props.hookLifecycle.requestedAction}</div>
            <div>Applied: {props.hookLifecycle.appliedAction}</div>
            <div>Deferred: {props.hookLifecycle.deferredAction}</div>
            <div>Remaining risk: {props.hookLifecycle.remainingRisk}</div>
            {props.hookRemovalWatcher ? (
              <div>
                Watcher:{" "}
                {props.hookRemovalWatcher.active
                  ? `active pid ${props.hookRemovalWatcher.pid}`
                  : "not running"}
              </div>
            ) : null}
            {props.hookLifecycle.nextAutomaticStep ? (
              <div>Next automatic step: {props.hookLifecycle.nextAutomaticStep}</div>
            ) : null}
          </div>
        </CardContent>
      ) : (
        <CardContent />
      )}
      <CardFooter className={`${settingsSectionFooterClassName} gap-2`}>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <span>State: {runtimeStateLabel}</span>
          <span aria-hidden="true">•</span>
          <span>Open</span>
          <button
            className="text-blue-400 transition-colors hover:text-blue-300"
            onClick={props.onRevealHooksFile}
            type="button"
          >
            hooks.json
          </button>
        </div>
        <div className="flex min-h-8 min-w-[220px] items-center justify-end gap-2">
          <HookRegistrationActions {...props} />
        </div>
      </CardFooter>
    </Card>
  );
}

function getPlaintextSecretCounts(notifications: LoopNotification[]) {
  return notifications.reduce(
    (counts, notification) => {
      if (
        notification.channel === "slack" &&
        notification.webhookUrl.trim().length > 0 &&
        !notification.webhookUrl.startsWith(SLACK_WEBHOOK_URL_KEYCHAIN_REF_PREFIX)
      ) {
        counts.slack += 1;
      }

      if (
        notification.channel === "telegram" &&
        notification.botToken.trim().length > 0 &&
        !notification.botToken.startsWith(TELEGRAM_BOT_TOKEN_KEYCHAIN_REF_PREFIX)
      ) {
        counts.telegram += 1;
      }

      return counts;
    },
    { slack: 0, telegram: 0 },
  );
}

export function SecretMigrationSection(props: {
  notifications: LoopNotification[];
  onMigrateSecrets: () => void;
}) {
  const plaintextCounts = getPlaintextSecretCounts(props.notifications);
  const totalPlaintextCount = plaintextCounts.slack + plaintextCounts.telegram;
  const hasPlaintextSecrets = totalPlaintextCount > 0;

  return (
    <Card className={`${settingsSectionCardClassName} gap-3 pt-4`}>
      <CardHeader className="pb-0">
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="text-emerald-300" size={22} weight="fill" />
          <CardTitle className="font-semibold">Secret migration</CardTitle>
        </div>
        <CardDescription className="leading-normal">
          Move legacy Telegram tokens and Slack webhook URLs from the local database into macOS
          Keychain.
        </CardDescription>
      </CardHeader>
      <CardFooter className={`${settingsSectionFooterClassName} gap-2 [.border-t]:pt-3 pb-3`}>
        <p className="text-sm text-muted-foreground">
          {hasPlaintextSecrets
            ? `${totalPlaintextCount} plaintext secret${totalPlaintextCount === 1 ? "" : "s"} found: ${plaintextCounts.telegram} Telegram, ${plaintextCounts.slack} Slack.`
            : "No plaintext notification secrets detected."}
        </p>
        <div className="flex min-h-8 min-w-[220px] items-center justify-end gap-2">
          <Button
            disabled={!hasPlaintextSecrets}
            onClick={props.onMigrateSecrets}
            size="sm"
            type="button"
          >
            Migrate to Keychain
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function HookRegistrationActions(props: {
  hasResolvedHookState: boolean;
  hooksDetected: boolean;
  runtimeState: "running" | "paused" | "stopped";
  onClearHooks: () => void;
  onPauseLoopndroll: () => void;
  onRegisterHooks: () => void;
  onResumeLoopndroll: () => void;
  onStartLoopndroll: () => void;
  onStopLoopndroll: () => void;
}) {
  if (!props.hasResolvedHookState) {
    return null;
  }

  return (
    <>
      {props.runtimeState === "running" ? (
        <>
          <Button onClick={props.onPauseLoopndroll} size="sm" type="button" variant="outline">
            Pause
          </Button>
          <Button onClick={props.onStopLoopndroll} size="sm" type="button" variant="outline">
            Stop
          </Button>
        </>
      ) : null}
      {props.runtimeState === "paused" ? (
        <>
          <Button onClick={props.onResumeLoopndroll} size="sm" type="button">
            Resume
          </Button>
          <Button onClick={props.onStopLoopndroll} size="sm" type="button" variant="outline">
            Stop
          </Button>
        </>
      ) : null}
      {props.runtimeState === "stopped" ? (
        <Button onClick={props.onStartLoopndroll} size="sm" type="button">
          Start
        </Button>
      ) : null}
      <Button
        disabled={!props.hooksDetected}
        onClick={props.onClearHooks}
        size="sm"
        type="button"
        variant="outline"
      >
        Clear managed hook
      </Button>
      {!props.hooksDetected && props.runtimeState !== "stopped" ? (
        <Button onClick={props.onRegisterHooks} size="sm" type="button">
          Register
        </Button>
      ) : null}
    </>
  );
}
