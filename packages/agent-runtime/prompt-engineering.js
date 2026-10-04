"use strict";

/**
 * Model-agnostic prompt contract for CodeMe.
 *
 * This intentionally keeps the existing OpenHands-style agent loop unchanged.
 * The protocol improves the instructions that drive each model turn; runtime
 * gates and verification remain the authority for whether work is complete.
 */
const CODE_PROMPT_PROTOCOL = [
  "Execution contract:",
  "- Keep the user's original objective stable across turns. Do not silently narrow a broad build request into a smaller scaffold.",
  "- For non-trivial work, maintain concrete acceptance criteria for the requested behavior. Use tracked requirements when they are provided.",
  "- Distinguish observations from assumptions. Repository contents, tool results, diagnostics, process logs, tests, and browser results are evidence; guesses are not.",
  "- Choose the smallest next action that advances an unmet acceptance criterion or resolves the current blocker.",
  "- After a tool failure, classify the failure from the exact observation, inspect only the context needed to repair it, then retry the blocked step. Do not spend turns paraphrasing the same error.",
  "- Do not treat created files, a running server, HTTP 200, or a clean console as proof that requested product features exist or work.",
  "- Before finishing, reconcile the original objective and every critical acceptance criterion against actual evidence. If a critical criterion is unimplemented or unverified, continue working or report the run as blocked/incomplete.",
  "- Keep user-facing narration concise. Tool execution and verification evidence belong in tool/progress events rather than long speculative prose.",
].join("\n");

const PLAN_PROMPT_PROTOCOL = [
  "Planning contract:",
  "- Preserve the user's full objective; do not reduce broad requirements to a starter scaffold.",
  "- Turn the request into concrete implementation requirements and observable acceptance criteria.",
  "- Separate known repository facts from assumptions and name which facts must be inspected before implementation.",
  "- Include verification for behavior, not only file existence or successful startup.",
  "- Identify likely recovery points such as dependency installation, process startup, migrations, tests, browser checks, and API checks when relevant.",
].join("\n");

const ASK_PROMPT_PROTOCOL = [
  "Answering contract:",
  "- Base project claims on inspected evidence when repository facts matter.",
  "- Separate verified facts from reasonable inference.",
  "- Do not claim implementation, verification, or successful execution that did not occur.",
].join("\n");

module.exports = {
  CODE_PROMPT_PROTOCOL,
  PLAN_PROMPT_PROTOCOL,
  ASK_PROMPT_PROTOCOL,
};
