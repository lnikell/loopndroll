import type { Database } from "bun:sqlite";
import {
  DEFAULT_PROMPT,
  LOOP_PRESET_VALUES,
  LOOPNDROLL_RUNTIME_STATE_VALUES,
  LOOP_SCOPE_VALUES,
  LOOP_SESSION_SOURCE_VALUES,
  NOTIFICATION_CHANNEL_VALUES,
} from "../constants";
import { hookLifecycleMigrations } from "./hook-lifecycle-migrations";
import { nowIsoString, shouldIgnoreMigrationStatementError } from "./migration-runtime";
import {
  PARK_PASSIVE_OVERRIDABLE_SESSION_ID_STATEMENTS,
  PARK_PASSIVE_SESSION_ID_STATEMENTS,
} from "./passive-preset-migration-statements";

export type AppMigration = { id: number; name: string; statements: string[] };

const SETTINGS_SCOPE_CHECK = LOOP_SCOPE_VALUES.map((value) => `'${value}'`).join(", ");
const PRESET_CHECK = LOOP_PRESET_VALUES.map((value) => `'${value}'`).join(", ");
const RUNTIME_STATE_CHECK = LOOPNDROLL_RUNTIME_STATE_VALUES.map((value) => `'${value}'`).join(", ");
const SESSION_SOURCE_CHECK = LOOP_SESSION_SOURCE_VALUES.map((value) => `'${value}'`).join(", ");
const NOTIFICATION_CHANNEL_CHECK = NOTIFICATION_CHANNEL_VALUES.map((value) => `'${value}'`).join(
  ", ",
);
const ESCAPED_DEFAULT_PROMPT = DEFAULT_PROMPT.replaceAll("'", "''");

