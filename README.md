# Lark Codex Desktop Bridge

[中文说明](README.zh-CN.md)

Connect a Feishu/Lark bot chat, powered by `lark-channel-bridge`, to a Codex Desktop/App thread.

This repository contains a Codex skill plus helper scripts. It does not replace `lark-channel-bridge`; it adds a local wrapper that changes the final Codex execution hop from `codex exec` to Codex `app-server` so messages can continue a desktop/app thread.

## Architecture

```text
Feishu/Lark message
  -> lark-channel-bridge
  -> codex-appserver-wrapper.js
  -> Codex app-server
  -> Codex Desktop/App thread
```

## Dependency Model

This project depends on `lark-channel-bridge` as an external runtime dependency.

`lark-channel-bridge` is the npm package backed by:

```text
github.com/zarazhangrui/feishu-claude-code-bridge
```

This repository does not vendor that package. The skill's bootstrap script can check for it and install it only when explicitly requested.

## Prerequisites

- Node.js and npm
- Codex Desktop or Codex CLI
- `lark-channel-bridge`
- `lark-cli` from `@larksuite/cli`
- A working Feishu/Lark bot app profile in `lark-channel-bridge`

The Feishu/Lark bot profile must already receive and reply to normal messages before this bridge is applied.

## Install The Skill

Copy the skill folder into your Codex skills directory:

```bash
mkdir -p ~/.codex/skills
cp -R skills/lark-codex-desktop-bridge ~/.codex/skills/
```

Then restart Codex so the skill is discoverable.

## Bootstrap Dependencies

Check dependencies:

```bash
node ~/.codex/skills/lark-codex-desktop-bridge/scripts/bootstrap_dependencies.js
```

Install missing npm dependencies only when you explicitly want the script to do so:

```bash
node ~/.codex/skills/lark-codex-desktop-bridge/scripts/bootstrap_dependencies.js --install
```

This runs:

```bash
npm install -g lark-channel-bridge @larksuite/cli
```

## Setup

First create and verify a normal `lark-channel-bridge` profile. The profile must be able to receive and reply to Feishu/Lark messages.

Then bind a Feishu/Lark chat to a Codex Desktop/App thread:

```bash
node ~/.codex/skills/lark-codex-desktop-bridge/scripts/setup_lark_codex_desktop_bridge.js \
  --profile codex \
  --chat-id <lark-chat-id> \
  --thread-id <codex-thread-id> \
  --cwd <workspace-directory>
```

The setup script:

- installs `~/.lark-channel/bin/codex-appserver-wrapper.js`
- updates `~/.lark-channel/config.json`
- writes `~/.lark-channel/profiles/<profile>/desktop-thread-map.json`
- updates an existing bridge session catalog entry when possible

Use `--restart` only from a normal shell, not from inside a currently running bridge-spawned agent process.

## Required Inputs

- `chat-id`: Feishu/Lark chat id. In bridge-delivered messages this is `bridge_context.chatId`.
- `thread-id`: Codex Desktop/App thread id.
- `profile`: lark-channel profile name, commonly `codex`.
- `cwd`: workspace directory used by the bridge session.

You do not need to provide app secrets to this setup script. App credentials stay in `lark-channel-bridge` / `lark-cli`.

## Verification

```bash
lark-channel-bridge status --profile codex
node --check ~/.lark-channel/bin/codex-appserver-wrapper.js
~/.lark-channel/bin/codex-appserver-wrapper.js --version
```

After sending a Feishu/Lark message, check bridge logs and confirm the run resumes the expected Codex thread id.

## Limitations

- This is a local adapter layer, not a built-in `lark-channel-bridge` mode.
- The wrapper depends on the current `lark-channel-bridge` Codex adapter command shape and Codex `app-server` protocol.
- Upgrading `lark-channel-bridge` or Codex may require rerunning setup and re-verifying the bridge.
- One chat/cwd binding maps to one Codex thread.

## License

MIT
