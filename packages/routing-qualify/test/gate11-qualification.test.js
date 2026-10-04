"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ModelProvider,
  RunStore,
  startPipelineRun,
  ReadOnlyToolProvider,
  ToolRegistry,
  selectCapability,
} = require("../../agent-runtime");

const LIVE = [
  { name: "hub.health", description: "Echo a short token and report hub health" },
  { name: "research.problem", description: "Gather short evidence for a problem. Returns sources and excerpts." },
  { name: "knowledge.lookup", description: "Find a prior note by query, or remember a short note." },
  { name: "task.decompose", description: "Split a large goal into a bounded task graph." },
];

class OneTurnProvider extends ModelProvider {
  constructor(label, composerMode = "ask") {
    super("gate11-scripted");
    this.label = label;
    this.composerMode = composerMode;
    this.calls = [];
  }

  async complete(input) {
    this.calls.push(input);
    if (this.composerMode === "plan") {
      return {
        text: "1. Inspect the current workspace.\n2. Apply the planned change in Code mode.\n3. Verify the result.",
        toolCalls: [],
      };
    }
    return { text: `Observed routed context for ${this.label}.`, toolCalls: [] };
  }
}

function routingHub(state) {
  return {
    async listCapabilities() {
      return LIVE.map((item) => ({ ...item }));
    },
    async invoke(request) {
      state.requests.push({
        capability: request.capability,
        input: request.input,
        requestId: request.requestId,
      });

      let data;
      if (request.capability === "task.decompose") {
        data = {
          project: "Checkout delivery",
          tasks: [
            {
              id: "T1",
              title: "Define checkout contract",
              objective: "Specify the checkout request and response.",
            },
            {
              id: "T2",
              title: "Implement checkout",
              objective: "Build the checkout flow against the contract.",
            },
          ],
        };
      } else if (request.capability === "knowledge.lookup") {
        data = {
          action: "lookup",
          query: request.input && request.input.query,
          matches: [{
            title: "Completion needs evidence",
            text: "Tests, diagnostics, and the diff decide completion.",
          }],
        };
      } else if (request.capability === "research.problem") {
        data = {
          problem: request.input && request.input.problem,
          confidence: "high",
          evidence: [{
            title: "Stripe webhook verification",
            url: "https://example.com/stripe-webhook",
            excerpt: "Verify the signature against the raw request body before parsing JSON.",
            source: "test",
          }],
        };
      } else {
        data = { health: "ok" };
      }

      return {
        protocolVersion: 1,
        requestId: request.requestId,
        status: "ok",
        data,
        sources: [],
        warnings: [],
        error: null,
        duration: 3,
      };
    },
  };
}

function createHost(workspace) {
  return {
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
    async browserCheck(url) {
      return { available: false, code: "browser_unavailable", message: "not needed", url };
    },
  };
}

async function runScenario({ goal, composerMode = "ask", expectedCapability = null }) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-gate11-"));
  const workspace = path.join(parent, "ws");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "README.md"), "# Gate 11\nLocal workspace context.\n");

  const state = { requests: [] };
  const provider = new OneTurnProvider(expectedCapability || "local", composerMode);
  const run = await startPipelineRun({
    goal,
    model: "gate11-scripted",
    providerName: provider.name,
    mode: "read_only",
    composerMode,
    taskClass: composerMode === "plan" ? "plan" : undefined,
    provider,
    registry: new ToolRegistry(new ReadOnlyToolProvider(createHost(workspace))),
    store: new RunStore(path.join(parent, "runs")),
    capabilities: routingHub(state),
    maxIterations: 4,
    projectBrainEnabled: false,
    skillsEnabled: false,
  }).done;

  return { run, state, provider };
}

function firstModelText(provider) {
  const first = provider.calls[0];
  assert.ok(first, "the model should receive one routed turn");
  return (first.messages || []).map((message) => String(message.content || "")).join("\n");
}

async function main() {
  const taskGoal = "1. Design the checkout API 2. Build the cart client 3. Add email receipts";
  const task = await runScenario({ goal: taskGoal, composerMode: "plan", expectedCapability: "task.decompose" });
  assert.strictEqual(task.run.lifecycle, "completed");
  assert.deepStrictEqual(task.state.requests.map((item) => item.capability), ["task.decompose"]);
  assert.strictEqual(task.state.requests[0].input.goal, taskGoal);
  assert.match(firstModelText(task.provider), /Task graph:/);
  assert.match(firstModelText(task.provider), /T1 Define checkout contract/);
  assert.ok(task.run.toolCalls.some((call) => call.name === "capability.invoke" && call.phase === "preflight"));

  const knowledgeGoal = "What did we save in the project notes about completion evidence";
  const knowledge = await runScenario({ goal: knowledgeGoal, expectedCapability: "knowledge.lookup" });
  assert.strictEqual(knowledge.run.lifecycle, "completed");
  assert.deepStrictEqual(knowledge.state.requests.map((item) => item.capability), ["knowledge.lookup"]);
  assert.strictEqual(knowledge.state.requests[0].input.query, knowledgeGoal);
  assert.match(firstModelText(knowledge.provider), /Stored context:/);
  assert.match(firstModelText(knowledge.provider), /Completion needs evidence/);

  const researchGoal = "Research why Stripe webhook signature verification is failing";
  const research = await runScenario({ goal: researchGoal, expectedCapability: "research.problem" });
  assert.strictEqual(research.run.lifecycle, "completed");
  assert.deepStrictEqual(research.state.requests.map((item) => item.capability), ["research.problem"]);
  assert.strictEqual(research.state.requests[0].input.problem, researchGoal);
  assert.match(firstModelText(research.provider), /Stripe webhook verification|raw request body/);

  const local = await runScenario({ goal: "Explain the README in this workspace", expectedCapability: null });
  assert.strictEqual(local.run.lifecycle, "completed");
  assert.deepStrictEqual(local.state.requests, []);
  assert.doesNotMatch(firstModelText(local.provider), /EXTERNAL CAPABILITY PREFLIGHT/);

  const priority = selectCapability(
    "What did we save in the project notes about why the API fails",
    [
      { name: "research.problem", category: "research" },
      { name: "knowledge.lookup", category: "knowledge" },
      { name: "task.decompose", category: "task" },
    ],
  );
  assert.strictEqual(priority && priority.name, "knowledge.lookup");

  console.log("ok gate 11 intelligent capability routing qualification on canonical OpenHands loop");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
