"use strict";

const crypto = require("crypto");

const AGENT_EVENT_TYPES = Object.freeze({
  MESSAGE: "message",
  ACTION: "action",
  OBSERVATION: "observation",
  CONDENSATION: "condensation",
  CONDENSATION_REQUEST: "condensation_request",
  SECURITY: "security",
  CONFIRMATION: "confirmation",
});

function createAgentEvent(type, data = {}) {
  return {
    id: "evt_" + crypto.randomBytes(6).toString("hex"),
    type: String(type || "event"),
    at: new Date().toISOString(),
    ...data,
  };
}

function messageEvent(text, data = {}) {
  return createAgentEvent(AGENT_EVENT_TYPES.MESSAGE, {
    source: data.source || "assistant",
    text: String(text || ""),
    ...data,
  });
}

function actionEvent(call, data = {}) {
  return createAgentEvent(AGENT_EVENT_TYPES.ACTION, {
    source: "agent",
    actionId: String(call && call.id || ""),
    tool: String(call && call.name || ""),
    args: call && call.args && typeof call.args === "object" ? { ...call.args } : {},
    ...data,
  });
}

function observationEvent(call, result, data = {}) {
  return createAgentEvent(AGENT_EVENT_TYPES.OBSERVATION, {
    source: "environment",
    actionId: String(call && call.id || ""),
    tool: String(call && call.name || ""),
    ok: Boolean(result && result.ok),
    result,
    ...data,
  });
}

module.exports = {
  AGENT_EVENT_TYPES,
  createAgentEvent,
  messageEvent,
  actionEvent,
  observationEvent,
};
