"use strict";

const { messageChars } = require("../context-condenser");
const { writeContext, scratchpadText } = require("./write-context");
const { selectContext } = require("./select-context");
const { isolateContext } = require("./isolate-context");
const { compressContext } = require("./compress-context");

const SCRATCHPAD_HEADER = "## CodeMe context engineering scratchpad";

function attachScratchpad(messages, state) {
  const note = scratchpadText(state);
  const source = (Array.isArray(messages) ? messages : []).map((message) => ({ ...message }));
  if (!note) return source;

  const block = SCRATCHPAD_HEADER + "\n" + note;
  const systemIndex = source.findIndex((message) => message && message.role === "system");
  if (systemIndex >= 0) {
    const current = String(source[systemIndex].content || "");
    if (!current.includes(SCRATCHPAD_HEADER)) {
      source[systemIndex] = { ...source[systemIndex], content: current + "\n\n" + block };
    }
    return source;
  }

  source.unshift({ role: "system", content: block });
  return source;
}

function engineerContext(messages, options = {}) {
  const source = (Array.isArray(messages) ? messages : []).map((message) => ({ ...message }));
  const maxChars = Math.max(4000, Number(options.maxChars || 56000));
  const beforeChars = messageChars(source);

  const written = writeContext(source, { goal: options.goal });
  const selection = selectContext(source, written, {
    maxChars,
    triggerRatio: options.selectTriggerRatio,
    targetRatio: options.selectTargetRatio,
    keepRecent: options.keepRecent,
  });
  const isolation = isolateContext(selection.messages, {
    keepRecent: options.keepRecent,
    maxToolChars: options.maxToolChars,
    maxArgumentChars: options.maxArgumentChars,
  });

  const structuralChange = selection.changed || isolation.changed;
  const stagedMessages = structuralChange && options.injectScratchpad !== false
    ? attachScratchpad(isolation.messages, written)
    : isolation.messages;

  const compression = compressContext(stagedMessages, {
    maxChars,
    triggerRatio: options.compressTriggerRatio,
    targetRatio: options.compressTargetRatio,
    keepRecent: options.keepRecent,
    maxItemChars: options.maxItemChars,
  });

  return {
    messages: compression.messages,
    state: written,
    write: {
      goal: Boolean(written.goal),
      directives: written.directives.length,
      files: written.filePaths.length,
      tools: written.toolsUsed.length,
      failures: written.failures.length,
    },
    selection,
    isolation,
    compression,
    beforeChars,
    afterChars: messageChars(compression.messages),
    changed: structuralChange || compression.changed,
  };
}

module.exports = {
  SCRATCHPAD_HEADER,
  attachScratchpad,
  engineerContext,
};
