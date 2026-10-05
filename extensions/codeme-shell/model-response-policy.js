"use strict";

const RESPONSE_POLICY = [
  "CodeMe response style:",
  "- Answer the user's actual question first. Put the conclusion before background.",
  "- Use plain English and short paragraphs or short bullets. Avoid report-style filler.",
  "- Keep normal final answers concise (usually under 250 words) unless the user asks for detail.",
  "- When explaining files, say what each file actually does in the inspected code, not what a page of that name would usually do.",
  "- If the user asks whether routing, behavior, an interaction, or a feature works, inspect the code responsible for that behavior before claiming it works.",
  "- If the relevant implementation was not inspected or verified, say 'not verified' rather than guessing.",
  "- If the user asks whether a named CodeMe feature, tool, helper, role, integration, or service is installed, active, connected, or available, use codeme.capabilities with a focused query before answering whenever that tool is offered. Do not infer installation from generic CodeMe abilities or from the user's project files.",
  "- If codeme.capabilities does not list the named feature, do not claim that it is installed. Say it is not listed/not verified and explain what evidence is available.",
  "- Distinguish 'the code appears wired correctly' from 'verified in a running browser/test'.",
  "- During tool-use turns, prefer the tool call over narration. Do not describe a tool call instead of making it.",
  "- Do not repeat large file contents or produce generic introductions/conclusions.",
  "- Never emit HTML entities such as &#xA0;, &#160;, &nbsp;, or &#x43; in normal prose. Use normal Unicode/plain text instead.",
  "- Never repeat or splice the same sentence fragment into itself. If a draft becomes garbled, rewrite the sentence from scratch.",
].join("\n");

const REPAIR_POLICY = [
  "Your draft response was malformed or repetitive.",
  "Regenerate the answer from scratch.",
  "Use clean plain English/Markdown only.",
  "Do not emit HTML entities.",
  "Do not repeat sentence fragments.",
  "Preserve the factual/tool-use requirements from the conversation and verify named CodeMe capabilities before claiming they are installed.",
].join(" ");

const ACTION_REQUIRED_POLICY = [
  "ACTION REQUIRED: this CodeMe turn cannot finish with prose only.",
  "Use one of the supplied native tools now.",
  "If you still need repository facts, inspect the specific file or directory needed.",
  "If you already have enough context, apply the requested workspace change with the appropriate mutation tool.",
  "If verification failed, use the failed verification item to choose the next repair or verification tool.",
  "Do not claim that a file was changed, a process was started, or verification passed unless the corresponding tool result exists.",
].join(" ");

const MUTATION_TOOLS = new Set([
  "file.write",
  "file.patch",
  "document.create",
  "document.edit",
  "dir.create",
]);

const EDIT_INTENT = /\b(edit|change|update|write|create|add|remove|delete|fix|repair|implement|build|make|rename|refactor|restyle|redesign)\b/i;

function safeCodePoint(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 0x10ffff) return "";
  try {
    return String.fromCodePoint(number);
  } catch {
    return "";
  }
}

function decodeAssistantEntities(value) {
  return String(value == null ? "" : value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal) => safeCodePoint(parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\u00a0/g, " ");
}

