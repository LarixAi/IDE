"use strict";

const {
  AGENT_EVENT_TYPES,
  createAgentEvent,
  messageEvent,
  actionEvent,
  observationEvent,
} = require("./agent-events");
const { engineerContext } = require("./context-engineering/context-manager");
const { analyzeAction, requiresConfirmation } = require("./security-analyzer");


const CORE_TOOL_NAMES = new Set([
  "workspace.inspect",
  "dir.list",
  "file.read",
  "file.patch",
  "file.write",
  "repo.search",
  "git.status",
  "git.diff",
  "diagnostics.run",
]);

const MUTATION_TOOL_NAMES = new Set([
  "file.patch",
  "file.write",
  "dir.create",
]);

const DOCUMENT_TOOL_NAMES = new Set([
  "document.read",
  "document.create",
  "document.edit",
]);

const EXECUTION_TOOL_NAMES = new Set([
  "terminal.run",
  "sandbox.run",
  "tests.run",
]);

const PREVIEW_TOOL_NAMES = new Set([
  "process.start",
  "process.status",
  "process.logs",
  "browser.check",
  "browser.interact",
]);

const MEMORY_TOOL_NAMES = new Set([
  "memory.recall",
  "memory.save",
]);

function taskText(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && message.role === "user")
    .map((message) => String(message.content || ""))
    .join("\n")
    .slice(-16000);
}

function usedToolNames(messages) {
  const names = new Set();
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message) continue;
    if (message.role === "tool" && message.name) names.add(String(message.name));
    for (const call of Array.isArray(message.toolCalls) ? message.toolCalls : []) {
      if (call && call.name) names.add(String(call.name));
    }
  }
  return names;
}

function selectToolsForTask(tools, messages, options = {}) {
  const offered = Array.isArray(tools) ? tools.filter(Boolean) : [];
  const threshold = Math.max(1, Number(options.threshold || 10));
  if (offered.length <= threshold) return offered.slice();

  const text = taskText(messages);
  if (!text.trim()) return offered.slice();

  const lower = text.toLowerCase();
  const selected = new Set(CORE_TOOL_NAMES);
  for (const name of usedToolNames(messages)) selected.add(name);

  const editIntent = /\b(edit|change|update|write|create|add|remove|delete|fix|repair|implement|build|make|rename|refactor|restyle|redesign)\b/i.test(text);
  const codeIntent = editIntent || /\b(code|coding|debug|compile|build|test|lint|diagnostic|implementation)\b/i.test(text);
  const webIntent = /\b(website|web site|webpage|frontend|front-end|html|css|browser|preview|page|button|form|click|serve|server|run|start|launch)\b/i.test(text);
  const documentIntent = /\b(document|docx|word|pdf)\b/i.test(text);
  const memoryIntent = /\b(memory|remember|recall|project brain|long[- ]term context)\b/i.test(text);
  const skillIntent = /(^|\s)\/[-\w]+\b|\bskill\b/i.test(text);
  const researchIntent = /\b(research|latest|current|online|internet|web search|github|npm|mdn|documentation|docs)\b/i.test(text);
  const designIntent = /\b(openpencil|ui designer|wireframe|mockup|vector design|design screen|design a screen)\b/i.test(text);
  const capabilityIntent = /\b(capabilit(?:y|ies)|installed|available|connected|integration status)\b/i.test(text);

  if (editIntent) {
    for (const name of MUTATION_TOOL_NAMES) selected.add(name);
  }
  if (codeIntent) {
    for (const name of EXECUTION_TOOL_NAMES) selected.add(name);
  }
  if (webIntent) {
    for (const name of PREVIEW_TOOL_NAMES) selected.add(name);
  }
  if (documentIntent) {
    for (const name of DOCUMENT_TOOL_NAMES) selected.add(name);
  }
  if (memoryIntent) {
    for (const name of MEMORY_TOOL_NAMES) selected.add(name);
  }
  if (skillIntent) selected.add("skill.run");
  if (researchIntent) {
    selected.add("research.engineer");
    selected.add("capability.list");
    selected.add("capability.invoke");
  }
  if (designIntent) selected.add("design.openpencil");
  if (/\bbrowser harness\b/i.test(text)) selected.add("browser.harness");
  if (capabilityIntent) {
    selected.add("codeme.capabilities");
    selected.add("capability.list");
    selected.add("capability.invoke");
  }

  // Explicitly named integrations remain available when the user asks for them.
  for (const tool of offered) {
    const name = String(tool && tool.name || "");
    const description = String(tool && tool.description || "");
    const haystack = (name + " " + description).toLowerCase();
    if (
      (lower.includes("n8n") && haystack.includes("n8n"))
      || (lower.includes("paperclip") && haystack.includes("paperclip"))
      || (lower.includes("openpencil") && haystack.includes("openpencil"))
    ) {
      selected.add(name);
    }
    if (lower.includes(name.toLowerCase()) || lower.includes(name.toLowerCase().replace(/[._-]+/g, " "))) {
      selected.add(name);
    }
  }

  const filtered = offered.filter((tool) => selected.has(String(tool && tool.name || "")));
  return filtered.length ? filtered : offered.slice(0, threshold);
}

