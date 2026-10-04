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

class EvidenceAwareProvider extends ModelProvider {
  constructor() {
    super("research-canonical");
    this.calls = [];
    this.step = 0;
    this.sawPreflight = false;
  }

  async complete(input) {
    this.calls.push(input);
    const context = (input.messages || []).map((message) => String(message.content || "")).join("\n");
    if (context.includes("EXTERNAL CAPABILITY PREFLIGHT") && context.includes("double every second digit")) {
      this.sawPreflight = true;
    }
    const steps = [
      { text: "Reading the current implementation.", toolCalls: [{ name: "file.read", args: { path: "src/check.js" } }] },
      { text: "Reading the current tests.", toolCalls: [{ name: "file.read", args: { path: "test/check.test.js" } }] },
      { text: "Applying the evidence-based repair.", toolCalls: [{ name: "file.write", args: { path: "src/check.js", contents: REPAIR } }] },
      { text: "The repair is implemented; verify it with the project checks.", toolCalls: [] },
    ];
    const reply = steps[Math.min(this.step, steps.length - 1)];
    this.step += 1;
    return reply;
  }
}

function prepareWorkspace() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-research-integration-"));
  const workspace = path.join(parent, "fixture");
  fs.cpSync(FIXTURE, workspace, { recursive: true });
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  cp.execFileSync("git", ["init", "-b", "main"], { cwd: workspace, stdio: "ignore" });
  cp.execFileSync("git", ["add", "."], { cwd: workspace, stdio: "ignore" });
  cp.execFileSync("git", ["commit", "-m", "id check"], { cwd: workspace, env: gitEnv, stdio: "ignore" });
  return workspace;
}

async function main() {
  const workspace = prepareWorkspace();
  const before = probe(workspace);
  assert.strictEqual(before.acceptValid && before.rejectInvalid && before.rejectMalformed, false, "fixture must start broken");

  const hub = { invocations: 0 };
  const provider = new EvidenceAwareProvider();
  const run = await startPipelineRun({
    goal: GOAL,
    model: "scripted",
    providerName: provider.name,
    mode: "controlled",
    composerMode: "code",
    requirements: REQUIREMENTS.map((item) => ({ ...item })),
    provider,
    registry: new ToolRegistry(new ControlledToolProvider(createResearchWorkspaceHost(workspace))),
    store: new RunStore(fs.mkdtempSync(path.join(os.tmpdir(), "codeme-research-integration-runs-"))),
    capabilities: {
      async listCapabilities() {
        return [{ name: "research.problem", description: "Gather short evidence for a problem. Returns sources and excerpts." }];
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
              url: "https://example.com/rule",
              excerpt: "Process digits from the right; double every second digit and subtract 9 when the doubled value exceeds 9.",
              source: "test",
            }],
          },
          sources: [],
          warnings: [],
          error: null,
          duration: 4,
        };
      },
    },
    maxIterations: 8,
    projectBrainEnabled: false,
    skillsEnabled: false,
  }).done;

  const calls = run.toolCalls || [];
  const research = calls.find((call) => call.name === "capability.invoke" && call.phase === "preflight");
  const write = calls.find((call) => call.name === "file.write" && call.result && call.result.ok);
  const tests = calls.find((call) => call.name === "tests.run" && call.directedBy === "verification" && call.result && call.result.ok);
  const diagnostics = calls.find((call) => call.name === "diagnostics.run" && call.directedBy === "verification" && call.result && call.result.ok);
  const diff = calls.find((call) => call.name === "git.diff" && call.directedBy === "verification" && call.result && call.result.ok);

  assert.strictEqual(run.lifecycle, "completed", JSON.stringify({ error: run.error, verification: run.verification }, null, 2));
  assert.strictEqual(run.verification.status, "passed");
  assert.strictEqual(hub.invocations, 1);
  assert.ok(research);
  assert.strictEqual(research.directedBy, "runtime");
  assert.strictEqual(research.result.trusted, false);
  assert.ok(provider.sawPreflight, "the first model step must see the external evidence");
  assert.ok(write);
  assert.ok(calls.indexOf(write) > calls.indexOf(research), "workspace edits must follow the untrusted research preflight");
  assert.ok(tests, "canonical verifier must run project tests");
  assert.ok(diagnostics, "canonical verifier must run diagnostics");
  assert.ok(diff, "canonical verifier must inspect git diff");

  const final = probe(workspace);
  assert.strictEqual(final.acceptValid, true);
  assert.strictEqual(final.rejectInvalid, true);
  assert.strictEqual(final.rejectMalformed, true);

  console.log("ok research integration runs entirely through canonical OpenHands loop");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