function proseForCorruptionCheck(value) {
  return String(value || "")
    .replace(/\x60{3}[\s\S]*?\x60{3}/g, " ")
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/[\x60*_>#~]/g, " ")
    .toLowerCase();
}

function hasRepeatedPhrase(value, minWords = 8) {
  const words = proseForCorruptionCheck(value).match(/[a-z0-9]+/g) || [];
  if (words.length < minWords * 2) return false;
  const seen = new Map();
  for (let index = 0; index <= words.length - minWords; index += 1) {
    const key = words.slice(index, index + minWords).join(" ");
    if (seen.has(key)) {
      const prior = seen.get(key);
      if (index - prior >= Math.max(3, Math.floor(minWords / 2))) return true;
    } else {
      seen.set(key, index);
    }
  }
  return false;
}

function looksCorruptedAssistantText(value) {
  const text = String(value || "");
  if (!text.trim()) return false;
  if (/&#(?:x[0-9a-f]+|[0-9]+);|&nbsp;/i.test(text)) return true;
  if (/\uFFFD/.test(text)) return true;
  return hasRepeatedPhrase(text);
}

function normalizeAssistantText(value) {
  return decodeAssistantEntities(value)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}


function latestUserText(messages) {
  const source = Array.isArray(messages) ? messages : [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const message = source[index];
    if (message && message.role === "user") return String(message.content || "");
  }
  return "";
}

function originalEditRequest(messages) {
  const source = Array.isArray(messages) ? messages : [];
  for (const message of source) {
    if (!message || message.role !== "user") continue;
    const content = String(message.content || "");
    if (/^VERIFICATION FAILED/i.test(content.trim())) continue;
    if (EDIT_INTENT.test(content)) return content;
  }
  return "";
}

function successfulMutationMessage(message) {
  if (!message || message.role !== "tool" || !MUTATION_TOOLS.has(String(message.name || ""))) return false;
  try {
    const result = JSON.parse(String(message.content || "{}"));
    if (!result || result.ok !== true) return false;
    if (
      ["file.write", "file.patch", "document.create", "document.edit"].includes(String(message.name || ""))
      && result.data
      && result.data.changed === false
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function hasSuccessfulMutation(messages) {
  return (Array.isArray(messages) ? messages : []).some(successfulMutationMessage);
}

function offeredNames(input) {
  return new Set((Array.isArray(input && input.tools) ? input.tools : []).map((tool) => String(tool && tool.name || "")));
}

function needsActionRetry(input, reply) {
  const calls = Array.isArray(reply && reply.toolCalls) ? reply.toolCalls : [];
  if (calls.length) return false;

  const messages = Array.isArray(input && input.messages) ? input.messages : [];
  const offered = offeredNames(input);
  if (!offered.size) return false;

  const latest = latestUserText(messages);
  if (/^VERIFICATION FAILED/i.test(latest.trim())) return true;

  const mutationAvailable = [...MUTATION_TOOLS].some((name) => offered.has(name));
  if (!mutationAvailable) return false;
  if (hasSuccessfulMutation(messages)) return false;
  return Boolean(originalEditRequest(messages));
}

class ResponsePolicyProvider {
  constructor(provider) {
    this.provider = provider;
    this.name = provider && provider.name ? provider.name : "response-policy";
  }

  async listModels(options) {
    return this.provider.listModels(options);
  }

  async complete(input) {
    const messages = Array.isArray(input && input.messages)
      ? input.messages.map((message) => ({ ...message }))
      : [];
    messages.push({ role: "system", content: RESPONSE_POLICY });

    let reply = await this.provider.complete({ ...input, messages });

    if (needsActionRetry({ ...input, messages }, reply)) {
      const retryMessages = messages.concat([{ role: "system", content: ACTION_REQUIRED_POLICY }]);
      try {
        const retried = await this.provider.complete({ ...input, messages: retryMessages });
        if (retried && (String(retried.text || "").trim() || (Array.isArray(retried.toolCalls) && retried.toolCalls.length))) {
          reply = retried;
        }
      } catch {
        // Keep the first successful model response; deterministic verification remains authoritative.
      }
    }

    const toolCalls = Array.isArray(reply && reply.toolCalls) ? reply.toolCalls : [];
    const firstText = String(reply && reply.text || "");

    if (!toolCalls.length && looksCorruptedAssistantText(firstText)) {
      const retryMessages = messages.concat([{ role: "system", content: REPAIR_POLICY }]);
      try {
        const retried = await this.provider.complete({ ...input, messages: retryMessages });
        if (retried && (String(retried.text || "").trim() || (Array.isArray(retried.toolCalls) && retried.toolCalls.length))) {
          reply = retried;
        }
      } catch {
        // Keep the first successful model response and normalize it below.
      }
    }

    if (!reply || typeof reply !== "object") return reply;
    return {
      ...reply,
      text: normalizeAssistantText(reply.text),
    };
  }
}

function wrapResponsePolicy(provider) {
  return new ResponsePolicyProvider(provider);
}

module.exports = {
  RESPONSE_POLICY,
  REPAIR_POLICY,
  ACTION_REQUIRED_POLICY,
  ResponsePolicyProvider,
  decodeAssistantEntities,
  hasRepeatedPhrase,
  looksCorruptedAssistantText,
  normalizeAssistantText,
  needsActionRetry,
  hasSuccessfulMutation,
  wrapResponsePolicy,
};
