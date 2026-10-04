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
  prepareAgentStep,
  eventsForAssistantReply,
  eventForObservation,
};
