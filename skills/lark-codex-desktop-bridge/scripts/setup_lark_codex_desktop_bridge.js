#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const WRAPPER_SOURCE = `#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const REAL_CODEX =
  process.env.LARK_CHANNEL_REAL_CODEX ||
  "/Applications/Codex.app/Contents/Resources/codex";

function bridgeHome() {
  return process.env.LARK_CHANNEL_HOME || path.resolve(__dirname, "..");
}

function bridgeProfile() {
  return process.env.LARK_CHANNEL_PROFILE || "codex";
}

function printVersion() {
  const child = spawn(REAL_CODEX, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk) => {
    out += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    err += chunk.toString("utf8");
  });
  child.on("close", (code) => {
    process.stdout.write(out.trim() ? out : "codex-appserver-wrapper 0.2.0\\n");
    if (code !== 0 && err.trim()) process.stderr.write(err);
    process.exit(code ?? 0);
  });
}

function parseArgs(argv) {
  const parsed = {
    cwd: process.cwd(),
    sandbox: "danger-full-access",
    model: null,
    threadId: null,
    images: [],
  };
  let resume = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "exec") continue;
    if (arg === "resume") {
      resume = true;
      continue;
    }
    if (
      arg === "--json" ||
      arg === "--skip-git-repo-check" ||
      arg === "--ignore-rules" ||
      arg === "--ignore-user-config" ||
      arg === "--"
    ) continue;
    if (arg === "-") continue;
    if (arg === "-C" || arg === "--cwd" || arg === "--cd") {
      parsed.cwd = argv[++i] || parsed.cwd;
      continue;
    }
    if (arg === "--sandbox") {
      parsed.sandbox = argv[++i] || parsed.sandbox;
      continue;
    }
    if (arg === "--model" || arg === "-m") {
      parsed.model = argv[++i] || null;
      continue;
    }
    if (arg === "--image") {
      const image = argv[++i];
      if (image) parsed.images.push(image);
      continue;
    }
    if (arg === "-c" || arg === "--config") {
      i += 1;
      continue;
    }
    if (resume && !arg.startsWith("-") && !parsed.threadId) parsed.threadId = arg;
  }
  return parsed;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function jsonl(value) {
  process.stdout.write(\`\${JSON.stringify(value)}\\n\`);
}

function errorText(message) {
  return typeof message === "string" && message.trim() ? message : "codex app-server error";
}

function extractBridgeContext(prompt) {
  const match = prompt.match(/<bridge_context>\\s*([\\s\\S]*?)\\s*<\\/bridge_context>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function resolveMappedThread(prompt, cwd) {
  const ctx = extractBridgeContext(prompt);
  if (!ctx?.chatId) return null;
  const mapPath = path.join(bridgeHome(), "profiles", bridgeProfile(), "desktop-thread-map.json");
  try {
    const raw = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    const bindings = Array.isArray(raw.bindings) ? raw.bindings : [];
    const cwdBinding = bindings.find((item) => item.chatId === ctx.chatId && item.cwd === cwd);
    const chatBinding = bindings.find((item) => item.chatId === ctx.chatId && !item.cwd);
    return cwdBinding?.threadId || chatBinding?.threadId || null;
  } catch {
    return null;
  }
}

class AppServerClient {
  constructor() {
    this.child = spawn(REAL_CODEX, ["app-server", "--stdio"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.done = false;
    this.exitCode = null;
    this.agentMessageDeltaIds = new Set();

    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    this.child.on("exit", (code, signal) => {
      this.exitCode = code;
      if (!this.done && signal) {
        jsonl({ type: "turn.failed", error: { message: \`codex app-server exited with \${signal}\` } });
      }
    });
  }

  onStdout(chunk) {
    this.buffer += chunk.toString("utf8");
    let newline = this.buffer.indexOf("\\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.onMessage(line);
      newline = this.buffer.indexOf("\\n");
    }
  }

  onMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      pending.resolve(message);
      return;
    }
    if (message.method) this.translateNotification(message);
  }

  send(method, params, timeoutMs = 30000) {
    const id = this.nextId++;
    this.child.stdin.write(\`\${JSON.stringify({ id, method, params })}\\n\`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(\`timeout waiting for \${method}\`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
    });
  }

  async initialize() {
    const response = await this.send("initialize", {
      clientInfo: {
        name: "lark-channel-codex-appserver-wrapper",
        title: "Lark Channel Codex App Server Wrapper",
        version: "0.2.0",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });
    this.assertOk(response, "initialize");
  }

  async startOrResume(options) {
    const base = {
      cwd: options.cwd,
      approvalPolicy: "never",
      sandbox: options.sandbox,
      ...(options.model ? { model: options.model } : {}),
    };
    const response = options.threadId
      ? await this.send("thread/resume", { threadId: options.threadId, ...base, excludeTurns: true }, 30000)
      : await this.send("thread/start", { ...base, serviceName: "lark-channel-bridge" }, 30000);
    this.assertOk(response, options.threadId ? "thread/resume" : "thread/start");
    const thread = response.result.thread;
    jsonl({ type: "thread.started", thread_id: thread.id });
    return thread.id;
  }

  async startTurn(threadId, prompt, images) {
    const input = [{ type: "text", text: prompt, text_elements: [] }];
    for (const image of images) input.push({ type: "localImage", path: image });
    const response = await this.send("turn/start", { threadId, input }, 30000);
    this.assertOk(response, "turn/start");
  }

  assertOk(response, label) {
    if (response && !response.error) return;
    throw new Error(response?.error?.message || \`\${label} failed\`);
  }

  translateNotification(message) {
    const params = message.params || {};
    if (message.method === "item/started") {
      const item = params.item;
      if (item?.type === "commandExecution") {
        jsonl({
          type: "item.started",
          item: { type: "command_execution", id: item.id, command: item.command || "" },
        });
      }
      return;
    }
    if (message.method === "item/completed") {
      const item = params.item;
      if (item?.type === "commandExecution") {
        jsonl({
          type: "item.completed",
          item: {
            type: "command_execution",
            id: item.id,
            output: item.aggregatedOutput || "",
            exit_code: item.exitCode,
          },
        });
      } else if (item?.type === "agentMessage" && item.text && !this.agentMessageDeltaIds.has(item.id)) {
        jsonl({ type: "agent_message", message: item.text });
      }
      return;
    }
    if (message.method === "item/agentMessage/delta" && params.delta) {
      if (params.itemId) this.agentMessageDeltaIds.add(params.itemId);
      jsonl({ type: "agent_message", message: params.delta });
      return;
    }
    if (message.method === "turn/completed") {
      this.done = true;
      jsonl({ type: "turn.completed" });
      this.close();
      return;
    }
    if (message.method === "error") {
      this.done = true;
      jsonl({ type: "turn.failed", error: { message: errorText(params.error?.message || params.message) } });
      this.close();
    }
  }

  close() {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGTERM");
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write("codex app-server wrapper for lark-channel-bridge\\n");
    return;
  }
  if (argv.includes("--version") || argv.includes("-V") || argv.includes("-v")) {
    printVersion();
    return;
  }
  if (argv[0] !== "exec") {
    const child = spawn(REAL_CODEX, argv, { stdio: "inherit", env: process.env });
    child.on("exit", (code) => process.exit(code ?? 0));
    return;
  }

  const options = parseArgs(argv);
  const prompt = await readStdin();
  if (!options.threadId) options.threadId = resolveMappedThread(prompt, options.cwd);
  const client = new AppServerClient();

  const stop = () => client.close();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  try {
    await client.initialize();
    const threadId = await client.startOrResume(options);
    await client.startTurn(threadId, prompt, options.images);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("turn timed out")), 30 * 60 * 1000);
      const interval = setInterval(() => {
        if (client.done) {
          clearTimeout(timer);
          clearInterval(interval);
          resolve();
        } else if (client.exitCode !== null) {
          clearTimeout(timer);
          clearInterval(interval);
          reject(new Error(\`codex app-server exited with code \${client.exitCode}\`));
        }
      }, 250);
    });
  } catch (error) {
    client.done = true;
    jsonl({ type: "turn.failed", error: { message: errorText(error.message) } });
    client.close();
    process.exitCode = 1;
  }
}

main().catch((error) => {
  jsonl({ type: "turn.failed", error: { message: errorText(error.message) } });
  process.exitCode = 1;
});
`;

function parseArgs(argv) {
  const out = {
    bridgeHome: process.env.LARK_CHANNEL_HOME || path.join(process.env.HOME, ".lark-channel"),
    profile: process.env.LARK_CHANNEL_PROFILE || "codex",
    cwd: process.cwd(),
    codexBin: "/Applications/Codex.app/Contents/Resources/codex",
    restart: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--bridge-home") out.bridgeHome = argv[++i];
    else if (arg === "--profile") out.profile = argv[++i];
    else if (arg === "--thread-id") out.threadId = argv[++i];
    else if (arg === "--chat-id") out.chatId = argv[++i];
    else if (arg === "--cwd") out.cwd = argv[++i];
    else if (arg === "--codex-bin") out.codexBin = argv[++i];
    else if (arg === "--restart") out.restart = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  console.log(`Usage:
  node setup_lark_codex_desktop_bridge.js --thread-id <codex-thread-id> [--chat-id <lark-chat-id>] [options]

Options:
  --profile <name>       lark-channel profile, default: env LARK_CHANNEL_PROFILE or codex
  --bridge-home <path>   lark-channel home, default: env LARK_CHANNEL_HOME or ~/.lark-channel
  --cwd <path>           workspace cwd for chat binding, default: current directory
  --codex-bin <path>     real Codex executable, default: Codex.app bundled binary
  --restart              restart lark-channel-bridge after writing config
`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function realpathMaybe(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return value;
  }
}

function installWrapper(bridgeHome, codexBin) {
  const binDir = path.join(bridgeHome, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const wrapperPath = path.join(binDir, "codex-appserver-wrapper.js");
  const source = WRAPPER_SOURCE.replace(
    '"/Applications/Codex.app/Contents/Resources/codex"',
    JSON.stringify(codexBin)
  );
  fs.writeFileSync(wrapperPath, source, { mode: 0o700 });
  fs.chmodSync(wrapperPath, 0o700);
  return wrapperPath;
}

function updateConfig(bridgeHome, profile, wrapperPath) {
  const configPath = path.join(bridgeHome, "config.json");
  const config = readJson(configPath);
  const profileConfig = config.profiles?.[profile];
  if (!profileConfig) throw new Error(`profile not found: ${profile}`);
  if (profileConfig.agentKind !== "codex") {
    throw new Error(`profile ${profile} is ${profileConfig.agentKind}, expected codex`);
  }
  profileConfig.codex ||= {};
  profileConfig.codex.binaryPath = wrapperPath;
  profileConfig.codex.inheritCodexHome = profileConfig.codex.inheritCodexHome !== false;
  profileConfig.codex.ignoreUserConfig = profileConfig.codex.ignoreUserConfig === true;
  profileConfig.codex.ignoreRules = profileConfig.codex.ignoreRules !== false;
  writeJson(configPath, config);
}

function upsertMap(bridgeHome, profile, chatId, cwd, threadId) {
  if (!chatId) return null;
  const mapPath = path.join(bridgeHome, "profiles", profile, "desktop-thread-map.json");
  let map = { schemaVersion: 1, bindings: [] };
  if (fs.existsSync(mapPath)) map = readJson(mapPath);
  if (!Array.isArray(map.bindings)) map.bindings = [];
  const resolvedCwd = realpathMaybe(cwd);
  const now = new Date().toISOString();
  const existing = map.bindings.find((item) => item.chatId === chatId && item.cwd === resolvedCwd);
  if (existing) {
    existing.threadId = threadId;
    existing.updatedAt = now;
  } else {
    map.bindings.push({ chatId, cwd: resolvedCwd, threadId, updatedAt: now });
  }
  writeJson(mapPath, map);
  return mapPath;
}

function updateExistingCatalog(bridgeHome, profile, chatId, cwd, threadId) {
  if (!chatId) return false;
  const catalogPath = path.join(bridgeHome, "profiles", profile, "sessions.json.catalog.json");
  if (!fs.existsSync(catalogPath)) return false;
  const entries = readJson(catalogPath);
  if (!Array.isArray(entries)) return false;
  const resolvedCwd = realpathMaybe(cwd);
  let changed = false;
  for (const entry of entries) {
    if (entry.scopeId === chatId && entry.agentId === "codex" && entry.cwdRealpath === resolvedCwd) {
      entry.threadId = threadId;
      entry.updatedAt = Date.now();
      changed = true;
    }
  }
  if (changed) writeJson(catalogPath, entries);
  return changed;
}

function maybeRestart(profile) {
  const result = spawnSync("lark-channel-bridge", ["restart", "--profile", profile], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) throw new Error(`restart failed with exit code ${result.status}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!args.threadId) throw new Error("--thread-id is required");
  args.bridgeHome = realpathMaybe(args.bridgeHome);
  args.cwd = realpathMaybe(args.cwd);

  const wrapperPath = installWrapper(args.bridgeHome, args.codexBin);
  updateConfig(args.bridgeHome, args.profile, wrapperPath);
  const mapPath = upsertMap(args.bridgeHome, args.profile, args.chatId, args.cwd, args.threadId);
  const catalogUpdated = updateExistingCatalog(args.bridgeHome, args.profile, args.chatId, args.cwd, args.threadId);

  console.log(JSON.stringify({
    ok: true,
    profile: args.profile,
    wrapperPath,
    threadId: args.threadId,
    chatId: args.chatId || null,
    cwd: args.cwd,
    mapPath,
    catalogUpdated,
    restarted: args.restart,
  }, null, 2));

  if (args.restart) maybeRestart(args.profile);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
