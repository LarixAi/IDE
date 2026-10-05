"use strict";

const assert = require("node:assert/strict");
const {
  isExperimentalSelfTestEnabled,
  runPostMutationSelfTest,
} = require("../self-test-supervisor");

assert.equal(isExperimentalSelfTestEnabled({ experimentalSelfTest: true }), true);
assert.equal(isExperimentalSelfTestEnabled({ experimentalSelfTest: false }), false);

(async () => {
  const calls = [];
  const registry = {
    async call(name, args) {
      calls.push({ name, args });
      if (name === "diagnostics.run") {
        return { ok: true, tool: name, data: { items: [] } };
      }
      if (name === "tests.run") {
        return { ok: false, tool: name, error: { code: "test_failed", message: "1 test failed" } };
      }
      throw new Error("unexpected tool");
    },
  };

  const report = await runPostMutationSelfTest({
    registry,
    workspace: { scripts: { test: "node test.js" } },
    definitions: [{ name: "diagnostics.run" }, { name: "tests.run" }],
  });

  assert.equal(report.summary.ok, false);
  assert.deepEqual(report.summary.checks.map((item) => [item.name, item.ok]), [
    ["diagnostics.run", true],
    ["tests.run", false],
  ]);
  assert.deepEqual(calls.map((item) => item.name), ["diagnostics.run", "tests.run"]);
  console.log("experimental self-test supervisor tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
