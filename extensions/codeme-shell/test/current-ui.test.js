"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { renderComposer } = require("../composer-view");

const shellRoot = path.join(__dirname, "..");
const repoRoot = path.resolve(shellRoot, "..", "..");

const html = renderComposer("current-ui-test");
assert.match(html, /data-codeme-ui="current-v23"/);
assert.match(html, /CodeMe Current UI/);
assert.match(html, /Cursor-reference Composer V23/);
assert.match(html, /header \.workspace-actions \{\s*display: none !important;/);
assert.match(html, /placeholder="Plan, Build, \/ for skills, @ for context"/);
assert.doesNotMatch(html, /placeholder="Ask CodeMe anything/);

const manifest = JSON.parse(fs.readFileSync(path.join(shellRoot, "package.json"), "utf8"));
assert.strictEqual(manifest.version, "0.2.0");
assert.match(manifest.description, /current native workbench/i);

const launcher = fs.readFileSync(path.join(repoRoot, "scripts", "launch-codeme.sh"), "utf8");
assert.match(launcher, /extension_version=/);
assert.match(launcher, /codeme\.codeme-shell-\$extension_version/);
assert.match(launcher, /for stale in "\$ext_dir"\/codeme\.codeme-shell-\*/);
assert.match(launcher, /ui_generation="current-v23"/);
assert.doesNotMatch(launcher, /codeme\.codeme-shell-0\.1\.0/);

console.log("ok current CodeMe UI is the only registered shell generation");
