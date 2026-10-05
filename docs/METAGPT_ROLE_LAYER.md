# MetaGPT-inspired Software Team Layer

CodeMe uses a small software-team planning layer inspired by the role/SOP pattern popularised by [MetaGPT](https://github.com/FoundationAgents/MetaGPT).

## What was adopted

The useful idea is the handoff between responsibilities:

1. Product Manager
2. Software Architect
3. Project Manager
4. Engineer
5. QA / Reviewer

For large website and application builds, CodeMe gives the selected local model this sequence as a bounded planning contract before it executes the normal CodeMe agent loop.

For smaller edits in an existing web project, the layer is reduced to:

1. Software Architect
2. Engineer
3. QA / Reviewer

This keeps prompt overhead low enough for smaller local models.

## What was not adopted

CodeMe does **not** run the MetaGPT application, does not add a second agent loop, and does not require multiple model processes.

The existing CodeMe/OpenHands-style loop remains authoritative for:

- file reads and edits
- terminal and test execution
- Research Engineer calls
- Browser Harness verification
- retries and repair
- completion criteria

The role layer only sharpens how the model turns a broad product request into requirements, architecture, implementation order, code, and verification.

## Runtime integration

The role plan is built after workspace inspection so it can distinguish between a new project and an existing codebase.

For example:

```text
Build a dealership website with accounts, bidding and payments
    ↓
Product Manager
    ↓
Software Architect
    ↓
Project Manager
    ↓
Engineer
    ↓
QA / Reviewer
    ↓
existing CodeMe tool loop + Browser Harness verification
```

The selected plan is also stored on the run as `run.softwareTeam` so the Composer/runtime can expose it later without changing the core loop.

## Attribution and licensing

MetaGPT is distributed under the MIT License. CodeMe's implementation in `packages/agent-runtime/software-team.js` is an original implementation of the role/SOP concept rather than a copied MetaGPT source file.

Upstream reference:

- https://github.com/FoundationAgents/MetaGPT
- MIT License, Copyright (c) 2024 Chenglin Wu

If substantial upstream MetaGPT code is copied into CodeMe in the future, its MIT copyright and permission notice must be retained with that copied code.
