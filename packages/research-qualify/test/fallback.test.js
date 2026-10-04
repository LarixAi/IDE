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
const { createResearchWorkspaceHost } = require("../host");

const FIXTURE = path.join(__dirname, "../fixture");

class ScriptedProvider extends ModelProvider {
  constructor(steps) {
    super("scripted");
    this.steps = [...steps];
  }
  async complete() {
    return this.steps.shift() || { text: "External evidence is unavailable, so no change was made.", toolCalls: [] };
  }
}

function prepareWorkspace() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-research-fallback-"));
  const workspace = path.join(parent, "fixture");
  fs.cpSync(FIXTURE, workspace, { recursive: true });
  return workspace;
}

async function runWithHub(hub) {
  const workspace = prepareWorkspace();
  const before = fs.readFileSync(path.join(workspace, "src/check.js"), "utf8");
  const provider = new ScriptedProvider([
    {
      text: "I will not guess. Attempting an edit should be blocked in this no-edit research run.",
      toolCalls: [{
        name: "file.write",
        args: { path: "src/check.js", contents: "module.exports = { validNumber() { return true; } };\n" },
      }],
    },
    { text: "The required external evidence is unavailable, so no edit was made.", toolCalls: [] },
  ]);
  const run = await startPipelineRun({
    goal: "Research the missing identification-number rule because it is not documented in the repository. Do not edit anything yet.",
    model: "scripted",
    providerName: provider.name,
    mode: "controlled",
    composerMode: "code",
    provider,
    registry: new ToolRegistry(new ControlledToolProvider(createResearchWorkspaceHost(workspace))),
    store: new RunStore(path.join(path.dirname(workspace), "runs")),
    capabilities: hub,
    maxIterations: 4,
    projectBrainEnabled: false,
    skillsEnabled: false,
  }).done;
  return { run, workspace, before };
}

async function main() {
  const unavailable = {
    requests: [],
    async listCapabilities() {
      return [{ name: "research.problem", description: "Gather short evidence for a problem. Returns sources and excerpts." }];
    },
    async invoke(request) {
      this.requests.push(request);
      throw new Error("hub offline");
    },
  };

  const first = await runWithHub(unavailable);
  assert.strictEqual(first.run.mode, "read_only");
  assert.strictEqual(unavailable.requests.length, 1);
  const preflight = first.run.toolCalls.find((call) => call.name === "capability.invoke" && call.phase === "preflight");
  assert.ok(preflight, "research preflight should be recorded");
  assert.strictEqual(preflight.result.ok, false);
  assert.strictEqual(preflight.result.trusted, false);
  assert.ok(!first.run.toolCalls.some((call) => call.name === "file.write" && call.result && call.result.ok));
  assert.strictEqual(fs.readFileSync(path.join(first.workspace, "src/check.js"), "utf8"), first.before);
  assert.ok(first.run.messages.some((message) => /hub offline|unavailable/i.test(String(message.content || ""))));
  console.log("ok unavailable research evidence stays read-only on canonical loop");

  const empty = {
    async listCapabilities() { return []; },
    async invoke() { throw new Error("must not invoke"); },
  };
  const second = await runWithHub(empty);
  assert.ok(!second.run.toolCalls.some((call) => call.name === "capability.invoke"));
  assert.ok(!second.run.toolCalls.some((call) => call.name === "file.write" && call.result && call.result.ok));
  assert.strictEqual(fs.readFileSync(path.join(second.workspace, "src/check.js"), "utf8"), second.before);
  console.log("ok empty capability discovery cannot create a fallback loop or workspace edit");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
