"use strict";

const assert = require("assert");
const {
  ACTION_TO_TOOL,
  DEFAULT_COMMAND,
  DEFAULT_PACKAGE,
  OpenPencilProvider,
} = require("../openpencil-provider");

class FakeClient {
  constructor() {
    this.calls = [];
    this.closed = false;
  }

  async listTools() {
    return [
      { name: "list_documents" },
      { name: "new_document" },
      { name: "get_page_tree" },
      { name: "render" },
      { name: "set_layout" },
      { name: "set_fill" },
      { name: "lint" },
      { name: "export_svg" },
      { name: "eval" },
    ];
  }

  async callTool(name, args) {
    this.calls.push({ name, args });
    return { ok: true, output: JSON.stringify({ name, args }) };
  }

  close() {
    this.closed = true;
  }
}

(async () => {
  let created = 0;
  const disabled = new OpenPencilProvider({
    isEnabled: () => false,
    commandExists: () => true,
    createClient: () => {
      created += 1;
      return new FakeClient();
    },
  });
  assert.deepStrictEqual(await disabled.listTools(), []);
  assert.strictEqual(created, 0);
  assert.strictEqual(disabled.status().status, "disabled");

  const missing = new OpenPencilProvider({
    isEnabled: () => true,
    commandExists: () => false,
  });
  await assert.rejects(
    () => missing.listTools(),
    (error) => error && error.code === "openpencil_mcp_missing",
  );
  assert.strictEqual(missing.status().status, "unavailable");
  assert.match(missing.status().detail, /Install @open-pencil\/mcp/);

  const fake = new FakeClient();
  const provider = new OpenPencilProvider({
    isEnabled: () => true,
    getRoot: () => "/tmp/design-project",
    commandExists: () => true,
    createClient: (config) => {
      created += 1;
      assert.strictEqual(config.command, DEFAULT_COMMAND);
      assert.deepStrictEqual(config.args, []);
      assert.strictEqual(config.cwd, "/tmp/design-project");
      assert.strictEqual(config.env.OPENPENCIL_MCP_ROOT, "/tmp/design-project");
      return fake;
    },
  });

  const tools = await provider.listTools();
  assert.strictEqual(tools.length, 1);
  assert.strictEqual(tools[0].name, "design.openpencil");
  const actions = tools[0].parameters.properties.action.enum;
  assert.ok(actions.includes("render_ui"));
  assert.ok(actions.includes("page_tree"));
  assert.ok(actions.includes("set_layout"));
  assert.ok(actions.includes("lint"));
  assert.ok(actions.includes("export_svg"));
  assert.ok(!actions.includes("eval"), "raw eval is deliberately not exposed through CodeMe's compact adapter");
  assert.strictEqual(provider.status().status, "connected");
  assert.strictEqual(provider.status().packageSpec, DEFAULT_PACKAGE);

  const result = await provider.call("design.openpencil", {
    action: "render_ui",
    args: { jsx: "<Frame><Text>Dashboard</Text></Frame>" },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.trusted, false);
  assert.strictEqual(result.data.engine, "openpencil");
  assert.strictEqual(fake.calls[0].name, ACTION_TO_TOOL.render_ui);
  assert.deepStrictEqual(fake.calls[0].args, { jsx: "<Frame><Text>Dashboard</Text></Frame>" });

  const unsupported = await provider.call("design.openpencil", { action: "eval", args: {} });
  assert.strictEqual(unsupported.ok, false);
  assert.strictEqual(unsupported.error.code, "openpencil_action_unavailable");

  provider.close();
  assert.strictEqual(fake.closed, true);

  console.log("ok OpenPencil UI Designer adapter is bounded, local, and MCP-backed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
