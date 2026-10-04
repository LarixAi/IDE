"use strict";

function messageSize(message) {
  let total = String(message && message.content || "").length;
  const calls = Array.isArray(message && message.toolCalls) ? message.toolCalls : [];
  for (const call of calls) total += JSON.stringify(call || {}).length;
  return total;
}

function messageChars(messages) {
  return (Array.isArray(messages) ? messages : []).reduce((sum, message) => sum + messageSize(message), 0);
}

function compactToolMessage(message, maxChars) {
  const content = String(message && message.content || "");
  if (content.length <= maxChars) return { ...message };
  const first = content.split(/\r?\n/).find((line) => line.trim()) || "";
  const failed = /"ok"\s*:\s*false|\berror\b/i.test(content);
  return {
    ...message,
    content:
      (failed ? "ERROR" : "OK") +
      " [condensed " + content.length + " chars from " + String(message && message.name || "tool") + "]: " +
      first.slice(0, Math.max(80, maxChars - 120)),
  };
}

function compactAssistantMessage(message, maxChars) {
  const next = { ...message };
  const content = String(next.content || "");
  if (content.length > maxChars) next.content = content.slice(0, maxChars) + "\n…[condensed]";
  if (Array.isArray(next.toolCalls)) {
    next.toolCalls = next.toolCalls.map((call) => {
      const raw = call && (call.args || call.arguments) || {};
      const args = {};
      for (const [key, value] of Object.entries(raw)) {
        args[key] = typeof value === "string" && value.length > maxChars
          ? "[" + value.length + " chars omitted]"
          : value;
      }
      return { ...call, args };
    });
  }
  return next;
}

function condenseMessages(messages, options = {}) {
  const source = (Array.isArray(messages) ? messages : []).map((message) => ({ ...message }));
  const maxChars = Math.max(4000, Number(options.maxChars || 56000));
  const triggerRatio = Math.min(1, Math.max(0.5, Number(options.triggerRatio || 0.82)));
  const targetRatio = Math.min(triggerRatio, Math.max(0.35, Number(options.targetRatio || 0.64)));
  const keepRecent = Math.max(4, Number(options.keepRecent || 10));
  const maxItemChars = Math.max(700, Number(options.maxItemChars || 1800));
  const beforeChars = messageChars(source);

  if (beforeChars <= Math.floor(maxChars * triggerRatio)) {
    return {
      kind: "view",
      messages: source,
      beforeChars,
      afterChars: beforeChars,
      summarized: 0,
      changed: false,
    };
  }

  const firstSystem = source.findIndex((message) => message && message.role === "system");
  const firstUser = source.findIndex((message) => message && message.role === "user");
  const recentFrom = Math.max(firstUser + 1, source.length - keepRecent);
  let summarized = 0;

  let view = source.map((message, index) => {
    if (index === firstSystem || index === firstUser || index >= recentFrom) return { ...message };
    const content = String(message && message.content || "");
    if (message && message.role === "tool") {
      const next = compactToolMessage(message, maxItemChars);
      if (next.content !== content) summarized += 1;
      return next;
    }
    if (message && message.role === "assistant") {
      const next = compactAssistantMessage(message, maxItemChars);
      if (next.content !== content || JSON.stringify(next.toolCalls) !== JSON.stringify(message.toolCalls)) summarized += 1;
      return next;
    }
    if (content.length > maxItemChars) {
      summarized += 1;
      return { ...message, content: content.slice(0, maxItemChars) + "\n…[condensed]" };
    }
    return { ...message };
  });

  const targetChars = Math.floor(maxChars * targetRatio);
  let afterChars = messageChars(view);
  if (afterChars > targetChars) {
    const removable = [];
    for (let index = 0; index < recentFrom; index += 1) {
      if (index === firstSystem || index === firstUser) continue;
      removable.push(index);
    }
    for (const index of removable) {
      if (afterChars <= targetChars) break;
      const message = view[index];
      const size = messageSize(message);
      if (!size) continue;
      view[index] = {
        role: message && message.role === "tool" ? "tool" : "assistant",
        ...(message && message.name ? { name: message.name } : {}),
        content: "[Earlier event condensed; " + size + " chars omitted]",
      };
      summarized += 1;
      afterChars = messageChars(view);
    }
  }

  return {
    kind: "condensation",
    messages: view,
    beforeChars,
    afterChars: messageChars(view),
    summarized,
    changed: true,
  };
}

module.exports = {
  messageChars,
  condenseMessages,
};
