# Loopndroll Agent Notes

## Repository

Loopndroll is a desktop app that keeps Codex chats moving after Codex stops. The app uses Electrobun for the desktop shell, Bun for the backend process, and Vite + React 19 + TypeScript for the renderer.

## Code Style

- TypeScript everywhere with `strict` mode enabled.
- Formatting and linting use `oxfmt` and `oxlint`.
- Do not disable or ignore ESLint-style `max-lines` or `max-lines-per-function` limits.
- Use the `@/` alias for imports from `src`.
- Keep components and route models small; move shared helpers into `src/lib` or `src/shared`.
- Prefer typed constants and narrow unions over loose strings.

## Folder Structure

- `src/app.tsx`, `src/main.tsx`: renderer entry and app shell.
- `src/pages/*`: route-level UI and route-specific models.
- `src/components/*`: reusable React components.
- `src/components/ui/*`: shared shadcn/base UI primitives.
- `src/lib/*`: renderer-side helpers, hooks, RPC clients.
- `src/shared/*`: types shared between renderer and Bun.
- `src/bun/*`: Bun/Electrobun main-process code, hooks, Telegram bridge, app actions.
- `src/bun/db/*`: SQLite schema, migrations, and DB client.

## Naming

- Files and folders: `kebab-case`.
- React components and types: `PascalCase`.
- Hooks: `useSomething`.
- Functions and variables: `camelCase`.
- Constants: `UPPER_SNAKE_CASE`.
- Route-specific state logic usually lives in `model.ts`; reusable UI stays in `components`.

## Debugging

- Start dev mode with `pnpm dev`.
- Run repo checks with `pnpm check`.
- The renderer runs on `http://127.0.0.1:5173`; the desktop/backend entry is `src/bun/index.ts`.
- In normal dev mode, Bun/Electrobun logs are printed to the terminal running `pnpm dev`.
- For hook-level persistent debug logs, run `LOOPNDROLL_ENABLE_HOOK_DEBUG_LOGS=1 pnpm dev`.

## Dev Logs

- SQLite app state lives under the platform app-data directory:
  macOS: `~/Library/Application Support/loopndroll/app.db`
  Windows: `%LocalAppData%\loopndroll\app.db`
  Linux: `${XDG_DATA_HOME:-~/.local/share}/loopndroll/app.db`
- Optional hook debug log lives alongside the database in `logs/hooks-debug.jsonl`
- Managed Codex hook/config files touched by the app: `~/.codex/hooks.json` and `~/.codex/config.toml`
