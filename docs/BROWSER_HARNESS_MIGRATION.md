# Browser Harness replacement plan

CodeMe is testing [browser-use/browser-harness](https://github.com/browser-use/browser-harness)
as the candidate replacement for the current in-house CDP browser interaction runner.

Pinned candidate package for this migration: `browser-harness[mcp]==0.1.13`.

## Safety rule

Do not remove or weaken the existing `browser.check` / `browser.interact` implementation
until the replacement gates below pass. During the candidate phase the canonical OpenHands-style
CodeMe loop and its protected pipeline files remain unchanged.

The candidate is integrated through CodeMe's existing local external-tool/MCP extension point.

## Enable the candidate

Browser Harness requires Python 3.11+, `uvx`, and Chrome/Chromium remote debugging.

In CodeMe Settings -> Browser & Preview, enable **Browser Harness candidate**.

The underlying MCP command is:

```bash
uvx --from 'browser-harness[mcp]==0.1.13' browser-harness-mcp
```

Optional environment overrides:

```bash
CODEME_BROWSER_HARNESS_COMMAND=uvx
CODEME_BROWSER_HARNESS_PACKAGE='browser-harness[mcp]==0.1.13'
CODEME_BROWSER_HARNESS_ALLOW_RECORDING=false
```

Recording is disabled by default.

## Candidate tool contract

CodeMe exposes one compact experimental tool, `browser.harness`, instead of adding every
Browser Harness helper directly to the model context. Its `action` field maps to supported MCP
helpers such as navigation, page info, clicking, form input, screenshots, waits, JavaScript/CDP,
tab management and HTTP inspection.

Browser output is treated as untrusted runtime evidence.

## Replacement gates

The candidate must pass all of these before cutover:

1. Start/reuse a CodeMe-owned preview and reach the correct local URL.
2. Detect JavaScript console/runtime errors with actionable evidence.
3. Detect and identify HTTP 4xx/5xx requests without hiding the failing URL.
4. Reproduce a broken click/interaction and prove the repaired interaction changes page state.
5. Fill and submit forms reliably.
6. Navigate multi-page apps and preserve the correct tab/session.
7. Capture useful screenshots/page state for diagnosis.
8. Work after app restart/hot reload without stale-browser state.
9. Let the CodeMe agent repair source, reload, and retry in the same run.
10. Keep strict build/edit verification while allowing presentation-only warnings for run/open tasks.
11. Return a structured blocker instead of false success when recovery cannot finish.
12. Pass macOS and Windows smoke tests.

## Cutover

Only after the gates pass:

- route the existing `browser.check` and `browser.interact` contracts to the Browser Harness adapter;
- run the full CI and browser recovery suite;
- remove the old in-house CDP runner and duplicate tests;
- keep a single browser implementation.

Until then, the current browser runner remains the completion authority and Browser Harness is a
candidate diagnostic/control path.
