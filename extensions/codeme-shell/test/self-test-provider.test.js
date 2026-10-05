"use strict";

const assert = require("node:assert/strict");
const { CodeMeControlledToolProvider } = require("../codeme-tool-provider");

(async () => {
  const calls = [];
  const host = {
    async writeFile(path, contents) {
      calls.push(["writeFile", path, contents]);
      return { path, changed: true };
    },
    async patchFile(path, oldText, newText) {
      calls.push(["patchFile", path, oldText, newText]);
      return { path, changed: true };
    },
    async diagnostics() {
      calls.push(["diagnostics"]);
      return { items: [] };
    },
    async inspectWorkspace() {
      calls.push(["inspectWorkspace"]);
      return { scripts: { test: "node test.js" } };
    },
    async runTests(command) {
      calls.push(["runTests", command]);
      return { exitCode: 1, stdout: "1 test failed" };
    },
    async browserCheck(_url, args) {
      return {
        available: true,
        receivedWarningPolicy: args && args.allowPresentationWarnings === true,
      };
    },
  };

  const provider = new CodeMeControlledToolProvider(host, { experimentalSelfTest: true });

  const result = await provider.call("file.write", {
    path: "src/example.js",
    contents: "module.exports = 1;\n",
  });

  assert.equal(result.ok, true, "the edit itself should remain recorded as successful");
  assert.equal(result.data.changed, true);
  assert.ok(result.data.selfTest, "post-edit self-test summary should be attached");
  assert.equal(result.data.selfTest.ok, false);
  assert.equal(result.data.selfTest.requiresRepair, true);
  assert.deepEqual(
    result.data.selfTest.checks.map((check) => [check.name, check.ok]),
    [["diagnostics.run", true], ["tests.run", false]],
  );
  assert.deepEqual(
    calls.map((item) => item[0]),
    ["writeFile", "diagnostics", "inspectWorkspace", "runTests"],
  );

  const fileWrite = provider.definitions().find((tool) => tool.name === "file.write");
  assert.match(fileWrite.description, /data\.selfTest/i);
  assert.match(fileWrite.description, /do not claim completion/i);

  const browser = provider.definitions().find((tool) => tool.name === "browser.check");
  assert.ok(browser.parameters.properties.allowPresentationWarnings);

  console.log("ok experimental post-edit self-test provider");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
