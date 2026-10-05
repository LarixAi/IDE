"use strict";

const assert = require("assert");
const fs = require("fs");
const {
  VoiceDictationService,
  isWav,
  keepsSpeakerWords,
  stripReasoning,
} = require("../voice-dictation");

function wavFixture() {
  const samples = 3200;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

function fakeWhisper(command, args, options, callback) {
  const outputIndex = args.indexOf("-of");
  const outputBase = outputIndex >= 0 ? args[outputIndex + 1] : "";
  fs.writeFileSync(outputBase + ".txt", "um check the login button it is not working and fix the javascript error");
  callback(null, "", "");
}

async function main() {
  const wav = wavFixture();
  assert.strictEqual(isWav(wav), true);
  assert.strictEqual(isWav(Buffer.from("not wav")), false);
  assert.strictEqual(keepsSpeakerWords("fix the login button", "Fix the login button."), true);
  assert.strictEqual(keepsSpeakerWords("fix the login button", "I have completed the task for you"), false);
  assert.strictEqual(stripReasoning("<think>hidden</think>Clean text"), "Clean text");

  const service = new VoiceDictationService({
    findWhisperBinary: () => "/fake/whisper-cli",
    findWhisperModel: () => "/fake/model.bin",
    execFile: fakeWhisper,
    ollamaModel: "qwen3.5:9b",
    fetch: async (url, options) => {
      assert.ok(String(url).endsWith("/api/chat"));
      const body = JSON.parse(options.body);
      assert.strictEqual(body.stream, false);
      assert.strictEqual(body.messages[1].role, "user");
      return {
        ok: true,
        async json() {
          return {
            message: {
              content: "Check the login button. It is not working, and fix the JavaScript error.",
            },
          };
        },
      };
    },
  });

  const result = await service.processBase64(wav.toString("base64"));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.cleaned, true);
  assert.ok(result.text.includes("JavaScript error"));
  assert.ok(result.rawText.startsWith("um check"));

  const guarded = new VoiceDictationService({
    findWhisperBinary: () => "/fake/whisper-cli",
    findWhisperModel: () => "/fake/model.bin",
    execFile: fakeWhisper,
    fetch: async () => ({
      ok: true,
      async json() {
        return { message: { content: "I understand. I will now solve your coding problem." } };
      },
    }),
  });
  const guardedResult = await guarded.processBase64(wav.toString("base64"));
  assert.strictEqual(guardedResult.cleaned, false);
  assert.strictEqual(guardedResult.fallback, "cleanup_rejected");
  assert.strictEqual(guardedResult.text, guardedResult.rawText);

  const rawFallback = new VoiceDictationService({
    findWhisperBinary: () => "/fake/whisper-cli",
    findWhisperModel: () => "/fake/model.bin",
    execFile: fakeWhisper,
    fetch: async () => { throw new Error("ollama offline"); },
  });
  const fallback = await rawFallback.processBase64(wav.toString("base64"));
  assert.strictEqual(fallback.cleaned, false);
  assert.strictEqual(fallback.fallback, "cleanup_failed");
  assert.strictEqual(fallback.text, fallback.rawText);

  const missing = new VoiceDictationService({
    findWhisperBinary: () => "",
    findWhisperModel: () => "",
  });
  await assert.rejects(
    () => missing.processBase64(wav.toString("base64")),
    (error) => error && error.code === "voice_whisper_missing",
  );

  console.log("ok local Flow-style voice dictation, Ollama cleanup, guard, and raw fallback");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
