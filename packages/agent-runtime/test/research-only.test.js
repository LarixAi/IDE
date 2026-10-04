"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ModelProvider,
  RunStore,
  startPipelineRun,
  createRun,
  ToolRegistry,
  ControlledToolProvider,
  classifyTask,
  hasNoEditDirective,
  hasEditIntent,
  isResearchOnlyRequest,
  stripNegatedEditing,
} = require("../index.js");
const { dispatchCapability, loadCapabilityRegistry, normalizeCapabilityInput } = require("../capability");
const { createWorkspaceHost } = require("../../coding-qualify/host");

const PROMPT = "Research the current recommended approach for handling React error boundaries, then use the evidence to explain what should be changed in this project. Do not edit anything yet.";

class ScriptedModelProvider extends ModelProvider {
  constructor(steps) {
    super("scripted");
    this.steps = [...steps];
    this.calls = [];
  }
  async complete(input) {
    this.calls.push(input);
    return this.steps.shift() || { text: "Done.", toolCalls: [] };
  }
}

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-research-only-"));
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"demo","scripts":{"start":"node server.js"}}\n');
  fs.writeFileSync(path.join(root, "public/app.js"), "function render() { return null; }\n");
  return root;
}

function makeHub() {
  const hub = {
    invocations: [],
    async listCapabilities() {
      return [{
        name: "research.problem",
        category: "research",
        risk: "read",
        permissions: ["evidence"],
        description: "Gather evidence for an unknown technical problem",
      }];
    },
    async invoke(request) {
      hub.invocations.push(request);
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        runId: request.runId,
        capability: request.capability,
        status: "ok",
        data: {
          problem: request.input.problem,
          confidence: "medium",
          evidence: [{ title: "React docs", excerpt: "Use an error boundary around a subtree." }],
        },
        sources: [],
        warnings: [],
        error: null,
        duration: 1,
      };
    },
  };
  return hub;
}

function start({ goal, workspace, provider, capabilities, maxIterations = 8 }) {
  const runs = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-research-run-"));
  return startPipelineRun({
    goal,
    model: "scripted",
    providerName: "scripted",
    mode: "controlled",
    composerMode: "code",
    provider,
    registry: new ToolRegistry(new ControlledToolProvider(createWorkspaceHost(workspace))),
    store: new RunStore(path.join(runs, "runs")),
    maxIterations,
    capabilities,
    projectBrainEnabled: false,
    skillsEnabled: false,
  });
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
  await test("no-edit research intent overrides Code mode before the canonical loop starts", async () => {
    assert.strictEqual(hasNoEditDirective(PROMPT), true);
    assert.strictEqual(hasEditIntent(PROMPT), false);
    assert.strictEqual(isResearchOnlyRequest(PROMPT), true);
    assert.ok(!/\bedit\b/i.test(stripNegatedEditing(PROMPT)));
    assert.strictEqual(classifyTask(PROMPT, { mode: "controlled" }), "research");
    const run = createRun({
      goal: PROMPT,
      model: "scripted",
      providerName: "scripted",
      mode: "controlled",
      composerMode: "code",
    });
    assert.strictEqual(run.noEdit, true);
    assert.strictEqual(run.mode, "read_only");
    assert.strictEqual(run.taskClass, "research");
    assert.ok(!run.plan.some((step) => step.id === "edit"));
  });

  await test("scoped exclusion keeps a real edit request", async () => {
    const goal = "Fix the broken heading. Do not touch package.json.";
    assert.strictEqual(hasNoEditDirective(goal), false);
    assert.strictEqual(classifyTask(goal, { mode: "controlled" }), "bug-fix");
  });

  await test("research-only Code request preflights once, reads, and never writes", async () => {
    const workspace = makeWorkspace();
    const before = fs.readFileSync(path.join(workspace, "public/app.js"), "utf8");
    const hub = makeHub();
    const provider = new ScriptedModelProvider([
      { text: "Reading the implementation.", toolCalls: [{ name: "file.read", args: { path: "public/app.js" } }] },
      { text: "The evidence recommends an error boundary around the rendering subtree; no edit was made.", toolCalls: [] },
    ]);

    const run = await start({ goal: PROMPT, workspace, provider, capabilities: hub }).done;
    assert.strictEqual(run.lifecycle, "completed", JSON.stringify(run.error));
    assert.strictEqual(run.mode, "read_only");
    assert.strictEqual(hub.invocations.length, 1);
    assert.strictEqual(hub.invocations[0].capability, "research.problem");
    assert.ok(hub.invocations[0].input.problem);
    assert.ok(run.toolCalls.some((call) => call.name === "capability.invoke" && call.phase === "preflight"));
    assert.ok(run.toolCalls.some((call) => call.name === "file.read"));
    assert.strictEqual(
      run.toolCalls.filter((call) => ["file.write", "file.patch", "dir.create"].includes(call.name) && call.result && call.result.ok).length,
      0,
    );
    assert.deepStrictEqual(run.filesChanged, []);
    assert.strictEqual(fs.readFileSync(path.join(workspace, "public/app.js"), "utf8"), before);
    assert.ok(provider.calls[0].messages.some((message) => String(message.content).includes("EXTERNAL CAPABILITY PREFLIGHT")));
  });

  await test("a model cannot mutate a no-edit run even if it fabricates a write call", async () => {
    const workspace = makeWorkspace();
    const before = fs.readFileSync(path.join(workspace, "public/app.js"), "utf8");
    const provider = new ScriptedModelProvider([
      { text: "Trying to patch.", toolCalls: [{ name: "file.patch", args: { path: "public/app.js", oldText: "return null;", newText: "return 1;" } }] },
      { text: "No edit was made.", toolCalls: [] },
    ]);
    const run = await start({ goal: PROMPT, workspace, provider, capabilities: makeHub() }).done;
    const attempt = run.toolCalls.find((call) => call.name === "file.patch");
    assert.ok(attempt);
    assert.strictEqual(attempt.result.ok, false);
    assert.strictEqual(fs.readFileSync(path.join(workspace, "public/app.js"), "utf8"), before);
  });

  await test("research.problem safely maps one obvious alias to problem", async () => {
    const schema = { type: "object", properties: { problem: { type: "string" } }, required: ["problem"] };
    assert.deepStrictEqual(normalizeCapabilityInput(schema, { goal: "x" }).input, { problem: "x" });
    assert.strictEqual(normalizeCapabilityInput(schema, { goal: "x", topic: "y" }).remapped, null);
    const hub = makeHub();
    const registry = await loadCapabilityRegistry(hub);
    const result = await dispatchCapability(
      hub,
      { id: "run_test" },
      { name: "capability.invoke", args: { capability: "research.problem", input: { goal: "react error boundaries" } } },
      undefined,
      registry,
    );
    assert.strictEqual(result.ok, true, JSON.stringify(result.error));
    assert.strictEqual(hub.invocations[0].input.problem, "react error boundaries");
  });

  console.log("ok research-only behavior uses canonical OpenHands loop");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
