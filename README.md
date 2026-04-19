



<h1 align="center">Loopndroll</h1>

<p align="center"><strong>Let Codex run until the task is actually done.</strong></p>
<p align="center"><a href="https://github.com/lnikell/loopndroll/releases/latest/download/stable-macos-arm64-Loopndroll.dmg">Download</a></p>

https://github.com/user-attachments/assets/1deba634-a305-4686-8654-65f889162932

If you've ever had to send dozens of follow-up messages just to keep Codex running, or felt frustrated when it skipped tests, lint, or typecheck even though you clearly asked for them in Agents.md, this might help.

## With Loopndroll, you can:

- keep Codex running until you stop it
- require specific commands at the end of a task, and keep going until they pass
- get progress updates in Telegram or Slack, and even reply to redirect the work or change the mode

## How does it work

Loopndroll plugs into Codex through Codex Hooks.

When a chat starts, Loopndroll registers it and remembers the settings for that task.

When Codex tries to stop, Loopndroll gets a chance to decide what should happen next. Depending on the mode you picked, it can:

- let the chat stop
- send another prompt and keep Codex going
- run your completion checks first, and keep going if they fail
- wait for a reply from Telegram and feed that reply back into the same chat

At the same time, it can send the latest assistant message to Telegram or Slack so you can see progress without sitting in front of Codex the whole time.

**IMPORTANT:** Loopndroll runs fully locally on your machine. It does not send your chats, prompts, or app data to any Loopndroll server. If you connect Telegram or Slack, you are using **your own bot** or **your own webhook**, under your control.

## Modes

You can set a mode globally for all chats, or override it per task.

If no mode is active, Codex stops normally.

- **Infinite**: every time Codex stops, Loopndroll sends the default follow-up prompt and keeps the chat going. You can change that default prompt in Settings, or override it for one task by replying to that task in Telegram.
- **Await Reply**: when Codex stops, Loopndroll waits for your reply in Telegram, then sends that reply back into the same chat.
- **Completion Checks**: when Codex stops, Loopndroll runs your commands like tests, lint, or typecheck. If any command fails, it tells Codex to keep going until they pass.
- **Max Turns 1 / 2 / 3**: Loopndroll keeps Codex going for a fixed number of extra turns, then lets it stop.

This gives you a simple choice: keep pushing automatically, wait for human input, require checks to pass, or allow only a small number of extra turns.

## Use cases

- **Keep pushing on a messy refactor without making me send "keep going" every 5 minutes**
  Use **Infinite** when the work is real, but there is no clean automatic way to evaluate "done" yet. This fits tasks like cross-file refactors, bug hunts, and long review-comment cleanup where the next step depends on what Codex finds.

- **Make sure `pnpm test` passes before marking the task as done**
  Use **Completion Checks** when you want Codex to stop only after the repo is actually green. This is for the common case where the agent says it is done, but tests, lint, or typecheck still fail.

- **Send me the result in Telegram and wait for my decision**
  Use **Await Reply** when Codex reaches a decision point and should wait for you instead of guessing. This works well when you want to review a draft, approve a plan, or redirect the work while you are away from your desk.

## Telegram Setup

### Get a Telegram bot token

1. Open Telegram.
2. Start a chat with [`@BotFather`](https://t.me/BotFather).
3. Send `/newbot`.
4. Follow the prompts to choose a bot name and username.
5. BotFather will send you a bot token. It looks like `123456789:AA...`.
6. In Loop N Roll, go to `Settings` -> `Notifications` -> `Add Notification`.
7. Choose `Telegram`.
8. Paste the bot token into `API Token`.

### Get your Telegram chat to show up in the app

1. Open a direct message with your bot and send any message.
2. Or add the bot to a group and send any message in that group.
3. Go back to Loopndroll.
4. The chat should appear in the `Chat` dropdown.
5. Select it and save the notification.

## Telegram Commands

These commands work in Telegram after your bot is connected:

- `/help` - show the command help
- `/list` - list chats registered to this Telegram destination
- `/status` - show the current global mode and per-chat modes
- `/reply C22 your message` - send a message to one specific chat
- `/mode global infinite` - set the global mode to Infinite
- `/mode global await` - set the global mode to Await Reply
- `/mode global checks` - set the global mode to Completion Checks
- `/mode global off` - turn off the global mode
- `/mode C22 infinite` - set chat `C22` to Infinite
- `/mode C22 await` - set chat `C22` to Await Reply
- `/mode C22 checks` - set chat `C22` to Completion Checks
- `/mode C22 off` - stop chat `C22`

Notes:

- If you reply directly to a Telegram notification, Loopndroll uses that chat automatically.
- If you send plain text without a command, Loopndroll sends it to the latest waiting chat in that Telegram conversation.

## Slack Setup

### Important

This app uses a Slack Incoming Webhook URL.

It does **not** use a Slack bot token.

### Get the Slack webhook URL

1. Go to [Slack Apps](https://api.slack.com/apps).
2. Create a new app, or open an existing app.
3. Open `Incoming Webhooks`.
4. Turn Incoming Webhooks on.
5. Click `Add New Webhook to Workspace`.
6. Pick the channel where you want messages posted.
7. Approve the app.
8. Copy the webhook URL. It looks like `https://hooks.slack.com/services/...`.
9. In Loopndroll, go to `Settings` -> `Notifications` -> `Add Notification`.
10. Choose `Slack`.
11. Paste the webhook URL into `Webhook URL`.

If you were looking for a Slack token: this app does not need one for Slack notifications.

## Development

- `pnpm install` - install dependencies
- `pnpm run dev` - start the app in development mode
- `pnpm run check` - run lint, format check, and typecheck
- `pnpm run build` - build the app
- `pnpm run build:stable` - build the release version

## Platform notes

- Loopndroll stores app data in the platform app-data directory, such as `~/Library/Application Support/loopndroll` on macOS and `%LocalAppData%\loopndroll` on Windows.
- Completion checks run through the native shell for the current platform: `cmd.exe /c` on Windows and the current POSIX shell on macOS/Linux.

## Useful Links

- Telegram BotFather: [https://t.me/BotFather](https://t.me/BotFather)
- Telegram Bot API: [https://core.telegram.org/bots/api](https://core.telegram.org/bots/api)
- Slack apps: [https://api.slack.com/apps](https://api.slack.com/apps)
- Slack incoming webhooks: [https://api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks)
