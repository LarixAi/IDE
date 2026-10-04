"use strict";

const assert = require("node:assert/strict");
const { cycleDetected } = require("../progress");
const { runPipeline } = require("../pipeline-loop");

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
  await test("a rolling action cycle is still detectable without a legacy executor", async () => {
    const cycle = ["search:a", "search:b", "read:a", "reason:x"];
    assert.strictEqual(cycleDetected(cycle.concat(cycle)), true);
    assert.strictEqual(cycleDetected(["search:a", "read:b", "write:c"]), false);
  });

  await test("repeated read-only evidence is suppressed and the model is forced to answer", async () => {
    let modelTurn = 0;
    let executions = 0;
    const events = [];
    const provider = {
      async complete(input) {
        modelTurn += 1;
        if (modelTurn <= 2) {
          return {
            text: "",
            toolCalls: [{ id: "read_" + modelTurn, name: "file.read", args: { path: "README.md" } }],
          };
        }
        assert.deepStrictEqual(input.tools, [], "repeat suppression should force an answer-only turn");
        return { text: "I used the evidence already collected.", toolCalls: [] };
      },
    };

    const result = await runPipeline({
      provider,
      model: "scripted",
      messages: [
        { role: "system", content: "Ask mode." },
        { role: "user", content: "Explain the README." },
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
      async executeTool() {
        executions += 1;
        return { ok: true, tool: "file.read", data: { contents: "# Project" } };
      },
      mode: "read_only",
      forceReadOnlyAnswerOnRepeat: true,
      maxTurns: 5,
      onEvent(event) { events.push(event); },
    });

    assert.strictEqual(result.reason, "answered");
    assert.strictEqual(executions, 1, "the identical read should execute only once");
    assert.ok(events.some((event) => event.type === "tool_repeat_suppressed"));
    assert.strictEqual(result.finalText, "I used the evidence already collected.");
  });

  await test("a non-progressing model is bounded by the canonical loop turn limit", async () => {
    let n = 0;
    const result = await runPipeline({
      provider: {
        async complete() {
          n += 1;
          return {
            text: "",
            toolCalls: [{ id: "call_" + n, name: "file.read", args: { path: "file-" + n + ".txt" } }],
          };
        },
      },
      model: "scripted",
      messages: [{ role: "user", content: "keep reading forever" }],
      tools: [{
        name: "file.read",
        description: "Read",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      }],
      async executeTool(call) {
        return { ok: true, tool: call.name, data: { contents: "x" } };
      },
      mode: "controlled",
      maxTurns: 3,
    });

    assert.strictEqual(result.reason, "max_turns");
    assert.strictEqual(result.turns, 3);
  });

  console.log("ok canonical OpenHands loop stagnation protections");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
