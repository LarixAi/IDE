"use strict";

const assert = require("node:assert/strict");
const { engineerContext, SCRATCHPAD_HEADER } = require("../context-engineering/context-manager");
const { isolateContext } = require("../context-engineering/isolate-context");
const { prepareAgentStep } = require("../agent-step");

function longText(label, count = 900) {
  return (label + " ").repeat(count);
}

function main() {
  const small = [
    { role: "system", content: "You are CodeMe." },
    { role: "user", content: "Read README.md and explain it." },
    { role: "assistant", content: "I can do that." },
  ];
  const smallResult = engineerContext(small, { maxChars: 12000 });
  assert.equal(smallResult.changed, false);
  assert.deepEqual(smallResult.messages, small);

  const messages = [
    { role: "system", content: "You are CodeMe. Preserve the user's goal." },
    { role: "user", content: "Fix the login flow in src/auth/login.js and verify it." },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "read_login", name: "file.read", args: { path: "src/auth/login.js" } }],
    },
    { role: "tool", name: "file.read", content: longText("login handler token validation", 700) },
    ...Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 ? "assistant" : "tool",
      ...(index % 2 ? {} : { name: "terminal.run" }),
      content: longText("unrelated generated build log " + index, 500),
    })),
    { role: "user", content: "Keep the existing API and focus on the login validation bug." },
    { role: "assistant", content: "Continuing with the existing API." },
  ];

  const engineered = engineerContext(messages, {
    maxChars: 12000,
    selectTriggerRatio: 0.5,
    selectTargetRatio: 0.42,
    compressTriggerRatio: 0.72,
    compressTargetRatio: 0.55,
    keepRecent: 5,
    maxToolChars: 1200,
  });

  assert.equal(engineered.changed, true);
  assert.ok(engineered.afterChars < engineered.beforeChars);
  assert.ok(engineered.selection.dropped > 0 || engineered.isolation.isolated > 0 || engineered.compression.changed);
  assert.ok(engineered.state.filePaths.includes("src/auth/login.js"));
  assert.ok(engineered.messages.some((message) => String(message.content || "").includes("login validation bug")));
  assert.ok(
    engineered.messages.some(
      (message) => message.role === "system" && String(message.content || "").includes(SCRATCHPAD_HEADER),
    ),
  );

  const isolated = isolateContext([
    { role: "system", content: "system" },
    { role: "tool", name: "terminal.run", content: longText("huge output", 1000) },
    { role: "assistant", content: "middle" },
    { role: "user", content: "next" },
    { role: "assistant", content: "recent" },
    { role: "user", content: "latest" },
  ], { keepRecent: 4, maxToolChars: 700 });
  assert.equal(isolated.changed, true);
  assert.ok(isolated.messages[1].content.includes("raw result retained outside model view"));

  const prepared = prepareAgentStep(messages, {
    contextWindowChars: 12000,
    contextSelectTriggerRatio: 0.5,
    contextSelectTargetRatio: 0.42,
    condenseTriggerRatio: 0.72,
    condenseTargetRatio: 0.55,
    keepRecent: 5,
  });
  assert.ok(prepared.contextEngineering);
  assert.ok(prepared.events.some((event) => event.type === "context_engineering"));

  console.log("ok context engineering write/select/isolate/compress");
}

main();
