"use strict";

const { StdioMcpClient } = require("./universal-mcp");

const DEFAULT_PACKAGE = "browser-harness[mcp]==0.1.13";
const ACTION_TO_TOOL = Object.freeze({
  new_tab: "browser_new_tab",
  goto: "browser_goto",
  page_info: "browser_page_info",
  click: "browser_click",
  type: "browser_type",
  fill: "browser_fill",
  press: "browser_press",
  scroll: "browser_scroll",
  screenshot: "browser_screenshot",
  list_tabs: "browser_list_tabs",
  current_tab: "browser_current_tab",
  switch_tab: "browser_switch_tab",
  close_tab: "browser_close_tab",
  ensure_real_tab: "browser_ensure_real_tab",
  wait: "browser_wait",
  wait_for_load: "browser_wait_for_load",
  wait_for_element: "browser_wait_for_element",
  js: "browser_js",
  cdp: "browser_cdp",
  http_get: "browser_http_get",
  upload_file: "browser_upload_file",
  start_recording: "browser_start_recording",
  stop_recording: "browser_stop_recording",
});

function envEnabled(name, fallback = false) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

class BrowserHarnessProvider {
  constructor(options = {}) {
    this.isEnabled = typeof options.isEnabled === "function"
      ? options.isEnabled
      : () => envEnabled("CODEME_BROWSER_HARNESS_ENABLED", false);
    this.allowRecording = options.allowRecording !== undefined
      ? Boolean(options.allowRecording)
      : envEnabled("CODEME_BROWSER_HARNESS_ALLOW_RECORDING", false);
    this.command = String(options.command || process.env.CODEME_BROWSER_HARNESS_COMMAND || "uvx");
    this.packageSpec = String(options.packageSpec || process.env.CODEME_BROWSER_HARNESS_PACKAGE || DEFAULT_PACKAGE);
    this.createClient = typeof options.createClient === "function"
      ? options.createClient
      : (config) => new StdioMcpClient(config);
    this.client = null;
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

  ensureClient() {
    if (this.client) return this.client;
    this.client = this.createClient({
      command: this.command,
      args: ["--from", this.packageSpec, "browser-harness-mcp"],
    });
    return this.client;
  }

  permittedAction(action) {
    if (!this.allowRecording && (action === "start_recording" || action === "stop_recording")) return false;
    return Object.prototype.hasOwnProperty.call(ACTION_TO_TOOL, action);
  }

  async listTools(signal) {
    if (!this.enabled()) {
      this.connected = false;
      this.lastError = "";
      this.availableActions = [];
      return [];
    }

    try {
      const upstream = await this.ensureClient().listTools(signal);
      const discovered = new Set((upstream || []).map((tool) => String(tool && tool.name || "")));
      this.availableActions = Object.entries(ACTION_TO_TOOL)
        .filter(([action, toolName]) => this.permittedAction(action) && discovered.has(toolName))
        .map(([action]) => action);

      if (!this.availableActions.length) {
        throw Object.assign(
          new Error("Browser Harness MCP connected but did not expose any supported browser helpers."),
          { code: "browser_harness_no_tools" },
        );
      }

      this.connected = true;
      this.lastError = "";
      return [{
        name: "browser.harness",
        description:
          "Experimental Browser Harness candidate for autonomous browser diagnosis and interaction. "
          + "Use it during the migration test phase to inspect and control the real browser, reproduce UI failures, "
          + "collect browser evidence, and then repair code with CodeMe's normal file/terminal tools. "
          + "The existing browser.check remains the authoritative completion gate until the replacement test plan passes.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: this.availableActions,
              description: "Browser Harness action to perform.",
            },
            args: {
              type: "object",
              description: "Arguments forwarded to the selected Browser Harness MCP helper.",
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
    if (name !== "browser.harness") {
      return {
        ok: false,
        tool: name,
        trusted: false,
        error: { code: "unknown_tool", message: "Unknown Browser Harness tool " + name },
      };
    }
    if (!this.enabled()) {
      return {
        ok: false,
        tool: name,
        trusted: false,
        error: { code: "browser_harness_disabled", message: "Browser Harness candidate is disabled in CodeMe settings." },
      };
    }

    const action = String(args.action || "").trim();
    if (!this.availableActions.includes(action)) {
      try { await this.listTools(signal); } catch {}
    }
    if (!this.availableActions.includes(action) || !this.permittedAction(action)) {
      return {
        ok: false,
        tool: name,
        trusted: false,
        error: {
          code: "browser_harness_action_unavailable",
          message: "Browser Harness action is unavailable: " + (action || "(missing)"),
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
            code: "browser_harness_failed",
            message: String(result && result.output || "Browser Harness action failed."),
          },
          data: { action, output: String(result && result.output || "").slice(0, 16000) },
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
          engine: "browser-harness",
          candidate: true,
        },
      };
    } catch (error) {
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        tool: name,
        trusted: false,
        error: { code: "browser_harness_failed", message: this.lastError },
      };
    }
  }

  status() {
    const enabled = this.enabled();
    const status = !enabled
      ? "disabled"
      : this.connected
        ? "connected"
        : this.lastError
          ? "unavailable"
          : "configured";
    return {
      enabled,
      connected: enabled && this.connected,
      status,
      detail: !enabled
        ? "Browser Harness candidate is disabled. The current CodeMe browser runner remains active."
        : this.connected
          ? "Browser Harness MCP is connected and available for migration testing."
          : this.lastError
            ? this.lastError
            : "Browser Harness candidate is enabled and will be probed through MCP.",
      command: this.command,
      packageSpec: this.packageSpec,
      actions: this.availableActions.slice(),
      allowRecording: this.allowRecording,
      activeEngine: "current",
      replacementReady: false,
    };
  }

  close() {
    if (this.client && typeof this.client.close === "function") {
      try { this.client.close(); } catch {}
    }
    this.client = null;
    this.connected = false;
    this.availableActions = [];
  }
}

module.exports = {
  BrowserHarnessProvider,
  ACTION_TO_TOOL,
  DEFAULT_PACKAGE,
};
