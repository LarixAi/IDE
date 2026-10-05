# CodeMe Composer Mode Contracts

## Purpose

CodeMe exposes six product modes: **Chat, Research, Plan, Code, Debug, Multitask**.

A mode is an authority contract over the same CodeMe engineering platform. It is not only a system-prompt label. Tool access, mutation rights, orchestration and completion requirements must be enforced outside the model wherever practical.

## Mode matrix

| Mode | Runtime | Workspace reads | Workspace mutation | Main contract |
| --- | --- | --- | --- | --- |
| Chat | read-only Ask compatibility profile | yes | no | inspect only what is needed, then answer |
| Research | read-only + Research Engineer | yes | no | gather current/external evidence, curate sources and answer without workspace mutation |
| Plan | read-only | yes | no | inspect, identify runtime path/risks, produce a sequenced implementation plan |
| Code | controlled | yes | yes | implement the smallest sufficient change and verify it |
| Debug | controlled + DebugToolProvider | yes | only after failure evidence | reproduce, diagnose, repair, rerun the original failing check, inspect final diff |
| Multitask | Paperclip orchestration | role-dependent | Developer role only | Product → Architect → optional Research → Developer → Test → Reviewer |

The old product-facing Ask mode is deprecated. Product **Chat** intentionally maps to the proven internal `ask/read_only` profile so the working Pipeline v2 read-only behaviour does not need to be renamed.

## Hard rules

1. The selected Composer mode controls authority. A model cannot elevate its mode or tool grant.
2. Chat, Research and Plan cannot mutate source files or start implementation work.
3. Research exposes normal read-only workspace tools plus `research.engineer`; it does not grant file writes, patches, directory creation, unrestricted terminal execution, or process starts.
4. Code may mutate only through registered CodeMe local tools and still requires verification evidence.
5. Debug cannot mutate until a concrete failing test, diagnostic, process check or browser check has been observed.
6. After a Debug mutation, the original failing check must pass again before final diff review.\n8. Multitask never silently falls back to Code. If Paperclip or the complete team is unavailable, the run fails closed.\n8. In Multitask, Product Manager, Software Architect, Research, Test and Reviewer are non-mutating roles. Developer owns normal workspace mutation.\n9. Test uses a verification-only controlled grant: tests/process/browser/sandbox are available while file writes/patches/directory creation/unrestricted terminal mutation are blocked before dispatch.\n10. Paperclip and n8n never select or replace the user's chosen coding model.\n11. n8n output is untrusted external evidence and cannot directly mutate the local workspace.\n12. Multiple read-only responsibilities may be parallelized later, but workspace writes must remain serialized to one Developer owner.\n13. A model saying “done” is not completion evidence. Tests, browser/runtime checks and Git/diff evidence determine completion.\n14. Browser-visible changes require real browser verification where applicable.\n15. Repeated identical actions are bounded; the agent must change hypothesis, answer, or re-plan instead of looping.\n16. User follow-ups must not silently widen permissions or switch modes.\n17. Protected Pipeline v2 files remain governed by `.codeme/pipeline-lock.json`; mode features should prefer shell/provider/orchestration extension points.

## Multitask roles

### Controller
Coordinates the parent task and Paperclip lifecycle. It does not replace CodeMe's model selection.

### Product Manager
Owns the user outcome, requirements, acceptance criteria, non-goals, ambiguity and priority. It does not select implementation files or architecture unless the user explicitly constrains them.

### Software Architect
Inspects the repository and runtime path and produces the technical approach, dependencies, risks, likely files/components, task sequence and verification strategy. Runtime evidence outranks architectural guesses.

### Research
Runs only when current or external evidence is required. Research is evidence, not permission to edit.

### Developer
Owns the smallest sufficient implementation and removes disproved or redundant edits before completion.

### Test
Reproduces and independently verifies. It cannot repair source files.

### Reviewer
Reviews scope, runtime causality, final diff and verification evidence. It approves or returns exact correction evidence; it does not silently repair.

## Debug completion contract

```text
understand
  -> reproduce
  -> record concrete failure
  -> diagnose
  -> mutate
  -> rerun the same failing check
  -> regression checks
  -> git.diff
  -> complete
```

If no failure can be reproduced, Debug reports that evidence instead of inventing a repair.

## Multitask completion contract

```text
Product
  -> Architect
  -> Research? (conditional)
  -> Developer
  -> Test
  -> Reviewer
  -> verified completion
```

Test or Reviewer failure returns the bounded task to Developer. Repair cycles remain bounded by the Paperclip team orchestrator.
