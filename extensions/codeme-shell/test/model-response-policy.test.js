"use strict";

const assert = require("assert");
const {
  RESPONSE_POLICY,
  ACTION_REQUIRED_POLICY,
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

  let editAttempts = 0;
  let editRetryMessages = [];
  const editBase = {
    name: "fixture",
    async complete(input) {
      editAttempts += 1;
      editRetryMessages = input.messages || [];
      if (editAttempts === 1) {
        return { text: "Done — I updated the website.", toolCalls: [] };
      }
      return {
        text: "",
        toolCalls: [{ name: "file.read", args: { path: "public/index.html" } }],
      };
    },
  };
  const editReply = await new ResponsePolicyProvider(editBase).complete({
    model: "fixture",
    messages: [{ role: "user", content: "Can you fix the website UI? I don't like any of the pages." }],
    tools: [
      { name: "file.read", parameters: { type: "object", properties: { path: { type: "string" } } } },
      { name: "file.patch", parameters: { type: "object", properties: {} } },
      { name: "file.write", parameters: { type: "object", properties: {} } },
    ],
  });
  assert.strictEqual(editAttempts, 2, "Code mode prose completion must be retried until the model takes an action");
  assert.strictEqual(editReply.toolCalls.length, 1);
  assert.strictEqual(editReply.toolCalls[0].name, "file.read");
  assert.ok(
    editRetryMessages.some((message) => (
      message.role === "system"
      && String(message.content || "").includes("ACTION REQUIRED")
    )),
  );
  assert.ok(ACTION_REQUIRED_POLICY.includes("cannot finish with prose only"));

  let verificationAttempts = 0;
  const verificationBase = {
    name: "fixture",
    async complete() {
      verificationAttempts += 1;
      if (verificationAttempts === 1) {
        return { text: "I couldn't complete that.", toolCalls: [] };
      }
      return {
        text: "",
        toolCalls: [{ name: "browser.check", args: {} }],
      };
    },
  };
  const verificationReply = await new ResponsePolicyProvider(verificationBase).complete({
    model: "fixture",
    messages: [
      { role: "user", content: "Fix the website UI." },
      { role: "assistant", content: "", toolCalls: [{ name: "file.write", args: { path: "public/index.html" } }] },
      { role: "tool", name: "file.write", content: JSON.stringify({ ok: true, data: { changed: true } }) },
      { role: "user", content: "VERIFICATION FAILED (repair round 1/2). Run browser.check after the edit." },
    ],
    tools: [
      { name: "file.write", parameters: { type: "object", properties: {} } },
      { name: "browser.check", parameters: { type: "object", properties: {} } },
    ],
  });
  assert.strictEqual(verificationAttempts, 2, "verification repair prose must be retried as an action turn");
  assert.strictEqual(verificationReply.toolCalls[0].name, "browser.check");

  console.log("ok model response policy, capability grounding, and garbled-text recovery");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
