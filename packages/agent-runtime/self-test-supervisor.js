"use strict";

function truthy(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || "").trim());
}

function isExperimentalSelfTestEnabled(options = {}) {
  if (typeof options.experimentalSelfTest === "boolean") return options.experimentalSelfTest;
  return truthy(process.env.CODEME_EXPERIMENTAL_SELF_TEST);
}

function diagnosticErrors(result) {
  const items = result && result.data && Array.isArray(result.data.items) ? result.data.items : [];
  return items.filter((item) => {
    const severity = item && item.severity;
    return severity === "error" || severity === 0 || severity === "Error";
  });
}

function detailFor(result) {
  if (!result) return "No result";
  if (!result.ok) {
    return String(result.error && (result.error.message || result.error.code) || "Tool failed").slice(0, 800);
  }
  const data = result.data;
  if (data && typeof data === "object") {
    if (typeof data.output === "string" && data.output.trim()) return data.output.trim().slice(0, 800);
    if (typeof data.stdout === "string" && data.stdout.trim()) return data.stdout.trim().slice(0, 800);
    if (typeof data.status === "string") return data.status;
  }
  return "Passed";
}

async function guardedCall(registry, name, args) {
  try {
    return await registry.call(name, args || {});
  } catch (error) {
    return {
      ok: false,
      tool: name,
      error: {
        code: error && error.code ? String(error.code) : "self_test_tool_failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function runPostMutationSelfTest({ registry, workspace, definitions }) {
  const names = new Set((definitions || []).map((tool) => tool && tool.name).filter(Boolean));
  const records = [];

  if (names.has("diagnostics.run")) {
    const result = await guardedCall(registry, "diagnostics.run", {});
    const errors = diagnosticErrors(result);
    const ok = Boolean(result && result.ok) && errors.length === 0;
    records.push({
      name: "diagnostics.run",
      args: {},
      result,
      ok,
      detail: errors.length
        ? errors.slice(0, 5).map((item) => String(item.path || "") + ": " + String(item.message || "")).join("\n")
        : detailFor(result),
    });
  }

  const scripts = workspace && workspace.scripts && typeof workspace.scripts === "object"
    ? workspace.scripts
    : {};
  if (scripts.test && names.has("tests.run")) {
    const args = { command: "npm test" };
    const result = await guardedCall(registry, "tests.run", args);
    records.push({
      name: "tests.run",
      args,
      result,
      ok: Boolean(result && result.ok),
      detail: detailFor(result),
    });
  }

  if (!records.length) return null;

  const checks = records.map((record) => ({
    name: record.name,
    ok: record.ok,
    detail: record.detail,
  }));
  return {
    summary: {
      ok: checks.every((check) => check.ok),
      checks,
    },
    records,
  };
}

module.exports = {
  isExperimentalSelfTestEnabled,
  runPostMutationSelfTest,
  diagnosticErrors,
};
