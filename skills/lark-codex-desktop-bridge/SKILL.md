---
name: lark-codex-desktop-bridge
description: Connect an existing lark-channel-bridge Feishu/Lark bot chat to a Codex desktop/app thread by installing an app-server wrapper, updating the bridge profile's Codex binary path, and binding a Lark chat_id to a Codex thread_id. Use when the user asks to make Feishu/Lark bot messages continue the current Codex desktop session/thread, package this bridge setup into a reusable workflow, or repair/reapply the local desktop-thread bridge after bridge/profile changes.
---

# Lark Codex Desktop Bridge

## Scope

Installing this skill only installs the skill folder. It does not automatically install npm packages or configure a Feishu/Lark app. For a public/open-source release, tell users to run the dependency bootstrap script first.

Use this skill only after the normal Feishu/Lark bridge is already healthy. Concretely, these local files and settings must already exist and work:

- `~/.lark-channel/config.json` contains a profile such as `codex`.
- That profile has `agentKind: "codex"` and valid Feishu/Lark app credentials through the bridge secret store.
- `lark-channel-bridge status --profile <profile>` shows the bot running.
- A Feishu/Lark message to the bot reaches bridge logs as an `intake.enter` event, and the bot can send a reply.

This skill does not create the Feishu app, subscribe message events, store app secrets, or perform OAuth login. It assumes that part is already working. It only changes the last hop: instead of letting bridge call `codex exec` directly, it points bridge at a wrapper that calls Codex `app-server` and resumes a desktop/app thread.

## Dependency Bootstrap

For a new machine, run check-only first:

```bash
node <skill-dir>/scripts/bootstrap_dependencies.js
```

If dependencies are missing and the user explicitly wants the script to install them:

```bash
node <skill-dir>/scripts/bootstrap_dependencies.js --install
```

The bootstrap script checks:

- `lark-channel-bridge`, npm package backed by `github.com/zarazhangrui/feishu-claude-code-bridge`
- `lark-cli` from npm package `@larksuite/cli`
- Codex binary, defaulting to `/Applications/Codex.app/Contents/Resources/codex`

With `--install`, it runs:

```bash
npm install -g lark-channel-bridge @larksuite/cli
```

Do not store or print Feishu app secrets in the skill. App creation, app secret storage, event subscription, and profile creation still happen through `lark-channel-bridge` and `lark-cli`.

## Dependency Model

Treat `lark-channel-bridge` as an external runtime prerequisite, not vendored skill code. The skill depends on it by command-line contract:

- `lark-channel-bridge` owns Feishu/Lark websocket events, message parsing, queueing, replies, card rendering, daemon lifecycle, and profile state under `~/.lark-channel`.
- The skill's wrapper only replaces the Codex execution target configured at `profiles.<profile>.codex.binaryPath`.
- The wrapper expects bridge to invoke the Codex agent in the current bridge shape: `codex exec --json ...` or `codex exec resume --json <threadId> -`.

For open-source distribution, document `lark-channel-bridge` as a peer/runtime dependency and provide `bootstrap_dependencies.js --install` as a convenience installer.

## Required Inputs

For an existing bridge profile, collect:

- `thread_id`: Codex desktop/app thread id to continue.
- `chat_id`: Feishu/Lark `chatId` to bind. In bridge-delivered prompts, read it from `bridge_context.chatId`.
- `profile`: lark-channel profile name. Default to `LARK_CHANNEL_PROFILE`, otherwise `codex`.
- `cwd`: workspace directory for this binding. Default to current working directory.
- `bridge_home`: lark-channel home. Default to `LARK_CHANNEL_HOME`, otherwise `~/.lark-channel`.

Optional:

- `codex_bin`: real Codex binary. Default: `/Applications/Codex.app/Contents/Resources/codex`.

Not required for this desktop binding if the profile already exists:

- App secret.
- Bot open_id.
- User open_id.
- App id, except when diagnosing the underlying Feishu app/profile setup.

## Setup Workflow

For public users, the full order is:

1. Install this skill.
2. Run dependency bootstrap check/install.
3. Use `lark-channel-bridge` to create/configure a working Feishu/Lark bot profile and verify it receives and replies to normal messages.
4. Run this skill's setup script to bind a chat to a Codex desktop thread.

Run the bundled setup script:

```bash
node <skill-dir>/scripts/setup_lark_codex_desktop_bridge.js \
  --profile <profile> \
  --chat-id <chat_id> \
  --thread-id <thread_id> \
  --cwd <cwd>
```

The script:

- Installs/updates `~/.lark-channel/bin/codex-appserver-wrapper.js`.
- Updates `~/.lark-channel/config.json` so the profile's `codex.binaryPath` points to the wrapper.
- Writes `~/.lark-channel/profiles/<profile>/desktop-thread-map.json` so the wrapper can map `bridge_context.chatId` to the target Codex thread.
- Updates an existing `sessions.json.catalog.json` entry for the same chat/cwd when present, so bridge can immediately pass `threadId` on the next run.

Use `--restart` only from a normal shell outside an active bridge-spawned agent process. Do not restart bridge from inside the active Feishu-delivered run unless the user explicitly accepts that the current run may be interrupted. Without restart, the next bridge-spawned wrapper process still picks up wrapper and map changes.

## Verification

Check:

```bash
lark-channel-bridge status --profile <profile>
node --check ~/.lark-channel/bin/codex-appserver-wrapper.js
~/.lark-channel/bin/codex-appserver-wrapper.js --version
```

After the user sends a Feishu message, inspect bridge logs and confirm:

- `agent.spawn` has `hasThread: true`, or wrapper uses `desktop-thread-map.json` when no catalog entry exists.
- `session.resume` / `session.set-thread` shows the expected Codex `thread_id`.
- The Codex desktop thread contains the Feishu-delivered user message.

## Limits

This setup has three layers:

- Third-party bridge package: `lark-channel-bridge` receives Feishu/Lark messages and sends replies.
- Local wrapper: `~/.lark-channel/bin/codex-appserver-wrapper.js` is installed by this skill and translates bridge's `codex exec --json` call into Codex app-server requests.
- Codex app-server: the wrapper calls `thread/resume` and `turn/start` so the message lands in a Codex desktop/app thread.

Because the wrapper depends on both bridge's Codex adapter behavior and Codex app-server's protocol, it is not a built-in `lark-channel-bridge` mode. If either package changes those internal interfaces during an upgrade, rerun the setup script and re-verify the bridge.

One chat/cwd maps to one Codex thread. Avoid sending Feishu messages while the same desktop thread is already running a long turn, because outputs can interleave in that thread.
