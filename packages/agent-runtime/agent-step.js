"use strict";

const {
  AGENT_EVENT_TYPES,
  createAgentEvent,
  messageEvent,
  actionEvent,
  observationEvent,
} = require("./agent-events");
const { condenseMessages } = require("./context-condenser");
const { analyzeAction, requiresConfirmation } = require("./security-analyzer");

function prepareAgentStep(messages, options = {}) {
  const condensed = condenseMessages(messages, {
    maxChars: options.contextWindowChars || 56000,
    triggerRatio: options.condenseTriggerRatio,
    targetRatio: options.condenseTargetRatio,
    keepRecent: options.keepRecent,
  });
  const events = [];
  if (condensed.kind === "condensation") {
    events.push(createAgentEvent(AGENT_EVENT_TYPES.CONDENSATION, {
      source: "agent",
      beforeChars: condensed.beforeChars,
      afterChars: condensed.afterChars,
      summarized: condensed.summarized,
    }));
  }
  return {
    messages: condensed.messages,
    events,
    condensation: condensed,
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
