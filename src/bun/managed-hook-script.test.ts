import { describe, expect, test } from "bun:test";

import { buildManagedHookScript, normalizeRuntimeStateHelperName } from "./managed-hook-script";
import { MANAGED_HOOK_SCRIPT_CHUNK_3 } from "./managed-hook-script/chunk-3";

function createTestPaths() {
  return {
    appDirectoryPath: "/tmp/app",
    binDirectoryPath: "/tmp/app/bin",
    stateDirectoryPath: "/tmp/app/state",
    logsDirectoryPath: "/tmp/app/logs",
    databasePath: "/tmp/app/app.db",
    managedHookPath: "/tmp/app/bin/loopndroll-hook",
    hookRemovalWatchLockPath: "/tmp/app/state/hook-removal-watch.lock",
    startupRecoveryMarkerPath: "/tmp/app/state/startup-runtime.marker.json",
    hookDebugLogPath: "/tmp/app/logs/hooks-debug.jsonl",
    codexDirectoryPath: "/tmp/.codex",
    codexConfigPath: "/tmp/.codex/config.toml",
    codexHooksPath: "/tmp/.codex/hooks.json",
  };
}

describe("MANAGED_HOOK_SCRIPT_CHUNK_3", () => {
  test("embeds the runtime-state guard directly in the generated source", () => {
    const script = MANAGED_HOOK_SCRIPT_CHUNK_3;

    expect(script).toContain("const runtimeState = getLoopndrollRuntimeState(db);");
    expect(script).toContain('if (runtimeState !== "running") {');
    expect(script).toContain("reason: `runtime-${runtimeState}`");
    expect(script).toContain("sessionId: input.session_id");
  });
});

describe("buildManagedHookScript", () => {
  test("normalizes bundled runtime-state helper names back to the chunk contract", () => {
    const source = "function getLoopndrollRuntimeState2(db) { return 'running'; }";

    expect(normalizeRuntimeStateHelperName(source)).toBe(
      "function getLoopndrollRuntimeState(db) { return 'running'; }",
    );
  });

  test("defines the exact runtime-state helper name used by the hook body", () => {
    const script = buildManagedHookScript(createTestPaths());

    expect(script).toContain("function getLoopndrollRuntimeState(db)");
    expect(script).toContain("const runtimeState = getLoopndrollRuntimeState(db);");
    expect(script).not.toContain("function getLoopndrollRuntimeState2(");
  });

  test("does not emit escaped backticks into the hook source", () => {
    const script = buildManagedHookScript(createTestPaths());

    expect(script).not.toContain("\\`");
  });

  test("includes the telegram output helpers needed at runtime", () => {
    const script = buildManagedHookScript(createTestPaths());

    expect(script).toContain("function compactWhitespace(value)");
    expect(script).toContain("function appendTelegramChunkLabel(header, chunkLabel)");
    expect(script).toContain("function buildTelegramNotificationChunks(input)");
  });

  test("does not expose passive mode in the generated v1 hook", () => {
    const script = buildManagedHookScript(createTestPaths());

    expect(script).not.toContain('value === "passive"');
    expect(script).not.toContain('preset === "passive"');
    expect(script).not.toContain("queue the next prompt for this Codex chat");
  });

  test("resolves Telegram keychain token references without embedding real bot tokens", () => {
    const script = buildManagedHookScript(createTestPaths());

    expect(script).toContain("keychain://loopndroll/telegram-bot-token/");
    expect(script).toContain("find-generic-password");
    expect(script).toContain("resolveTelegramBotToken(botToken)");
    expect(script).not.toContain("opaque-token-value");
  });

  test("resolves Slack keychain webhook references before delivery", () => {
    const script = buildManagedHookScript(createTestPaths());

    expect(script).toContain("keychain://loopndroll/slack-webhook-url/");
    expect(script).toContain("resolveSlackWebhookUrl(notification.webhook_url)");
    expect(script).not.toContain("fetch(notification.webhook_url");
  });

  test("targets current thread_id schema while preserving Codex session_id input", () => {
    const script = buildManagedHookScript(createTestPaths());

    expect(script).toContain("input.session_id");
    expect(script).toContain("thread_id as session_id");
    expect(script).toContain("thread_name as title");
    expect(script).toContain("where thread_id = ?");
    expect(script).toContain("where s.thread_id = ?");
    expect(script).toContain("where sn.thread_id = ?");
    expect(script).toContain("update sessions set thread_name = ? where thread_id = ?");
    expect(script).not.toContain("where session_id = ?");
    expect(script).not.toContain("where s.session_id = ?");
    expect(script).not.toContain("where sn.session_id = ?");
    expect(script).not.toContain("select session_ref, title, archived, cwd");
    expect(script).not.toContain("update sessions set title = ?");
    expect(script).not.toContain("insert into sessions (\\n          session_id,");
  });
});

describe("buildManagedHookScript runtime behavior", () => {
  test("finalizes hook SQLite statements before closing the process-scoped connection", () => {
    const script = buildManagedHookScript(createTestPaths());

    expect(script).toContain("const db = new Database(databasePath, { create: true });");
    expect(script).toContain("function installHookSqliteStatementFinalizer");
    expect(script).toContain("const finalizeHookSqliteStatements");
    expect(script).toContain("finalizeHookSqliteStatements();");
    expect(script).toContain("db.close();");
    expect(script).not.toContain("db?.close();");
  });

  test("sends working acknowledgement only after consuming a Telegram prompt", () => {
    const script = buildManagedHookScript(createTestPaths());

    expect(script).toContain("async function sendTelegramWorkingAck");
    expect(script).toContain("buildTelegramWorkingAckText({");
    expect(script).toContain("await sendTelegramWorkingAck(db, sessionId, telegramTargets);");
    expect(script).toContain('type: "telegram-working-ack"');
  });

  test("does not send stop notifications when the thread has no active mode", () => {
    const script = buildManagedHookScript(createTestPaths());

    expect(script).toContain("if (effectivePreset === null && !settingsRow.mirror_enabled) {");
    expect(script).toContain('reason: "no-active-mode-and-mirror-disabled"');
    expect(script).toContain("return [];");
  });

  test("mirrors user prompts only when mirror mode is enabled", () => {
    const script = buildManagedHookScript(createTestPaths());

    expect(script).toContain("async function sendUserPromptMirrorNotifications");
    expect(script).toContain("if (!settingsRow.mirror_enabled) {");
    expect(script).toContain("await sendUserPromptMirrorNotifications(db, input);");
    expect(script).toContain("message: `User Message:\\n\\n${message}`");
    expect(script).toContain("Slack user mirror failed with status");
  });
});
