"use strict";

const assert = require("assert");
const { CodeMeControlledToolProvider } = require("../codeme-tool-provider");
const { DebugToolProvider } = require("../debug-tool-provider");
const { VerificationToolProvider } = require("../verification-tool-provider");

class FakeHarness {
  constructor() {
    this.calls = [];
  }

  async listTools() {
    return [{ name: "browser.harness" }];
  }

  async call(name, payload) {
    this.calls.push({ name, payload });
    const action = payload && payload.action;
    if (action === "goto" || action === "wait_for_load" || action === "wait") {
      return { ok: true, tool: name, data: { action, output: JSON.stringify({ ok: true }) } };
    }
    if (action === "js") {
      const expression = String(payload.args && payload.args.expression || "");
      if (expression.includes("target_not_found")) {
        return { ok: true, tool: name, data: { action, output: JSON.stringify({ ok: false, reason: "target_not_found" }) } };
      }
      if (expression.includes("el.click()")) {
        return {
          ok: true,
          tool: name,
          data: {
            action,
            output: JSON.stringify({ ok: true, text: "Save", before: "Before state" }),
          },
        };
      }
      return {
        ok: true,
        tool: name,
        data: {
          action,
          output: JSON.stringify({
            url: "http://127.0.0.1:4173/",
            title: "Test site",
            readyState: "complete",
            bodyPresent: true,
            selectorFound: true,
            selectedText: "It works",
            bodyText: "It works",
            expectedTextMatched: true,
          }),
        },
      };
    }
    if (action === "fill") {
      return { ok: true, tool: name, data: { action, output: JSON.stringify({ ok: true }) } };
    }
    return { ok: false, tool: name, error: { code: "unexpected_action", message: action } };
  }
}

const host = {
  browserCheck: async () => ({ available: true, engine: "legacy" }),
  browserInteract: async () => ({ available: true, engine: "legacy" }),
  processStatus: async () => ({
    found: true,
    status: "running",
    url: "http://127.0.0.1:4173/",
    origin: "http://127.0.0.1:4173",
  }),
};

function names(provider) {
  return provider.definitions().map((tool) => tool.name);
}

(async () => {
  for (const Provider of [CodeMeControlledToolProvider, DebugToolProvider, VerificationToolProvider]) {
    const harness = new FakeHarness();
    const harnessOnly = new Provider(host, {
      legacyBrowserEnabled: false,
      browserHarness: harness,
    });
    const harnessNames = names(harnessOnly);
    assert.ok(harnessNames.includes("browser.check"));
    assert.ok(harnessNames.includes("browser.interact"));

    const rollback = new Provider(host, { legacyBrowserEnabled: true, browserHarness: harness });
    const rollbackNames = names(rollback);
    assert.ok(rollbackNames.includes("browser.check"));
    assert.ok(rollbackNames.includes("browser.interact"));
  }

  const harness = new FakeHarness();
  const provider = new CodeMeControlledToolProvider(host, {
    legacyBrowserEnabled: false,
    browserHarness: harness,
  });

  const checked = await provider.call("browser.check", {
    selector: "body",
    expectedText: "It works",
  });
  assert.strictEqual(checked.ok, true);
  assert.strictEqual(checked.tool, "browser.check");
  assert.strictEqual(checked.data.engine, "browser-harness");
  assert.strictEqual(checked.data.expectedTextMatched, true);
  assert.ok(harness.calls.some((item) => item.payload.action === "goto"));
  assert.ok(harness.calls.some((item) => item.payload.action === "js"));

  const interacted = await provider.call("browser.interact", {
    action: "assertText",
    selector: "body",
    expectedText: "It works",
  });
  assert.strictEqual(interacted.ok, true);
  assert.strictEqual(interacted.tool, "browser.interact");
  assert.strictEqual(interacted.data.engine, "browser-harness");
  assert.strictEqual(interacted.data.matched, true);

  let legacyCalls = 0;
  const legacyProvider = new CodeMeControlledToolProvider({
    ...host,
    async browserCheck() {
      legacyCalls += 1;
      return { available: true, engine: "legacy" };
    },
  }, { legacyBrowserEnabled: true, browserHarness: harness });

  const legacy = await legacyProvider.call("browser.check", {});
  assert.strictEqual(legacy.ok, true);
  assert.strictEqual(legacy.data.engine, "legacy");
  assert.strictEqual(legacyCalls, 1);

  console.log("ok canonical browser verification tools remain available and route to Browser Harness in harness mode");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
