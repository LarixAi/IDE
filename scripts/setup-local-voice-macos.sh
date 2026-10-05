#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This setup script currently targets macOS. CodeMe voice runtime itself is cross-platform once whisper.cpp and a model are available."
  exit 1
fi

for cmd in git cmake curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
done

TOOLS_DIR="${HOME}/.codeme/tools/whisper.cpp"
MODEL_DIR="${HOME}/.codeme/models/whisper"
MODEL_NAME="${CODEME_WHISPER_MODEL_NAME:-ggml-large-v3-turbo-q5_0.bin}"
MODEL_PATH="${MODEL_DIR}/${MODEL_NAME}"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}"

mkdir -p "$(dirname "$TOOLS_DIR")" "$MODEL_DIR"

if [[ ! -d "${TOOLS_DIR}/.git" ]]; then
  echo "Cloning whisper.cpp..."
  git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "$TOOLS_DIR"
else
  echo "Updating whisper.cpp..."
  git -C "$TOOLS_DIR" pull --ff-only
fi

echo "Building whisper.cpp with Apple Metal acceleration..."
cmake -S "$TOOLS_DIR" -B "$TOOLS_DIR/build" \
  -DGGML_METAL=ON \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DCMAKE_BUILD_TYPE=Release
cmake --build "$TOOLS_DIR/build" --config Release --parallel

WHISPER_BIN="${TOOLS_DIR}/build/bin/whisper-cli"
if [[ ! -x "$WHISPER_BIN" ]]; then
  ALT_BIN="${TOOLS_DIR}/build/bin/main"
  if [[ -x "$ALT_BIN" ]]; then
    WHISPER_BIN="$ALT_BIN"
  else
    echo "whisper.cpp built, but whisper-cli was not found in the expected build directory."
    exit 1
  fi
fi

if [[ ! -f "$MODEL_PATH" ]]; then
  echo "Downloading local Whisper model: ${MODEL_NAME}"
  curl -L --fail --progress-bar "$MODEL_URL" -o "${MODEL_PATH}.part"
  mv "${MODEL_PATH}.part" "$MODEL_PATH"
else
  echo "Whisper model already present: $MODEL_PATH"
fi

VOICE_MODEL="${CODEME_VOICE_OLLAMA_MODEL:-${CODEME_QWEN_MODEL:-qwen3.5:9b}}"
if command -v ollama >/dev/null 2>&1; then
  if ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fxq "$VOICE_MODEL"; then
    echo "Ollama cleanup model already present: $VOICE_MODEL"
  else
    echo "Pulling local Ollama cleanup model: $VOICE_MODEL"
    ollama pull "$VOICE_MODEL" || echo "Warning: Ollama model pull failed. Voice transcription will still fall back to the raw Whisper transcript."
  fi
else
  echo "Warning: Ollama is not on PATH. Voice transcription will still work, but cleanup will fall back to raw text until Ollama is available."
fi

echo ""
echo "CodeMe local voice setup is ready."
echo "Whisper binary: $WHISPER_BIN"
echo "Whisper model:  $MODEL_PATH"
echo "Cleanup model:  $VOICE_MODEL"
echo ""
echo "CodeMe auto-detects these default paths, so no .env changes are required."
