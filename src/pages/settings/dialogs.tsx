import { Controller, type UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  completionCheckSchema,
  notificationChannelItems,
  type CompletionCheckFormValues,
  type NotificationFormValues,
  type TelegramChatItem,
} from "./common";

function SlackFields({
  form,
  webhookUrlError,
}: {
  form: UseFormReturn<NotificationFormValues>;
  webhookUrlError: string | undefined;
}) {
  return (
    <Field data-invalid={Boolean(webhookUrlError)}>
      <FieldContent>
        <FieldLabel htmlFor="notification-webhook-url">Webhook URL</FieldLabel>
        <Input
          aria-invalid={Boolean(webhookUrlError)}
          id="notification-webhook-url"
          placeholder="https://hooks.slack.com/services/..."
          {...form.register("webhookUrl")}
        />
        {webhookUrlError ? <FieldError>{webhookUrlError}</FieldError> : null}
      </FieldContent>
    </Field>
  );
}

function TelegramBotTokenField({
  botTokenError,
  form,
  onDocsClick,
}: {
  botTokenError: string | undefined;
  form: UseFormReturn<NotificationFormValues>;
  onDocsClick: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Field data-invalid={Boolean(botTokenError)}>
      <FieldContent>
        <FieldLabel htmlFor="notification-bot-token">API Token</FieldLabel>
        <Input
          aria-invalid={Boolean(botTokenError)}
          id="notification-bot-token"
          placeholder="<bot-id>:<bot-secret>"
          {...form.register("botToken", {
            onChange: () => {
              form.setValue("telegramChatId", "");
              form.setValue("telegramChatUsername", "");
              form.setValue("telegramChatDisplayName", "");
            },
          })}
        />
        <FieldDescription>
          <a
            className="text-blue-400 transition-colors hover:text-blue-300"
            href="https://github.com/lnikell/loopndroll?tab=readme-ov-file#telegram-setup"
            onClick={onDocsClick}
            rel="noreferrer"
            target="_blank"
          >
            Where do I find this?
          </a>
        </FieldDescription>
        {botTokenError ? <FieldError>{botTokenError}</FieldError> : null}
      </FieldContent>
    </Field>
  );
}

