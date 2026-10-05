# Local Voice Dictation

CodeMe Composer voice input follows the same local-first pattern as Flow:

```text
mic button
  -> CodeMe webview captures mono PCM
  -> resample to 16 kHz WAV
  -> local whisper.cpp transcription
  -> local Ollama cleanup
  -> corrected text inserted into Composer
```

The voice path is input-only. It does not create another agent loop and it does not submit the prompt automatically.

## macOS setup

From the CodeMe repository:

```bash
bash scripts/setup-local-voice-macos.sh
```

The setup script clones/builds `whisper.cpp` with Metal support, downloads the quantized
`large-v3-turbo` model under `~/.codeme/models/whisper`, and makes sure the configured
local Ollama cleanup model is available when Ollama is installed.

CodeMe auto-detects the default setup paths.

## Composer behavior

1. Click the microphone button.
2. CodeMe requests microphone permission and starts local capture.
3. Speak normally.
4. Click the microphone button again.
5. Whisper transcribes locally.
6. Ollama fixes punctuation, capitalization, filler words, obvious transcription mistakes,
   and explicit self-corrections.
7. The resulting text is appended to the current Composer draft.

The user still presses Send. Voice dictation never submits an agent request by itself.

## Safety / fidelity

The cleanup model is instructed to return only a cleaned transcript and not answer or execute
the spoken request. CodeMe also applies a vocabulary-overlap guard. If the local model starts
answering, invents content, is offline, or returns an unusable result, CodeMe falls back to the
raw Whisper transcript instead of losing the dictation.

## Configuration

Optional `.env` overrides:

```bash
CODEME_WHISPER_BIN=
CODEME_WHISPER_MODEL=
CODEME_VOICE_CLEANUP=true
CODEME_VOICE_OLLAMA_URL=http://127.0.0.1:11434
CODEME_VOICE_OLLAMA_MODEL=qwen3.5:9b
```

If `CODEME_VOICE_CLEANUP=false`, the mic still uses local Whisper but inserts the raw transcript.

## Current scope

The integrated runtime is designed to work anywhere CodeMe can provide a local whisper.cpp binary
and model. The included installer currently targets macOS; Windows setup packaging is the next
platform-specific step.
