"use strict";

const { messageChars } = require("../context-condenser");

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "been", "before", "being", "build", "could",
  "from", "have", "into", "just", "like", "make", "more", "only", "please", "should",
  "some", "than", "that", "their", "them", "then", "there", "these", "they", "this",
  "through", "user", "using", "want", "what", "when", "where", "which", "with", "would",
]);

function messageSize(message) {
  let total = String(message && message.content || "").length;
  if (Array.isArray(message && message.toolCalls)) total += JSON.stringify(message.toolCalls).length;
  return total;
}

function terms(text) {
  const values = String(text || "")
    .toLowerCase()
    .match(/[a-z0-9_./-]{3,}/g) || [];
  return new Set(values.filter((value) => !STOP_WORDS.has(value)));
}

function messageText(message) {
  const content = String(message && message.content || "");
  const calls = Array.isArray(message && message.toolCalls) ? JSON.stringify(message.toolCalls) : "";
  return content + "\n" + calls;
}

function relevanceScore(message, queryTerms, state) {
  const haystack = messageText(message).toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (haystack.includes(term)) score += term.includes("/") || term.includes(".") ? 4 : 1;
  }
  if (message && message.role === "user") score += 2;
  if (/"ok"\s*:\s*false|\b(error|failed|failure)\b/i.test(haystack)) score += 3;
  for (const filePath of state.filePaths || []) {
    if (filePath && haystack.includes(String(filePath).toLowerCase())) score += 5;
  }
  return score;
}

function expandToolPairs(source, keep) {
  const expanded = new Set(keep);
  for (const index of [...keep]) {
    const message = source[index];
    if (!message) continue;
    if (message.role === "tool" && index > 0) {
      const previous = source[index - 1];
      if (previous && previous.role === "assistant" && Array.isArray(previous.toolCalls) && previous.toolCalls.length) {
        expanded.add(index - 1);
      }
    }
    if (message.role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      for (let cursor = index + 1; cursor < source.length && source[cursor] && source[cursor].role === "tool"; cursor += 1) {
        expanded.add(cursor);
      }
    }
  }
  return expanded;
}

function selectContext(messages, state = {}, options = {}) {
  const source = (Array.isArray(messages) ? messages : []).map((message) => ({ ...message }));
  const maxChars = Math.max(4000, Number(options.maxChars || 56000));
  const triggerRatio = Math.min(0.95, Math.max(0.45, Number(options.triggerRatio || 0.72)));
  const targetRatio = Math.min(triggerRatio, Math.max(0.35, Number(options.targetRatio || 0.58)));
  const keepRecent = Math.max(4, Number(options.keepRecent || 12));
  const beforeChars = messageChars(source);

  if (beforeChars <= Math.floor(maxChars * triggerRatio)) {
    return {
      kind: "view",
      messages: source,
      beforeChars,
      afterChars: beforeChars,
      dropped: 0,
      changed: false,
    };
  }

  const keep = new Set();
  const firstUser = source.findIndex((message) => message && message.role === "user");
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] && source[index].role === "system") keep.add(index);
  }
  if (firstUser >= 0) keep.add(firstUser);

  const recentFrom = Math.max(0, source.length - keepRecent);
  for (let index = recentFrom; index < source.length; index += 1) keep.add(index);

  const queryTerms = terms([
    state.goal || "",
    state.focus || "",
    ...(state.filePaths || []),
    ...(state.directives || []).slice(-2),
  ].join("\n"));

  const candidates = [];
  for (let index = 0; index < recentFrom; index += 1) {
    if (keep.has(index)) continue;
    const score = relevanceScore(source[index], queryTerms, state);
    if (score > 0) candidates.push({ index, score, size: messageSize(source[index]) });
  }
  candidates.sort((a, b) => b.score - a.score || b.index - a.index);

  const targetChars = Math.floor(maxChars * targetRatio);
  let selectedChars = [...keep].reduce((sum, index) => sum + messageSize(source[index]), 0);
  for (const candidate of candidates) {
    if (selectedChars >= targetChars) break;
    if (selectedChars + candidate.size > targetChars && selectedChars > targetChars * 0.8) continue;
    keep.add(candidate.index);
    selectedChars += candidate.size;
  }

  const paired = expandToolPairs(source, keep);
  const selected = source.filter((_, index) => paired.has(index));
  return {
    kind: "selection",
    messages: selected,
    beforeChars,
    afterChars: messageChars(selected),
    dropped: source.length - selected.length,
    changed: selected.length !== source.length,
  };
}

module.exports = {
  selectContext,
};
