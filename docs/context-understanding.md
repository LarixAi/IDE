# Context understanding

CodeMe's context-understanding layer is a lightweight native implementation inspired by:

- Graphiti's temporal/entity context model
- Semantic Router's intent-by-meaning pattern
- Aider's repository-map approach

It does not import another agent runtime, graph database, vector store, or model loop.

## Where it runs

The resolver runs in `extensions/codeme-shell` before the Composer submits a task to the
locked canonical OpenHands-style loop.

The visible user message is unchanged. If the resolver is confident that a short follow-up is
referential, CodeMe passes a resolved `goalOverride` into the existing Composer API.

Example:

```text
User visible message:
run it

Resolved internal goal:
Run the existing website in the current workspace using its configured npm run dev script.
Reuse an existing CodeMe-owned process if one is already running. Then check the integrated
preview. Do not rebuild it unless startup fails.
```

## Current features

- semantic intent families for run/start/preview, verify/test, continue, and inspect
- reference resolution for "it", "that", "this", "same", and "what you just built"
- lightweight repository map:
  - project kind
  - framework
  - package scripts
  - key files
- per-workspace persisted context state
- recent changed-file memory from the Composer snapshot
- safe fallback: if confidence is insufficient, the original user text is passed through

## Boundaries

This is deliberately dependency-free. It does not yet use embeddings or a graph database.
Those can be added later as an optional retrieval backend without changing the locked loop.
