"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ModelProvider,
  RunStore,
  startPipelineRun,
  ControlledToolProvider,
  ToolRegistry,
} = require("../../agent-runtime");
const { createWorkspaceHost } = require("../../coding-qualify/host");
const { REQUIREMENTS } = require("../acceptance");
const { executeControlled } = require("../../agent-tools");

class ScriptedModelProvider extends ModelProvider {
  constructor(steps) {
    super("scripted");
    this.steps = [...steps];
    this.calls = 0;
  }

  async complete() {
    this.calls += 1;
    return this.steps.shift() || { text: "Done.", toolCalls: [] };
  }
}

function simpleHost(root) {
  return {
    async inspectWorkspace() {
      return {
        state: "project",
        root,
        entries: fs.readdirSync(root).length,
        git: false,
        projectMarkers: [],
        languages: [],
        frameworks: [],
        packageManager: null,
        scripts: {},
      };
    },
    async listDirectory() {
      return {
        path: ".",
        entries: fs.readdirSync(root).map((name) => ({ path: name, type: "file" })),
      };
    },
    async readFile(filePath) {
      return { path: filePath, contents: fs.readFileSync(path.join(root, filePath), "utf8") };
    },
    async writeFile(filePath, contents) {
      fs.writeFileSync(path.join(root, filePath), contents);
      return { path: filePath, bytes: Buffer.byteLength(contents) };
    },
    async search() { return { query: "", matches: [] }; },
    async gitStatus() { return { branch: "main", changes: [] }; },
    async gitDiff() { return { diff: "" }; },
    async diagnostics() { return { items: [] }; },
  };
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
  await test("an unanswered edit requirement triggers canonical verify-repair before completion", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-feature-"));
    fs.writeFileSync(path.join(workspace, "README.md"), "fixture\n");
    const provider = new ScriptedModelProvider([
      { text: "Done.", toolCalls: [] },
      {
        text: "Applying the missing implementation.",
        toolCalls: [{ name: "file.write", args: { path: "registration.txt", contents: "registration enabled\n" } }],
      },
      { text: "Registration has been added.", toolCalls: [] },
    ]);

    const run = await startPipelineRun({
      goal: "Add registration",
      model: "scripted",
      providerName: "scripted",
      mode: "controlled",
      composerMode: "code",
      requirements: REQUIREMENTS,
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(simpleHost(workspace))),
      store: new RunStore(path.join(workspace, ".runs")),
      maxIterations: 5,
      maxRepairRounds: 2,
      projectBrainEnabled: false,
      skillsEnabled: false,
    }).done;

    assert.strictEqual(run.lifecycle, "completed", JSON.stringify({ error: run.error, verification: run.verification }, null, 2));
    assert.ok(run.verificationHistory.some((item) => item.status === "failed"), "first prose-only answer must fail verification");
    assert.strictEqual(run.verification.status, "passed");
    assert.ok(run.toolCalls.some((call) => call.name === "file.write" && call.result && call.result.ok));
    assert.strictEqual(fs.readFileSync(path.join(workspace, "registration.txt"), "utf8"), "registration enabled\n");
    assert.ok(run.requirements.every((item) => item.status === "verified"));
    assert.strictEqual(provider.calls, 3);
  });

  await test("the fixture suite fails before the feature exists and path escape is still blocked", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-feature-app-"));
    const workspace = path.join(parent, "fixture");
    fs.cpSync(path.join(__dirname, "../fixture"), workspace, { recursive: true });
    const result = await executeControlled(createWorkspaceHost(workspace), "tests.run", { command: "npm test" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "exit_status");
    const host = { async writeFile() { throw new Error("wrote"); } };
    const escaped = await executeControlled(host, "file.write", { path: "../outside.txt", contents: "x" });
    assert.strictEqual(escaped.error.code, "path_escape");
  });

  console.log("ok requirements qualification uses canonical OpenHands loop");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
