import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useForm } from "react-hook-form";
import {
  getTelegramChats,
  type CompletionCheck,
  type LoopNotification,
  type TelegramChatOption,
} from "@/lib/loopndroll";
import { useLoopndrollState } from "@/lib/use-loopndroll-state";
import {
  completionCheckSchema,
  createEmptyCompletionCheckValues,
  createEmptyNotificationValues,
  getTelegramChatErrorMessage,
  isTransientTelegramChatError,
  mergeTelegramChats,
  notificationSchema,
  parseCommandsText,
  toTelegramChatItem,
  type CompletionCheckFormValues,
  type NotificationFormValues,
  type SettingsFormValues,
} from "./common";
import {
  filterTelegramDirectMessageChats,
  inferTelegramChatKind,
} from "@/shared/telegram-chat-policy";

function createDefaultPromptSubmitHandler(args: {
  savePrompt: ReturnType<typeof useLoopndrollState>["savePrompt"];
  settingsForm: ReturnType<typeof useForm<SettingsFormValues>>;
}) {
  return args.settingsForm.handleSubmit((values) =>
    args.savePrompt(values.defaultPrompt).then(() => {
      args.settingsForm.reset({ defaultPrompt: values.defaultPrompt });
    }),
  );
}

function createNotificationSubmitHandler(args: {
  addCompletionCheck: ReturnType<typeof useLoopndrollState>["addCompletionCheck"];
  addNotification: ReturnType<typeof useLoopndrollState>["addNotification"];
  completionCheckForm: ReturnType<typeof useForm<CompletionCheckFormValues>>;
  editCompletionCheck: ReturnType<typeof useLoopndrollState>["editCompletionCheck"];
  editNotification: ReturnType<typeof useLoopndrollState>["editNotification"];
  editingCompletionCheckId: string | null;
  editingNotificationId: string | null;
  notificationForm: ReturnType<typeof useForm<NotificationFormValues>>;
  savePrompt: ReturnType<typeof useLoopndrollState>["savePrompt"];
  setEditingCompletionCheckId: (value: string | null) => void;
  setEditingNotificationId: (value: string | null) => void;
  setIsCompletionCheckDialogOpen: (value: boolean) => void;
  setIsNotificationDialogOpen: (value: boolean) => void;
}) {
  return args.notificationForm.handleSubmit(async (values) => {
    const parsed = notificationSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const fieldName = issue.path[0];
        if (typeof fieldName === "string") {
          args.notificationForm.setError(fieldName as keyof NotificationFormValues, {
            message: issue.message,
          });
        }
      }
      return;
    }

    if (args.editingNotificationId) {
      if (values.channel === "slack") {
        await args.editNotification({
          id: args.editingNotificationId,
          label: values.label.trim(),
          channel: "slack",
          webhookUrl: values.webhookUrl.trim(),
        });
      } else {
        await args.editNotification({
          id: args.editingNotificationId,
          label: values.label.trim(),
          channel: "telegram",
          chatId: values.telegramChatId.trim(),
          botToken: values.botToken.trim(),
          chatUsername: values.telegramChatUsername.trim() || null,
          chatDisplayName: values.telegramChatDisplayName.trim() || null,
        });
      }
    } else if (values.channel === "slack") {
      await args.addNotification({
        label: values.label.trim(),
        channel: "slack",
        webhookUrl: values.webhookUrl.trim(),
      });
    } else {
      await args.addNotification({
        label: values.label.trim(),
        channel: "telegram",
        chatId: values.telegramChatId.trim(),
        botToken: values.botToken.trim(),
        chatUsername: values.telegramChatUsername.trim() || null,
        chatDisplayName: values.telegramChatDisplayName.trim() || null,
      });
    }

    args.notificationForm.reset(createEmptyNotificationValues());
    args.setEditingNotificationId(null);
    args.setIsNotificationDialogOpen(false);
  });
}

