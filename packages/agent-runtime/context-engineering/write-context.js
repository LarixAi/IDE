"use strict";

function clip(value, maxChars) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length <= maxChars ? text : text.slice(0, maxChars) + "…";
}

function unique(values, limit = 20) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
}

function callArgs(call) {
  const value = call && (call.args || call.arguments);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function collectFilePaths(messages) {
  const paths = [];
  for (const message of messages) {
    const calls = Array.isArray(message && message.toolCalls) ? message.toolCalls : [];
    for (const call of calls) {
      const args = callArgs(call);
      for (const key of ["path", "file", "filepath", "file_path", "target"]) {
        if (typeof args[key] === "string") paths.push(args[key]);
      }
      if (Array.isArray(args.paths)) paths.push(...args.paths.filter((value) => typeof value === "string"));
    }
  }
  return unique(paths, 24);
}

function collectTools(messages) {
  const names = [];
  for (const message of messages) {
    const calls = Array.isArray(message && message.toolCalls) ? message.toolCalls : [];
    for (const call of calls) if (call && call.name) names.push(call.name);
    if (message && message.role === "tool" && message.name) names.push(message.name);
  }
  return unique(names, 24);
}

function isFailure(content) {
  return /"ok"\s*:\s*false|\b(error|failed|failure|exception)\b/i.test(String(content || ""));
}

function writeContext(messages, options = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const userMessages = source.filter((message) => message && message.role === "user");
  const firstUser = userMessages[0];
  const latestUser = userMessages[userMessages.length - 1];
  const failures = [];

  for (let index = source.length - 1; index >= 0 && failures.length < 4; index -= 1) {
    const message = source[index];
    if (!message || message.role !== "tool" || !isFailure(message.content)) continue;
    failures.push({
      tool: String(message.name || "tool"),
      detail: clip(message.content, 700),
    });
  }
  failures.reverse();

  const directives = userMessages
    .slice(-4)
    .map((message) => clip(message.content, 900))
    .filter(Boolean);

  return {
    goal: clip(options.goal || (firstUser && firstUser.content), 3000),
    focus: clip(latestUser && latestUser.content, 2200),
    directives,
    filePaths: collectFilePaths(source),
    toolsUsed: collectTools(source),
    failures,
  };
}

function scratchpadText(state) {
  if (!state || typeof state !== "object") return "";
  const lines = [];
  if (state.goal) lines.push("Goal: " + state.goal);
  if (state.focus && state.focus !== state.goal) lines.push("Current focus: " + state.focus);
  if (Array.isArray(state.filePaths) && state.filePaths.length) {
    lines.push("Relevant files seen: " + state.filePaths.slice(-10).join(", "));
  }
  if (Array.isArray(state.toolsUsed) && state.toolsUsed.length) {
    lines.push("Tools already used: " + state.toolsUsed.slice(-10).join(", "));
  }
  if (Array.isArray(state.failures) && state.failures.length) {
    lines.push(
      "Recent failures: " +
      state.failures.map((item) => item.tool + ": " + clip(item.detail, 220)).join(" | ")
    );
  }
  if (Array.isArray(state.directives) && state.directives.length > 1) {
    lines.push("Recent user directives: " + state.directives.slice(-3).join(" | "));
  }
  return lines.join("\n");
}

module.exports = {
  writeContext,
  scratchpadText,
};
