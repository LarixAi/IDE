"use strict";

const assert = require("node:assert/strict");
const cp = require("child_process");
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
const { REQUIREMENTS, probe } = require("../acceptance");
const { GOAL } = require("../goal");

const FIXTURE = path.join(__dirname, "../fixture");
const REPAIR = `function validNumber(value) {
  if (typeof value !== "string" || !/^[0-9]{2,}$/.test(value)) return false;
  let sum = 0;
  const digits = value.split("").reverse();
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

module.exports = { validNumber };
`;

class Gate10Provider extends ModelProvider {
  constructor() {
    super("gate10-canonical");
    this.calls = [];
    this.step = 0;
    this.repairSawResearch = false;
  }

  async complete(input) {
    this.calls.push(input);
    const context = (input.messages || []).map((message) => String(message.content || "")).join("\n");
    const hasResearch = context.includes("EXTERNAL CAPABILITY PREFLIGHT")
      && context.includes("subtract 9")
      && context.includes("from the right");

    const steps = [
      { text: "Inspecting the implementation.", toolCalls: [{ name: "file.read", args: { path: "src/check.js" } }] },
      { text: "Inspecting the tests.", toolCalls: [{ name: "file.read", args: { path: "test/check.test.js" } }] },
      {
        text: "Applying the published-rule repair.",
        toolCalls: [{ name: "file.write", args: { path: "src/check.js", contents: REPAIR } }],
      },
      { text: "The evidence-based repair is ready for verification.", toolCalls: [] },
    ];

    if (this.step === 2) this.repairSawResearch = hasResearch;
    const reply = steps[Math.min(this.step, steps.length - 1)];
    this.step += 1;
    return reply;
  }
}

function prepareWorkspace() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-gate10-"));
  const workspace = path.join(parent, "fixture");
  fs.cpSync(FIXTURE, workspace, { recursive: true });
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "gate10",
    GIT_AUTHOR_EMAIL: "gate10@example.com",
    GIT_COMMITTER_NAME: "gate10",
    GIT_COMMITTER_EMAIL: "gate10@example.com",
  };
  cp.execFileSync("git", ["init", "-b", "main"], { cwd: workspace, stdio: "ignore" });
  cp.execFileSync("git", ["add", "."], { cwd: workspace, stdio: "ignore" });
  cp.execFileSync("git", ["commit", "-m", "gate10 fixture"], { cwd: workspace, env: gitEnv, stdio: "ignore" });
  return workspace;
}

async function main() {
  assert.strictEqual(/subtract 9|from the right|right-to-left/i.test(GOAL), false, "the hidden rule must not be in the user goal");

  const workspace = prepareWorkspace();
  const before = probe(workspace);
  assert.strictEqual(before.acceptValid && before.rejectInvalid && before.rejectMalformed, false, "fixture must start broken");

  const hub = { invocations: 0 };
  const provider = new Gate10Provider();
  const run = await startPipelineRun({
    goal: GOAL,
    model: "gate10-scripted",
    providerName: provider.name,
    mode: "controlled",
    composerMode: "code",
    requirements: REQUIREMENTS.map((item) => ({ ...item })),
    provider,
    registry: new ToolRegistry(new ControlledToolProvider(createResearchWorkspaceHost(workspace))),
    store: new RunStore(fs.mkdtempSync(path.join(os.tmpdir(), "codeme-gate10-runs-"))),
    capabilities: {
      async listCapabilities() {
        return [{
          name: "research.problem",
          description: "Gather short evidence for a problem. Returns sources and excerpts.",
        }];
      },
      async invoke(request) {
        hub.invocations += 1;
        return {
          protocolVersion: 1,
          requestId: request.requestId,
          status: "ok",
          data: {
            problem: request.input && request.input.problem,
            confidence: "high",
            evidence: [{
              title: "Published rule",
              url: "https://example.com/published-rule",
              excerpt: "Process digits from the right; double every second digit and subtract 9 when the doubled value exceeds 9.",
              source: "test",
            }],
          },
          sources: [],
          warnings: [],
          error: null,
          duration: 5,
        };
      },
    },
    maxIterations: 8,
    projectBrainEnabled: false,
    skillsEnabled: false,
  }).done;

  const calls = run.toolCalls || [];
  const researchCalls = calls.filter((call) => call.name === "capability.invoke" && call.phase === "preflight");
  const research = researchCalls[0];
  const writeIndex = calls.findIndex((call) => call.name === "file.write" && call.result && call.result.ok);
  const researchIndex = calls.indexOf(research);

  assert.strictEqual(run.lifecycle, "completed", JSON.stringify({ error: run.error, verification: run.verification }, null, 2));
  assert.strictEqual(run.verification.status, "passed");
  assert.strictEqual(hub.invocations, 1);
  assert.strictEqual(researchCalls.length, 1);
  assert.ok(research);
  assert.strictEqual(research.iteration, 0, "published external evidence should be gathered before the first model turn");
  assert.strictEqual(research.directedBy, "runtime");
  assert.strictEqual(research.result.trusted, false);
  assert.ok(writeIndex > researchIndex, "workspace edits must follow research evidence");
  assert.strictEqual(provider.repairSawResearch, true);
  assert.ok(calls.some((call) => call.name === "tests.run" && call.directedBy === "verification" && call.result && call.result.ok));
  assert.ok(calls.some((call) => call.name === "diagnostics.run" && call.directedBy === "verification" && call.result && call.result.ok));
  assert.ok(calls.some((call) => call.name === "git.diff" && call.directedBy === "verification" && call.result && call.result.ok));

  const final = probe(workspace);
  assert.strictEqual(final.acceptValid, true);
  assert.strictEqual(final.rejectInvalid, true);
  assert.strictEqual(final.rejectMalformed, true);

  console.log("ok gate 10 research-assisted coding qualification on canonical OpenHands loop");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
