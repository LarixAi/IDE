"use strict";

const assert = require("assert");
const {
  RESPONSE_POLICY,
  ResponsePolicyProvider,
  decodeAssistantEntities,
  hasRepeatedPhrase,
  looksCorruptedAssistantText,
  normalizeAssistantText,
} = require("../model-response-policy");

(async () => {
  const seen = [];
  const base = {
    name: "fixture",
    async complete(input) {
      seen.push(input);
      return { text: "OK", toolCalls: [] };
    },
  };
  const provider = new ResponsePolicyProvider(base);
  const original = {
    model: "fixture",
    messages: [{ role: "user", content: "Does routing work?" }],
    tools: [],
  };
  const reply = await provider.complete(original);
  assert.strictEqual(reply.text, "OK");
  assert.strictEqual(original.messages.length, 1, "must not mutate pipeline messages");
  assert.strictEqual(seen[0].messages.length, 2);
  assert.strictEqual(seen[0].messages[1].role, "system");
  assert.ok(seen[0].messages[1].content.includes("not verified"));
  assert.ok(seen[0].messages[1].content.includes("codeme.capabilities"));
  assert.ok(RESPONSE_POLICY.includes("plain English"));
  assert.ok(RESPONSE_POLICY.includes("HTML entities"));

  assert.strictEqual(
    decodeAssistantEntities("CodeMe&#xA0;IDE &#x43;ode &#160; test"),
    "CodeMe IDE Code   test",
  );
  assert.strictEqual(normalizeAssistantText("Hello&nbsp;world"), "Hello world");

  const malformed = "Yes, you have a website software architect and developer builder in this IDE. "
    + "This is **s, you have a website software architect and developer builder in this IDE. "
    + "This is&#xA0;**&#x43;odeMe**deMe**.";
  assert.strictEqual(looksCorruptedAssistantText(malformed), true);
  assert.strictEqual(hasRepeatedPhrase(malformed), true);

  let attempts = 0;
  const repairBase = {
    name: "fixture",
    async complete() {
      attempts += 1;
      if (attempts === 1) return { text: malformed, toolCalls: [] };
      return {
        text: "No — the named Software Architect role is not verified as installed.",
        toolCalls: [],
      };
    },
  };
  const repaired = await new ResponsePolicyProvider(repairBase).complete({
    model: "fixture",
    messages: [{ role: "user", content: "Is the Software Architect installed?" }],
    tools: [{ name: "codeme.capabilities", parameters: { type: "object", properties: {} } }],
  });
  assert.strictEqual(attempts, 2, "garbled prose should be regenerated once");
  assert.strictEqual(
    repaired.text,
    "No — the named Software Architect role is not verified as installed.",
  );

  let toolAttempts = 0;
  const toolBase = {
    name: "fixture",
    async complete() {
      toolAttempts += 1;
      return {
        text: "Checking&#xA0;capabilities",
        toolCalls: [{ name: "codeme.capabilities", args: { query: "Software Architect" } }],
      };
    },
  };
  const toolReply = await new ResponsePolicyProvider(toolBase).complete({
    model: "fixture",
    messages: [{ role: "user", content: "Is it installed?" }],
    tools: [],
  });
  assert.strictEqual(toolAttempts, 1, "valid tool calls must not be discarded by prose repair");
  assert.strictEqual(toolReply.text, "Checking capabilities");
  assert.strictEqual(toolReply.toolCalls.length, 1);

  console.log("ok model response policy, capability grounding, and garbled-text recovery");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
