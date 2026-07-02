# Lark Codex Desktop Bridge

[中文说明](README.zh-CN.md)

<p align="center">
  <img src="assets/banner.png" alt="Lark Codex Desktop Bridge banner">
</p>

<p align="center">
  <a href="https://github.com/zarazhangrui/feishu-claude-code-bridge"><img alt="Built on lark-channel-bridge" src="https://img.shields.io/badge/built%20on-lark--channel--bridge-0ea5e9"></a>
  <img alt="Codex Desktop" src="https://img.shields.io/badge/Codex-Desktop%20%2F%20App-22c55e">
  <img alt="Feishu Lark" src="https://img.shields.io/badge/Feishu%20%2F%20Lark-bot%20bridge-6366f1">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-111827">
</p>

## The Moment This Solves

You are deep in a Codex Desktop thread: the codebase is loaded, the reasoning is warm, and the next step is almost clear. Then you have to leave the computer for a meeting, a commute, or a quick run where your phone is the only thing in reach.

The painful part is not asking an AI another question. The painful part is losing the live desktop thread. You do not want to start over, restate the repo context, or paste a summary into a fresh chat. You want to send one message from Feishu/Lark and have the same Codex Desktop thread continue.

### Storyboard

| 1. Mid-flow on desktop | 2. Away from the keyboard | 3. Continue in Feishu/Lark | 4. Same Codex thread resumes |
| --- | --- | --- | --- |
| Codex Desktop already has the full context | You step into a meeting or switch to mobile | Send the bot one more instruction | The response lands back in the live desktop/app thread |

This skill is built for that moment: connect Codex Desktop/App threads to Feishu/Lark, using [`lark-channel-bridge`](https://github.com/zarazhangrui/feishu-claude-code-bridge) as the message bridge.

This repository contains a Codex skill plus helper scripts. It does not replace `lark-channel-bridge`; it adds a local wrapper that changes the final Codex execution hop from `codex exec` to Codex `app-server` so Feishu/Lark messages can continue a live Codex desktop/app thread.

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

`lark-channel-bridge` is the npm package backed by the original project:

<https://github.com/zarazhangrui/feishu-claude-code-bridge>

This repository does not vendor that package. The skill's bootstrap script can check for it and install it only when explicitly requested.

## Repository Layout

```text
skills/lark-codex-desktop-bridge/
  SKILL.md                         Codex skill instructions
  agents/openai.yaml               Codex skill UI metadata
  scripts/bootstrap_dependencies.js dependency checker/installer
  scripts/setup_lark_codex_desktop_bridge.js desktop-thread setup script
```

`agents/openai.yaml` is not a Feishu/Lark or bridge runtime config. It is metadata used by Codex to show the skill name, short description, and default prompt in the UI.

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

## Acknowledgements

This project builds on [`lark-channel-bridge`](https://github.com/zarazhangrui/feishu-claude-code-bridge). That package owns the Feishu/Lark messaging bridge; this project only adds the Codex Desktop/App thread adapter.
