"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ModelProvider,
  RunStore,
  startPipelineRun,
  resumePipelineRun,
  ToolRegistry,
  ControlledToolProvider,
  lockModel,
  classifyTask,
  selectStrategy,
} = require("../index.js");

class ScriptedModelProvider extends ModelProvider {
  constructor(steps) {
    super("scripted");
    this.steps = [...steps];
    this.calls = [];
  }

  async complete(input) {
    this.calls.push(input);
    const step = this.steps.shift();
    if (!step) return { text: "Done.", toolCalls: [] };
    if (step.waitForAbort) {
      await new Promise((resolve, reject) => {
        const fail = () => reject(Object.assign(new Error("model call cancelled"), { code: "cancelled" }));
        if (input.signal && input.signal.aborted) return fail();
        input.signal.addEventListener("abort", fail, { once: true });
      });
    }
    return { text: step.text || "", toolCalls: step.toolCalls || [] };
  }
}

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-hardening-"));
  fs.writeFileSync(path.join(root, "README.md"), "# Demo\n");
  return root;
}

function hostFor(root) {
  return {
    async inspectWorkspace() {
      return {
        state: "project",
        root,
        entries: 1,
        git: false,
        projectMarkers: [],
        languages: ["markdown"],
        frameworks: [],
        packageManager: null,
        scripts: {},
      };
    },
    async listDirectory() {
      return { path: ".", entries: [{ path: "README.md", type: "file" }] };
    },
    async readFile(filePath) {
      return { path: filePath, contents: fs.readFileSync(path.join(root, filePath), "utf8") };
    },
    async writeFile(filePath, contents) {
      fs.writeFileSync(path.join(root, filePath), contents);
      return { path: filePath, bytes: Buffer.byteLength(contents) };
    },
    async createDirectory(dirPath) {
      fs.mkdirSync(path.join(root, dirPath), { recursive: true });
      return { path: dirPath };
    },
    async search(query) { return { query, matches: [] }; },
    async runTerminal(command) { return { command, exitCode: 0, stdout: "", stderr: "" }; },
    async runTests(command) { return { command, exitCode: 0, stdout: "ok", stderr: "" }; },
    async diagnostics() { return { items: [] }; },
    async gitStatus() { return { branch: "main", changes: [] }; },
    async gitDiff() { return { diff: "" }; },
  };
}

function start(options = {}) {
  const workspace = options.workspace || makeWorkspace();
  const store = new RunStore(path.join(workspace, ".runs"));
  const handle = startPipelineRun({
    goal: options.goal || "Inspect the repository.",
    model: options.model || "scripted",
    fallbackModel: options.fallbackModel,
    modelProfiles: options.modelProfiles,
    providerName: "scripted",
    mode: options.mode || "read_only",
    composerMode: options.composerMode || (options.mode === "controlled" ? "code" : "ask"),
    provider: options.provider,
    registry: options.registry || new ToolRegistry(new ControlledToolProvider(hostFor(workspace))),
    store,
    maxIterations: options.maxIterations ?? 8,
    maxRepairRounds: options.maxRepairRounds ?? 2,
    projectBrainEnabled: false,
    skillsEnabled: false,
  });
  handle.store = store;
  handle.workspace = workspace;
  return handle;
}

async function test(name, fn) {
  try {
    await fn();
    console.log("ok", name);
  } catch (error) {
    console.error("fail", name);
    console.error(error);
    process.exitCode = 1;
  }
}

async function main() {
  await test("the effective model is locked and a fallback is explicit", async () => {
    const selected = lockModel({
      model: "chat-only",
      fallbackModel: "tool-model",
      modelProfiles: {
        "chat-only": { supportsTools: false },
        "tool-model": { supportsTools: true },
      },
    });
    assert.strictEqual(selected.ok, true);
    assert.strictEqual(selected.requestedModel, "chat-only");
    assert.strictEqual(selected.effectiveModel, "tool-model");
    assert.strictEqual(selected.persistentSelection, "chat-only");

    const failed = lockModel({
      model: "chat-only",
      modelProfiles: { "chat-only": { supportsTools: false } },
    });
    assert.strictEqual(failed.ok, false);
  });

  await test("strategy selection stays deterministic around the canonical loop", async () => {
    assert.strictEqual(classifyTask("Fix the broken heading", { mode: "controlled" }), "bug-fix");
    const first = selectStrategy("Fix the broken heading", { mode: "controlled" });
    const second = selectStrategy("Fix the broken heading", { mode: "controlled" });
    assert.deepStrictEqual(first, second);
  });

  await test("prose cannot finish an edit until canonical verification sees a mutation", async () => {
    const provider = new ScriptedModelProvider([
      { text: "Done.", toolCalls: [] },
      {
        text: "Applying the requested edit.",
        toolCalls: [{ name: "file.write", args: { path: "README.md", contents: "# Updated\n" } }],
      },
      { text: "The README is updated.", toolCalls: [] },
    ]);
    const handle = start({
      provider,
      mode: "controlled",
      goal: "Update the README heading.",
    });
    const run = await handle.done;

    assert.strictEqual(run.lifecycle, "completed", JSON.stringify({ error: run.error, verification: run.verification }));
    assert.ok(run.verificationHistory.some((item) => item.status === "failed"));
    assert.strictEqual(run.verification.status, "passed");
    assert.ok(run.toolCalls.some((call) => call.name === "file.write" && call.result && call.result.ok));
    assert.strictEqual(fs.readFileSync(path.join(handle.workspace, "README.md"), "utf8"), "# Updated\n");
  });

  await test("read-only mode never exposes mutation tools", async () => {
    const provider = new ScriptedModelProvider([{ text: "The workspace was inspected.", toolCalls: [] }]);
    const run = await start({ provider, mode: "read_only", goal: "Inspect the repository." }).done;
    assert.strictEqual(run.lifecycle, "completed");
    const offered = new Set(provider.calls[0].tools.map((tool) => tool.name));
    assert.ok(!offered.has("file.write"));
    assert.ok(!offered.has("file.patch"));
    assert.ok(!offered.has("terminal.run"));
    assert.ok(!offered.has("tests.run"));
  });

  await test("cancellation terminates the canonical loop and cannot replay as another executor", async () => {
    const provider = new ScriptedModelProvider([{ waitForAbort: true }]);
    const handle = start({ provider, goal: "Inspect the repository." });
    handle.cancel();
    const run = await handle.done;
    assert.strictEqual(run.lifecycle, "cancelled");

    let rejected = null;
    try {
      resumePipelineRun(run.id, {
        provider,
        registry: new ToolRegistry(new ControlledToolProvider(hostFor(handle.workspace))),
        store: handle.store,
      });
    } catch (error) {
      rejected = error;
    }
    assert.ok(rejected, "cancelled run must not be resumed through a hidden fallback");
    assert.ok(["no_checkpoint", "not_resumable"].includes(rejected.code));
  });

  console.log("ok canonical OpenHands loop hardening");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
