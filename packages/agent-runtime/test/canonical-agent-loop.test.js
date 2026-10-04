"use strict";

const assert = require("assert");

const canonical = require("../agent-loop");
const legacy = require("../pipeline-loop");
const runtime = require("../index");

assert.strictEqual(typeof canonical.runAgentLoop, "function");
assert.strictEqual(canonical.runAgentLoop, canonical.runPipeline, "runPipeline must remain only as a compatibility alias");
assert.strictEqual(legacy.runAgentLoop, canonical.runAgentLoop, "pipeline-loop must re-export the canonical implementation");
assert.strictEqual(legacy.runPipeline, canonical.runAgentLoop, "legacy pipeline entry must resolve to the canonical implementation");
assert.strictEqual(runtime.runAgentLoop, canonical.runAgentLoop, "public runtime export must use the canonical implementation");

console.log("ok canonical OpenHands-style agent loop is the single runtime loop");
