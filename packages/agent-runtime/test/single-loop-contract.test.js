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

function walkJavaScript(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "code-oss") continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkJavaScript(full));
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const forbidden = [
  { pattern: /\bstartAgentRun\b/, label: "startAgentRun" },
  { pattern: /\bresumeRun\b/, label: "resumeRun" },
  { pattern: /CODEME_AGENT_PIPELINE/, label: "CODEME_AGENT_PIPELINE" },
  { pattern: /agent-run\.js/, label: "agent-run.js" },
];

for (const base of [path.join(repoRoot, "packages"), path.join(repoRoot, "extensions")]) {
  for (const file of walkJavaScript(base)) {
    if (file === __filename) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const item of forbidden) {
      assert.ok(
        !item.pattern.test(source),
        item.label + " must not appear in executable CodeMe source: " + path.relative(repoRoot, file),
      );
    }
  }
}

console.log("ok OpenHands event-step loop is the only executable CodeMe agent loop");
