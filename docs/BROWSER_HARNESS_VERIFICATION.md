# Browser Harness verification bridge

CodeMe's canonical verifier records browser evidence under the logical tool names
`browser.check` and `browser.interact`.

When Browser Harness is the active browser engine, those logical tools remain visible
to the agent and verifier. The unlocked shell adapter routes them to Browser Harness
MCP helpers underneath and normalizes the result back to the canonical CodeMe tool
shape.

This is intentional:

```text
CodeMe verifier
    |
browser.check / browser.interact
    |
Browser Harness logical adapter
    |
browser-harness MCP
    |
real Chrome
```

The raw `browser.harness` migration tool is not exposed to the pipeline model. This
prevents successful Browser Harness work from being invisible to the verifier.

The legacy browser runner remains available only through the rollback setting. No
protected canonical pipeline file is changed by this bridge.
