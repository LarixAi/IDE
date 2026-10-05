"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const MAX_OUTPUT = 50000;

function sandboxError(code, message) {
  return Object.assign(new Error(message), { code });
}

function findExecutable(name, searchPath = process.env.PATH) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  if (path.isAbsolute(raw)) {
    try {
      fs.accessSync(raw, fs.constants.X_OK);
      return raw;
    } catch {
      return "";
    }
  }
  const suffixes = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const directory of String(searchPath || "").split(path.delimiter).filter(Boolean)) {
    for (const suffix of suffixes) {
      const candidate = path.join(directory, raw + suffix);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return "";
}

function executableInfo(program, finder = findExecutable) {
  const found = finder(program);
  if (!found) return { executable: program, readRoot: "" };
  let resolved = found;
  try { resolved = fs.realpathSync(found); } catch {}
  const normalized = resolved.replace(/\\/g, "/");
  if (normalized.startsWith("/opt/homebrew/")) {
    return { executable: resolved, readRoot: "/opt/homebrew" };
  }
  if (
    normalized.startsWith("/usr/")
    || normalized.startsWith("/bin/")
    || normalized.startsWith("/sbin/")
  ) {
    return { executable: resolved, readRoot: "" };
  }
  return { executable: resolved, readRoot: path.dirname(path.dirname(resolved)) };
}

function parseAgentCommand(command) {
  const text = String(command || "").trim();
  if (!text) throw sandboxError("invalid_args", "Agent terminal requires a command.");
  if (/[\0\n\r;&|\`$<>\\\\"']/.test(text) || text.includes("(") || text.includes(")")) {
    throw sandboxError("command_rejected", "Agent terminal command contains shell syntax.");
  }
  if (text.includes("..")) {
    throw sandboxError("path_escape", "Agent terminal command escapes the workspace.");
  }

  const parts = text.split(/\s+/);
  const program = parts.shift();
  const args = parts;

  const safeRelative = (value) => {
    const candidate = String(value || "");
    return Boolean(
      candidate
      && !candidate.startsWith("-")
      && !path.isAbsolute(candidate)
      && !/^[A-Za-z]:[\\/]/.test(candidate)
      && !candidate.includes("..")
    );
  };

  if (program === "npm") {
    if (args.length === 1 && args[0] === "test") return { program, args };
    if (args.length === 2 && args[0] === "run" && /^[A-Za-z0-9:_-]+$/.test(args[1])) {
      if (["start", "dev", "preview"].includes(args[1].toLowerCase())) {
        throw sandboxError(
          "process_required",
          "Use process.start for long-running npm start/dev/preview scripts.",
        );
      }
      return { program, args };
    }
  }

  if (program === "node") {
    if (args.length === 1 && safeRelative(args[0])) return { program, args };
    if (args.length === 2 && args[0] === "--check" && safeRelative(args[1])) return { program, args };
    if (args.length <= 2 && args[0] === "--test" && (!args[1] || safeRelative(args[1]))) {
      return { program, args };
    }
  }

  if (program === "python3") {
    if (args.length === 1 && safeRelative(args[0]) && /\.py$/i.test(args[0])) return { program, args };
    if (
      args.length >= 2
      && args.length <= 3
      && args[0] === "-m"
      && args[1] === "pytest"
      && (!args[2] || safeRelative(args[2]))
    ) {
      return { program, args };
    }
  }

  throw sandboxError(
    "command_rejected",
    "Agent terminal supports short-lived node, npm, and python3 developer commands only.",
  );
}

function quoteProfile(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function macProfile(workspaceRoot, runtimeRoot, temporaryRoot) {
  const readable = [
    workspaceRoot,
    temporaryRoot,
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/etc",
    "/private/etc",
    "/Library/Frameworks",
    "/Library/Apple",
    "/opt/homebrew",
    "/private/var/db/dyld",
    "/dev",
  ];
  if (runtimeRoot) readable.push(runtimeRoot);
  const readRules = [...new Set(readable)]
    .filter((item) => item && fs.existsSync(item))
    .map((item) => `(subpath "${quoteProfile(item)}")`)
    .join(" ");

  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow signal)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    `(allow file-read* ${readRules})`,
    `(allow file-write* (subpath "${quoteProfile(workspaceRoot)}") (subpath "${quoteProfile(temporaryRoot)}"))`,
    "(deny network*)",
  ].join("");
}

function sandboxEnvironment(temporaryRoot) {
  const home = path.join(temporaryRoot, "home");
  const cache = path.join(temporaryRoot, "npm-cache");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cache, { recursive: true });
  return {
    PATH: String(process.env.PATH || ""),
    LANG: String(process.env.LANG || "C"),
    LC_ALL: String(process.env.LC_ALL || ""),
    HOME: home,
    TMPDIR: temporaryRoot,
    TMP: temporaryRoot,
    TEMP: temporaryRoot,
    CI: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    npm_config_cache: cache,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
    npm_config_offline: "true",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    ALL_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "",
  };
}

function defaultBackend(options = {}) {
  const platform = options.platform || process.platform;
  const exists = options.exists || fs.existsSync;
  const finder = options.findExecutable || findExecutable;
  if (platform === "darwin" && exists("/usr/bin/sandbox-exec")) {
    return {
      kind: "macos-seatbelt",
      label: "macOS Seatbelt",
      available: true,
      securityBoundary: true,
      network: "denied",
      executable: "/usr/bin/sandbox-exec",
    };
  }
  if (platform === "linux") {
    const bwrap = finder("bwrap");
    if (bwrap) {
      return {
        kind: "linux-bubblewrap",
        label: "Linux bubblewrap",
        available: true,
        securityBoundary: true,
        network: "denied",
        executable: bwrap,
      };
    }
  }
  return {
    kind: "unavailable",
    label: platform === "win32" ? "Windows sandbox unavailable" : "OS sandbox unavailable",
    available: false,
    securityBoundary: false,
    network: "blocked_by_policy",
    executable: "",
  };
}

function commandSpec(backend, workspaceRoot, temporaryRoot, parsed, finder = findExecutable) {
  const program = executableInfo(parsed.program, finder);
  if (!program.executable) {
    throw sandboxError("command_not_found", "Could not find executable: " + parsed.program);
  }

  if (backend.kind === "macos-seatbelt") {
    return {
      executable: backend.executable,
      args: [
        "-p",
        macProfile(workspaceRoot, program.readRoot, temporaryRoot),
        program.executable,
        ...parsed.args,
      ],
    };
  }

  if (backend.kind === "linux-bubblewrap") {
    return {
      executable: backend.executable,
      args: [
        "--die-with-parent",
        "--unshare-net",
        "--ro-bind", "/", "/",
        "--bind", workspaceRoot, workspaceRoot,
        "--bind", temporaryRoot, temporaryRoot,
        "--chdir", workspaceRoot,
        "--proc", "/proc",
        "--dev", "/dev",
        "--",
        program.executable,
        ...parsed.args,
      ],
    };
  }

  throw sandboxError(
    "agent_terminal_sandbox_unavailable",
    "CodeMe will not run AI terminal commands without an OS sandbox on this platform.",
  );
}

function redact(value) {
  return String(value || "")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s]+)/g, "$1=[REDACTED]");
}

function execFileResult(execFile, executable, args, options) {
  return new Promise((resolve) => {
    execFile(executable, args, options, (error, stdout, stderr) => {
      const timedOut = Boolean(error && (error.killed || error.signal === "SIGTERM"));
      const exitCode = error && typeof error.code === "number"
        ? error.code
        : error
          ? (timedOut ? 124 : 1)
          : 0;
      resolve({
        exitCode,
        timedOut,
        stdout: redact(stdout).slice(-MAX_OUTPUT),
        stderr: redact(stderr).slice(-MAX_OUTPUT),
      });
    });
  });
}

function createAgentTerminalSandbox(options = {}) {
  const execFile = options.execFile || cp.execFile;
  const finder = options.findExecutable || findExecutable;
  const backend = options.backend || defaultBackend({
    platform: options.platform,
    exists: options.exists,
    findExecutable: finder,
  });

  async function run(workspaceRoot, command, runOptions = {}) {
    const root = path.resolve(String(workspaceRoot || ""));
    if (!root || !fs.existsSync(root)) {
      return {
        available: false,
        code: "no_workspace",
        message: "Agent terminal requires an open workspace.",
      };
    }
    if (!backend.available || !backend.securityBoundary) {
      return {
        available: false,
        code: "agent_terminal_sandbox_unavailable",
        message: "CodeMe blocked the AI terminal command because no OS sandbox is available.",
        sandboxed: false,
        backend: backend.kind,
        workspace: "live",
      };
    }

    let parsed;
    try {
      parsed = parseAgentCommand(command);
    } catch (error) {
      return {
        available: false,
        code: error && error.code ? String(error.code) : "command_rejected",
        message: error instanceof Error ? error.message : String(error),
        sandboxed: true,
        backend: backend.kind,
        workspace: "live",
      };
    }

    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(1000, Number(runOptions.timeoutMs || DEFAULT_TIMEOUT_MS)),
    );
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-agent-terminal-"));

    try {
      const spec = commandSpec(backend, root, temporaryRoot, parsed, finder);
      const result = await execFileResult(execFile, spec.executable, spec.args, {
        cwd: root,
        env: sandboxEnvironment(temporaryRoot),
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
      });
      const output = [result.stdout, result.stderr]
        .filter(Boolean)
        .join(result.stdout && result.stderr ? "\n" : "");
      return {
        available: true,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        output,
        timedOut: result.timedOut,
        sandboxed: true,
        securityBoundary: true,
        backend: backend.kind,
        backendLabel: backend.label,
        workspace: "live",
        workspaceWrites: "allowed",
        outsideWorkspaceWrites: "blocked",
        network: backend.network,
        manualTerminalAffected: false,
      };
    } finally {
      try { fs.rmSync(temporaryRoot, { recursive: true, force: true }); } catch {}
    }
  }

  function status() {
    return {
      available: Boolean(backend.available && backend.securityBoundary),
      sandboxed: Boolean(backend.available && backend.securityBoundary),
      kind: backend.kind,
      label: backend.label,
      securityBoundary: Boolean(backend.securityBoundary),
      network: backend.network,
      workspace: "live",
      workspaceWrites: "allowed",
      outsideWorkspaceWrites: "blocked",
      manualTerminalAffected: false,
      policy: "fail_closed",
    };
  }

  return { run, status };
}

function agentTerminalSandboxStatus() {
  return createAgentTerminalSandbox().status();
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  agentTerminalSandboxStatus,
  commandSpec,
  createAgentTerminalSandbox,
  defaultBackend,
  executableInfo,
  findExecutable,
  macProfile,
  parseAgentCommand,
  sandboxEnvironment,
};
