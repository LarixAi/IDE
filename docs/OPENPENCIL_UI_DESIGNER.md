# OpenPencil UI Designer

CodeMe integrates [OpenPencil](https://github.com/open-pencil/open-pencil) as a local UI/vector design engine.

The upstream source is pinned as a Git submodule at:

`vendor/open-pencil`

Pinned upstream commit:

`f465da8b812d22623dc0d4a305a183ef87914e67`

OpenPencil is MIT licensed. Its copyright and license remain in the upstream submodule.

## Why CodeMe uses an adapter

OpenPencil exposes more than 100 MCP design tools. Sending all of those schemas to a small local coding model would consume unnecessary context and make tool selection harder.

CodeMe therefore exposes one compact model-facing tool:

`design.openpencil`

The adapter discovers the installed OpenPencil MCP tools at runtime and exposes a bounded action list for common product-design work:

- create/open/save design documents
- inspect pages, nodes, selection, and components
- render a complete UI tree from OpenPencil Design JSX
- create and edit shapes
- set layout, fill, stroke, and text
- create components
- lint a design
- analyze colors, typography, and spacing
- export SVG
- undo/redo agent design edits

Raw `eval` and the rest of OpenPencil's full tool surface are deliberately not exposed through this compact CodeMe adapter.

## Runtime architecture

```text
User request
    ↓
CodeMe model / future UI Designer role
    ↓
design.openpencil
    ↓
OpenPencilProvider
    ↓
@open-pencil/mcp stdio
    ↓
OpenPencil desktop app
    ↓
editable local vector design
```

This is an extension point around the existing CodeMe/OpenHands-style agent loop. It does not replace or fork the canonical loop.

## Local setup

The source is present in the CodeMe repository, but the running desktop designer and its MCP executable still need to exist on the machine.

On macOS:

```bash
brew install --cask openpencil
npm install -g @open-pencil/mcp@0.15.1
```

Or run:

```bash
sh scripts/setup-openpencil.sh
```

Then:

1. Start the OpenPencil desktop app.
2. Open an existing design or create a blank document.
3. Start CodeMe.
4. Open **Settings → UI Designer**.
5. Confirm OpenPencil is enabled.
6. Ask CodeMe to design a screen.

The stdio server discovers the running OpenPencil app automatically. CodeMe restricts OpenPencil file access to the current workspace by setting `OPENPENCIL_MCP_ROOT`.

## Test prompt

Use this in Code mode after OpenPencil is running:

```text
Use the UI Designer to create an editable vector design for a modern transport-manager dashboard.
Include a left navigation, fleet status cards, today's jobs, off-road vehicles, driver alerts,
and a responsive content layout. Inspect the design after creating it, lint it, and export the
main dashboard frame as SVG. Do not code the website yet.
```

Expected activity should include `design.openpencil` actions such as:

```text
new_document
render_ui
page_tree
lint
export_svg
```

A successful result proves the design capability is connected independently of website implementation.

## Design-to-code workflow

The intended end-to-end CodeMe flow is:

```text
Prompt
  ↓
UI Designer · OpenPencil
  ↓
editable vector UI / design system
  ↓
Software Architect
  ↓
Developer
  ↓
Browser Harness
  ↓
Reviewer
```

The Software Architect/Developer role layer is a separate CodeMe feature and should only be treated as active after its own runtime integration is merged and verified.
