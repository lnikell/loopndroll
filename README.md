# Loopndroll

Loopndroll is a macOS menu bar app that installs a global Codex `Stop` hook under `~/.codex` and can keep Codex sessions running either indefinitely or for a per-thread turn budget.

[Download](https://github.com/lnikell/loopndroll/releases/download/v1.0.0/loopndroll-v1.0.0.zip)

https://github.com/user-attachments/assets/d69f08ee-86a0-40a3-a2f6-ef625bd9d7eb

## What it does

- Adds `codex_hooks = true` to `~/.codex/config.toml`
- Creates or merges a managed `Stop` hook in `~/.codex/hooks.json`
- Stores its runtime state in `~/Library/Application Support/loopndroll/state.json`
- Keeps the hook installed even when the app is off; the helper checks app state and no-ops when disabled

The managed hook uses Codex `Stop` hooks, which continue Codex by returning `{"decision":"block","reason":"..."}` to the runtime.

## Important behavior

- Hooks apply reliably to new Codex threads created after Loopndroll is installed.
- If a Codex thread was already running before the hook was installed, that existing thread may not pick up the new hook dynamically.
- Toggling `Start` or `Stop` updates shared state immediately for threads that already know about the hook.

## Install

### Prebuilt app

1. Download `Loopndroll.app.zip` from a release or the `dist/` folder produced by the packaging script.
2. Unzip it.
3. Move `Loopndroll.app` into `/Applications` or another permanent location.
4. Launch the app and allow it to run.
5. Open a new Codex thread after first install.

This repository currently packages an unsigned app bundle with ad-hoc signing only. On another Mac, Gatekeeper may require right-click -> `Open` on first launch, or the app may need to be notarized before broader distribution.

### Build from source

```bash
swift build
swift run Loopndroll
```

## Package for sharing

```bash
./scripts/package_app.sh
```

That command creates:

- `dist/Loopndroll.app`
- `dist/Loopndroll.app.zip`

To sign with a real Developer ID certificate instead of ad-hoc signing:

```bash
SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" ./scripts/package_app.sh
```

You can list available code-signing identities with:

```bash
security find-identity -v -p codesigning
```

## Structure

- `Sources/LoopndrollCore`: install/repair logic, state store, hook decision engine, and prompt rendering
- `Sources/LoopndrollApp`: SwiftUI menu bar app
- `Sources/LoopndrollHook`: dedicated helper executable for tests and direct CLI use
- `Packaging/Info.plist`: app bundle metadata used by the packager
- `scripts/package_app.sh`: release packaging script

Release builds bundle `LoopndrollHook` under `Loopndroll.app/Contents/Helpers/LoopndrollHook`, and the app installs that helper as the managed hook executable in `~/Library/Application Support/loopndroll/bin/loopndroll-hook`. The app binary also supports `--hook` mode for local development.

## Build

```bash
swift build
```

## Run

```bash
swift run Loopndroll
```

## Test

```bash
swift test
```
