# CodeMe prompt engineering layer

CodeMe keeps its existing OpenHands-style event loop as the canonical execution loop. This layer improves the instructions and adds repeatable prompt evaluation; it does **not** introduce a second agent loop.

## Sources and roles

- **DAIR.AI Prompt Engineering Guide** — reference material for prompt/context engineering patterns, decomposition, agents, RAG, and evaluation design.
- **Anthropic Prompt Engineering Interactive Tutorial** — reference material for clear instructions, examples, structured prompting, tool-use discipline, chaining, and failure handling.
- **Promptfoo** — executable regression tests for prompts and agent decision policies.

The DAIR and Anthropic repositories are used as design references rather than copied wholesale into CodeMe. That avoids bloating the IDE and keeps CodeMe model-agnostic. Promptfoo is pinned as a development dependency inside `packages/prompt-evals`.

## What changed

`packages/agent-runtime/prompt-engineering.js` adds three small contracts:

- Code mode: preserve the full objective, maintain acceptance criteria, distinguish evidence from assumptions, recover from exact tool errors, and never equate scaffolding/HTTP 200 with feature completion.
- Plan mode: derive implementation requirements plus observable acceptance criteria and verification steps.
- Ask mode: ground project claims in inspected evidence and never invent implementation or verification.

`pipeline-instructions.js` injects those contracts into the existing mode-specific system prompts.

## Prompt regression suite

`packages/prompt-evals` uses Promptfoo against local Ollama models. The initial scenarios come directly from failures a coding IDE must handle:

1. A generic HTTP 200 page is not proof that a requested fleet-management application is complete.
2. `MODULE_NOT_FOUND` for a dependency already declared in `package.json` should lead to dependency installation/retry, not repeated model turns.
3. An EJS/HTML view mismatch should be diagnosed from the actual files and repaired before completion.
4. `EADDRINUSE` should lead to process/port recovery rather than unrelated code edits.
5. A deterministic browser assertion that proves the requested behavior may satisfy completion.

## Running locally

Promptfoo 0.123.1 requires Node >= 22.22.0. CodeMe's portable Node 24 runtime is suitable.

```bash
cd packages/prompt-evals
npm install
OLLAMA_BASE_URL=http://127.0.0.1:11434 npm run eval
```

To evaluate another installed model:

```bash
npm run eval -- --providers ollama:chat:qwen3.5:9b
```

For a home-server Ollama instance, set `OLLAMA_BASE_URL` to that server URL.

## Boundary

Prompt engineering can improve model decisions, but it is not a substitute for runtime enforcement. Completion gates, deterministic verification, process recovery, stagnation handling, and the canonical loop remain runtime responsibilities.