function prepareAgentStep(messages, options = {}) {
  const engineered = engineerContext(messages, {
    goal: options.goal,
    maxChars: options.contextWindowChars || 56000,
    selectTriggerRatio: options.contextSelectTriggerRatio,
    selectTargetRatio: options.contextSelectTargetRatio,
    compressTriggerRatio: options.condenseTriggerRatio,
    compressTargetRatio: options.condenseTargetRatio,
    keepRecent: options.keepRecent,
    maxToolChars: options.contextToolOutputChars,
    maxArgumentChars: options.contextToolArgumentChars,
  });
  const events = [];
  if (engineered.changed) {
    events.push(createAgentEvent(AGENT_EVENT_TYPES.CONTEXT_ENGINEERING, {
      source: "agent",
      beforeChars: engineered.beforeChars,
      afterChars: engineered.afterChars,
      write: engineered.write,
      selected: engineered.selection.dropped,
      isolated: engineered.isolation.isolated,
      summarized: engineered.compression.summarized || 0,
    }));
  }
  if (engineered.compression.kind === "condensation") {
    events.push(createAgentEvent(AGENT_EVENT_TYPES.CONDENSATION, {
      source: "agent",
      beforeChars: engineered.compression.beforeChars,
      afterChars: engineered.compression.afterChars,
      summarized: engineered.compression.summarized,
    }));
  }
  return {
    messages: engineered.messages,
    events,
    condensation: engineered.compression,
    contextEngineering: engineered,
  };
}

function eventsForAssistantReply(text, toolCalls, options = {}) {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  if (!calls.length) {
    return [messageEvent(text, { turn: options.turn })];
  }
  const policy = options.confirmationPolicy || "direct";
  const events = [];
  for (const call of calls) {
    const security = analyzeAction(call, {
      mode: options.mode,
      external: String(call && call.name || "").startsWith("capability."),
    });
    events.push(createAgentEvent(AGENT_EVENT_TYPES.SECURITY, {
      source: "agent",
      actionId: String(call && call.id || ""),
      tool: String(call && call.name || ""),
      analysis: security,
      confirmationRequired: requiresConfirmation(security, policy),
      turn: options.turn,
    }));
    events.push(actionEvent(call, {
      turn: options.turn,
      security,
      confirmationRequired: requiresConfirmation(security, policy),
    }));
  }
  return events;
}

function eventForObservation(call, result, options = {}) {
  return observationEvent(call, result, { turn: options.turn });
}

module.exports = {
  selectToolsForTask,
  taskText,
  prepareAgentStep,
  eventsForAssistantReply,
  eventForObservation,
};
