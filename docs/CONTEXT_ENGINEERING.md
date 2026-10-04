# CodeMe Context Engineering

CodeMe vendors the LangChain context-engineering examples at
`vendor/langchain-context-engineering` as a pinned reference. The notebooks are
not executed by the IDE runtime. CodeMe implements the same four strategies as
native JavaScript around the canonical OpenHands-style agent step.

## Runtime flow

```text
raw run history
   -> write    (derive durable goal/focus/files/tools/failures)
   -> select   (retain mandatory, recent, and relevant older context)
   -> isolate  (move oversized historical tool payloads out of the model view)
   -> compress (condense the remaining view to the active context budget)
   -> model
```

The canonical loop remains `packages/agent-runtime/agent-loop.js`. The
integration happens in `prepareAgentStep()`, so there is still one production
agent loop.

## Files

- `context-engineering/write-context.js` builds a deterministic scratchpad from
  the run history.
- `context-engineering/select-context.js` keeps system instructions, the
  original request, recent turns, tool-call pairs, and older messages relevant
  to the current goal/files.
- `context-engineering/isolate-context.js` replaces oversized historical tool
  output and huge historical tool arguments with bounded model-view summaries.
  The original run history is not mutated.
- `context-engineering/compress-context.js` reuses CodeMe's existing
  deterministic condenser.
- `context-engineering/context-manager.js` coordinates the four stages and
  injects a compact scratchpad only when the model view actually needs
  selection/isolation.

## Safety properties

- The source `messages` array is never truncated or rewritten in place by the
  context manager.
- Recent turns are always retained.
- System messages and the first user request are always retained during
  selection.
- Tool-call/observation pairs are kept together when older relevant context is
  selected.
- Error outputs receive a larger isolation allowance than successful noisy tool
  output.
- Small conversations pass through unchanged.

Reference: `langchain-ai/context_engineering`, pinned in the repository as a
Git submodule.
