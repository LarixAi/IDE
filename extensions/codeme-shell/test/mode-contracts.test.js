const assert = require("assert");
const {
  contractFor,
  internalComposerMode,
  modeOptions,
  visibleMode,
} = require("../mode-contracts");
const {
  normalizeComposerMode,
  agentModeFor,
  taskClassFor,
  composerModeLabel,
} = require("../composer-client");

assert.deepStrictEqual(modeOptions().map((item) => item.label), [
  "Chat",
  "Research",
  "Plan",
  "Code",
  "Debug",
  "Multitask",
]);
assert.strictEqual(visibleMode("ask"), "chat");
assert.strictEqual(visibleMode("chat_only"), "chat");
assert.strictEqual(visibleMode("research"), "research");
assert.strictEqual(internalComposerMode("chat"), "ask");
assert.strictEqual(internalComposerMode("research"), "research");
assert.strictEqual(contractFor("chat").mutation, "blocked");
assert.strictEqual(contractFor("research").mutation, "blocked");
assert.strictEqual(contractFor("research").agentMode, "read_only");
assert.strictEqual(contractFor("research").taskClass, "research");
assert.strictEqual(contractFor("debug").mutation, "after_failure_evidence");
assert.strictEqual(contractFor("multitask").orchestrated, true);

assert.strictEqual(normalizeComposerMode("chat"), "ask");
assert.strictEqual(agentModeFor("chat"), "read_only");
assert.strictEqual(normalizeComposerMode("research"), "research");
assert.strictEqual(agentModeFor("research"), "read_only");
assert.strictEqual(taskClassFor("research"), "research");
assert.strictEqual(agentModeFor("debug"), "controlled");
assert.strictEqual(agentModeFor("multitask"), "read_only");
assert.strictEqual(taskClassFor("debug"), "bug-fix");
assert.strictEqual(composerModeLabel("ask"), "Chat");
assert.strictEqual(composerModeLabel("research"), "Research");
assert.strictEqual(composerModeLabel("debug"), "Debug");
assert.strictEqual(composerModeLabel("multitask"), "Multitask");

console.log("ok Composer mode contracts");
