"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ModelProvider,
  RunStore,
  startPipelineRun,
  ToolRegistry,
  ReadOnlyToolProvider,
  selectCapability,
  isSiteLayoutGoal,
} = require("../index.js");
const { normalizeCapabilityInput } = require("../capability");
const { chooseCapabilityPreflight } = require("../capability-preflight");

const LIVE = [
  { name: "hub.health", category: "hub", risk: "read", permissions: ["evidence"], description: "Echo a short token and report hub health" },
  { name: "research.problem", category: "research", risk: "read", permissions: ["evidence"], description: "Gather short evidence for a problem. Returns sources and excerpts." },
  { name: "knowledge.lookup", category: "knowledge", risk: "read", permissions: ["evidence"], description: "Find a prior note by query, or remember a short note." },
  { name: "task.decompose", category: "task", risk: "read", permissions: ["evidence"], description: "Split a large goal into a bounded task graph." },
];

class ScriptedModelProvider extends ModelProvider {
  constructor(responses) {
    super("scripted");
    this.responses = responses.slice();
    this.calls = [];
  }

  async complete(input) {
    this.calls.push(input);
    return this.responses.shift() || { text: "Done.", toolCalls: [] };
  }
}

function liveHub(state, records = LIVE) {
  return {
    async listCapabilities() {
      return records.map((item) => ({ name: item.name, description: item.description }));
    },
    async invoke(request) {
      state.invocations.push(request.capability);
      state.requests.push(request);
      if (request.capability === "knowledge.lookup") {
        const remember = request.input && request.input.action === "remember";
        return {
          protocolVersion: 1,
          requestId: request.requestId,
          status: "ok",
          data: remember
            ? { action: "remember", stored: true, key: "test-animal" }
            : { action: "lookup", result: "The CodeMe test colour is sapphire.", matches: [] },
          sources: [],
          warnings: [],
          error: null,
          duration: 4,
        };
      }
      if (request.capability === "task.decompose") {
        return {
          protocolVersion: 1,
          requestId: request.requestId,
          status: "ok",
          data: {
            project: "test-plan",
            tasks: [
              { id: "1", title: "Inspect", objective: "Inspect the project" },
              { id: "2", title: "Implement", objective: "Apply the change" },
            ],
          },
          sources: [],
          warnings: [],
          error: null,
          duration: 4,
        };
      }
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        status: "ok",
        data: {
          problem: request.input && request.input.problem,
          evidence: [{ title: "Published note", url: "https://example.com/note", excerpt: "short evidence", source: "test" }],
        },
        sources: [],
        warnings: [],
        error: null,
        duration: 4,
      };
    },
  };
}

