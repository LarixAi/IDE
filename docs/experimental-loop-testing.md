# Experimental loop-testing integration

This branch integrates the ideas from [sdsrss/loop-testing](https://github.com/sdsrss/loop-testing)
without replacing CodeMe's canonical OpenHands-style agent loop.

Pinned reference implementation:

- repository: `sdsrss/loop-testing`
- commit: `4bc983cc714a9b659fae0b18e0ebc315da36d110`
- release at that commit: v0.17.3
- license: MIT
- submodule path: `vendor/loop-testing`

## Why it is isolated

`loop-testing` is designed as a Claude Code / Codex skill with its own outer drivers.
Running that driver directly inside CodeMe would create a second autonomous agent loop that
could compete with CodeMe for the same files.

Instead, the submodule is kept as the reference implementation and CodeMe gets a native
experimental post-mutation supervisor that uses the tools it already owns.

## Enable it

On this branch only, set:

```bash
CODEME_EXPERIMENTAL_SELF_TEST=true
```

Then launch CodeMe normally. A normal Code-mode prompt uses the existing CodeMe loop. After
each successful workspace mutation, the harness automatically runs the fast checks that are
available:

1. `diagnostics.run`
2. `tests.run { command: "npm test" }` when the inspected project exposes an npm test script

The mutation tool result receives a `data.selfTest` summary. If a check fails, that failure is
visible to the model in the same run, and the system instructions require the model to repair
the root cause before it can claim completion. The normal end-of-run verifier still runs after
that, so this adds an early regression signal rather than replacing completion verification.

## Safety

- `main` is unchanged.
- The feature is off unless `CODEME_EXPERIMENTAL_SELF_TEST=true`.
- There is still only one canonical CodeMe agent loop.
- The vendored project is pinned instead of floating at its latest commit.
- Browser/API acceptance checks remain in CodeMe's normal verifier for now; the first experiment
  deliberately keeps the post-edit loop fast.
