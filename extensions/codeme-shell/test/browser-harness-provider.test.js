"use strict";

const assert = require("assert");
const { BrowserHarnessProvider, DEFAULT_PACKAGE } = require("../browser-harness-provider");

class FakeClient {
  constructor() {
    this.calls = [];
    this.closed = false;
  }
  async listTools() {
    return [
      { name: "browser_goto" },
      { name: "browser_page_info" },
      { name: "browser_click" },
      { name: "browser_screenshot" },
      { name: "browser_start_recording" },
      { name: "unrelated_tool" },
    ];
  }
  async callTool(name, args) {
    this.calls.push({ name, args });
    return { ok: true, output: JSON.stringify({ name, args }) };
  }
  close() { this.closed = true; }
}

(async () => {
  let created = 0;
  const disabled = new BrowserHarnessProvider({
    isEnabled: () => false,
    createClient: () => { created += 1; return new FakeClient(); },
  });
  assert.deepStrictEqual(await disabled.listTools(), []);
  assert.strictEqual(created, 0);
  assert.strictEqual(disabled.status().status, "disabled");

  const fake = new FakeClient();
  const provider = new BrowserHarnessProvider({
    isEnabled: () => true,
    createClient: (config) => {
      created += 1;
      assert.strictEqual(config.command, "uvx");
      assert.deepStrictEqual(config.args, ["--from", DEFAULT_PACKAGE, "browser-harness-mcp"]);
      return fake;
    },
  });

  const tools = await provider.listTools();
  assert.strictEqual(tools.length, 1);
  assert.strictEqual(tools[0].name, "browser.harness");
  assert.ok(tools[0].parameters.properties.action.enum.includes("goto"));
  assert.ok(tools[0].parameters.properties.action.enum.includes("page_info"));
  assert.ok(!tools[0].parameters.properties.action.enum.includes("start_recording"));
  assert.strictEqual(provider.status().status, "connected");
  assert.strictEqual(provider.status().activeEngine, "current");
  assert.strictEqual(provider.status().replacementReady, false);

  const result = await provider.call("browser.harness", {
    action: "goto",
    args: { url: "http://127.0.0.1:4173" },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.trusted, false);
  assert.strictEqual(fake.calls[0].name, "browser_goto");
  assert.deepStrictEqual(fake.calls[0].args, { url: "http://127.0.0.1:4173" });

  const recording = await provider.call("browser.harness", { action: "start_recording", args: {} });
  assert.strictEqual(recording.ok, false);
  assert.strictEqual(recording.error.code, "browser_harness_action_unavailable");

  provider.close();
  assert.strictEqual(fake.closed, true);

  const recordingProvider = new BrowserHarnessProvider({
    isEnabled: () => true,
    allowRecording: true,
    createClient: () => new FakeClient(),
  });
  const recordingTools = await recordingProvider.listTools();
  assert.ok(recordingTools[0].parameters.properties.action.enum.includes("start_recording"));

  console.log("ok Browser Harness candidate adapter is optional, bounded, and MCP-backed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
