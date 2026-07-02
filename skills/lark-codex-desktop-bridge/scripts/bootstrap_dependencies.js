#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");

const REQUIRED_NPM_PACKAGES = ["lark-channel-bridge", "@larksuite/cli"];
const REQUIRED_COMMANDS = [
  { name: "lark-channel-bridge", args: ["--version"] },
  { name: "lark-cli", args: ["--version"] },
];
const DEFAULT_CODEX_BIN = "/Applications/Codex.app/Contents/Resources/codex";

function parseArgs(argv) {
  const out = {
    install: false,
    codexBin: process.env.LARK_CHANNEL_REAL_CODEX || DEFAULT_CODEX_BIN,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--install") out.install = true;
    else if (arg === "--codex-bin") out.codexBin = argv[++i];
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  console.log(`Usage:
  node bootstrap_dependencies.js [--install] [--codex-bin <path>]

Default behavior is check-only. Pass --install to run:
  npm install -g ${REQUIRED_NPM_PACKAGES.join(" ")}
`);
}

function commandResult(command, args = []) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    command,
    args,
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    error: result.error ? result.error.message : null,
  };
}

function checkCodex(codexBin) {
  const candidates = [codexBin, "codex"].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes("/") && !fs.existsSync(candidate)) continue;
    const result = commandResult(candidate, ["--version"]);
    if (result.ok) return { ok: true, command: candidate, version: result.stdout };
  }
  return {
    ok: false,
    command: codexBin,
    message: "Codex binary not found. Install Codex Desktop/CLI or pass --codex-bin.",
  };
}

function checkCommands() {
  return REQUIRED_COMMANDS.map((item) => {
    const result = commandResult(item.name, item.args);
    return {
      name: item.name,
      ok: result.ok,
      version: result.stdout || null,
      error: result.error || result.stderr || null,
    };
  });
}

function installNpmPackages() {
  const result = spawnSync("npm", ["install", "-g", ...REQUIRED_NPM_PACKAGES], {
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw new Error(result.error.message);
  if (result.status !== 0) throw new Error(`npm install failed with exit code ${result.status}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  let commands = checkCommands();
  let codex = checkCodex(args.codexBin);
  const missing = commands.filter((item) => !item.ok);

  if ((missing.length > 0 || !codex.ok) && args.install) {
    installNpmPackages();
    commands = checkCommands();
    codex = checkCodex(args.codexBin);
  }

  const ok = commands.every((item) => item.ok) && codex.ok;
  const report = {
    ok,
    installed: args.install,
    npmPackages: REQUIRED_NPM_PACKAGES,
    commands,
    codex,
    nextStep: ok
      ? "Run setup_lark_codex_desktop_bridge.js after lark-channel-bridge profile creation."
      : `Install missing dependencies manually or rerun with --install. npm package command: npm install -g ${REQUIRED_NPM_PACKAGES.join(" ")}`,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
