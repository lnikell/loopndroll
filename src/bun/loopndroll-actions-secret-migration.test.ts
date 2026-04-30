import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { redactPersistedTelegramBotToken } from "./loopndroll-actions";

function createTokenStateSchema(db: Database) {
  db.exec(`
    create table telegram_update_cursors (
      bot_token text primary key,
      last_update_id integer not null,
      updated_at text not null
    );

    create table telegram_known_chats (
      bot_token text not null,
      chat_id text not null,
      kind text not null,
      username text,
      display_name text not null,
      updated_at text not null,
      primary key (bot_token, chat_id)
    );

    create table session_awaiting_replies (
      thread_id text not null,
      bot_token text not null,
      chat_id text not null,
      turn_id text,
      started_at text not null,
      primary key (thread_id, bot_token, chat_id)
    );

    create table telegram_delivery_receipts (
      id text primary key,
      notification_id text,
      thread_id text not null,
      bot_token text not null,
      chat_id text not null,
      telegram_message_id integer not null,
      created_at text not null
    );
  `);
}

describe("telegram bot token state redaction", () => {
  test("moves token-scoped bridge state to the migration ref without dropping it", () => {
    const db = new Database(":memory:");
    createTokenStateSchema(db);
    db.query(
      `insert into telegram_update_cursors (bot_token, last_update_id, updated_at)
       values ('plain-token', 41, '2026-04-30T00:00:00.000Z')`,
    ).run();
    db.query(
      `insert into telegram_known_chats (
        bot_token,
        chat_id,
        kind,
        username,
        display_name,
        updated_at
      ) values ('plain-token', '123', 'private', 'user', 'User', '2026-04-30T00:00:00.000Z')`,
    ).run();
    db.query(
      `insert into session_awaiting_replies (
        thread_id,
        bot_token,
        chat_id,
        turn_id,
        started_at
      ) values ('thread-1', 'plain-token', '123', 'turn-1', '2026-04-30T00:00:00.000Z')`,
    ).run();
    db.query(
      `insert into telegram_delivery_receipts (
        id,
        notification_id,
        thread_id,
        bot_token,
        chat_id,
        telegram_message_id,
        created_at
      ) values ('receipt-1', 'notification-1', 'thread-1', 'plain-token', '123', 10, '2026-04-30T00:00:00.000Z')`,
    ).run();

    redactPersistedTelegramBotToken(
      db,
      "plain-token",
      "keychain://loopndroll/telegram-bot-token/notification-1",
    );

    expect(db.query("select count(*) as count from telegram_update_cursors").get()).toEqual({
      count: 1,
    });
    expect(db.query("select bot_token, last_update_id from telegram_update_cursors").get()).toEqual(
      {
        bot_token: "keychain://loopndroll/telegram-bot-token/notification-1",
        last_update_id: 41,
      },
    );
    expect(db.query("select bot_token, chat_id from telegram_known_chats").get()).toEqual({
      bot_token: "keychain://loopndroll/telegram-bot-token/notification-1",
      chat_id: "123",
    });
    expect(db.query("select bot_token, chat_id from session_awaiting_replies").get()).toEqual({
      bot_token: "keychain://loopndroll/telegram-bot-token/notification-1",
      chat_id: "123",
    });
    expect(db.query("select bot_token, chat_id from telegram_delivery_receipts").get()).toEqual({
      bot_token: "keychain://loopndroll/telegram-bot-token/notification-1",
      chat_id: "123",
    });
  });
});