function createCompletionCheckSubmitHandler(args: {
  addCompletionCheck: ReturnType<typeof useLoopndrollState>["addCompletionCheck"];
  completionCheckForm: ReturnType<typeof useForm<CompletionCheckFormValues>>;
  editCompletionCheck: ReturnType<typeof useLoopndrollState>["editCompletionCheck"];
  editingCompletionCheckId: string | null;
  setEditingCompletionCheckId: (value: string | null) => void;
  setIsCompletionCheckDialogOpen: (value: boolean) => void;
}) {
  return args.completionCheckForm.handleSubmit(async (values) => {
    const parsed = completionCheckSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const fieldName = issue.path[0];
        if (typeof fieldName === "string") {
          args.completionCheckForm.setError(fieldName as keyof CompletionCheckFormValues, {
            message: issue.message,
          });
        }
      }
      return;
    }

    const commands = parseCommandsText(values.commandsText);
    if (args.editingCompletionCheckId) {
      await args.editCompletionCheck({
        id: args.editingCompletionCheckId,
        label: values.label.trim(),
        commands,
      });
    } else {
      await args.addCompletionCheck({
        label: values.label.trim(),
        commands,
      });
    }

    args.completionCheckForm.reset(createEmptyCompletionCheckValues());
    args.setEditingCompletionCheckId(null);
    args.setIsCompletionCheckDialogOpen(false);
  });
}

function createSaveHandlers(args: {
  addCompletionCheck: ReturnType<typeof useLoopndrollState>["addCompletionCheck"];
  addNotification: ReturnType<typeof useLoopndrollState>["addNotification"];
  completionCheckForm: ReturnType<typeof useForm<CompletionCheckFormValues>>;
  editCompletionCheck: ReturnType<typeof useLoopndrollState>["editCompletionCheck"];
  editNotification: ReturnType<typeof useLoopndrollState>["editNotification"];
  editingCompletionCheckId: string | null;
  editingNotificationId: string | null;
  notificationForm: ReturnType<typeof useForm<NotificationFormValues>>;
  savePrompt: ReturnType<typeof useLoopndrollState>["savePrompt"];
  setEditingCompletionCheckId: (value: string | null) => void;
  setEditingNotificationId: (value: string | null) => void;
  setIsCompletionCheckDialogOpen: (value: boolean) => void;
  setIsNotificationDialogOpen: (value: boolean) => void;
  settingsForm: ReturnType<typeof useForm<SettingsFormValues>>;
}) {
  return {
    saveDefaultPrompt: createDefaultPromptSubmitHandler(args),
    saveNotification: createNotificationSubmitHandler(args),
    saveCompletionCheck: createCompletionCheckSubmitHandler(args),
  };
}

function useSyncDefaultPrompt(
  settingsForm: ReturnType<typeof useForm<SettingsFormValues>>,
  snapshotDefaultPrompt: string | undefined,
) {
  useEffect(() => {
    if (!snapshotDefaultPrompt || settingsForm.formState.isDirty) {
      return;
    }

    settingsForm.reset({ defaultPrompt: snapshotDefaultPrompt });
  }, [settingsForm, settingsForm.formState.isDirty, snapshotDefaultPrompt]);
}

function useDialogResetEffects(args: {
  completionCheckForm: ReturnType<typeof useForm<CompletionCheckFormValues>>;
  isCompletionCheckDialogOpen: boolean;
  isNotificationDialogOpen: boolean;
  notificationForm: ReturnType<typeof useForm<NotificationFormValues>>;
  setEditingCompletionCheckId: (value: string | null) => void;
  setEditingNotificationId: (value: string | null) => void;
  setIsLoadingTelegramChats: (value: boolean) => void;
  setTelegramChats: React.Dispatch<React.SetStateAction<TelegramChatOption[]>>;
  setTelegramChatsError: (value: string | null) => void;
}) {
  useEffect(() => {
    if (!args.isNotificationDialogOpen) {
      args.notificationForm.reset(createEmptyNotificationValues());
      args.setEditingNotificationId(null);
      args.setTelegramChats([]);
      args.setTelegramChatsError(null);
      args.setIsLoadingTelegramChats(false);
    }
  }, [
    args.isNotificationDialogOpen,
    args.notificationForm,
    args.setEditingNotificationId,
    args.setIsLoadingTelegramChats,
    args.setTelegramChats,
    args.setTelegramChatsError,
  ]);

  useEffect(() => {
    if (!args.isCompletionCheckDialogOpen) {
      args.completionCheckForm.reset(createEmptyCompletionCheckValues());
      args.setEditingCompletionCheckId(null);
    }
  }, [
    args.completionCheckForm,
    args.isCompletionCheckDialogOpen,
    args.setEditingCompletionCheckId,
  ]);
}

