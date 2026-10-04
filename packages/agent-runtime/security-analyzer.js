"use strict";

const LOW_RISK_TOOLS = new Set([
  "workspace.inspect",
  "dir.list",
  "file.read",
  "document.read",
  "repo.search",
  "git.status",
  "git.diff",
  "diagnostics.run",
  "memory.recall",
  "capability.list",
]);

const MUTATION_TOOLS = new Set([
  "file.write",
  "file.patch",
  "document.create",
  "document.edit",
  "dir.create",
]);

const HIGH_RISK_COMMAND = /(?:^|\s)(?:sudo\s+|rm\s+-rf\b|git\s+reset\s+--hard\b|git\s+clean\s+-[^\n]*f|shutdown\b|reboot\b|mkfs\b|dd\s+if=|curl\b[^\n|]*\|\s*(?:sh|bash)\b|wget\b[^\n|]*\|\s*(?:sh|bash)\b)/i;

function analyzeAction(call, context = {}) {
  const name = String(call && call.name || "");
  const args = call && call.args && typeof call.args === "object" ? call.args : {};
  let level = "medium";
  const reasons = [];

  if (LOW_RISK_TOOLS.has(name)) {
    level = "low";
    reasons.push("read-only or inspection tool");
  } else if (MUTATION_TOOLS.has(name)) {
    level = "medium";
    reasons.push("workspace mutation");
  } else if (name === "terminal.run" || name === "sandbox.run" || name === "process.start") {
    const command = String(args.command || args.cmd || "");
    if (HIGH_RISK_COMMAND.test(command)) {
      level = "high";
      reasons.push("potentially destructive shell command");
    } else {
      level = "medium";
      reasons.push("process or shell execution");
    }
  } else if (name === "browser.interact") {
    level = "medium";
    reasons.push("browser interaction");
  } else if (name.startsWith("capability.") || context.external === true) {
    level = "medium";
    reasons.push("external capability");
  } else {
    reasons.push("tool effect requires monitoring");
  }

  return {
    level,
    reasons,
    tool: name,
    mode: String(context.mode || ""),
  };
}

function requiresConfirmation(analysis, policy = "direct") {
  if (!analysis) return false;
  if (policy === "all_actions") return true;
  if (policy === "mutations") return analysis.level !== "low";
  if (policy === "high_risk") return analysis.level === "high";
  return false;
}

module.exports = {
  LOW_RISK_TOOLS,
  MUTATION_TOOLS,
  analyzeAction,
  requiresConfirmation,
};
