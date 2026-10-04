# OpenHands-style Agent Loop Port

Source architecture reviewed: https://github.com/OpenHands/docs/blob/main/sdk/arch/agent.mdx

CodeMe adapts the architecture rather than copying the OpenHands Python runtime. The goal is to keep CodeMe's existing Pipeline v2 contracts while adopting the useful reasoning/action-loop properties.

## Architecture mapping

| OpenHands concept | CodeMe implementation |
| --- | --- |
| Stateless single-step preparation | `packages/agent-runtime/agent-step.js` |
| Event history | `packages/agent-runtime/agent-events.js` and persisted `run.agentEvents` |
| Condenser | `packages/agent-runtime/context-condenser.js` |
| LLM query | existing model-provider abstraction used by `pipeline-loop.js` |
| ActionEvent | `action` agent event emitted for each structured tool call |
| ObservationEvent | `observation` agent event emitted after each tool result |
| Security analyzer | `packages/agent-runtime/security-analyzer.js` |
| Agent context / skills | existing CodeMe Project Brain, rules and skills pipeline |
| Tool executor | existing CodeMe ToolRegistry / external capability adapters |
| Conversation persistence | existing RunStore and pipeline checkpoints |
| Verification/repair | existing CodeMe answer → verify → repair contract |

## Step flow

Each model turn now follows this event-step shape:

1. Build the current message view.
2. Proactively condense older history when the configured context threshold is crossed.
3. Query the selected model through CodeMe's model-provider abstraction.
4. Parse structured tool calls.
5. Emit security analysis and action events.
6. Execute legal CodeMe tools under the existing mode contract.
7. Emit observation events.
8. Feed observations back into the next model turn.
9. When the model answers, emit a message event and run CodeMe verification.
10. Persist message history, event history, and checkpoints so timeout/offline recovery resumes the same run.

## Important CodeMe differences

- Ask/Plan/Chat read-only rules remain authoritative.
- Code mode remains the only mode that can mutate the workspace.
- n8n remains a capability/research layer rather than a low-level file executor.
- Browser/test verification remains mandatory where CodeMe's verifier requires it.
- Project Brain and CodeMe skills remain the agent-context system.
- Security analysis is recorded for every action. The default confirmation policy is `direct`, preserving current CodeMe behavior. Higher-risk confirmation policies can be enabled later when the Composer approval UI is wired end-to-end.
- The durable `RunStore` owns mutable run state; the new step/condenser/security helpers are pure/stateless inputs-to-outputs where practical.

## Context condensation

The condenser is deterministic and does not call a second model. It keeps the system message, original user goal and recent turns, compresses older tool/assistant payloads, and produces a bounded view for the next LLM query. The canonical message history remains available in the run record while the model receives the condensed view.

## Pipeline lock

This is an owner-approved Pipeline v2 change. The protected-file hashes were refreshed after the loop port so `scripts/check-pipeline-lock.js` continues to guard the approved baseline.