function useTelegramChatPolling(args: {
  isNotificationDialogOpen: boolean;
  normalizedNotificationBotToken: string;
  notificationChannel: NotificationFormValues["channel"];
  setIsLoadingTelegramChats: (value: boolean) => void;
  setTelegramChats: Dispatch<SetStateAction<TelegramChatOption[]>>;
  setTelegramChatsError: (value: string | null) => void;
}) {
  useEffect(() => {
    if (!args.isNotificationDialogOpen || args.notificationChannel !== "telegram") {
      return;
    }

    if (args.normalizedNotificationBotToken.length === 0) {
      args.setTelegramChats([]);
      args.setTelegramChatsError(null);
      args.setIsLoadingTelegramChats(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      args.setIsLoadingTelegramChats(true);
      args.setTelegramChatsError(null);

      void getTelegramChats(args.normalizedNotificationBotToken)
        .then((chats) => {
          if (!cancelled) {
            args.setTelegramChats(chats);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            args.setTelegramChatsError(getTelegramChatErrorMessage(error));
          }
        })
        .finally(() => {
          if (!cancelled) {
            args.setIsLoadingTelegramChats(false);
          }
        });

      const runLongPoll = async () => {
        while (!cancelled) {
          try {
            const chats = await getTelegramChats(args.normalizedNotificationBotToken, true);
            if (!cancelled) {
              args.setTelegramChats((current) => mergeTelegramChats(current, chats));
              args.setTelegramChatsError(null);
            }
          } catch (error) {
            const message = getTelegramChatErrorMessage(error);
            if (!cancelled && !isTransientTelegramChatError(message)) {
              args.setTelegramChatsError(message);
              return;
            }

            if (!cancelled) {
              await new Promise((resolve) => window.setTimeout(resolve, 1_000));
            }
          } finally {
            if (!cancelled) {
              args.setIsLoadingTelegramChats(false);
            }
          }
        }
      };

      void runLongPoll();
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    args.isNotificationDialogOpen,
    args.normalizedNotificationBotToken,
    args.notificationChannel,
    args.setIsLoadingTelegramChats,
    args.setTelegramChats,
    args.setTelegramChatsError,
  ]);
}

function useSettingsForms() {
  const settingsForm = useForm<SettingsFormValues>({
    defaultValues: { defaultPrompt: "Keep working on the task. Do not finish yet." },
    mode: "onChange",
  });
  const notificationForm = useForm<NotificationFormValues>({
    defaultValues: createEmptyNotificationValues(),
    mode: "onChange",
  });
  const completionCheckForm = useForm<CompletionCheckFormValues>({
    defaultValues: createEmptyCompletionCheckValues(),
    mode: "onChange",
  });

  return {
    completionCheckForm,
    notificationForm,
    settingsForm,
  };
}

function useSettingsDialogState() {
  const [isNotificationDialogOpen, setIsNotificationDialogOpen] = useState(false);
  const [isCompletionCheckDialogOpen, setIsCompletionCheckDialogOpen] = useState(false);
  const [editingNotificationId, setEditingNotificationId] = useState<string | null>(null);
  const [editingCompletionCheckId, setEditingCompletionCheckId] = useState<string | null>(null);
  const [telegramChats, setTelegramChats] = useState<TelegramChatOption[]>([]);
  const [isLoadingTelegramChats, setIsLoadingTelegramChats] = useState(false);
  const [telegramChatsError, setTelegramChatsError] = useState<string | null>(null);

  return {
    editingCompletionCheckId,
    editingNotificationId,
    isCompletionCheckDialogOpen,
    isLoadingTelegramChats,
    isNotificationDialogOpen,
    setEditingCompletionCheckId,
    setEditingNotificationId,
    setIsCompletionCheckDialogOpen,
    setIsLoadingTelegramChats,
    setIsNotificationDialogOpen,
    setTelegramChats,
    setTelegramChatsError,
    telegramChats,
    telegramChatsError,
  };
}

function useNotificationFormState(
  notificationForm: ReturnType<typeof useForm<NotificationFormValues>>,
) {
  const notificationChannel = notificationForm.watch("channel");
  const notificationBotToken = notificationForm.watch("botToken");
  const notificationTelegramChatId = notificationForm.watch("telegramChatId");
  const notificationTelegramChatUsername = notificationForm.watch("telegramChatUsername");
  const notificationTelegramChatDisplayName = notificationForm.watch("telegramChatDisplayName");

  return {
    normalizedNotificationBotToken: notificationBotToken.trim(),
    notificationChannel,
    notificationTelegramChatDisplayName,
    notificationTelegramChatId,
    notificationTelegramChatUsername,
  };
}

function buildSelectedTelegramChat(args: {
  notificationTelegramChatDisplayName: string;
  notificationTelegramChatId: string;
  notificationTelegramChatUsername: string;
  telegramChatItems: Array<
    TelegramChatOption & { value: string; label: string; primaryLabel: string }
  >;
}) {
  const hasSelectedTelegramChat =
    args.notificationTelegramChatId.trim().length > 0 &&
    !args.telegramChatItems.some((chat) => chat.chatId === args.notificationTelegramChatId.trim());
  const selectedTelegramChat =
    (hasSelectedTelegramChat
      ? [
          {
            chatId: args.notificationTelegramChatId.trim(),
            kind: inferTelegramChatKind(args.notificationTelegramChatId),
            username: args.notificationTelegramChatUsername.trim() || null,
            displayName: args.notificationTelegramChatDisplayName.trim() || "Selected chat",
            value: args.notificationTelegramChatId.trim(),
            label: args.notificationTelegramChatDisplayName.trim() || "Selected chat",
            primaryLabel: args.notificationTelegramChatDisplayName.trim() || "Selected chat",
          },
          ...args.telegramChatItems,
        ]
      : args.telegramChatItems
    ).find((chat) => chat.chatId === args.notificationTelegramChatId.trim()) ?? null;

  return {
    hasSelectedTelegramChat,
    selectedTelegramChat,
  };
}

function createDialogOpeners(args: {
  completionCheckForm: ReturnType<typeof useForm<CompletionCheckFormValues>>;
  notificationForm: ReturnType<typeof useForm<NotificationFormValues>>;
  setEditingCompletionCheckId: (value: string | null) => void;
  setEditingNotificationId: (value: string | null) => void;
  setIsCompletionCheckDialogOpen: (value: boolean) => void;
  setIsNotificationDialogOpen: (value: boolean) => void;
  setTelegramChats: (value: TelegramChatOption[]) => void;
  setTelegramChatsError: (value: string | null) => void;
}) {
  return {
    openCreateNotificationDialog() {
      args.setEditingNotificationId(null);
      args.notificationForm.reset(createEmptyNotificationValues());
      args.setTelegramChats([]);
      args.setTelegramChatsError(null);
      args.setIsNotificationDialogOpen(true);
    },
    openCreateTelegramNotificationDialog() {
      args.setEditingNotificationId(null);
      args.notificationForm.reset({
        ...createEmptyNotificationValues(),
        channel: "telegram",
      });
      args.setTelegramChats([]);
      args.setTelegramChatsError(null);
      args.setIsNotificationDialogOpen(true);
    },
    openCreateSlackNotificationDialog() {
      args.setEditingNotificationId(null);
      args.notificationForm.reset({
        ...createEmptyNotificationValues(),
        channel: "slack",
      });
      args.setTelegramChats([]);
      args.setTelegramChatsError(null);
      args.setIsNotificationDialogOpen(true);
    },
    openCreateCompletionCheckDialog() {
      args.setEditingCompletionCheckId(null);
      args.completionCheckForm.reset(createEmptyCompletionCheckValues());
      args.setIsCompletionCheckDialogOpen(true);
    },
  };
}

function createEditOpeners(args: {
  completionCheckForm: ReturnType<typeof useForm<CompletionCheckFormValues>>;
  notificationForm: ReturnType<typeof useForm<NotificationFormValues>>;
  setEditingCompletionCheckId: (value: string | null) => void;
  setEditingNotificationId: (value: string | null) => void;
  setIsCompletionCheckDialogOpen: (value: boolean) => void;
  setIsNotificationDialogOpen: (value: boolean) => void;
  setTelegramChats: (value: TelegramChatOption[]) => void;
  setTelegramChatsError: (value: string | null) => void;
}) {
  return {
    openEditNotificationDialog(notification: LoopNotification) {
      args.setEditingNotificationId(notification.id);
      args.notificationForm.reset(
        notification.channel === "slack"
          ? {
              ...createEmptyNotificationValues(),
              label: notification.label,
              channel: "slack",
              webhookUrl: notification.webhookUrl,
            }
          : {
              ...createEmptyNotificationValues(),
              label: notification.label,
              channel: "telegram",
              botToken: notification.botToken,
              telegramChatId: notification.chatId,
              telegramChatUsername: notification.chatUsername ?? "",
              telegramChatDisplayName: notification.chatDisplayName ?? "",
            },
      );
      args.setTelegramChats([]);
      args.setTelegramChatsError(null);
      args.setIsNotificationDialogOpen(true);
    },
    openEditCompletionCheckDialog(completionCheck: CompletionCheck) {
      args.setEditingCompletionCheckId(completionCheck.id);
      args.completionCheckForm.reset({
        label: completionCheck.label,
        commandsText: completionCheck.commands.join("\n"),
      });
      args.setIsCompletionCheckDialogOpen(true);
    },
  };
}

function createSettingsRouteModelResult(args: {
  completionCheckForm: ReturnType<typeof useForm<CompletionCheckFormValues>>;
  completionChecks: CompletionCheck[];
  dialogOpeners: ReturnType<typeof createDialogOpeners>;
  dialogState: ReturnType<typeof useSettingsDialogState>;
  editOpeners: ReturnType<typeof createEditOpeners>;
  loopndrollState: ReturnType<typeof useLoopndrollState>;
  notificationForm: ReturnType<typeof useForm<NotificationFormValues>>;
  notificationState: ReturnType<typeof useNotificationFormState>;
  notifications: LoopNotification[];
  saveHandlers: ReturnType<typeof createSaveHandlers>;
  selectedTelegramChat: ReturnType<typeof buildSelectedTelegramChat>["selectedTelegramChat"];
  settingsForm: ReturnType<typeof useForm<SettingsFormValues>>;
  telegramChatItems: ReturnType<
    typeof useMemo<
      Array<TelegramChatOption & { value: string; label: string; primaryLabel: string }>
    >
  >;
}) {
  return {
    ...args.loopndrollState,
    completionCheckForm: args.completionCheckForm,
    completionChecks: args.completionChecks,
    editingCompletionCheckId: args.dialogState.editingCompletionCheckId,
    editingNotificationId: args.dialogState.editingNotificationId,
    hasResolvedHookState: !args.loopndrollState.isLoading && args.loopndrollState.snapshot !== null,
    hookLifecycle: args.loopndrollState.snapshot?.hookLifecycle ?? null,
    hookIssues: args.loopndrollState.snapshot?.health.issues ?? [],
    hookRemovalWatcher: args.loopndrollState.snapshot?.health.hookRemovalWatcher ?? null,
    hooksDetected: args.loopndrollState.snapshot?.health.registered ?? false,
    mirrorEnabled: args.loopndrollState.snapshot?.mirrorEnabled ?? false,
    runtimeState: args.loopndrollState.snapshot?.runtimeState ?? "running",
    isCompletionCheckDialogOpen: args.dialogState.isCompletionCheckDialogOpen,
    isLoadingTelegramChats: args.dialogState.isLoadingTelegramChats,
    isNotificationDialogOpen: args.dialogState.isNotificationDialogOpen,
    notificationChannel: args.notificationState.notificationChannel,
    notificationForm: args.notificationForm,
    notifications: args.notifications,
    saveHandlers: args.saveHandlers,
    selectedTelegramChat: args.selectedTelegramChat,
    settingsForm: args.settingsForm,
    shouldShowTelegramChatsError:
      args.dialogState.telegramChatsError !== null &&
      args.notificationState.notificationTelegramChatId.trim().length === 0,
    telegramChatItems: args.telegramChatItems,
    telegramChatsError: args.dialogState.telegramChatsError,
    ...args.dialogOpeners,
    ...args.editOpeners,
    setIsCompletionCheckDialogOpen: args.dialogState.setIsCompletionCheckDialogOpen,
    setIsNotificationDialogOpen: args.dialogState.setIsNotificationDialogOpen,
  };
}

function useTelegramChatSelection(args: {
  notificationState: ReturnType<typeof useNotificationFormState>;
  telegramChats: TelegramChatOption[];
}) {
  const telegramChatItems = useMemo(
    () => filterTelegramDirectMessageChats(args.telegramChats).map(toTelegramChatItem),
    [args.telegramChats],
  );

  return {
    telegramChatItems,
    selectedTelegramChat: buildSelectedTelegramChat({
      notificationTelegramChatDisplayName:
        args.notificationState.notificationTelegramChatDisplayName,
      notificationTelegramChatId: args.notificationState.notificationTelegramChatId,
      notificationTelegramChatUsername: args.notificationState.notificationTelegramChatUsername,
      telegramChatItems,
    }).selectedTelegramChat,
  };
}

export function useSettingsRouteModel() {
  const loopndrollState = useLoopndrollState();
  const dialogState = useSettingsDialogState();
  const { settingsForm, notificationForm, completionCheckForm } = useSettingsForms();
  const notificationState = useNotificationFormState(notificationForm);

  useSyncDefaultPrompt(settingsForm, loopndrollState.snapshot?.defaultPrompt);
  useDialogResetEffects({
    completionCheckForm,
    isCompletionCheckDialogOpen: dialogState.isCompletionCheckDialogOpen,
    isNotificationDialogOpen: dialogState.isNotificationDialogOpen,
    notificationForm,
    setEditingCompletionCheckId: dialogState.setEditingCompletionCheckId,
    setEditingNotificationId: dialogState.setEditingNotificationId,
    setIsLoadingTelegramChats: dialogState.setIsLoadingTelegramChats,
    setTelegramChats: dialogState.setTelegramChats,
    setTelegramChatsError: dialogState.setTelegramChatsError,
  });
  useTelegramChatPolling({
    isNotificationDialogOpen: dialogState.isNotificationDialogOpen,
    normalizedNotificationBotToken: notificationState.normalizedNotificationBotToken,
    notificationChannel: notificationState.notificationChannel,
    setIsLoadingTelegramChats: dialogState.setIsLoadingTelegramChats,
    setTelegramChats: dialogState.setTelegramChats,
    setTelegramChatsError: dialogState.setTelegramChatsError,
  });

  const saveHandlers = createSaveHandlers({
    addCompletionCheck: loopndrollState.addCompletionCheck,
    addNotification: loopndrollState.addNotification,
    completionCheckForm,
    editCompletionCheck: loopndrollState.editCompletionCheck,
    editNotification: loopndrollState.editNotification,
    editingCompletionCheckId: dialogState.editingCompletionCheckId,
    editingNotificationId: dialogState.editingNotificationId,
    notificationForm,
    savePrompt: loopndrollState.savePrompt,
    setEditingCompletionCheckId: dialogState.setEditingCompletionCheckId,
    setEditingNotificationId: dialogState.setEditingNotificationId,
    setIsCompletionCheckDialogOpen: dialogState.setIsCompletionCheckDialogOpen,
    setIsNotificationDialogOpen: dialogState.setIsNotificationDialogOpen,
    settingsForm,
  });

  const notifications = loopndrollState.snapshot?.notifications ?? [];
  const completionChecks = loopndrollState.snapshot?.completionChecks ?? [];
  const { telegramChatItems, selectedTelegramChat } = useTelegramChatSelection({
    notificationState,
    telegramChats: dialogState.telegramChats,
  });
  const dialogOpeners = createDialogOpeners({
    completionCheckForm,
    notificationForm,
    setEditingCompletionCheckId: dialogState.setEditingCompletionCheckId,
    setEditingNotificationId: dialogState.setEditingNotificationId,
    setIsCompletionCheckDialogOpen: dialogState.setIsCompletionCheckDialogOpen,
    setIsNotificationDialogOpen: dialogState.setIsNotificationDialogOpen,
    setTelegramChats: dialogState.setTelegramChats,
    setTelegramChatsError: dialogState.setTelegramChatsError,
  });
  const editOpeners = createEditOpeners({
    completionCheckForm,
    notificationForm,
    setEditingCompletionCheckId: dialogState.setEditingCompletionCheckId,
    setEditingNotificationId: dialogState.setEditingNotificationId,
    setIsCompletionCheckDialogOpen: dialogState.setIsCompletionCheckDialogOpen,
    setIsNotificationDialogOpen: dialogState.setIsNotificationDialogOpen,
    setTelegramChats: dialogState.setTelegramChats,
    setTelegramChatsError: dialogState.setTelegramChatsError,
  });

  return createSettingsRouteModelResult({
    completionCheckForm,
    completionChecks,
    dialogOpeners,
    dialogState,
    editOpeners,
    loopndrollState,
    notificationForm,
    notificationState,
    notifications,
    saveHandlers,
    selectedTelegramChat,
    settingsForm,
    telegramChatItems,
  });
}
