"use strict";

const { ControlledToolProvider } = require("../../packages/agent-runtime/tool-registry");

const LEGACY_BROWSER_TOOLS = new Set(["browser.check", "browser.interact"]);

/**
 * CodeMe-specific additions to the canonical controlled tool definitions.
 *
 * The canonical pipeline stays locked. This provider only extends the browser
 * tool contract so run/open-preview requests can distinguish presentation-only
 * asset warnings from failures that make the application unusable.
 */
class CodeMeControlledToolProvider extends ControlledToolProvider {
  constructor(host, options = {}) {
    super(host);
    this.legacyBrowserEnabled = options.legacyBrowserEnabled !== false;
  }

  definitions() {
    return super.definitions()
      .filter((tool) => this.legacyBrowserEnabled || !LEGACY_BROWSER_TOOLS.has(tool && tool.name))
      .map((tool) => {
      if (!tool || tool.name !== "browser.check") return tool;
      const parameters = tool.parameters && typeof tool.parameters === "object"
        ? tool.parameters
        : { type: "object", properties: {}, required: [] };
      return {
        ...tool,
        description:
          "Verify the current CodeMe-owned preview with HTTP readiness plus a real Chromium observation. "
          + "Call process.start first. URL is optional; when an owned preview is running CodeMe uses its canonical URL. "
          + "For a run/open-preview-only request (not a build/edit verification), set allowPresentationWarnings=true so missing images, fonts, or media are reported as warnings instead of making the preview fail. "
          + "Do not use that option to hide missing scripts, stylesheets, runtime errors, failed requested interactions, or missing assets that the user explicitly asked you to build.",
        parameters: {
          ...parameters,
          properties: {
            ...(parameters.properties || {}),
            allowPresentationWarnings: {
              type: "boolean",
              description:
                "Use true only when the user asked to run/open an existing website and presentation-only image/font/media 404s should be warnings. Leave false/default for build or edit verification.",
            },
          },
        },
      };
    });
  }

  async call(name, args) {
    if (!this.legacyBrowserEnabled && LEGACY_BROWSER_TOOLS.has(name)) {
      return {
        ok: false,
        tool: name,
        error: {
          code: "legacy_browser_disabled",
          message: "The legacy CodeMe browser runner is disabled while Browser Harness is under migration testing.",
        },
      };
    }
    return super.call(name, args);
  }
}

module.exports = { CodeMeControlledToolProvider, LEGACY_BROWSER_TOOLS };