function runtime(options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-capability-"));
  const workspace = path.join(directory, "ws");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "README.md"), "site notes\n");
  const host = {
    async inspectWorkspace() {
      return {
        state: "project",
        root: workspace,
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
      return { path: filePath, contents: fs.readFileSync(path.join(workspace, filePath), "utf8") };
    },
    async search() { return { query: "", matches: [] }; },
    async gitStatus() { return { branch: "main", changes: [] }; },
    async gitDiff() { return { diff: "" }; },
    async diagnostics() { return { items: [] }; },
    async browserCheck(url) { return { available: false, code: "browser_unavailable", message: "none", url }; },
  };
  return startPipelineRun({
    goal: options.goal,
    model: "scripted",
    providerName: "scripted",
    mode: options.mode || "read_only",
    composerMode: options.composerMode || "ask",
    taskClass: options.taskClass,
    provider: options.provider,
    registry: new ToolRegistry(new ReadOnlyToolProvider(host)),
    store: new RunStore(path.join(directory, "runs")),
    capabilities: options.capabilities,
    maxIterations: options.maxIterations || 4,
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
  await test("selectCapability still classifies research, task, knowledge, and layout exclusions", async () => {
    assert.strictEqual(selectCapability("research the website", LIVE, { composerMode: "ask" }).name, "research.problem");
    assert.strictEqual(selectCapability("Build a landing page and a cart and a checkout and email receipts", LIVE).name, "task.decompose");
    assert.strictEqual(selectCapability("Recall the project memory about deployment", LIVE).name, "knowledge.lookup");
    assert.strictEqual(selectCapability("Explain the readme", LIVE), null);
    assert.strictEqual(isSiteLayoutGoal("can you find me a better layout for my website"), true);
    assert.strictEqual(selectCapability("can you find me a better layout for my website", LIVE, { composerMode: "code" }), null);
  });

  await test("knowledge input aliases normalize into canonical remember and lookup requests", async () => {
    const schema = {
      type: "object",
      properties: {
        query: { type: "string" },
        action: { type: "string" },
        entry: { type: "object" },
      },
      required: [],
    };
    assert.deepStrictEqual(
      normalizeCapabilityInput(schema, { note: "The secret CodeMe test animal is otter." }, "knowledge.lookup").input,
      { action: "remember", entry: { content: "The secret CodeMe test animal is otter." } },
    );
    assert.deepStrictEqual(
      normalizeCapabilityInput(schema, { action: "recall", text: "What is the CodeMe test animal?" }, "knowledge.lookup").input,
      { action: "lookup", query: "What is the CodeMe test animal?" },
    );
  });

  await test("research intent runs once as OpenHands pipeline preflight before the first model step", async () => {
    const state = { invocations: [], requests: [] };
    const provider = new ScriptedModelProvider([{ text: "Research complete.", toolCalls: [] }]);
    const run = await runtime({
      goal: "research the website",
      provider,
      capabilities: liveHub(state),
    }).done;

    assert.strictEqual(run.lifecycle, "completed");
    assert.deepStrictEqual(state.invocations, ["research.problem"]);
    const call = run.toolCalls.find((item) => item.name === "capability.invoke" && item.phase === "preflight");
    assert.ok(call);
    assert.strictEqual(call.directedBy, "runtime");
    assert.strictEqual(call.args.capability, "research.problem");
    assert.strictEqual(state.requests[0].input.problem, "research the website");
    assert.ok(provider.calls[0].messages.some((message) => String(message.content).includes("EXTERNAL CAPABILITY PREFLIGHT")));
  });

  await test("external memory intent uses knowledge.lookup preflight on the canonical loop", async () => {
    const state = { invocations: [], requests: [] };
    const provider = new ScriptedModelProvider([{ text: "The project note was stored.", toolCalls: [] }]);
    const run = await runtime({
      goal: "Remember this project note using the external memory hub: The secret CodeMe test animal is otter. Do not edit any files.",
      provider,
      capabilities: liveHub(state),
    }).done;

    assert.strictEqual(run.lifecycle, "completed");
    assert.deepStrictEqual(state.invocations, ["knowledge.lookup"]);
    assert.deepStrictEqual(state.requests[0].input, {
      action: "remember",
      entry: { content: "The secret CodeMe test animal is otter." },
    });
    assert.ok(run.toolCalls.some((item) => item.name === "capability.invoke" && item.phase === "preflight"));
  });

  await test("Plan mode can preflight task decomposition without creating another loop", async () => {
    const state = { invocations: [], requests: [] };
    const provider = new ScriptedModelProvider([
      { text: "1. Inspect the project.\n2. Implement the change.\n3. Verify the result.", toolCalls: [] },
    ]);
    const run = await runtime({
      goal: "Map the checkout, inventory, and admin work into a sequenced delivery for the next sprint",
      composerMode: "plan",
      taskClass: "plan",
      provider,
      capabilities: liveHub(state),
    }).done;

    assert.strictEqual(run.lifecycle, "completed");
    assert.deepStrictEqual(state.invocations, ["task.decompose"]);
    assert.strictEqual(state.requests[0].input.goal.includes("checkout"), true);
    assert.ok(provider.calls[0].messages.some((message) => String(message.content).includes("untrusted planning evidence")));
  });

  await test("build tasks prefer research preflight while layout edits stay local", async () => {
    assert.strictEqual(
      chooseCapabilityPreflight(
        { goal: "create a dealership website with accounts and bidding", mode: "controlled", composerMode: "code", taskClass: "build" },
        LIVE,
      ).name,
      "research.problem",
    );
    assert.strictEqual(
      chooseCapabilityPreflight(
        { goal: "find me a better layout for my website", mode: "controlled", composerMode: "code", taskClass: "layout" },
        LIVE,
      ),
      null,
    );
  });

  await test("empty discovery exposes no capability tools and performs no preflight", async () => {
    const state = { invocations: [], requests: [] };
    const provider = new ScriptedModelProvider([{ text: "No external evidence is available.", toolCalls: [] }]);
    const run = await runtime({
      goal: "research the website",
      provider,
      capabilities: liveHub(state, []),
    }).done;

    assert.strictEqual(run.lifecycle, "completed");
    assert.deepStrictEqual(state.invocations, []);
    assert.ok(!provider.calls[0].tools.some((tool) => tool.name === "capability.invoke"));
    assert.ok(!run.toolCalls.some((item) => item.name === "capability.invoke"));
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
