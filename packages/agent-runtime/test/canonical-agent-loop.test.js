"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const canonical = require("../agent-loop");
const legacy = require("../pipeline-loop");
const runtime = require("../index");

assert.strictEqual(typeof canonical.runAgentLoop, "function");
assert.strictEqual(canonical.runAgentLoop, canonical.runPipeline, "runPipeline must remain only as a compatibility alias");
assert.strictEqual(legacy.runAgentLoop, canonical.runAgentLoop, "pipeline-loop must re-export the canonical implementation");
assert.strictEqual(legacy.runPipeline, canonical.runAgentLoop, "legacy pipeline entry must resolve to the canonical implementation");
assert.strictEqual(runtime.runAgentLoop, canonical.runAgentLoop, "public runtime export must use the canonical implementation");
assert.strictEqual(runtime.startAgentRun, runtime.startPipelineRun, "legacy startAgentRun API must route to the canonical pipeline");
assert.strictEqual(runtime.resumeRun, runtime.resumePipelineRun, "legacy resumeRun API must route to the canonical pipeline");

const composerSource = fs.readFileSync(path.join(__dirname, "../../../extensions/codeme-shell/composer-session.js"), "utf8");
assert.ok(!composerSource.includes("CODEME_AGENT_PIPELINE"), "Composer must not expose a legacy-loop environment switch");
assert.ok(!composerSource.includes("startAgentRun"), "Composer must start only the canonical pipeline");

console.log("ok canonical OpenHands-style agent loop is the single runtime loop");
