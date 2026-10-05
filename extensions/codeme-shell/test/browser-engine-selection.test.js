const assert = require("assert");
const { CodeMeControlledToolProvider } = require("../codeme-tool-provider");
const { DebugToolProvider } = require("../debug-tool-provider");
const { VerificationToolProvider } = require("../verification-tool-provider");

const host = {
  browserCheck: async () => ({ available: true }),
  browserInteract: async () => ({ available: true }),
};

function names(provider) {
  return provider.definitions().map((tool) => tool.name);
}

for (const Provider of [CodeMeControlledToolProvider, DebugToolProvider, VerificationToolProvider]) {
  const harnessOnly = new Provider(host, { legacyBrowserEnabled: false });
  const harnessOnlyNames = names(harnessOnly);
  assert.ok(!harnessOnlyNames.includes("browser.check"));
  assert.ok(!harnessOnlyNames.includes("browser.interact"));

  const rollback = new Provider(host, { legacyBrowserEnabled: true });
  const rollbackNames = names(rollback);
  assert.ok(rollbackNames.includes("browser.check"));
  assert.ok(rollbackNames.includes("browser.interact"));
}

(async () => {
  const provider = new CodeMeControlledToolProvider(host, { legacyBrowserEnabled: false });
  const result = await provider.call("browser.check", {});
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, "legacy_browser_disabled");
  console.log("ok legacy browser tools are disabled in harness-only mode and recoverable by rollback setting");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
