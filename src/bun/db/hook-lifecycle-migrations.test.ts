import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { hookLifecycleMigrations } from "./hook-lifecycle-migrations";
import { applyAppMigrations } from "./migrations";

function applyParkPassiveMigration(db: Database) {
  const migration = hookLifecycleMigrations.find(
    (candidate) => candidate.name === "park_passive_v1",
  );
  if (!migration) {
    throw new Error("park_passive_v1 migration is missing");
  }

  for (const statement of migration.statements) {
    db.exec(statement);
  }
}

function createPassiveMigrationSchema(db: Database) {
  db.exec(`
    create table settings (
      id integer primary key,
      global_preset text
    );

    create table sessions (
      thread_id text primary key,
      preset text,
      preset_overridden integer not null default 0,
      active_since text
    );

    create table session_remote_prompts (
      thread_id text not null,
      delivery_mode text not null,
      prompt_text text not null,
      primary key(thread_id, delivery_mode)
    );
  `);
}

function markAppliedThrough(db: Database, migrationId: number) {
  db.exec(`
    create table schema_migrations (
      id integer primary key,
      name text not null,
      applied_at text not null
    );
  `);

  const insertMigration = db.query(
    "insert into schema_migrations (id, name, applied_at) values (?, ?, ?)",
  );
  for (let id = 1; id <= migrationId; id += 1) {
    insertMigration.run(id, `existing_${id}`, "2026-04-24T10:00:00.000Z");
  }
}

function createPreCompletionCheckConstraintSchema(db: Database) {
  db.exec(`
    create table settings (
      id integer primary key,
      default_prompt text not null,
      scope text not null,
      global_preset text,
      global_notification_id text,
      global_completion_check_id text,
      global_completion_check_wait_for_reply integer not null default 0,
      hooks_auto_registration integer not null default 1,
      check (id = 1)
    );

    create table notifications (
      id text primary key,
      label text not null,
      channel text not null,
      webhook_url text,
      chat_id text,
      bot_token text,
      bot_url text,
      chat_username text,
      chat_display_name text,
      created_at text not null
    );

    create table sessions (
      session_id text primary key,
      session_ref text not null,
      source text not null,
      cwd text,
      archived integer not null default 0,
      first_seen_at text not null,
      last_seen_at text not null,
      active_since text,
      stop_count integer not null default 0,
      preset text,
      preset_overridden integer not null default 0,
      completion_check_id text,
      completion_check_wait_for_reply integer not null default 0,
      title text,
      transcript_path text,
      last_assistant_message text
    );

    create table session_notifications (
      session_id text not null,
      notification_id text not null,
      primary key (session_id, notification_id)
    );

    create table session_runtime (
      session_id text primary key,
      remaining_turns integer not null
    );

    create table session_remote_prompts (
      session_id text not null,
      source text not null,
      delivery_mode text not null default 'once',
      prompt_text text not null,
      telegram_chat_id text,
      telegram_message_id integer,
      created_at text not null,
      primary key (session_id, delivery_mode)
    );

    create table telegram_delivery_receipts (
      id text primary key,
      notification_id text,
      session_id text not null,
      bot_token text not null,
      chat_id text not null,
      telegram_message_id integer not null,
      created_at text not null
    );

    create table session_awaiting_replies (
      session_id text not null,
      bot_token text not null,
      chat_id text not null,
      turn_id text,
      started_at text not null,
      primary key (session_id, bot_token, chat_id)
    );
  `);
  markAppliedThrough(db, 14);
}