function TelegramChatField({
  form,
  isLoadingTelegramChats,
  normalizedNotificationBotToken,
  selectedTelegramChat,
  shouldShowTelegramChatsError,
  telegramChatIdError,
  telegramChatItems,
  telegramChatsError,
}: {
  form: UseFormReturn<NotificationFormValues>;
  isLoadingTelegramChats: boolean;
  normalizedNotificationBotToken: string;
  selectedTelegramChat: TelegramChatItem | null;
  shouldShowTelegramChatsError: boolean;
  telegramChatIdError: string | undefined;
  telegramChatItems: TelegramChatItem[];
  telegramChatsError: string | null;
}) {
  const renderEmptyState = () =>
    shouldShowTelegramChatsError
      ? "Unable to load chats"
      : normalizedNotificationBotToken.length === 0
        ? "Enter a token to load chats"
        : isLoadingTelegramChats
          ? "Loading chats..."
          : "No direct-message chats found";

  return (
    <Field data-invalid={Boolean(telegramChatIdError)}>
      <FieldContent>
        <FieldLabel htmlFor="notification-telegram-chat">Chat</FieldLabel>
        <Combobox
          items={
            selectedTelegramChat ? [selectedTelegramChat, ...telegramChatItems] : telegramChatItems
          }
          isItemEqualToValue={(item, value) => item.value === value.value}
          itemToStringLabel={(item) => item.label}
          itemToStringValue={(item) => item.value}
          onValueChange={(chat) => {
            form.setValue("telegramChatId", chat?.chatId ?? "", {
              shouldDirty: true,
              shouldValidate: true,
            });
            form.setValue("telegramChatUsername", chat?.username ?? "", { shouldDirty: true });
            form.setValue("telegramChatDisplayName", chat?.displayName ?? "", {
              shouldDirty: true,
            });
            form.clearErrors("telegramChatId");
          }}
          value={selectedTelegramChat}
        >
          <ComboboxInput
            disabled={normalizedNotificationBotToken.length === 0 || isLoadingTelegramChats}
            placeholder={
              normalizedNotificationBotToken.length === 0
                ? "Enter token first"
                : isLoadingTelegramChats
                  ? "Loading chats..."
                  : "Search direct messages"
            }
          />
          <ComboboxContent>
            <ComboboxEmpty>{renderEmptyState()}</ComboboxEmpty>
            <ComboboxList>
              {(chat) => (
                <ComboboxItem key={chat.value} value={chat}>
                  <span className="truncate font-medium">{chat.primaryLabel}</span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        <FieldDescription>
          Send the bot a direct message, and it will appear here. Groups and channels are ignored.
        </FieldDescription>
        {shouldShowTelegramChatsError ? (
          <FieldError>{telegramChatsError}</FieldError>
        ) : telegramChatIdError ? (
          <FieldError>{telegramChatIdError}</FieldError>
        ) : null}
      </FieldContent>
    </Field>
  );
}

function TelegramFields(props: {
  botTokenError: string | undefined;
  form: UseFormReturn<NotificationFormValues>;
  isLoadingTelegramChats: boolean;
  normalizedNotificationBotToken: string;
  onDocsClick: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  selectedTelegramChat: TelegramChatItem | null;
  shouldShowTelegramChatsError: boolean;
  telegramChatIdError: string | undefined;
  telegramChatItems: TelegramChatItem[];
  telegramChatsError: string | null;
}) {
  return (
    <>
      <TelegramBotTokenField
        botTokenError={props.botTokenError}
        form={props.form}
        onDocsClick={props.onDocsClick}
      />
      <TelegramChatField
        form={props.form}
        isLoadingTelegramChats={props.isLoadingTelegramChats}
        normalizedNotificationBotToken={props.normalizedNotificationBotToken}
        selectedTelegramChat={props.selectedTelegramChat}
        shouldShowTelegramChatsError={props.shouldShowTelegramChatsError}
        telegramChatIdError={props.telegramChatIdError}
        telegramChatItems={props.telegramChatItems}
        telegramChatsError={props.telegramChatsError}
      />
    </>
  );
}

function NotificationDialogFooter(props: { editingNotificationId: string | null }) {
  return (
    <DialogFooter className="-mx-6 -mb-6 mt-2 border-t bg-muted/50 px-6 py-4 sm:justify-end">
      <DialogClose asChild>
        <Button size="sm" type="button" variant="outline">
          Cancel
        </Button>
      </DialogClose>
      <Button size="sm" type="submit">
        {props.editingNotificationId ? "Save changes" : "Create"}
      </Button>
    </DialogFooter>
  );
}

export function NotificationDialog(props: {
  botTokenError: string | undefined;
  editingNotificationId: string | null;
  form: UseFormReturn<NotificationFormValues>;
  isLoadingTelegramChats: boolean;
  isOpen: boolean;
  normalizedNotificationBotToken: string;
  onDocsClick: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event?: React.BaseSyntheticEvent) => Promise<void>;
  selectedTelegramChat: TelegramChatItem | null;
  shouldShowTelegramChatsError: boolean;
  telegramChatIdError: string | undefined;
  telegramChatItems: TelegramChatItem[];
  telegramChatsError: string | null;
  webhookUrlError: string | undefined;
}) {
  const notificationChannel = props.form.watch("channel");

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <form className="grid gap-6" onSubmit={props.onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {props.editingNotificationId ? "Edit Notification" : "Add Notification"}
            </DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldContent>
                <FieldLabel htmlFor="notification-label">Label</FieldLabel>
                <Input
                  id="notification-label"
                  placeholder={notificationChannel === "slack" ? "Slack" : "Telegram"}
                  {...props.form.register("label")}
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldContent>
                <FieldLabel htmlFor="notification-channel">Channel</FieldLabel>
                <Controller
                  control={props.form.control}
                  name="channel"
                  render={({ field }) => (
                    <Select
                      items={notificationChannelItems}
                      onValueChange={(value) => {
                        if (value) {
                          props.form.clearErrors();
                          field.onChange(value);
                        }
                      }}
                      value={field.value}
                    >
                      <SelectTrigger className="w-full" id="notification-channel">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="slack">Slack</SelectItem>
                          <SelectItem value="telegram">Telegram</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
              </FieldContent>
            </Field>
            {notificationChannel === "slack" ? (
              <SlackFields form={props.form} webhookUrlError={props.webhookUrlError} />
            ) : (
              <TelegramFields
                botTokenError={props.botTokenError}
                form={props.form}
                isLoadingTelegramChats={props.isLoadingTelegramChats}
                normalizedNotificationBotToken={props.normalizedNotificationBotToken}
                onDocsClick={props.onDocsClick}
                selectedTelegramChat={props.selectedTelegramChat}
                shouldShowTelegramChatsError={props.shouldShowTelegramChatsError}
                telegramChatIdError={props.telegramChatIdError}
                telegramChatItems={props.telegramChatItems}
                telegramChatsError={props.telegramChatsError}
              />
            )}
          </FieldGroup>
          <NotificationDialogFooter editingNotificationId={props.editingNotificationId} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CompletionCheckDialog(props: {
  commandsError: string | undefined;
  editingCompletionCheckId: string | null;
  form: UseFormReturn<CompletionCheckFormValues>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event?: React.BaseSyntheticEvent) => Promise<void>;
}) {
  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <form className="grid gap-6" onSubmit={props.onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {props.editingCompletionCheckId ? "Edit Completion Check" : "Add Completion Check"}
            </DialogTitle>
            <DialogDescription>
              Create reusable command groups that Completion checks mode runs before Codex is
              allowed to finish.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldContent>
                <FieldLabel htmlFor="completion-check-label">Name</FieldLabel>
                <Input
                  id="completion-check-label"
                  placeholder="Frontend checks"
                  {...props.form.register("label")}
                />
              </FieldContent>
            </Field>
            <Field data-invalid={Boolean(props.commandsError)}>
              <FieldContent>
                <FieldLabel htmlFor="completion-check-commands">Commands</FieldLabel>
                <Textarea
                  aria-invalid={Boolean(props.commandsError)}
                  className="min-h-40 bg-input px-3 py-2.5 tracking-tight focus-visible:bg-background"
                  id="completion-check-commands"
                  placeholder={"pnpm lint\npnpm test"}
                  rows={7}
                  {...props.form.register("commandsText", {
                    validate: (value) => {
                      const result = completionCheckSchema.shape.commandsText.safeParse(value);
                      return result.success || result.error.issues[0]?.message;
                    },
                  })}
                />
                <FieldDescription>
                  Enter one shell command per line. Commands run sequentially and stop on the first
                  failure.
                </FieldDescription>
                {props.commandsError ? <FieldError>{props.commandsError}</FieldError> : null}
              </FieldContent>
            </Field>
          </FieldGroup>
          <DialogFooter className="-mx-6 -mb-6 mt-2 border-t bg-muted/50 px-6 py-4 sm:justify-end">
            <DialogClose asChild>
              <Button size="sm" type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button size="sm" type="submit">
              {props.editingCompletionCheckId ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
