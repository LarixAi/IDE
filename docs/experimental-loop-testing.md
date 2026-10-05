# Experimental loop-testing integration

This branch tests the self-healing QA pattern from
[sdsrss/loop-testing](https://github.com/sdsrss/loop-testing) without replacing
or editing CodeMe's locked canonical OpenHands-style agent loop.

Pinned reference implementation:

- repository: `sdsrss/loop-testing`
- pinned commit: `4bc983cc714a9b659fae0b18e0ebc315da36d110`
- release at that commit: v0.17.3
- license: MIT
- submodule path: `vendor/loop-testing`

## Integration point

The canonical pipeline stays locked.

CodeMe already routes controlled coding tools through
`extensions/codeme-shell/codeme-tool-provider.js`. This experiment extends that
provider only.

With `CODEME_EXPERIMENTAL_SELF_TEST=true`, successful `file.write` and
`file.patch` calls immediately run:

1. `diagnostics.run`
2. `tests.run { command: "npm test" }` when `workspace.inspect` reports an npm test script

The fast-check result is attached to the original mutation observation as
`data.selfTest`. The file mutation remains successful and therefore remains visible to
CodeMe's normal change tracking. When the checks fail, `data.selfTest.requiresRepair`
is true and the controlled tool contract tells the model to repair before claiming
completion.

The normal end-of-run verifier remains unchanged and still performs the canonical
completion gate.

## Enable for local testing

On this experimental branch:

```bash
export CODEME_EXPERIMENTAL_SELF_TEST=true
```

Then launch CodeMe normally and use Code mode. No special prompt is required.

## Safety

- `main` is unchanged.
- The feature is off by default.
- No protected pipeline file is changed.
- There is still one canonical CodeMe agent loop.
- `loop-testing` is pinned as a reference implementation; its own Claude/Codex outer
  drivers are not launched inside CodeMe.
- Browser/API acceptance checks remain in CodeMe's normal verifier for this first
  experiment so the post-edit checks stay fast.