function createPreAwaitReplyConstraintSchema(db: Database) {
  db.exec(`
    create table settings (
      id integer primary key,
      default_prompt text not null,
      scope text not null,
      global_preset text,
      global_notification_id text,
      hooks_auto_registration integer not null default 1,
      check (id = 1)
    );

    create table notifications (
      id text primary key,
      label text not null,
      channel text not null,
      webhook_url text,
      chat_id text,
      bot_token text,
      bot_url text,
      chat_username text,
      chat_display_name text,
      created_at text not null
    );

    create table sessions (
      session_id text primary key,
      session_ref text,
      source text not null,
      cwd text,
      first_seen_at text not null,
      last_seen_at text not null,
      active_since text,
      stop_count integer not null default 0,
      preset text,
      title text,
      transcript_path text,
      last_assistant_message text
    );

    create table session_notifications (
      session_id text not null,
      notification_id text not null,
      primary key (session_id, notification_id)
    );

    create table session_runtime (
      session_id text primary key,
      remaining_turns integer not null
    );

    create table session_remote_prompts (
      session_id text primary key,
      source text not null,
      prompt_text text not null,
      telegram_chat_id text,
      telegram_message_id integer,
      created_at text not null
    );

    create table telegram_delivery_receipts (
      id text primary key,
      notification_id text,
      session_id text not null,
      bot_token text not null,
      chat_id text not null,
      telegram_message_id integer not null,
      created_at text not null
    );

    create table session_ref_sequence (
      id integer primary key check (id = 1),
      last_value integer not null
    );
  `);
  markAppliedThrough(db, 5);
}

function testParkPassiveMigration() {
  const db = new Database(":memory:");
  createPassiveMigrationSchema(db);
  db.query("insert into settings (id, global_preset) values (1, 'passive')").run();
  db.query(
    `insert into sessions (thread_id, preset, preset_overridden, active_since) values
        ('explicit_passive', 'passive', 1, '2026-04-24T10:00:00.000Z'),
        ('inherited_passive', null, 0, '2026-04-24T10:00:00.000Z'),
        ('explicit_await', 'await-reply', 1, '2026-04-24T10:00:00.000Z')`,
  ).run();
  db.query(
    `insert into session_remote_prompts (thread_id, delivery_mode, prompt_text) values
        ('explicit_passive', 'once', 'stale explicit passive prompt'),
        ('inherited_passive', 'once', 'stale inherited passive prompt'),
        ('explicit_await', 'once', 'valid await prompt')`,
  ).run();

  applyParkPassiveMigration(db);

  expect(db.query("select global_preset from settings where id = 1").get()).toEqual({
    global_preset: null,
  });
  expect(
    db
      .query(
        "select preset, preset_overridden, active_since from sessions where thread_id = 'explicit_passive'",
      )
      .get(),
  ).toEqual({
    preset: null,
    preset_overridden: 1,
    active_since: null,
  });
  expect(
    db
      .query(
        "select preset, preset_overridden, active_since from sessions where thread_id = 'inherited_passive'",
      )
      .get(),
  ).toEqual({
    preset: null,
    preset_overridden: 0,
    active_since: null,
  });
  expect(
    db.query("select thread_id, prompt_text from session_remote_prompts order by thread_id").all(),
  ).toEqual([{ thread_id: "explicit_await", prompt_text: "valid await prompt" }]);
}

