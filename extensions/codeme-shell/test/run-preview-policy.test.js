"use strict";

const assert = require("node:assert/strict");
const { CodeMeControlledToolProvider } = require("../codeme-tool-provider");

const provider = new CodeMeControlledToolProvider({
  browserCheck: async (_url, args) => ({
    available: true,
    receivedWarningPolicy: args && args.allowPresentationWarnings === true,
  }),
});

const browser = provider.definitions().find((tool) => tool.name === "browser.check");
assert.ok(browser, "browser.check definition should be available");
assert.match(browser.description, /run\/open-preview-only/i);
assert.ok(browser.parameters.properties.allowPresentationWarnings);
assert.strictEqual(browser.parameters.properties.allowPresentationWarnings.type, "boolean");

provider.call("browser.check", { allowPresentationWarnings: true }).then((result) => {
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.data.receivedWarningPolicy, true);
  console.log("ok run preview browser warning policy");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
