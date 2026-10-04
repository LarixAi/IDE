"use strict";

const { messageChars } = require("../context-condenser");

function compactToolOutput(content, maxChars) {
  const text = String(content || "");
  if (text.length <= maxChars) return text;
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const first = lines[0] || text.slice(0, Math.floor(maxChars * 0.65));
  const last = lines.length > 1 ? lines[lines.length - 1] : "";
  const prefix = /"ok"\s*:\s*false|\b(error|failed|failure|exception)\b/i.test(text)
    ? "ERROR"
    : "TOOL OUTPUT";
  const budget = Math.max(200, maxChars - 120);
  const summary = (first + (last && last !== first ? "\n…\n" + last : "")).slice(0, budget);
  return prefix + " [isolated " + text.length + " chars; raw result retained outside model view]\n" + summary;
}

function isolateArguments(toolCalls, maxArgumentChars) {
  let isolated = 0;
  let removedChars = 0;
  const calls = (Array.isArray(toolCalls) ? toolCalls : []).map((call) => {
    const raw = call && (call.args || call.arguments);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...call };
    const args = { ...raw };
    for (const [key, value] of Object.entries(args)) {
      if (typeof value !== "string" || value.length <= maxArgumentChars) continue;
      removedChars += value.length - 32;
      isolated += 1;
      args[key] = "[" + value.length + " chars isolated]";
    }
    return { ...call, args };
  });
  return { calls, isolated, removedChars };
}

function isolateContext(messages, options = {}) {
  const source = (Array.isArray(messages) ? messages : []).map((message) => ({ ...message }));
  const keepRecent = Math.max(4, Number(options.keepRecent || 8));
  const maxToolChars = Math.max(600, Number(options.maxToolChars || 2400));
  const maxArgumentChars = Math.max(400, Number(options.maxArgumentChars || 1600));
  const recentFrom = Math.max(0, source.length - keepRecent);
  const beforeChars = messageChars(source);
  let isolated = 0;
  let removedChars = 0;

  const view = source.map((message, index) => {
    const next = { ...message };
    if (index < recentFrom && next.role === "tool") {
      const content = String(next.content || "");
      const failure = /"ok"\s*:\s*false|\b(error|failed|failure|exception)\b/i.test(content);
      const limit = failure ? Math.max(maxToolChars, 3600) : maxToolChars;
      if (content.length > limit) {
        next.content = compactToolOutput(content, limit);
        isolated += 1;
        removedChars += Math.max(0, content.length - next.content.length);
      }
    }
    if (index < recentFrom && Array.isArray(next.toolCalls)) {
      const result = isolateArguments(next.toolCalls, maxArgumentChars);
      next.toolCalls = result.calls;
      isolated += result.isolated;
      removedChars += result.removedChars;
    }
    return next;
  });

  return {
    kind: isolated ? "isolation" : "view",
    messages: view,
    beforeChars,
    afterChars: messageChars(view),
    isolated,
    removedChars,
    changed: isolated > 0,
  };
}

module.exports = {
  isolateContext,
};
