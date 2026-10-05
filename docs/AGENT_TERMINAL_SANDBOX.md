# AI terminal sandbox

CodeMe now uses a Cursor-style local safety model for normal coding:

- AI file edits apply directly to the open workspace.
- AI `terminal.run` and `tests.run` commands execute inside an OS sandbox.
- Those commands may write inside the workspace, but writes outside the workspace are blocked.
- Network access is denied for AI terminal/test commands.
- The user's own integrated Terminal is not intercepted or sandboxed.

On macOS, CodeMe uses Apple Seatbelt through `/usr/bin/sandbox-exec`. On Linux,
CodeMe uses `bubblewrap` when it is installed. If a supported OS sandbox is not
available, AI terminal/test execution fails closed instead of silently running unrestricted.

This is different from `sandbox.run`, which remains available for disposable-copy experiments.

`process.start` is still a separate, tightly restricted local-preview capability. It only accepts
the approved preview commands already enforced by the canonical tool contract and is owned by the
CodeMe preview lifecycle so Browser Harness can verify the running app.

No protected canonical pipeline file was changed for this feature.
