<h1 align="center">Loopndroll</h1>

<p align="center"><strong>Let Codex run until the task is actually done.</strong></p>
<p align="center"><a href="https://github.com/lnikell/loopndroll/releases/download/v1.1.5/stable-macos-arm64-Loopndroll.dmg">Download current published release</a></p>

https://github.com/user-attachments/assets/1deba634-a305-4686-8654-65f889162932

Loopndroll is a local macOS app for keeping Codex chats moving after Codex tries to stop. It uses Codex Hooks to observe chats, decide what should happen at Stop, send notifications, and optionally feed a Telegram reply back into the same Codex chat when the chat is already waiting.

It is useful when you want Codex to keep going through a long task, prove checks before stopping, or wait for a human decision in Telegram instead of guessing.

## Features

- Keep Codex running with a configurable continue prompt.
- Wait for a Telegram reply before continuing a Codex chat.
- Run completion checks, such as tests, lint, or typecheck, before allowing a chat to stop.
- Limit continuation to one, two, or three extra turns.
- Send Codex Stop replies to Telegram and Slack.
- Mirror observed Codex user prompts and assistant Stop replies to connected channels.
- Configure modes globally or per Codex chat.
- Attach Telegram or Slack destinations globally or per chat.
- Store new Telegram bot tokens and Slack webhook URLs in macOS Keychain.
- Manage Loopndroll's own Codex hooks without deleting unrelated hooks.

## Safety model

Loopndroll runs locally on your machine. It does not send your chats, prompts, app database, or hook state to a Loopndroll server.

If you connect Telegram or Slack, delivery goes through your own Telegram bot token or your own Slack Incoming Webhook URL. Those provider endpoints are controlled by you.

Important safety defaults:

- New Telegram bot tokens are stored in macOS Keychain.
- New Slack webhook URLs are stored in macOS Keychain.
- The local SQLite database stores non-secret Keychain references for new secrets.
- Telegram control is direct-message only.
- Telegram groups and channels are filtered out for control.
- Slack is outbound-only in v1.
- Passive wake is disabled in v1.
- Telegram input does not wake idle Codex threads.
- If no hook-backed channel is active, Telegram input is not delivered to Codex.
- Pause is a soft disable: hooks remain installed but Loopndroll stays inert.
- Stop/Clear removes only Loopndroll-managed hook entries.

## How it works

Loopndroll plugs into Codex through Codex Hooks.

When a Codex chat starts or resumes, Loopndroll registers the chat locally. When Codex reaches Stop, Loopndroll evaluates the active mode and either lets Codex stop or returns a follow-up prompt that keeps the chat going.

Depending on the mode, Loopndroll can:

- let the chat stop normally;
- send the default continue prompt;
- send a Telegram-provided prompt;
- run completion checks and continue if they fail;
- wait for a Telegram reply while Codex is already stopped inside an active hook;
- notify Telegram or Slack with the latest assistant message.

Loopndroll does not use Telegram or Slack as a general remote shell. Remote input is deliberately limited to active, hook-backed flows.

## Modes

You can set a mode globally for all chats, or override it per chat.

If no mode is active, Codex stops normally.

- **Infinite**: every time Codex stops, Loopndroll sends the default continue prompt and keeps the chat going. You can edit the default prompt in Settings.
- **Await Reply**: when Codex stops, Loopndroll sends a Telegram notification and waits for your Telegram reply. The reply is then sent back into the same Codex chat.
- **Completion Checks**: when Codex stops, Loopndroll runs configured commands such as tests, lint, or typecheck. If any command fails, Loopndroll tells Codex to keep going.
- **Max Turns 1 / 2 / 3**: Loopndroll keeps Codex going for a fixed number of extra turns, then lets it stop.
- **Off**: Loopndroll does not continue the chat and does not accept Telegram input for that chat.

## What v1 does not do

Loopndroll v1 does not wake idle Codex threads from Telegram.

That means a Telegram message cannot currently open chat `C2` and start a new Codex turn as if you typed into the Codex UI. Telegram input only works when Loopndroll already has a safe hook-backed channel, such as Await Reply waiting inside a Stop hook.

This is intentional. Starting a new Codex turn from an idle chat needs a reliable supported input surface from Codex. Loopndroll v1 keeps the product boundary conservative and safe instead of pretending that Telegram can wake idle chats.

## Notifications and mirror mode

Control-mode notifications require an active Loopndroll mode.

Mirror mode is separate. When enabled, Loopndroll mirrors observed Codex user prompts and assistant Stop replies to attached Telegram and Slack destinations. Mirror mode is output-only: Telegram replies are still ignored unless Await Reply is active.

Default behavior when everything is off:

- no Stop notifications;
- no mirror messages;
- no Telegram replies delivered to Codex;
- no pending prompts kept for inactive chats.

Administrative Telegram commands such as `/status`, `/help`, `/list`, `/mode`, and `/failsafe` may still respond because they control the integration itself.

## Hook lifecycle

Loopndroll manages only its own Codex hook entries.

Codex can load matching hooks from both global and repo-local hook files:

- `~/.codex/hooks.json`
- `<repo>/.codex/hooks.json`

Loopndroll treats hook installation as a multi-file surface and does not claim all hooks are removed unless its own managed entries are removed from the relevant hook files.

Runtime states:

- **Running**: Loopndroll-managed hooks are installed and active.
- **Paused**: managed hooks remain installed, but Loopndroll stays inert and avoids remote-control side effects.
- **Stopped**: Loopndroll removes only its own managed hook entries and stops responding until started again.

Changing hook files does not prove that an already-live Codex runtime has hot-unloaded those hooks. Loopndroll exposes that distinction in the app instead of pretending file state and live runtime state are the same.

