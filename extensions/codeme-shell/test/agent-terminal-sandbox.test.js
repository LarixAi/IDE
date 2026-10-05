"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  createAgentTerminalSandbox,
  macProfile,
  parseAgentCommand,
} = require("../agent-terminal-sandbox");

async function main() {
  assert.deepStrictEqual(parseAgentCommand("node script.js"), {
    program: "node",
    args: ["script.js"],
  });
  assert.deepStrictEqual(parseAgentCommand("node --check script.js"), {
    program: "node",
    args: ["--check", "script.js"],
  });
  assert.deepStrictEqual(parseAgentCommand("npm test"), {
    program: "npm",
    args: ["test"],
  });
  assert.deepStrictEqual(parseAgentCommand("npm run build"), {
    program: "npm",
    args: ["run", "build"],
  });
  assert.deepStrictEqual(parseAgentCommand("node --test"), {
    program: "node",
    args: ["--test"],
  });
  assert.deepStrictEqual(parseAgentCommand("python3 script.py"), {
    program: "python3",
    args: ["script.py"],
  });
  assert.deepStrictEqual(parseAgentCommand("python3 -m pytest tests"), {
    program: "python3",
    args: ["-m", "pytest", "tests"],
  });
  assert.throws(
    () => parseAgentCommand("npm run dev"),
    (error) => error && error.code === "process_required",
  );
  assert.throws(
    () => parseAgentCommand("node ../outside.js"),
    (error) => error && error.code === "path_escape",
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-agent-terminal-test-"));
  fs.writeFileSync(path.join(root, "script.js"), "console.log('ok')\n", "utf8");

  try {
    let captured = null;
    const runner = createAgentTerminalSandbox({
      backend: {
        kind: "macos-seatbelt",
        label: "macOS Seatbelt",
        available: true,
        securityBoundary: true,
        network: "denied",
        executable: "/usr/bin/sandbox-exec",
      },
      findExecutable: (program) => program === "npm" ? "/usr/bin/npm" : "/usr/bin/node",
      execFile(executable, args, options, callback) {
        captured = { executable, args, options };
        callback(null, "sandbox-ok", "");
      },
    });

    const result = await runner.run(root, "node script.js");
    assert.strictEqual(result.available, true);
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.sandboxed, true);
    assert.strictEqual(result.workspace, "live");
    assert.strictEqual(result.workspaceWrites, "allowed");
    assert.strictEqual(result.outsideWorkspaceWrites, "blocked");
    assert.strictEqual(result.network, "denied");
    assert.strictEqual(result.manualTerminalAffected, false);
    assert.strictEqual(captured.executable, "/usr/bin/sandbox-exec");
    assert.strictEqual(captured.args[0], "-p");
    assert.ok(captured.args[1].includes("(deny network*)"));
    assert.ok(captured.args[1].includes(path.resolve(root)));
    assert.strictEqual(captured.args[2], "/usr/bin/node");
    assert.deepStrictEqual(captured.args.slice(3), ["script.js"]);
    assert.strictEqual(captured.options.cwd, path.resolve(root));
    assert.notStrictEqual(captured.options.env.HOME, process.env.HOME);

    const profile = macProfile(root, "/usr", path.join(root, ".tmp"));
    assert.ok(profile.includes("(deny default)"));
    assert.ok(profile.includes("(deny network*)"));
    assert.ok(profile.includes("file-write*"));

    const blocked = createAgentTerminalSandbox({
      backend: {
        kind: "unavailable",
        label: "No sandbox",
        available: false,
        securityBoundary: false,
        network: "blocked_by_policy",
        executable: "",
      },
    });
    const blockedResult = await blocked.run(root, "node script.js");
    assert.strictEqual(blockedResult.available, false);
    assert.strictEqual(blockedResult.code, "agent_terminal_sandbox_unavailable");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log("ok live-workspace AI terminal sandbox policy");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
