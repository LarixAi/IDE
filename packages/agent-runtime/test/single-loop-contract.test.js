"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const runtimeRoot = path.join(__dirname, "..");
const repoRoot = path.resolve(runtimeRoot, "..", "..");
const composerSessionPath = path.join(repoRoot, "extensions", "codeme-shell", "composer-session.js");
const indexPath = path.join(runtimeRoot, "index.js");
const pipelineRunPath = path.join(runtimeRoot, "pipeline-run.js");
const legacyLoopPath = path.join(runtimeRoot, "agent-run.js");
const legacyTestPath = path.join(runtimeRoot, "test", "orchestration.test.js");

assert.equal(fs.existsSync(legacyLoopPath), false, "legacy agent-run.js must not exist");
assert.equal(fs.existsSync(legacyTestPath), false, "legacy loop regression suite must not exist");

const composer = fs.readFileSync(composerSessionPath, "utf8");
assert.ok(composer.includes("startPipelineRun"));
assert.ok(composer.includes("resumePipelineRun"));
assert.ok(!composer.includes("startAgentRun"));
assert.ok(!composer.includes("CODEME_AGENT_PIPELINE"));
assert.ok(!composer.includes('=== "legacy"'));

const index = fs.readFileSync(indexPath, "utf8");
assert.ok(index.includes('require("./run-state")'));
assert.ok(index.includes("startPipelineRun"));
assert.ok(index.includes("resumePipelineRun"));
assert.ok(!index.includes("startAgentRun"));
assert.ok(!index.includes("resumeRun"));

const pipeline = fs.readFileSync(pipelineRunPath, "utf8");
assert.ok(pipeline.includes('require("./run-state")'));
assert.ok(pipeline.includes('name: "openhands-agent"'));
assert.ok(pipeline.includes('loop: "openhands-event-step-v1"'));
assert.ok(!pipeline.includes('require("./agent-run")'));

console.log("ok OpenHands event-step loop is the only executable CodeMe agent loop");
