#!/bin/sh
set -eu

PACKAGE="@open-pencil/mcp@0.15.1"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install the OpenPencil MCP package." >&2
  exit 1
fi

echo "Installing ${PACKAGE}..."
npm install -g "$PACKAGE"

if [ "$(uname -s)" = "Darwin" ]; then
  if command -v open >/dev/null 2>&1 && [ -d "/Applications/OpenPencil.app" ]; then
    echo "OpenPencil desktop app is already installed."
  elif command -v brew >/dev/null 2>&1; then
    echo ""
    echo "OpenPencil desktop app is not installed."
    echo "Install it with:"
    echo "  brew install --cask openpencil"
  else
    echo ""
    echo "Install the OpenPencil desktop app from the upstream releases page."
  fi
fi

if command -v openpencil-mcp >/dev/null 2>&1; then
  echo ""
  echo "OpenPencil MCP is ready: $(command -v openpencil-mcp)"
else
  echo "The package installed but openpencil-mcp is not on PATH." >&2
  echo "Restart your terminal/CodeMe or set CODEME_OPENPENCIL_MCP_COMMAND to its full path." >&2
  exit 1
fi

echo ""
echo "Next:"
echo "1. Start OpenPencil and open or create a design document."
echo "2. Launch CodeMe."
echo "3. Open Settings -> UI Designer and confirm the integration is enabled."
