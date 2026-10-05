"use strict";

const { ControlledToolProvider } = require("../../packages/agent-runtime/tool-registry");
const { callLogicalBrowserTool } = require("./browser-harness-logical-tools");

const LEGACY_BROWSER_TOOLS = new Set(["browser.check", "browser.interact"]);
const VERIFICATION_BLOCKED_TOOLS = new Set([
  "file.write",
  "file.patch",
  "dir.create",
  "terminal.run",
]);

class VerificationToolProvider extends ControlledToolProvider {
  constructor(host, options = {}) {
    super(host);
    this.legacyBrowserEnabled = options.legacyBrowserEnabled !== false;
    this.browserHarness = options.browserHarness || null;
  }

  definitions() {
    return super.definitions().filter(
      (tool) => !VERIFICATION_BLOCKED_TOOLS.has(tool.name),
    );
  }

  async call(name, args) {
    if (!this.legacyBrowserEnabled && LEGACY_BROWSER_TOOLS.has(name)) {
      return callLogicalBrowserTool(
        { host: this.host, browserHarness: this.browserHarness },
        name,
        args || {},
      );
    }
    if (VERIFICATION_BLOCKED_TOOLS.has(name)) {
      return {
        ok: false,
        tool: name,
        error: {
          code: "verification_role_mutation_blocked",
          message: "Verification roles may reproduce and verify but cannot mutate workspace source files or use the unrestricted terminal command tool.",
        },
      };
    }
    return super.call(name, args);
  }
}

module.exports = { VerificationToolProvider, VERIFICATION_BLOCKED_TOOLS };
