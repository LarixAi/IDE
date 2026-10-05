"use strict";

const fs = require("fs");
const path = require("path");
const { StdioMcpClient } = require("./universal-mcp");

const DEFAULT_PACKAGE = "@open-pencil/mcp@0.15.1";
const DEFAULT_COMMAND = "openpencil-mcp";

const ACTION_TO_TOOL = Object.freeze({
  list_documents: "list_documents",
  new_document: "new_document",
  open_file: "open_file",
  save_file: "save_file",
  list_pages: "list_pages",
  switch_page: "switch_page",
  page_tree: "get_page_tree",
  selection: "get_selection",
  find_nodes: "find_nodes",
  get_node: "get_node",
  components: "get_components",
  render_ui: "render",
  create_shape: "create_shape",
  update_node: "update_node",
  set_layout: "set_layout",
  set_fill: "set_fill",
  set_stroke: "set_stroke",
  set_text: "set_text",
  create_component: "create_component",
  lint: "lint",
  analyze_colors: "analyze_colors",
  analyze_typography: "analyze_typography",
  analyze_spacing: "analyze_spacing",
  export_svg: "export_svg",
  undo: "undo",
  redo: "redo",
});

function envEnabled(name, fallback = false) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function findExecutable(command, searchPath = process.env.PATH) {
  const raw = String(command || "").trim();
  if (!raw) return "";
  if (path.isAbsolute(raw)) {
    try {
      fs.accessSync(raw, fs.constants.X_OK);
      return raw;
    } catch {
      return "";
    }
  }
  const suffixes = process.platform === "win32" ? ["", ".cmd", ".exe", ".bat"] : [""];
  for (const directory of String(searchPath || "").split(path.delimiter).filter(Boolean)) {
    for (const suffix of suffixes) {
      const candidate = path.join(directory, raw + suffix);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return "";
}

class OpenPencilProvider {
  constructor(options = {}) {
    this.isEnabled = typeof options.isEnabled === "function"
      ? options.isEnabled
      : () => envEnabled("CODEME_OPENPENCIL_ENABLED", true);
    this.getRoot = typeof options.getRoot === "function"
      ? options.getRoot
      : () => process.cwd();
    this.command = String(
      options.command
      || process.env.CODEME_OPENPENCIL_MCP_COMMAND
      || DEFAULT_COMMAND,
    );
    this.commandExists = typeof options.commandExists === "function"
      ? options.commandExists
      : (command) => Boolean(findExecutable(command));
    this.createClient = typeof options.createClient === "function"
      ? options.createClient
      : (config) => new StdioMcpClient(config);
    this.client = null;
    this.clientRoot = "";
    this.availableActions = [];
    this.connected = false;
    this.lastError = "";
  }

  enabled() {
    try {
      return this.isEnabled() === true;
    } catch {
      return false;
    }
  }

  root() {
    const candidate = String(this.getRoot() || "").trim();
    return candidate || process.cwd();
  }

  ensureClient() {
    const root = this.root();
    if (this.client && this.clientRoot === root) return this.client;
    this.close();
    this.clientRoot = root;
    this.client = this.createClient({
      command: this.command,
      args: [],
      cwd: root,
      env: {
        OPENPENCIL_MCP_ROOT: root,
      },
    });
    return this.client;
  }

  async listTools(signal) {
    if (!this.enabled()) {
      this.connected = false;
      this.availableActions = [];
      this.lastError = "";
      return [];
    }

    if (!this.commandExists(this.command)) {
      this.connected = false;
      this.availableActions = [];
      this.lastError =
        "OpenPencil MCP is not installed. Install " + DEFAULT_PACKAGE
        + " and run the OpenPencil desktop app with a design document open.";
      throw Object.assign(new Error(this.lastError), { code: "openpencil_mcp_missing" });
    }

    try {
      const upstream = await this.ensureClient().listTools(signal);
      const discovered = new Set((upstream || []).map((tool) => String(tool && tool.name || "")));
      this.availableActions = Object.entries(ACTION_TO_TOOL)
        .filter(([, toolName]) => discovered.has(toolName))
        .map(([action]) => action);

      if (!this.availableActions.length) {
        throw Object.assign(
          new Error(
            "OpenPencil MCP connected but no supported design tools were discovered. "
            + "Make sure the OpenPencil desktop app is running with a document open.",
          ),
          { code: "openpencil_no_tools" },
        );
      }

      this.connected = true;
      this.lastError = "";
      return [{
        name: "design.openpencil",
        description:
          "Use OpenPencil as CodeMe's UI/vector design canvas. "
          + "Create or inspect design documents, render whole UI trees, edit layout/styles/components, "
          + "lint design quality, analyze tokens, and export SVG. "
          + "Use this for visual UI design before or alongside implementation. "
          + "The OpenPencil desktop app must be running locally with a document available.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: this.availableActions,
              description: "Bounded OpenPencil design action.",
            },
            args: {
              type: "object",
              description: "Arguments forwarded to the selected OpenPencil MCP tool.",
              additionalProperties: true,
            },
          },
          required: ["action"],
        },
      }];
    } catch (error) {
      this.connected = false;
      this.availableActions = [];
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async call(name, args = {}, signal) {
    if (name !== "design.openpencil") {
      return {
        ok: false,
        tool: name,
        trusted: false,
        error: { code: "unknown_tool", message: "Unknown OpenPencil tool " + name },
      };
    }

    if (!this.enabled()) {
      return {
        ok: false,
        tool: name,
        trusted: false,
        error: { code: "openpencil_disabled", message: "OpenPencil UI Designer is disabled in CodeMe settings." },
      };
    }

    const action = String(args.action || "").trim();
    if (!this.availableActions.includes(action)) {
      try { await this.listTools(signal); } catch {}
    }

    if (!this.availableActions.includes(action)) {
      return {
        ok: false,
        tool: name,
        trusted: false,
        error: {
          code: "openpencil_action_unavailable",
          message: "OpenPencil design action is unavailable: " + (action || "(missing)"),
        },
      };
    }

    const input = args.args && typeof args.args === "object" && !Array.isArray(args.args)
      ? args.args
      : {};

    try {
      const result = await this.ensureClient().callTool(ACTION_TO_TOOL[action], input, signal);
      if (!result || !result.ok) {
        return {
          ok: false,
          tool: name,
          trusted: false,
          error: {
            code: "openpencil_failed",
            message: String(result && result.output || "OpenPencil design action failed."),
          },
          data: {
            action,
            output: String(result && result.output || "").slice(0, 16000),
            engine: "openpencil",
          },
        };
      }

      this.connected = true;
      this.lastError = "";
      return {
        ok: true,
        tool: name,
        trusted: false,
        data: {
          action,
          output: String(result.output || "").slice(0, 16000),
          engine: "openpencil",
          packageSpec: DEFAULT_PACKAGE,
        },
      };
    } catch (error) {
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        tool: name,
        trusted: false,
        error: { code: "openpencil_failed", message: this.lastError },
      };
    }
  }

  status() {
    const enabled = this.enabled();
    const commandAvailable = enabled && this.commandExists(this.command);
    const status = !enabled
      ? "disabled"
      : this.connected
        ? "connected"
        : this.lastError
          ? "unavailable"
          : commandAvailable
            ? "configured"
            : "setup_required";

    return {
      enabled,
      connected: enabled && this.connected,
      status,
      detail: !enabled
        ? "OpenPencil UI Designer is disabled."
        : this.connected
          ? "OpenPencil MCP is connected. CodeMe can inspect and edit the active design."
          : this.lastError
            ? this.lastError
            : commandAvailable
              ? "OpenPencil MCP is installed and will connect when the designer is used."
              : "Install @open-pencil/mcp and start the OpenPencil desktop app to enable UI design.",
      command: this.command,
      commandAvailable,
      packageSpec: DEFAULT_PACKAGE,
      actions: this.availableActions.slice(),
      source: "vendor/open-pencil",
      root: this.root(),
    };
  }

  close() {
    if (this.client && typeof this.client.close === "function") {
      try { this.client.close(); } catch {}
    }
    this.client = null;
    this.clientRoot = "";
    this.connected = false;
    this.availableActions = [];
  }
}

module.exports = {
  ACTION_TO_TOOL,
  DEFAULT_COMMAND,
  DEFAULT_PACKAGE,
  OpenPencilProvider,
  findExecutable,
};
