#!/bin/sh
# Canonical CodeMe agent checks. The retired AgentRun loop is not exercised.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"
export PATH="$node_bin:$PATH"

node "$root/packages/agent-runtime/test/canonical-agent-loop.test.js"
node "$root/packages/agent-runtime/test/pipeline-v2.test.js"
node "$root/packages/agent-runtime/test/agent-step-loop.test.js"