export const appMigrations: AppMigration[] = [
  {
    id: 1,
    name: "initial_schema",
    statements: [
      `create table settings (
        id integer primary key,
        default_prompt text not null,
        scope text not null check (scope in (${SETTINGS_SCOPE_CHECK})),
        global_preset text check (global_preset is null or global_preset in (${PRESET_CHECK})),
        global_notification_id text,
        hooks_auto_registration integer not null default 1 check (hooks_auto_registration in (0, 1)),
        check (id = 1)
      )`,
      `insert into settings (
        id,
        default_prompt,
        scope,
        global_preset,
        global_notification_id,
        hooks_auto_registration
      )
        values (1, '${ESCAPED_DEFAULT_PROMPT}', 'global', null, null, 1)`,
      `create table notifications (
        id text primary key,
        label text not null,
        channel text not null check (channel in (${NOTIFICATION_CHANNEL_CHECK})),
        webhook_url text,
        chat_id text,
        bot_token text,
        bot_url text,
        chat_username text,
        chat_display_name text,
        created_at text not null,
        check (
          (channel = 'slack' and webhook_url is not null and chat_id is null and bot_token is null and bot_url is null)
          or
          (channel = 'telegram' and webhook_url is null and chat_id is not null and bot_token is not null and bot_url is not null)
        )
      )`,
      `create table sessions (
        session_id text primary key,
        source text not null check (source in (${SESSION_SOURCE_CHECK})),
        cwd text,
        first_seen_at text not null,
        last_seen_at text not null,
        active_since text,
        stop_count integer not null default 0 check (stop_count >= 0),
        preset text check (preset is null or preset in (${PRESET_CHECK})),
        title text,
        transcript_path text,
        last_assistant_message text
      )`,
      `create table session_notifications (
        session_id text not null references sessions(session_id) on delete cascade,
        notification_id text not null references notifications(id) on delete cascade,
        primary key (session_id, notification_id)
      )`,
      `create table session_runtime (
        session_id text primary key references sessions(session_id) on delete cascade,
        remaining_turns integer not null check (remaining_turns >= 0)
      )`,
      `create index notifications_created_at_idx on notifications(created_at, id)`,
      `create index sessions_first_seen_at_idx on sessions(first_seen_at, session_id)`,
      `create index sessions_last_seen_at_idx on sessions(last_seen_at, session_id)`,
      `create index session_notifications_notification_idx on session_notifications(notification_id, session_id)`,
    ],
  },
  {
    id: 2,
    name: "telegram_bot_tokens",
    statements: [
      `alter table notifications add column bot_token text`,
      `alter table notifications add column chat_username text`,
      `alter table notifications add column chat_display_name text`,
      `update notifications
        set bot_token = substr(
          bot_url,
          instr(bot_url, '/bot') + 4,
          instr(bot_url, '/sendMessage') - (instr(bot_url, '/bot') + 4)
        )
      where channel = 'telegram'
        and (bot_token is null or trim(bot_token) = '')
        and bot_url like 'https://api.telegram.org/bot%/sendMessage'`,
    ],
  },
  {
    id: 3,
    name: "telegram_reply_bridge",
    statements: [
      `create table if not exists session_remote_prompts (
        session_id text primary key references sessions(session_id) on delete cascade,
        source text not null,
        delivery_mode text not null default 'once',
        prompt_text text not null,
        telegram_chat_id text,
        telegram_message_id integer,
        created_at text not null
      )`,
      `create table if not exists telegram_delivery_receipts (
        id text primary key,
        notification_id text references notifications(id) on delete set null,
        session_id text not null references sessions(session_id) on delete cascade,
        bot_token text not null,
        chat_id text not null,
        telegram_message_id integer not null,
        created_at text not null
      )`,
      `create unique index if not exists telegram_delivery_receipts_lookup_idx
        on telegram_delivery_receipts(bot_token, chat_id, telegram_message_id)`,
      `create table if not exists telegram_update_cursors (
        bot_token text primary key,
        last_update_id integer not null,
        updated_at text not null
      )`,
    ],
  },
  {
    id: 4,
    name: "session_refs",
    statements: [
      `alter table sessions add column session_ref text`,
      `with ordered as (
        select
          session_id,
          row_number() over (order by first_seen_at asc, session_id asc) as seq
        from sessions
        where session_ref is null or trim(session_ref) = ''
      )
      update sessions
      set session_ref = (
        select printf('C%d', ordered.seq)
        from ordered
        where ordered.session_id = sessions.session_id
      )
      where session_ref is null or trim(session_ref) = ''`,
      `create unique index if not exists sessions_session_ref_idx on sessions(session_ref)`,
    ],
  },
  {
    id: 5,
    name: "session_ref_sequence",
    statements: [
      `create table if not exists session_ref_sequence (
        id integer primary key check (id = 1),
        last_value integer not null
      )`,
      `insert into session_ref_sequence (id, last_value)
        values (
          1,
          coalesce((
            select max(cast(substr(session_ref, 2) as integer))
            from sessions
            where session_ref glob 'C[0-9]*'
          ), 0)
        )
        on conflict(id) do nothing`,
      `update session_ref_sequence
        set last_value = coalesce((
          select max(cast(substr(session_ref, 2) as integer))
          from sessions
          where session_ref glob 'C[0-9]*'
        ), 0)
        where id = 1
          and last_value < coalesce((
            select max(cast(substr(session_ref, 2) as integer))
            from sessions
            where session_ref glob 'C[0-9]*'
          ), 0)`,
    ],
  },
  {
    id: 6,
    name: "await_reply_preset_and_waiters",
    statements: [
      `pragma foreign_keys = off`,
      ...PARK_PASSIVE_SESSION_ID_STATEMENTS,
      `alter table settings rename to settings_old`,
      `create table settings (
        id integer primary key,
        default_prompt text not null,
        scope text not null check (scope in (${SETTINGS_SCOPE_CHECK})),
        global_preset text check (global_preset is null or global_preset in (${PRESET_CHECK})),
        global_notification_id text,
        hooks_auto_registration integer not null default 1 check (hooks_auto_registration in (0, 1)),
        check (id = 1)
      )`,
      `insert into settings (
        id,
        default_prompt,
        scope,
        global_preset,
        global_notification_id,
        hooks_auto_registration
      )
        select id, default_prompt, scope, global_preset, null, hooks_auto_registration
        from settings_old`,
      `drop table settings_old`,
      `alter table sessions rename to sessions_old`,
      `alter table session_notifications rename to session_notifications_old`,
      `alter table session_runtime rename to session_runtime_old`,
      `alter table session_remote_prompts rename to session_remote_prompts_old`,
      `alter table telegram_delivery_receipts rename to telegram_delivery_receipts_old`,
      `drop index if exists sessions_first_seen_at_idx`,
      `drop index if exists sessions_last_seen_at_idx`,
      `drop index if exists sessions_session_ref_idx`,
      `drop index if exists session_notifications_notification_idx`,
      `drop index if exists telegram_delivery_receipts_lookup_idx`,
      `with existing_max as (
        select coalesce(max(cast(substr(session_ref, 2) as integer)), 0) as max_seq
        from sessions_old
        where session_ref glob 'C[0-9]*'
      ),
      ordered as (
        select
          session_id,
          row_number() over (order by first_seen_at asc, session_id asc) as seq
        from sessions_old
        where session_ref is null or trim(session_ref) = ''
      )
      update sessions_old
      set session_ref = (
        select printf('C%d', existing_max.max_seq + ordered.seq)
        from ordered
        cross join existing_max
        where ordered.session_id = sessions_old.session_id
      )
      where session_ref is null or trim(session_ref) = ''`,
      `create table sessions (
        session_id text primary key,
        session_ref text not null,
        source text not null check (source in (${SESSION_SOURCE_CHECK})),
        cwd text,
        first_seen_at text not null,
        last_seen_at text not null,
        active_since text,
        stop_count integer not null default 0 check (stop_count >= 0),
        preset text check (preset is null or preset in (${PRESET_CHECK})),
        title text,
        transcript_path text,
        last_assistant_message text
      )`,
      `insert into sessions (
        session_id,
        session_ref,
        source,
        cwd,
        first_seen_at,
        last_seen_at,
        active_since,
        stop_count,
        preset,
        title,
        transcript_path,
        last_assistant_message
      )
      select
        session_id,
        session_ref,
        source,
        cwd,
        first_seen_at,
        last_seen_at,
        active_since,
        stop_count,
        preset,
        title,
        transcript_path,
        last_assistant_message
      from sessions_old`,
      `create index sessions_first_seen_at_idx on sessions(first_seen_at, session_id)`,
      `create index sessions_last_seen_at_idx on sessions(last_seen_at, session_id)`,
      `create unique index sessions_session_ref_idx on sessions(session_ref)`,
      `create table session_notifications (
        session_id text not null references sessions(session_id) on delete cascade,
        notification_id text not null references notifications(id) on delete cascade,
        primary key (session_id, notification_id)
      )`,
      `insert into session_notifications (session_id, notification_id)
        select session_id, notification_id from session_notifications_old`,
      `create index session_notifications_notification_idx on session_notifications(notification_id, session_id)`,
      `create table session_runtime (
        session_id text primary key references sessions(session_id) on delete cascade,
        remaining_turns integer not null check (remaining_turns >= 0)
      )`,
      `insert into session_runtime (session_id, remaining_turns)
        select session_id, remaining_turns from session_runtime_old`,
      `create table session_remote_prompts (
        session_id text primary key references sessions(session_id) on delete cascade,
        source text not null,
        delivery_mode text not null default 'once',
        prompt_text text not null,
        telegram_chat_id text,
        telegram_message_id integer,
        created_at text not null
      )`,
      `insert into session_remote_prompts (
        session_id,
        source,
        delivery_mode,
        prompt_text,
        telegram_chat_id,
        telegram_message_id,
        created_at
      )
      select
        session_id,
        source,
        'once',
        prompt_text,
        telegram_chat_id,
        telegram_message_id,
        created_at
      from session_remote_prompts_old`,
      `create table telegram_delivery_receipts (
        id text primary key,
        notification_id text references notifications(id) on delete set null,
        session_id text not null references sessions(session_id) on delete cascade,
        bot_token text not null,
        chat_id text not null,
        telegram_message_id integer not null,
        created_at text not null
      )`,
      `insert into telegram_delivery_receipts (
        id,
        notification_id,
        session_id,
        bot_token,
        chat_id,
        telegram_message_id,
        created_at
      )
      select
        id,
        notification_id,
        session_id,
        bot_token,
        chat_id,
        telegram_message_id,
        created_at
      from telegram_delivery_receipts_old`,
      `create unique index telegram_delivery_receipts_lookup_idx
        on telegram_delivery_receipts(bot_token, chat_id, telegram_message_id)`,
      `drop table telegram_delivery_receipts_old`,
      `drop table session_remote_prompts_old`,
      `drop table session_runtime_old`,
      `drop table session_notifications_old`,
      `drop table sessions_old`,
      `create table session_awaiting_replies (
        session_id text not null references sessions(session_id) on delete cascade,
        bot_token text not null,
        chat_id text not null,
        turn_id text,
        started_at text not null,
        primary key (session_id, bot_token, chat_id)
      )`,
      `create index session_awaiting_replies_chat_idx
        on session_awaiting_replies(bot_token, chat_id, started_at desc, session_id)`,
      `pragma foreign_keys = on`,
    ],
  },
  {
    id: 7,
    name: "session_remote_prompt_delivery_mode",
    statements: [
      `alter table session_remote_prompts add column delivery_mode text not null default 'once'`,
      `update session_remote_prompts
        set delivery_mode = 'once'
        where delivery_mode is null or trim(delivery_mode) = ''`,
    ],
  },
  {
    id: 8,
    name: "telegram_known_chats",
    statements: [
      `create table if not exists telegram_known_chats (
        bot_token text not null,
        chat_id text not null,
        kind text not null,
        username text,
        display_name text not null,
        updated_at text not null,
        primary key (bot_token, chat_id)
      )`,
      `create index if not exists telegram_known_chats_lookup_idx
        on telegram_known_chats(bot_token, updated_at desc, chat_id)`,
    ],
  },
  {
    id: 9,
    name: "session_archiving",
    statements: [
      `alter table sessions add column archived integer not null default 0 check (archived in (0, 1))`,
      `update sessions set archived = 0 where archived is null`,
    ],
  },
  {
    id: 10,
    name: "global_notification_default",
    statements: [`alter table settings add column global_notification_id text`],
  },
  {
    id: 11,
    name: "session_preset_override",
    statements: [
      `alter table sessions add column preset_overridden integer not null default 0 check (preset_overridden in (0, 1))`,
      `update sessions
        set preset_overridden = 1
        where preset is not null`,
    ],
  },
  {
    id: 12,
    name: "session_remote_prompts_per_mode",
    statements: [
      `pragma foreign_keys = off`,
      `alter table session_remote_prompts rename to session_remote_prompts_old`,
      `create table session_remote_prompts (
        session_id text not null references sessions(session_id) on delete cascade,
        source text not null,
        delivery_mode text not null default 'once',
        prompt_text text not null,
        telegram_chat_id text,
        telegram_message_id integer,
        created_at text not null,
        primary key (session_id, delivery_mode)
      )`,
      `insert into session_remote_prompts (
        session_id,
        source,
        delivery_mode,
        prompt_text,
        telegram_chat_id,
        telegram_message_id,
        created_at
      )
      select
        session_id,
        source,
        coalesce(nullif(trim(delivery_mode), ''), 'once'),
        prompt_text,
        telegram_chat_id,
        telegram_message_id,
        created_at
      from session_remote_prompts_old`,
      `drop table session_remote_prompts_old`,
      `pragma foreign_keys = on`,
    ],
  },
  {
    id: 13,
    name: "completion_checks",
    statements: [
      `create table if not exists completion_checks (
        id text primary key,
        label text not null,
        commands_json text not null,
        created_at text not null
      )`,
      `alter table settings add column global_completion_check_id text`,
      `alter table settings add column global_completion_check_wait_for_reply integer not null default 0 check (global_completion_check_wait_for_reply in (0, 1))`,
    ],
  },
  {
    id: 14,
    name: "session_completion_checks",
    statements: [
      `alter table sessions add column completion_check_id text`,
      `alter table sessions add column completion_check_wait_for_reply integer not null default 0 check (completion_check_wait_for_reply in (0, 1))`,
    ],
  },
  {
    id: 15,
    name: "completion_checks_preset_constraints",
    statements: [
      `pragma foreign_keys = off`,
      ...PARK_PASSIVE_OVERRIDABLE_SESSION_ID_STATEMENTS,
      `alter table settings rename to settings_old`,
      `create table settings (
        id integer primary key,
        default_prompt text not null,
        scope text not null check (scope in (${SETTINGS_SCOPE_CHECK})),
        global_preset text check (global_preset is null or global_preset in (${PRESET_CHECK})),
        global_notification_id text,
        global_completion_check_id text,
        global_completion_check_wait_for_reply integer not null default 0 check (global_completion_check_wait_for_reply in (0, 1)),
        hooks_auto_registration integer not null default 1 check (hooks_auto_registration in (0, 1)),
        check (id = 1)
      )`,
      `insert into settings (
        id,
        default_prompt,
        scope,
        global_preset,
        global_notification_id,
        global_completion_check_id,
        global_completion_check_wait_for_reply,
        hooks_auto_registration
      )
      select
        id,
        default_prompt,
        scope,
        global_preset,
        global_notification_id,
        global_completion_check_id,
        global_completion_check_wait_for_reply,
        hooks_auto_registration
      from settings_old`,
      `drop table settings_old`,
      `alter table sessions rename to sessions_old`,
      `alter table session_notifications rename to session_notifications_old`,
      `alter table session_runtime rename to session_runtime_old`,
      `alter table session_remote_prompts rename to session_remote_prompts_old`,
      `alter table telegram_delivery_receipts rename to telegram_delivery_receipts_old`,
      `alter table session_awaiting_replies rename to session_awaiting_replies_old`,
      `drop index if exists sessions_first_seen_at_idx`,
      `drop index if exists sessions_last_seen_at_idx`,
      `drop index if exists sessions_session_ref_idx`,
      `drop index if exists session_notifications_notification_idx`,
      `drop index if exists telegram_delivery_receipts_lookup_idx`,
      `create table sessions (
        session_id text primary key,
        session_ref text not null,
        source text not null check (source in (${SESSION_SOURCE_CHECK})),
        cwd text,
        archived integer not null default 0 check (archived in (0, 1)),
        first_seen_at text not null,
        last_seen_at text not null,
        active_since text,
        stop_count integer not null default 0 check (stop_count >= 0),
        preset text check (preset is null or preset in (${PRESET_CHECK})),
        preset_overridden integer not null default 0 check (preset_overridden in (0, 1)),
        completion_check_id text,
        completion_check_wait_for_reply integer not null default 0 check (completion_check_wait_for_reply in (0, 1)),
        title text,
        transcript_path text,
        last_assistant_message text
      )`,
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
        preset_overridden,
        completion_check_id,
        completion_check_wait_for_reply,
        title,
        transcript_path,
        last_assistant_message
      )
      select
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
        preset_overridden,
        completion_check_id,
        completion_check_wait_for_reply,
        title,
        transcript_path,
        last_assistant_message
      from sessions_old`,
      `create index sessions_first_seen_at_idx on sessions(first_seen_at, session_id)`,
      `create index sessions_last_seen_at_idx on sessions(last_seen_at, session_id)`,
      `create unique index sessions_session_ref_idx on sessions(session_ref)`,
      `create table session_notifications (
        session_id text not null references sessions(session_id) on delete cascade,
        notification_id text not null references notifications(id) on delete cascade,
        primary key (session_id, notification_id)
      )`,
      `insert into session_notifications (session_id, notification_id)
        select session_id, notification_id from session_notifications_old`,
      `create index session_notifications_notification_idx on session_notifications(notification_id, session_id)`,
      `create table session_runtime (
        session_id text primary key references sessions(session_id) on delete cascade,
        remaining_turns integer not null check (remaining_turns >= 0)
      )`,
      `insert into session_runtime (session_id, remaining_turns)
        select session_id, remaining_turns from session_runtime_old`,
      `create table session_remote_prompts (
        session_id text not null references sessions(session_id) on delete cascade,
        source text not null,
        delivery_mode text not null default 'once',
        prompt_text text not null,
        telegram_chat_id text,
        telegram_message_id integer,
        created_at text not null,
        primary key (session_id, delivery_mode)
      )`,
      `insert into session_remote_prompts (
        session_id,
        source,
        delivery_mode,
        prompt_text,
        telegram_chat_id,
        telegram_message_id,
        created_at
      )
      select
        session_id,
        source,
        delivery_mode,
        prompt_text,
        telegram_chat_id,
        telegram_message_id,
        created_at
      from session_remote_prompts_old`,
      `create table telegram_delivery_receipts (
        id text primary key,
        notification_id text references notifications(id) on delete set null,
        session_id text not null references sessions(session_id) on delete cascade,
        bot_token text not null,
        chat_id text not null,
        telegram_message_id integer not null,
        created_at text not null
      )`,
      `insert into telegram_delivery_receipts (
        id,
        notification_id,
        session_id,
        bot_token,
        chat_id,
        telegram_message_id,
        created_at
      )
      select
        id,
        notification_id,
        session_id,
        bot_token,
        chat_id,
        telegram_message_id,
        created_at
      from telegram_delivery_receipts_old`,
      `create unique index telegram_delivery_receipts_lookup_idx
        on telegram_delivery_receipts(bot_token, chat_id, telegram_message_id)`,
      `create table session_awaiting_replies (
        session_id text not null references sessions(session_id) on delete cascade,
        bot_token text not null,
        chat_id text not null,
        turn_id text,
        started_at text not null,
        primary key (session_id, bot_token, chat_id)
      )`,
      `insert into session_awaiting_replies (
        session_id,
        bot_token,
        chat_id,
        turn_id,
        started_at
      )
      select
        session_id,
        bot_token,
        chat_id,
        turn_id,
        started_at
      from session_awaiting_replies_old`,
      `drop table session_awaiting_replies_old`,
      `drop table telegram_delivery_receipts_old`,
      `drop table session_remote_prompts_old`,
      `drop table session_runtime_old`,
      `drop table session_notifications_old`,
      `drop table sessions_old`,
      `pragma foreign_keys = on`,
    ],
  },
  {
    id: 16,
    name: "preset_constraints",
    statements: [
      `pragma foreign_keys = off`,
      ...PARK_PASSIVE_OVERRIDABLE_SESSION_ID_STATEMENTS,
      `alter table settings rename to settings_old`,
      `create table settings (
        id integer primary key,
        default_prompt text not null,
        scope text not null check (scope in (${SETTINGS_SCOPE_CHECK})),
        global_preset text check (global_preset is null or global_preset in (${PRESET_CHECK})),
        global_notification_id text,
        global_completion_check_id text,
        global_completion_check_wait_for_reply integer not null default 0 check (global_completion_check_wait_for_reply in (0, 1)),
        hooks_auto_registration integer not null default 1 check (hooks_auto_registration in (0, 1)),
        check (id = 1)
      )`,
      `insert into settings (
        id,
        default_prompt,
        scope,
        global_preset,
        global_notification_id,
        global_completion_check_id,
        global_completion_check_wait_for_reply,
        hooks_auto_registration
      )
      select
        id,
        default_prompt,
        scope,
        global_preset,
        global_notification_id,
        global_completion_check_id,
        global_completion_check_wait_for_reply,
        hooks_auto_registration
      from settings_old`,
      `drop table settings_old`,
      `alter table sessions rename to sessions_old`,
      `alter table session_notifications rename to session_notifications_old`,
      `alter table session_runtime rename to session_runtime_old`,
      `alter table session_remote_prompts rename to session_remote_prompts_old`,
      `alter table telegram_delivery_receipts rename to telegram_delivery_receipts_old`,
      `alter table session_awaiting_replies rename to session_awaiting_replies_old`,
      `drop index if exists sessions_first_seen_at_idx`,
      `drop index if exists sessions_last_seen_at_idx`,
      `drop index if exists sessions_session_ref_idx`,
      `drop index if exists session_notifications_notification_idx`,
      `drop index if exists telegram_delivery_receipts_lookup_idx`,
      `create table sessions (
        session_id text primary key,
        session_ref text not null,
        source text not null check (source in (${SESSION_SOURCE_CHECK})),
        cwd text,
        archived integer not null default 0 check (archived in (0, 1)),
        first_seen_at text not null,
        last_seen_at text not null,
        active_since text,
        stop_count integer not null default 0 check (stop_count >= 0),
        preset text check (preset is null or preset in (${PRESET_CHECK})),
        preset_overridden integer not null default 0 check (preset_overridden in (0, 1)),
        completion_check_id text,
        completion_check_wait_for_reply integer not null default 0 check (completion_check_wait_for_reply in (0, 1)),
        title text,
        transcript_path text,
        last_assistant_message text
      )`,
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
        preset_overridden,
        completion_check_id,
        completion_check_wait_for_reply,
        title,
        transcript_path,
        last_assistant_message
      )
      select
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
        preset_overridden,
        completion_check_id,
        completion_check_wait_for_reply,
        title,
        transcript_path,
        last_assistant_message
      from sessions_old`,
      `create index sessions_first_seen_at_idx on sessions(first_seen_at, session_id)`,
      `create index sessions_last_seen_at_idx on sessions(last_seen_at, session_id)`,
      `create unique index sessions_session_ref_idx on sessions(session_ref)`,
      `create table session_notifications (
        session_id text not null references sessions(session_id) on delete cascade,
        notification_id text not null references notifications(id) on delete cascade,
        primary key (session_id, notification_id)
      )`,
      `insert into session_notifications (session_id, notification_id)
        select session_id, notification_id from session_notifications_old`,
      `create index session_notifications_notification_idx on session_notifications(notification_id, session_id)`,
      `create table session_runtime (
        session_id text primary key references sessions(session_id) on delete cascade,
        remaining_turns integer not null check (remaining_turns >= 0)
      )`,
      `insert into session_runtime (session_id, remaining_turns)
        select session_id, remaining_turns from session_runtime_old`,
      `create table session_remote_prompts (
        session_id text not null references sessions(session_id) on delete cascade,
        source text not null,
        delivery_mode text not null default 'once',
        prompt_text text not null,
        telegram_chat_id text,
        telegram_message_id integer,
        created_at text not null,
        primary key (session_id, delivery_mode)
      )`,
      `insert into session_remote_prompts (
        session_id,
        source,
        delivery_mode,
        prompt_text,
        telegram_chat_id,
        telegram_message_id,
        created_at
      )
      select
        session_id,
        source,
        delivery_mode,
        prompt_text,
        telegram_chat_id,
        telegram_message_id,
        created_at
      from session_remote_prompts_old`,
      `create table telegram_delivery_receipts (
        id text primary key,
        notification_id text references notifications(id) on delete set null,
        session_id text not null references sessions(session_id) on delete cascade,
        bot_token text not null,
        chat_id text not null,
        telegram_message_id integer not null,
        created_at text not null
      )`,
      `insert into telegram_delivery_receipts (
        id,
        notification_id,
        session_id,
        bot_token,
        chat_id,
        telegram_message_id,
        created_at
      )
      select
        id,
        notification_id,
        session_id,
        bot_token,
        chat_id,
        telegram_message_id,
        created_at
      from telegram_delivery_receipts_old`,
      `create unique index telegram_delivery_receipts_lookup_idx
        on telegram_delivery_receipts(bot_token, chat_id, telegram_message_id)`,
      `create table session_awaiting_replies (
        session_id text not null references sessions(session_id) on delete cascade,
        bot_token text not null,
        chat_id text not null,
        turn_id text,
        started_at text not null,
        primary key (session_id, bot_token, chat_id)
      )`,
      `insert into session_awaiting_replies (
        session_id,
        bot_token,
        chat_id,
        turn_id,
        started_at
      )
      select
        session_id,
        bot_token,
        chat_id,
        turn_id,
        started_at
      from session_awaiting_replies_old`,
      `drop table session_awaiting_replies_old`,
      `drop table telegram_delivery_receipts_old`,
      `drop table session_remote_prompts_old`,
      `drop table session_runtime_old`,
      `drop table session_notifications_old`,
      `drop table sessions_old`,
      `pragma foreign_keys = on`,
    ],
  },
  {
    id: 17,
    name: "runtime_state",
    statements: [
      `alter table settings add column runtime_state text not null default 'running' check (runtime_state in (${RUNTIME_STATE_CHECK}))`,
      `update settings set runtime_state = 'running' where runtime_state is null or trim(runtime_state) = ''`,
    ],
  },
  {
    id: 18,
    name: "canonical_thread_fields",
    statements: [
      `alter table sessions rename column session_id to thread_id`,
      `alter table sessions rename column title to thread_name`,
      `alter table session_notifications rename column session_id to thread_id`,
      `alter table session_runtime rename column session_id to thread_id`,
      `alter table session_remote_prompts rename column session_id to thread_id`,
      `alter table telegram_delivery_receipts rename column session_id to thread_id`,
      `alter table session_awaiting_replies rename column session_id to thread_id`,
    ],
  },
  {
    id: 19,
    name: "orphaned_refresh_miss_count",
    statements: [
      `alter table sessions add column orphaned_refresh_miss_count integer not null default 0 check (orphaned_refresh_miss_count >= 0)`,
      `update sessions
        set orphaned_refresh_miss_count = 0
        where orphaned_refresh_miss_count is null
           or orphaned_refresh_miss_count < 0`,
    ],
  },
  ...hookLifecycleMigrations,
];

export function applyAppMigrations(
  sqlite: Database,
  migrations: readonly AppMigration[] = appMigrations,
) {
  sqlite.exec(`create table if not exists schema_migrations (
    id integer primary key,
    name text not null,
    applied_at text not null
  )`);

  const appliedRows = sqlite
    .query("select id from schema_migrations order by id asc")
    .all() as Array<{
    id: number;
  }>;
  const appliedIds = new Set(appliedRows.map((row) => row.id));
  const insertAppliedMigration = sqlite.query(
    "insert into schema_migrations (id, name, applied_at) values (?, ?, ?)",
  );

  const applyMigration = sqlite.transaction((migration: AppMigration) => {
    for (const statement of migration.statements) {
      try {
        sqlite.exec(statement);
      } catch (error) {
        if (shouldIgnoreMigrationStatementError(sqlite, statement, error)) {
          continue;
        }

        throw error;
      }
    }

    insertAppliedMigration.run(migration.id, migration.name, nowIsoString());
  });

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    applyMigration(migration);
  }
}
