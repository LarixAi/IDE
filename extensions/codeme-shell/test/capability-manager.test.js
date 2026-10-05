"use strict";

const assert = require("assert");
const { CodeMeCapabilityManager } = require("../capability-manager");

const registry = {
  primary: { snapshot() { return { mcpEnabled: false }; } },
  snapshot() {
    return {
      servers: [
        { id: "github", name: "GitHub", enabled: true, transport: "http" },
        { id: "supabase", name: "Supabase", enabled: false, transport: "http" },
      ],
      status: [{ id: "github", name: "GitHub", ok: true, count: 4, transport: "http" }],
    };
  },
};

const manager = new CodeMeCapabilityManager({
  getRoot: () => "/tmp/demo",
  loadSkills: () => [
    { name: "fix-terminal-error", description: "Repair terminal failures", source: "builtin" },
  ],
  getMcpRegistry: () => registry,
  getNativeCapabilities: () => [
    { id: "research-engineer", name: "Research Engineer", status: "connected", connected: true },
    { id: "project-brain", name: "Project Brain", status: "connected", connected: true },
  ],
});

(async () => {
  const definitions = manager.listTools();
  assert.deepStrictEqual(definitions.map((item) => item.name), [
    "codeme.capabilities",
    "codeme.request_connection",
  ]);
  assert.match(definitions[0].description, /GitHub=connected/);
  assert.match(definitions[0].description, /Supabase=disabled/);

  const catalog = await manager.call("codeme.capabilities", {});
  assert.strictEqual(catalog.ok, true);
  assert.ok(catalog.data.items.some((item) => item.name === "/fix-terminal-error"));
  assert.ok(catalog.data.items.some((item) => item.name === "Research Engineer"));
  assert.ok(catalog.data.items.some((item) => item.name === "GitHub" && item.status === "connected"));
  assert.ok(catalog.data.items.some((item) => item.name === "Supabase" && item.status === "disabled"));

  const filtered = await manager.call("codeme.capabilities", { query: "github" });
  assert.strictEqual(filtered.data.items.length, 1);
  assert.strictEqual(filtered.data.items[0].name, "GitHub");

  const connected = await manager.call("codeme.request_connection", { name: "GitHub", reason: "Inspect issues" });
  assert.strictEqual(connected.data.status, "already_connected");
  assert.strictEqual(connected.data.userActionRequired, false);

  const disabled = await manager.call("codeme.request_connection", { name: "Supabase", reason: "Inspect schema" });
  assert.strictEqual(disabled.data.status, "user_action_required");
  assert.strictEqual(disabled.data.connectionState, "disabled");
  assert.match(disabled.data.message, /do not continue/i);

  const skill = await manager.call("codeme.request_connection", { name: "fix-terminal-error" });
  assert.strictEqual(skill.data.action, "use_directly");
  assert.strictEqual(skill.data.userActionRequired, false);

  const missing = await manager.call("codeme.request_connection", { name: "Jira", reason: "Read ticket" });
  assert.strictEqual(missing.data.connectionState, "not_configured");
  assert.strictEqual(missing.data.userActionRequired, true);

  console.log("ok capability manager exposes live capabilities and safe connection requests");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
