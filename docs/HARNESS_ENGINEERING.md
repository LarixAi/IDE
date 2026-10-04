# CodeMe Harness Engineering Map

CodeMe vendors `walkinglabs/learn-harness-engineering` as a pinned reference at
`vendor/learn-harness-engineering`.

This repository is a design reference, not a second runtime. CodeMe keeps one
canonical OpenHands-style agent loop in
`packages/agent-runtime/agent-loop.js`. Harness engineering describes the
systems around that loop that make the coding agent reliable.

Pinned upstream revision:

```text
walkinglabs/learn-harness-engineering
38ddcd2bf8d65271f668b94e7c875ca1d629d622
```

## Five harness systems

The reference course uses a five-subsystem framing: instructions, tools,
environment, state, and feedback. CodeMe already has concrete components in
each area.

### 1. Instructions

Purpose: tell the model what the task is, what constraints apply, and how it
should act.

Current CodeMe components:

- `packages/agent-runtime/pipeline-instructions.js`
- `packages/agent-runtime/prompt-engineering.js`
- `docs/prompt-engineering.md`
- `packages/prompt-evals/`
- mode contracts and read-only/code-mode guards

Direction:

- keep instructions short and layered;
- put durable repository rules in versioned files;
- mechanically test prompt contracts instead of relying on prose alone;
- use progressive disclosure rather than one giant system prompt.

### 2. Tools

Purpose: give the model safe, typed ways to observe and change the real
workspace.

Current CodeMe components:

- `packages/agent-runtime/tool-registry.js`
- `packages/agent-tools/`
- file, directory, terminal, git, diagnostics, browser, and verification tools
- `packages/agent-runtime/security-analyzer.js`

Direction:

- keep structured tool calls as the only action interface;
- keep tool schemas small and explicit;
- expose only tools useful to the active task/mode;
- record action/observation events for every tool call;
- treat tool errors as useful feedback, not disposable noise.

### 3. Environment

Purpose: make the actual software environment observable and operable by the
agent.

Current CodeMe components:

- Code-OSS workspace and integrated terminal
- `extensions/codeme-shell/browser-interaction-runner.js`
- integrated preview/browser verification
- diagnostics, git status/diff, tests, and shell execution
- mode-aware workspace access

Direction:

- prefer the real project environment over simulated assumptions;
- make terminal, browser, diagnostics, and repository state visible to the
  agent;
- isolate destructive/high-risk operations behind policy;
- keep environment setup reproducible on macOS and Windows.

### 4. State

Purpose: let long-running work survive model turns, context compression,
timeouts, and restarts.

Current CodeMe components:

- `packages/agent-runtime/run-store.js`
- `packages/agent-runtime/pipeline-recovery.js`
- `packages/agent-runtime/project-brain.js`
- `packages/agent-runtime/project-brain-store.js`
- agent events and checkpoints
- `packages/agent-runtime/context-engineering/`

Context engineering currently applies:

```text
WRITE -> SELECT -> ISOLATE -> COMPRESS -> model
```

Direction:

- keep the full run record outside the model context;
- build a bounded model view for each turn;
- preserve goals, decisions, relevant files, failures, and verification state;
- make resume/recovery deterministic.

### 5. Feedback

Purpose: prove that work actually succeeded and turn failures into the next
useful action.

Current CodeMe components:

- `extensions/codeme-shell/verification-tool-provider.js`
- browser interaction and preview checks
- tests and diagnostics
- `packages/agent-runtime/diagnosis.js`
- verification/repair rounds in the canonical agent loop
- GitHub CI through `scripts/test-ci.sh`

Direction:

- require observable evidence before declaring code work complete;
- feed failed tests, diagnostics, and browser checks back into the same run;
- avoid cosmetic edits after successful verification;
- retain enough failure evidence for future context selection.

## CodeMe harness stack

```text
User goal
   |
   v
Instructions / prompt contracts
   |
   v
Context engineering
WRITE -> SELECT -> ISOLATE -> COMPRESS
   |
   v
Canonical OpenHands-style agent loop
   |
   +-------------------+
   |                   |
   v                   v
Tools              Environment
   |                   |
   +---------+---------+
             |
             v
            State
             |
             v
          Feedback
tests / browser / diagnostics / verification
             |
             +-------> next canonical loop turn
```

## Architecture rule

Harness engineering must not introduce another production model loop.

New harness work should normally land as one of:

- instructions or prompt contracts;
- tool/provider capabilities;
- environment adapters;
- state/context services;
- verification/feedback services;
- observability around the canonical loop.

The canonical loop remains:

```text
packages/agent-runtime/agent-loop.js
```

## Next design work

Before adding more runtime behavior, evaluate CodeMe against the reference
course using these questions:

1. Can the agent recover the user's intent after many turns or a restart?
2. Does it receive only the tools and context needed for the current task?
3. Can it inspect and operate the real application environment?
4. Are important decisions, failures, and progress represented as durable state?
5. Does every code task have a mechanically checkable completion signal?
6. Can failures be traced to instructions, context, tools, environment, state,
   or feedback rather than being treated as a generic model failure?

Those answers should drive future harness changes one subsystem at a time.
