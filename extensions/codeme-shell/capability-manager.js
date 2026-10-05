"use strict";

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function normalized(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

class CodeMeCapabilityManager {
  constructor(options = {}) {
    this.getRoot = typeof options.getRoot === "function" ? options.getRoot : () => "";
    this.loadSkills = typeof options.loadSkills === "function" ? options.loadSkills : () => [];
    this.getMcpRegistry = typeof options.getMcpRegistry === "function" ? options.getMcpRegistry : () => null;
    this.getNativeCapabilities = typeof options.getNativeCapabilities === "function"
      ? options.getNativeCapabilities
      : () => [];
  }

  catalog(query = "") {
    const items = [];
    const root = this.getRoot();

    if (root) {
      for (const skill of this.loadSkills(root) || []) {
        if (!skill || !skill.name) continue;
        items.push({
          id: "skill:" + skill.name,
          name: "/" + skill.name,
          kind: "skill",
          status: "available",
          connected: true,
          description: skill.description || "Reusable CodeMe skill.",
          source: skill.source || "builtin",
        });
      }
    }

    for (const native of this.getNativeCapabilities() || []) {
      if (!native || !native.name) continue;
      const status = native.status || "available";
      items.push({
        id: native.id || "native:" + normalized(native.name).replace(/\s+/g, "-"),
        name: native.name,
        kind: "native",
        status,
        connected: native.connected !== false && !["disabled", "unavailable"].includes(status),
        description: native.description || "",
      });
    }

    const registry = this.getMcpRegistry();
    if (registry && typeof registry.snapshot === "function") {
      const snapshot = registry.snapshot() || {};
      const servers = Array.isArray(snapshot.servers) ? snapshot.servers : [];
      const statuses = Array.isArray(snapshot.status) ? snapshot.status : [];
      const byId = new Map(statuses.map((item) => [String(item && item.id || ""), item]));

      for (const server of servers) {
        if (!server || !server.id) continue;
        const probe = byId.get(String(server.id));
        const enabled = server.enabled !== false;
        const status = !enabled
          ? "disabled"
          : probe && probe.ok
            ? "connected"
            : probe
              ? "unavailable"
              : "configured";
        items.push({
          id: String(server.id),
          name: server.name || server.id,
          kind: "mcp",
          status,
          connected: status === "connected",
          enabled,
          description: "MCP server via " + String(server.transport || "http"),
          transport: server.transport || "http",
          toolCount: probe && Number.isFinite(Number(probe.count)) ? Number(probe.count) : 0,
          error: probe && !probe.ok ? String(probe.error || "") : "",
        });
      }

      if (registry.primary && typeof registry.primary.snapshot === "function") {
        const primary = registry.primary.snapshot() || {};
        const probe = byId.get("n8n");
        const enabled = primary.mcpEnabled === true;
        items.push({
          id: "n8n",
          name: "n8n",
          kind: "mcp",
          status: !enabled ? "disabled" : probe && probe.ok ? "connected" : probe ? "unavailable" : "configured",
          connected: Boolean(enabled && probe && probe.ok),
          enabled,
          description: "Built-in n8n MCP integration.",
          toolCount: probe && Number.isFinite(Number(probe.count)) ? Number(probe.count) : 0,
          error: probe && !probe.ok ? String(probe.error || "") : "",
          builtIn: true,
        });
      }
    }

    const q = normalized(query);
    const filtered = q
      ? items.filter((item) => normalized([
          item.name,
          item.id,
          item.kind,
          item.description,
          item.status,
        ].join(" ")).includes(q))
      : items;

    return {
      items: filtered,
      counts: filtered.reduce((out, item) => {
        out.total += 1;
        out[item.kind] = (out[item.kind] || 0) + 1;
        out[item.status] = (out[item.status] || 0) + 1;
        return out;
      }, { total: 0 }),
    };
  }

  summary() {
    const items = this.catalog().items;
    const skills = items.filter((item) => item.kind === "skill");
    const native = items.filter((item) => item.kind === "native").slice(0, 6);
    const mcp = items.filter((item) => item.kind === "mcp").slice(0, 8);
    const parts = [
      skills.length + " skill" + (skills.length === 1 ? "" : "s"),
      native.length + " native helper" + (native.length === 1 ? "" : "s"),
      mcp.length + " configured MCP connection" + (mcp.length === 1 ? "" : "s"),
    ];
    if (native.length) parts.push("native: " + native.map((item) => item.name + "=" + item.status).join(", "));
    if (mcp.length) parts.push("MCP: " + mcp.map((item) => item.name + "=" + item.status).join(", "));
    return parts.join(" · ").slice(0, 1200);
  }

  listTools() {
    return [
      {
        name: "codeme.capabilities",
        description:
          "Inspect CodeMe's live skills, native helpers, and configured MCP connections. "
          + "Use this when a task may benefit from an extra integration. If a useful external capability is disconnected, "
          + "disabled, unavailable, or not configured, do not pretend it is connected; use codeme.request_connection. "
          + "Current catalog: " + this.summary(),
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Optional service, skill, or integration name to filter for." },
          },
          required: [],
        },
      },
      {
        name: "codeme.request_connection",
        description:
          "Request user action for an external capability. This never authenticates, grants permission, or connects a service. "
          + "If user_action_required is returned, explain the benefit and ask the user to connect/configure it in "
          + "CodeMe Settings > Capabilities & MCP. Internal skills and native helpers can be used directly.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Capability or integration name." },
            reason: { type: "string", description: "Why the capability would help." },
          },
          required: ["name"],
        },
      },
    ];
  }

  find(name) {
    const wanted = normalized(name);
    if (!wanted) return null;
    const items = this.catalog().items;
    return items.find((item) => normalized(item.name) === wanted || normalized(item.id) === wanted)
      || items.find((item) => normalized(item.name).includes(wanted) || wanted.includes(normalized(item.name)));
  }

  async call(name, args = {}) {
    if (name === "codeme.capabilities") {
      return {
        ok: true,
        tool: name,
        trusted: true,
        data: {
          ...this.catalog(args.query || ""),
          guidance:
            "Use connected skills/native helpers directly. For disconnected external capabilities, request user action. "
            + "If a needed integration is not listed, codeme.request_connection can still request it by name.",
        },
      };
    }

    if (name !== "codeme.request_connection") {
      return {
        ok: false,
        tool: name,
        trusted: true,
        error: { code: "unknown_tool", message: "Unknown capability-manager tool " + name },
      };
    }

    const requested = clean(args.name);
    if (!requested) {
      return {
        ok: false,
        tool: name,
        trusted: true,
        error: { code: "invalid_args", message: "Capability name is required." },
      };
    }

    const item = this.find(requested);
    if (!item) {
      return {
        ok: true,
        tool: name,
        trusted: true,
        data: {
          status: "user_action_required",
          userActionRequired: true,
          capability: requested,
          connectionState: "not_configured",
          reason: clean(args.reason),
          action: "open_settings",
          settingsPanel: "mcp",
          message:
            "No saved connection named " + requested + ". Ask the user whether they want to configure it in "
            + "CodeMe Settings > Capabilities & MCP. Do not claim it is connected.",
        },
      };
    }

    if (item.kind === "skill" || item.kind === "native") {
      return {
        ok: true,
        tool: name,
        trusted: true,
        data: {
          status: "available",
          userActionRequired: false,
          capability: item.name,
          connectionState: item.status,
          action: "use_directly",
          message: item.name + " is internal to CodeMe and does not require an external connection.",
        },
      };
    }

    if (item.connected) {
      return {
        ok: true,
        tool: name,
        trusted: true,
        data: {
          status: "already_connected",
          userActionRequired: false,
          capability: item.name,
          connectionState: item.status,
          action: "use_connected_tools",
          message: item.name + " is already connected.",
        },
      };
    }

    return {
      ok: true,
      tool: name,
      trusted: true,
      data: {
        status: "user_action_required",
        userActionRequired: true,
        capability: item.name,
        capabilityId: item.id,
        connectionState: item.status,
        reason: clean(args.reason),
        action: "open_settings",
        settingsPanel: "mcp",
        message:
          item.name + " is " + item.status + ". Explain why it would help and ask the user to connect or enable it "
          + "in CodeMe Settings > Capabilities & MCP. Do not continue as if it were connected.",
      },
    };
  }
}

module.exports = { CodeMeCapabilityManager, normalized };