## Startup recovery

If the previous app process exits without graceful cleanup and leaves its runtime marker behind, Loopndroll clears inherited active loop state on startup. This avoids relaunching into stale active modes or keeping old pending Telegram prompts alive by accident. A normal quit preserves configured modes.

## Telegram setup

### Create a Telegram bot

1. Open Telegram.
2. Start a chat with [`@BotFather`](https://t.me/BotFather).
3. Send `/newbot`.
4. Choose the bot display name.
5. Choose the bot username. Telegram requires it to end in `bot`.
6. Copy the bot token. It looks like `<bot-id>:<bot-secret>`.
7. In Loopndroll, open `Settings`.
8. Open `Telegram setup instructions` if you want the checklist.
9. Click `Add Telegram Notification`.
10. Paste the token into `API Token`.

Loopndroll stores newly saved Telegram bot tokens in macOS Keychain.

Use one Telegram bot token per machine. Telegram polling cursors are token-scoped, so sharing one bot token across multiple Loopndroll installs can make replies appear on the wrong machine or disappear from one install after another install consumes the update.

### Make your chat appear

1. Open a direct message with your new bot.
2. Send any message to the bot.
3. Return to Loopndroll.
4. Load/select the direct-message chat.
5. Save the notification.
6. Attach the notification globally or to specific chats from Home.

Telegram control is direct-message only in v1. Groups and channels are filtered out for safety.

## Telegram commands

These commands work after your bot is connected:

- `/help` - show command help.
- `/list` - list chats registered to this Telegram destination.
- `/status` - show system state, global mode, and per-chat modes.
- `/reply C22 your message` - fallback: send a message to a specific registered chat.
- `/mode global infinite` - set the global mode to Infinite.
- `/mode global await` - set the global mode to Await Reply.
- `/mode global checks` - set the global mode to Completion Checks.
- `/mode global off` - turn off the global mode.
- `/mode C22 infinite` - set chat `C22` to Infinite.
- `/mode C22 await` - set chat `C22` to Await Reply.
- `/mode C22 checks` - set chat `C22` to Completion Checks.
- `/mode C22 off` - turn off chat `C22`.
- `/failsafe C22` - disable control for one chat and clear its pending prompts.
- `/failsafe all` - disable global mode, all per-chat modes, and pending prompts.

Notes:

- Replying directly to a Loopndroll Telegram notification targets that Codex chat.
- Plain text without a command targets the latest safe Telegram-linked chat only when that chat has an active mode.
- If the target chat is Off, Loopndroll reports that nothing was delivered.
- If there is no safe active channel, Loopndroll does not wake Codex in v1.

## Slack setup

Loopndroll uses Slack Incoming Webhooks.

It does not use a Slack bot token in v1, and it does not receive inbound Slack messages.

Why Slack is outbound-only:

- An Incoming Webhook is a one-way Slack URL for posting messages into a channel.
- It does not deliver channel messages back to Loopndroll.
- Inbound Slack control would require a Slack app with events, permissions, signing-secret verification, and a reachable HTTP endpoint.
- Loopndroll v1 is local-first and does not require a public server, so Slack stays outbound-only.

### Create a Slack Incoming Webhook

1. Go to [Slack Apps](https://api.slack.com/apps).
2. Create a new app, or open an existing app.
3. Open `Incoming Webhooks`.
4. Turn Incoming Webhooks on.
5. Click `Add New Webhook to Workspace`.
6. Pick the channel where Loopndroll should post messages.
7. Approve the app.
8. Copy the webhook URL. It looks like `https://hooks.slack.com/services/...`.
9. In Loopndroll, open `Settings`.
10. Open `Slack setup instructions` if you want the checklist.
11. Click `Add Slack Notification`.
12. Paste the webhook URL into `Webhook URL`.

Loopndroll stores newly saved Slack webhook URLs in macOS Keychain.

## Secret migration

Older local databases may contain plaintext Telegram bot tokens or Slack webhook URLs. Settings includes a Secret migration card that moves legacy plaintext secrets into macOS Keychain and keeps only non-secret references in the database.

## Install and updates

Install Loopndroll from a versioned release artifact. Public download links should point to a specific tag, for example `/releases/download/v1.1.5/...`, not GitHub's mutable `/releases/latest/download/...` shortcut.

Release builds can still use Electrobun's auto-update mechanism. The app reads its configured release feed, checks for `update.json`, downloads an update, and applies it after you choose `Restart to Update`. Settings shows the current version, channel, release feed, last check time, and update status.

For release maintainers:

- `RELEASE_BASE_URL` controls the auto-update feed embedded in the release build.
- `scripts/release-macos.sh` defaults to Electrobun's GitHub Releases feed.
- Direct install links in documentation should stay version-pinned.
- Prefer a controlled stable feed plus signed release artifacts when you need stronger protection against mutable-feed compromise.

## Development

- `pnpm install` - install dependencies.
- `pnpm run dev` - start the app in development mode.
- `pnpm run check` - run lint, format check, and typecheck.
- `pnpm run build` - build the app.
- `pnpm run build:stable` - build the stable release app.
- `RELEASE_BASE_URL=<stable-feed-url> pnpm run release:macos` - build, sign, notarize, and publish a release.

## Useful links

- Telegram BotFather: [https://t.me/BotFather](https://t.me/BotFather)
- Telegram Bot API: [https://core.telegram.org/bots/api](https://core.telegram.org/bots/api)
- Slack apps: [https://api.slack.com/apps](https://api.slack.com/apps)
- Slack Incoming Webhooks: [https://api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks)
