"use strict";

const { ControlledToolProvider } = require("../../packages/agent-runtime/tool-registry");

const SELF_TEST_MUTATIONS = new Set(["file.write", "file.patch"]);

function truthy(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || "").trim());
}

function diagnosticErrors(result) {
  const items = result && result.data && Array.isArray(result.data.items)
    ? result.data.items
    : [];
  return items.filter((item) => {
    const severity = item && item.severity;
    return severity === "error" || severity === 0 || severity === "Error";
  });
}

function compactDetail(result) {
  if (!result) return "No result";
  if (!result.ok) {
    return String(
      result.error && (result.error.message || result.error.code)
      || "Tool failed",
    ).slice(0, 800);
  }
  const data = result.data;
  if (data && typeof data === "object") {
    if (typeof data.output === "string" && data.output.trim()) return data.output.trim().slice(0, 800);
    if (typeof data.stdout === "string" && data.stdout.trim()) return data.stdout.trim().slice(0, 800);
    if (typeof data.status === "string") return data.status;
  }
  return "Passed";
}

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
    this.experimentalSelfTest = typeof options.experimentalSelfTest === "boolean"
      ? options.experimentalSelfTest
      : truthy(process.env.CODEME_EXPERIMENTAL_SELF_TEST);
  }

  async runPostMutationSelfTest() {
    const checks = [];

    const diagnostics = await super.call("diagnostics.run", {});
    const errors = diagnosticErrors(diagnostics);
    checks.push({
      name: "diagnostics.run",
      ok: Boolean(diagnostics && diagnostics.ok) && errors.length === 0,
      detail: errors.length
        ? errors.slice(0, 5).map((item) =>
          String(item.path || "") + ": " + String(item.message || "")
        ).join("\n")
        : compactDetail(diagnostics),
    });

    const workspace = await super.call("workspace.inspect", {});
    const scripts = workspace && workspace.ok
      && workspace.data
      && workspace.data.scripts
      && typeof workspace.data.scripts === "object"
      ? workspace.data.scripts
      : {};

    if (scripts.test) {
      const tests = await super.call("tests.run", { command: "npm test" });
      checks.push({
        name: "tests.run",
        ok: Boolean(tests && tests.ok),
        detail: compactDetail(tests),
      });
    }

    return {
      ok: checks.every((check) => check.ok),
      checks,
      requiresRepair: checks.some((check) => !check.ok),
      source: "codeme-tool-provider",
    };
  }

  async call(name, args) {
    const result = await super.call(name, args);
    if (
      !this.experimentalSelfTest
      || !SELF_TEST_MUTATIONS.has(name)
      || !result
      || !result.ok
    ) {
      return result;
    }

    const selfTest = await this.runPostMutationSelfTest();
    const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? result.data
      : {};

    return {
      ...result,
      data: {
        ...data,
        selfTest,
      },
    };
  }

  definitions() {
    return super.definitions().map((tool) => {
      if (!tool) return tool;

      if (tool.name === "file.write" || tool.name === "file.patch") {
        return {
          ...tool,
          description:
            String(tool.description || "")
            + " When CODEME_EXPERIMENTAL_SELF_TEST is enabled, a successful edit returns data.selfTest. "
            + "If data.selfTest.ok is false or requiresRepair is true, inspect the failed checks, repair the root cause, "
            + "and do not claim completion until a later edit/check passes.",
        };
      }

      if (tool.name !== "browser.check") return tool;
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
}

module.exports = { CodeMeControlledToolProvider };
