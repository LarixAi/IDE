"use strict";

const crypto = require("crypto");
const { createProgressState } = require("./progress");
const { lockModel } = require("./model-lock");
const { selectStrategy } = require("./strategy");
const { inferRequirements } = require("./requirements");
const { hasNoEditDirective } = require("./intent");

function normalizeConversationHistory(list) {
  if (!Array.isArray(list)) return [];
  const cleaned = list.map((item) => {
    const role = item && item.role === "assistant" ? "assistant" : "user";
    const content = String(item && (item.content || item.text) || "").trim();
    return content ? { role, content: content.slice(0, 4000) } : null;
  }).filter(Boolean).slice(-20);

  let budget = 20000;
  const kept = [];
  for (let index = cleaned.length - 1; index >= 0; index -= 1) {
    const item = cleaned[index];
    if (budget <= 0) break;
    const content = item.content.slice(Math.max(0, item.content.length - budget));
    kept.push({ role: item.role, content });
    budget -= content.length;
  }
  return kept.reverse();
}

function normalizeAttachments(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => ({
    kind: item && item.kind ? String(item.kind) : "file",
    path: item && item.path ? String(item.path) : "",
    name: item && item.name ? String(item.name) : "",
    type: item && item.type ? String(item.type) : "text/plain",
    size: Number(item && item.size) || 0,
  })).filter((item) => item.path);
}

function buildPlan(options) {
  const requirements = options.requirements || [];
  if (options.mode === "chat_only") {
    return [
      { id: "understand", title: "Understand the conversation", status: "pending" },
      { id: "respond", title: "Answer without workspace actions", status: "pending" },
    ];
  }
  if (requirements.length) {
    return [
      { id: "understand", title: "Keep the original goal", status: "pending" },
      { id: "inspect", title: "Inspect the repository and find the relevant files", status: "pending" },
      ...requirements.map((item) => ({ id: item.id, title: item.text, status: "pending" })),
      { id: "verify", title: "Verify every requirement with the checks available in this workspace", status: "pending" },
    ];
  }
  if (options.mode === "controlled") {
    if (options.taskClass === "run" || (options.strategyRecord && options.strategyRecord.taskClass === "run")) {
      return [
        { id: "understand", title: "Keep the original goal", status: "pending" },
        { id: "inspect", title: "Inspect the existing project and start configuration", status: "pending" },
        { id: "run", title: "Start or reuse the existing application process", status: "pending" },
        { id: "verify", title: "Verify the running application", status: "pending" },
      ];
    }
    return [
      { id: "understand", title: "Keep the original goal", status: "pending" },
      { id: "inspect", title: "Inspect the repository", status: "pending" },
      { id: "edit", title: "Edit the implementation", status: "pending" },
      { id: "verify", title: "Verify the saved change with the checks available in this workspace", status: "pending" },
    ];
  }
  return [
    { id: "understand", title: "Keep the original goal", status: "pending" },
    { id: "inspect", title: "Inspect with tools and record observations", status: "pending" },
    { id: "verify", title: "Verify the outcome from observations", status: "pending" },
  ];
}

function createRun(options) {
  const lock = options.modelLock || lockModel(options);
  const requestedMode = options.mode || "read_only";
  const noEdit = options.noEdit === true || hasNoEditDirective(options.goal);
  const effectiveMode = requestedMode === "chat_only"
    ? "chat_only"
    : (noEdit ? "read_only" : requestedMode);
  options = { ...options, mode: effectiveMode };
  const strategy = options.strategyRecord || selectStrategy(options.goal, options);
  const requirements = effectiveMode === "chat_only" ? [] : inferRequirements(options.goal, options);
  const run = {
    schemaVersion: 1,
    id: `run_${crypto.randomBytes(8).toString("hex")}`,
    goal: options.goal,
    originalGoal: options.originalGoal || options.goal,
    promptEnhancement: options.promptEnhancement && typeof options.promptEnhancement === "object"
      ? {
        source: String(options.promptEnhancement.source || "").slice(0, 40),
        original: String(options.promptEnhancement.original || options.originalGoal || options.goal || "").slice(0, 12000),
        enhanced: String(options.promptEnhancement.enhanced || options.goal || "").slice(0, 12000),
      }
      : null,
    attachments: normalizeAttachments(options.attachments),
    requestedModel: lock.requestedModel || options.model,
    effectiveModel: lock.effectiveModel || options.model,
    persistentSelection: lock.persistentSelection || options.model,
    modelLock: lock,
    provider: options.providerName,
    mode: effectiveMode,
    requestedMode,
    noEdit,
    composerMode: options.composerMode || "",
    taskClass: strategy.taskClass,
    strategyRecord: strategy,
    lifecycle: "created",
    requirements,
    plan: buildPlan({ ...options, requirements }),
    toolCalls: [],
    observations: [],
    decisions: [],
    ruleDecisions: [],
    repairs: [],
    diagnoses: [],
    followUps: [],
    transitions: [],
    filesChanged: [],
    events: [],
    agentEvents: [],
    strategy: "working",
    progress: createProgressState(options),
    verification: { status: "pending", summary: "", evidence: [] },
    verificationHistory: [],
    projectDecision: null,
    workspaceInspected: false,
    outcome: null,
    iteration: 0,
    maxIterations: options.maxIterations ?? 20,
    repairReserve: options.repairReserve ?? 4,
    repairReserveUsed: 0,
    recoveryReserve: options.recoveryReserve ?? 2,
    recoveryReserveUsed: 0,
    recoveryEditPending: false,
    recoveryEditAttempted: false,
    recoveryEditResearchIteration: null,
    previewStartAttempted: false,
    serverFailureEvidenceCaptured: "",
    serverRuntimeRestartAttempted: false,
    modelTimeoutRetryLimit: options.modelTimeoutRetryLimit ?? 1,
    modelTimeoutRetriesUsed: 0,
    timeoutRetryPending: false,
    maxRetries: options.maxRetries ?? 2,
    maxIdenticalActions: options.maxIdenticalActions ?? 4,
    actionCounts: {},
    failureCounts: {},
    strategyResets: {},
    cancelRequested: false,
    timeoutMs: options.timeoutMs ?? (strategy.taskClass === "layout" ? 300000 : 180000),
    inFlight: null,
    error: null,
    messages: [],
    conversationHistory: normalizeConversationHistory(options.conversationHistory),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (noEdit && requestedMode !== effectiveMode) {
    run.events.push({
      type: "intent_override",
      runId: run.id,
      from: requestedMode,
      to: effectiveMode,
      reason: "The request says not to edit. This run is read-only regardless of the Composer mode.",
    });
  }
  return run;
}

module.exports = {
  createRun,
  buildPlan,
  normalizeConversationHistory,
  normalizeAttachments,
};
