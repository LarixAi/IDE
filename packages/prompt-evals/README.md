# CodeMe prompt evals

This package adds Promptfoo as a development-only evaluation harness for CodeMe. It does not replace CodeMe's canonical agent loop.

## Requirements

- Node >= 22.22.0 (CodeMe's portable Node 24 runtime is suitable)
- Ollama reachable through `OLLAMA_BASE_URL`
- The configured model installed on that Ollama server

## Run

```bash
npm install
npm run eval
```

Default provider:

```text
ollama:chat:qwen2.5-coder:14b
```

Override it without changing the checked-in config:

```bash
npm run eval -- --providers ollama:chat:qwen3.5:9b
```

Use a remote/home Ollama server:

```bash
OLLAMA_BASE_URL=http://YOUR_SERVER:11434 npm run eval
```

The suite is intentionally deterministic: JSON output plus JavaScript assertions. It tests decision quality around completion, blockers, dependency recovery, template mismatches, process recovery, and verified browser interactions.
