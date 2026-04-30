import { spawnSync } from "node:child_process";

const TELEGRAM_BOT_TOKEN_SERVICE = "loopndroll.telegram.bot-token";
const TELEGRAM_BOT_TOKEN_REF_PREFIX = "keychain://loopndroll/telegram-bot-token/";
const SLACK_WEBHOOK_URL_SERVICE = "loopndroll.slack.webhook-url";
const SLACK_WEBHOOK_URL_REF_PREFIX = "keychain://loopndroll/slack-webhook-url/";

function encodeKeychainAccount(notificationId: string) {
  return notificationId.trim();
}

function parseTelegramBotTokenKeychainRef(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith(TELEGRAM_BOT_TOKEN_REF_PREFIX)) {
    return null;
  }

  const account = decodeURIComponent(trimmed.slice(TELEGRAM_BOT_TOKEN_REF_PREFIX.length));
  return account.length > 0 ? account : null;
}

function parseSlackWebhookUrlKeychainRef(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith(SLACK_WEBHOOK_URL_REF_PREFIX)) {
    return null;
  }

  const account = decodeURIComponent(trimmed.slice(SLACK_WEBHOOK_URL_REF_PREFIX.length));
  return account.length > 0 ? account : null;
}

export function isTelegramBotTokenKeychainRef(value: string | null | undefined) {
  return typeof value === "string" && parseTelegramBotTokenKeychainRef(value) !== null;
}

export function isSlackWebhookUrlKeychainRef(value: string | null | undefined) {
  return typeof value === "string" && parseSlackWebhookUrlKeychainRef(value) !== null;
}

export function createTelegramBotTokenKeychainRef(notificationId: string) {
  return `${TELEGRAM_BOT_TOKEN_REF_PREFIX}${encodeURIComponent(encodeKeychainAccount(notificationId))}`;
}

export function createSlackWebhookUrlKeychainRef(notificationId: string) {
  return `${SLACK_WEBHOOK_URL_REF_PREFIX}${encodeURIComponent(encodeKeychainAccount(notificationId))}`;
}

export function getTelegramBotTokenMigrationRef(
  notificationId: string,
  botToken: string,
  refsByPlaintextToken: Map<string, string>,
) {
  const normalizedBotToken = botToken.trim();
  const existingRef = refsByPlaintextToken.get(normalizedBotToken);
  if (existingRef) {
    return {
      ref: existingRef,
      shouldStore: false,
    };
  }

  const ref = createTelegramBotTokenKeychainRef(notificationId);
  refsByPlaintextToken.set(normalizedBotToken, ref);
  return {
    ref,
    shouldStore: true,
  };
}

function runSecurityCommand(args: string[]) {
  const result = spawnSync("/usr/bin/security", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function storeSecretInKeychain(input: {
  notificationId: string;
  secret: string;
  emptyMessage: string;
  service: string;
  failureMessage: string;
  refFactory: (notificationId: string) => string;
}) {
  const secret = input.secret.trim();
  if (secret.length === 0) {
    throw new Error(input.emptyMessage);
  }

  if (process.platform !== "darwin") {
    return secret;
  }

  const account = encodeKeychainAccount(input.notificationId);
  const result = runSecurityCommand([
    "add-generic-password",
    "-a",
    account,
    "-s",
    input.service,
    "-w",
    secret,
    "-U",
  ]);
  if (!result.ok) {
    throw new Error(input.failureMessage);
  }

  return input.refFactory(input.notificationId);
}

function resolveSecretFromKeychain(input: {
  valueOrRef: string;
  parseRef: (value: string) => string | null;
  service: string;
  unavailableMessage: string;
  readFailureMessage: string;
  emptyMessage: string;
}) {
  const value = input.valueOrRef.trim();
  const account = input.parseRef(value);
  if (account === null) {
    return value;
  }

  if (process.platform !== "darwin") {
    throw new Error(input.unavailableMessage);
  }

  const result = runSecurityCommand([
    "find-generic-password",
    "-a",
    account,
    "-s",
    input.service,
    "-w",
  ]);
  if (!result.ok) {
    throw new Error(input.readFailureMessage);
  }

  const secret = result.stdout.trim();
  if (secret.length === 0) {
    throw new Error(input.emptyMessage);
  }

  return secret;
}

function deleteSecretFromKeychain(input: {
  valueOrRef: string | null | undefined;
  parseRef: (value: string) => string | null;
  service: string;
}) {
  if (typeof input.valueOrRef !== "string" || process.platform !== "darwin") {
    return;
  }

  const account = input.parseRef(input.valueOrRef);
  if (account === null) {
    return;
  }

  runSecurityCommand(["delete-generic-password", "-a", account, "-s", input.service]);
}

export function storeTelegramBotTokenInKeychain(notificationId: string, botToken: string) {
  return storeSecretInKeychain({
    notificationId,
    secret: botToken,
    emptyMessage: "Telegram bot token is required.",
    service: TELEGRAM_BOT_TOKEN_SERVICE,
    failureMessage: "Could not store Telegram bot token in macOS Keychain.",
    refFactory: createTelegramBotTokenKeychainRef,
  });
}

export function storeSlackWebhookUrlInKeychain(notificationId: string, webhookUrl: string) {
  return storeSecretInKeychain({
    notificationId,
    secret: webhookUrl,
    emptyMessage: "Slack webhook URL is required.",
    service: SLACK_WEBHOOK_URL_SERVICE,
    failureMessage: "Could not store Slack webhook URL in macOS Keychain.",
    refFactory: createSlackWebhookUrlKeychainRef,
  });
}

export function resolveTelegramBotToken(botTokenOrRef: string) {
  return resolveSecretFromKeychain({
    valueOrRef: botTokenOrRef,
    parseRef: parseTelegramBotTokenKeychainRef,
    service: TELEGRAM_BOT_TOKEN_SERVICE,
    unavailableMessage: "Telegram bot token is stored in Keychain, but Keychain is unavailable.",
    readFailureMessage: "Could not read Telegram bot token from macOS Keychain.",
    emptyMessage: "Telegram bot token in macOS Keychain is empty.",
  });
}

export function resolveSlackWebhookUrl(webhookUrlOrRef: string) {
  return resolveSecretFromKeychain({
    valueOrRef: webhookUrlOrRef,
    parseRef: parseSlackWebhookUrlKeychainRef,
    service: SLACK_WEBHOOK_URL_SERVICE,
    unavailableMessage: "Slack webhook URL is stored in Keychain, but Keychain is unavailable.",
    readFailureMessage: "Could not read Slack webhook URL from macOS Keychain.",
    emptyMessage: "Slack webhook URL in macOS Keychain is empty.",
  });
}

export function deleteTelegramBotTokenFromKeychain(botTokenOrRef: string | null | undefined) {
  deleteSecretFromKeychain({
    valueOrRef: botTokenOrRef,
    parseRef: parseTelegramBotTokenKeychainRef,
    service: TELEGRAM_BOT_TOKEN_SERVICE,
  });
}

export function deleteSlackWebhookUrlFromKeychain(webhookUrlOrRef: string | null | undefined) {
  deleteSecretFromKeychain({
    valueOrRef: webhookUrlOrRef,
    parseRef: parseSlackWebhookUrlKeychainRef,
    service: SLACK_WEBHOOK_URL_SERVICE,
  });
}