function testParkPassiveBeforeConstrainedRebuilds() {
  const db = new Database(":memory:");
  createPreCompletionCheckConstraintSchema(db);
  db.query(
    `insert into settings (
        id,
        default_prompt,
        scope,
        global_preset,
        hooks_auto_registration
      ) values (1, 'Keep working', 'global', 'passive', 1)`,
  ).run();
  db.query(
    `insert into sessions (
        session_id,
        session_ref,
        source,
        cwd,
        archived,
        first_seen_at,
        last_seen_at,
        active_since,
        stop_count,
        preset,
        preset_overridden
      ) values
        ('explicit_passive', 'C1', 'stop', '/tmp/project', 0, '2026-04-24T10:00:00.000Z', '2026-04-24T10:00:00.000Z', '2026-04-24T10:00:00.000Z', 1, 'passive', 1),
        ('inherited_passive', 'C2', 'stop', '/tmp/project', 0, '2026-04-24T10:00:00.000Z', '2026-04-24T10:00:00.000Z', '2026-04-24T10:00:00.000Z', 1, null, 0),
        ('explicit_await', 'C3', 'stop', '/tmp/project', 0, '2026-04-24T10:00:00.000Z', '2026-04-24T10:00:00.000Z', '2026-04-24T10:00:00.000Z', 1, 'await-reply', 1)`,
  ).run();
  db.query(
    `insert into session_remote_prompts (
        session_id,
        source,
        delivery_mode,
        prompt_text,
        created_at
      ) values
        ('explicit_passive', 'telegram', 'once', 'stale explicit passive prompt', '2026-04-24T10:00:00.000Z'),
        ('inherited_passive', 'telegram', 'once', 'stale inherited passive prompt', '2026-04-24T10:00:00.000Z'),
        ('explicit_await', 'telegram', 'once', 'valid await prompt', '2026-04-24T10:00:00.000Z')`,
  ).run();

  applyAppMigrations(db);

  expect(db.query("select global_preset from settings where id = 1").get()).toEqual({
    global_preset: null,
  });
  expect(
    db
      .query(
        `select thread_id, preset, preset_overridden, active_since
           from sessions
           order by thread_id`,
      )
      .all(),
  ).toEqual([
    {
      thread_id: "explicit_await",
      preset: "await-reply",
      preset_overridden: 1,
      active_since: "2026-04-24T10:00:00.000Z",
    },
    {
      thread_id: "explicit_passive",
      preset: null,
      preset_overridden: 1,
      active_since: null,
    },
    {
      thread_id: "inherited_passive",
      preset: null,
      preset_overridden: 0,
      active_since: null,
    },
  ]);
  expect(
    db.query("select thread_id, prompt_text from session_remote_prompts order by thread_id").all(),
  ).toEqual([{ thread_id: "explicit_await", prompt_text: "valid await prompt" }]);
}

function testParkPassiveBeforeFirstConstrainedRebuild() {
  const db = new Database(":memory:");
  createPreAwaitReplyConstraintSchema(db);
  db.query(
    `insert into settings (
        id,
        default_prompt,
        scope,
        global_preset,
        hooks_auto_registration
      ) values (1, 'Keep working', 'global', 'passive', 1)`,
  ).run();
  db.query(
    `insert into sessions (
        session_id,
        session_ref,
        source,
        cwd,
        first_seen_at,
        last_seen_at,
        active_since,
        stop_count,
        preset
      ) values
        ('explicit_passive', 'C1', 'stop', '/tmp/project', '2026-04-24T10:00:00.000Z', '2026-04-24T10:00:00.000Z', '2026-04-24T10:00:00.000Z', 1, 'passive'),
        ('inherited_passive', 'C2', 'stop', '/tmp/project', '2026-04-24T10:00:00.000Z', '2026-04-24T10:00:00.000Z', '2026-04-24T10:00:00.000Z', 1, null),
        ('explicit_await', 'C3', 'stop', '/tmp/project', '2026-04-24T10:00:00.000Z', '2026-04-24T10:00:00.000Z', '2026-04-24T10:00:00.000Z', 1, 'await-reply')`,
  ).run();
  db.query(
    `insert into session_remote_prompts (
        session_id,
        source,
        prompt_text,
        created_at
      ) values
        ('explicit_passive', 'telegram', 'stale explicit passive prompt', '2026-04-24T10:00:00.000Z'),
        ('inherited_passive', 'telegram', 'stale inherited passive prompt', '2026-04-24T10:00:00.000Z'),
        ('explicit_await', 'telegram', 'valid await prompt', '2026-04-24T10:00:00.000Z')`,
  ).run();

  applyAppMigrations(db);

  expect(db.query("select global_preset from settings where id = 1").get()).toEqual({
    global_preset: null,
  });
  expect(db.query("select thread_id, preset from sessions where preset = 'passive'").all()).toEqual(
    [],
  );
  expect(
    db.query("select thread_id, prompt_text from session_remote_prompts order by thread_id").all(),
  ).toEqual([{ thread_id: "explicit_await", prompt_text: "valid await prompt" }]);
}

describe("hook lifecycle migrations", () => {
  test(
    "parks explicit and inherited passive state without leaving stale Telegram prompts",
    testParkPassiveMigration,
  );
  test(
    "parks passive state before constrained preset table rebuilds",
    testParkPassiveBeforeConstrainedRebuilds,
  );
  test(
    "parks passive state before the first preset-constrained rebuild",
    testParkPassiveBeforeFirstConstrainedRebuild,
  );
});
