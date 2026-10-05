"use strict";

const assert = require("node:assert/strict");
const { runPipeline } = require("../pipeline-loop");
const { condenseMessages } = require("../context-condenser");
const { analyzeAction, requiresConfirmation } = require("../security-analyzer");
const { prepareAgentStep, selectToolsForTask } = require("../agent-step");

async function main() {
  const longMessages = [
    { role: "system", content: "system".repeat(500) },
    { role: "user", content: "build the feature" },
    ...Array.from({ length: 14 }, (_, index) => ({
      role: index % 2 ? "assistant" : "tool",
      name: index % 2 ? undefined : "file.read",
      content: ("message-" + index + " ").repeat(700),
    })),
  ];
  const condensed = condenseMessages(longMessages, {
    maxChars: 12000,
    triggerRatio: 0.6,
    targetRatio: 0.45,
    keepRecent: 4,
  });
  assert.equal(condensed.kind, "condensation");
  assert.ok(condensed.changed);
  assert.ok(condensed.afterChars < condensed.beforeChars);
  assert.ok(condensed.summarized > 0);

  const prepared = prepareAgentStep(longMessages, {
    contextWindowChars: 12000,
    condenseTriggerRatio: 0.6,
    condenseTargetRatio: 0.45,
    keepRecent: 4,
  });
  assert.ok(prepared.events.some((event) => event.type === "condensation"));
  assert.ok(prepared.events.some((event) => event.type === "context_engineering"));

  const broadTools = [
    "workspace.inspect", "dir.list", "file.read", "file.patch", "file.write",
    "repo.search", "git.status", "git.diff", "diagnostics.run",
    "terminal.run", "sandbox.run", "tests.run",
    "process.start", "process.status", "process.logs", "browser.check", "browser.interact",
    "memory.recall", "memory.save", "skill.run", "capability.list", "capability.invoke",
    "research.engineer", "design.openpencil", "browser.harness", "codeme.capabilities",
  ].map((name) => ({ name, description: name, parameters: { type: "object", properties: {} } }));
  const cssTools = selectToolsForTask(broadTools, [{ role: "user", content: "Fix the website CSS." }]);
  const cssNames = new Set(cssTools.map((tool) => tool.name));
  assert.ok(cssTools.length < broadTools.length, "CSS work should not receive the entire tool catalogue");
  assert.ok(cssNames.has("file.patch"));
  assert.ok(cssNames.has("browser.check"));
  assert.ok(!cssNames.has("design.openpencil"));
  assert.ok(!cssNames.has("capability.invoke"));

  const designTools = selectToolsForTask(broadTools, [{ role: "user", content: "Use OpenPencil to design a dashboard mockup." }]);
  assert.ok(designTools.some((tool) => tool.name === "design.openpencil"));

  const destructive = analyzeAction({
    id: "call_1",
    name: "terminal.run",
    args: { command: "rm -rf build" },
  }, { mode: "code" });
  assert.equal(destructive.level, "high");
  assert.equal(requiresConfirmation(destructive, "high_risk"), true);
  assert.equal(requiresConfirmation(destructive, "direct"), false);

  const replies = [
    {
      text: "",
      toolCalls: [{ id: "call_read", name: "file.read", args: { path: "README.md" } }],
    },
    {
      text: "Done from the event-step loop.",
      toolCalls: [],
    },
  ];
  let calls = 0;
  let checkpoint = null;
  const result = await runPipeline({
    model: "test-model",
    messages: [
      { role: "system", content: "test" },
      { role: "user", content: "read README and answer" },
    ],
    tools: [{
      name: "file.read",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    }],
    provider: {
      async complete() {
        const reply = replies[calls];
        calls += 1;
        return reply;
      },
    },
    async executeTool(call) {
      assert.equal(call.name, "file.read");
      return { ok: true, tool: call.name, data: { contents: "# hello" } };
    },
    maxTurns: 3,
    mode: "read_only",
    confirmationPolicy: "direct",
    onCheckpoint(value) {
      checkpoint = value;
    },
  });

  assert.equal(result.reason, "answered");
  assert.equal(result.finalText, "Done from the event-step loop.");
  const types = result.agentEvents.map((event) => event.type);
  assert.ok(types.includes("security"));
  assert.ok(types.includes("action"));
  assert.ok(types.includes("observation"));
  assert.ok(types.includes("message"));
  assert.ok(checkpoint);
  assert.ok(Array.isArray(checkpoint.agentEvents));
  assert.ok(checkpoint.agentEvents.some((event) => event.type === "observation"));

  console.log("ok OpenHands-style event-step model loop");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
