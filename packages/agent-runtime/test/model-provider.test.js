const assert = require("assert");
const http = require("http");
const {
  OllamaModelProvider,
  OpenAICompatibleModelProvider,
  contextWindowForModel,
} = require("../model-provider");

function toolDefinition() {
  return {
    name: "file.read",
    description: "Read a workspace file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
  };
}

function fileWriteDefinition() {
  return {
    name: "file.write",
    description: "Write a workspace file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        contents: { type: "string" },
      },
      required: ["path", "contents"],
    },
  };
}

function capabilityInvokeDefinition() {
  return {
    name: "capability.invoke",
    description: "Call a discovered external capability",
    capabilityNames: ["knowledge.lookup"],
    parameters: {
      type: "object",
      properties: {
        capability: { type: "string" },
        input: { type: "object" },
        context: { type: "object" },
      },
      required: ["capability"],
    },
  };
}


async function withServer(responses, run) {
  const queue = responses.slice();
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/api/chat") {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      JSON.parse(body);
      const next = queue.shift();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(next));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runNativeToolCall() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: "file_read",
              arguments: { path: "server.js" },
            },
          },
        ],
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read server.js" }],
      tools: [toolDefinition()],
    });

    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [
      { name: "file.read", args: { path: "server.js" } },
    ]);
  });
}

async function runJsonContentFallback() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: JSON.stringify({
          name: "file_read",
          arguments: { path: "server.js" },
        }),
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read server.js" }],
      tools: [toolDefinition()],
    });

    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [
      { name: "file.read", args: { path: "server.js" } },
    ]);
  });
}

async function runFencedJsonContentFallback() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: `\`\`\`json
{
  "name": "file_read",
  "arguments": { "path": "server.js" }
}
\`\`\``,
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read server.js" }],
      tools: [toolDefinition()],
    });

    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [
      { name: "file.read", args: { path: "server.js" } },
    ]);
  });
}

async function runProseWrappedFencedJsonFallback() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: `I'll list the workspace first.

\`\`\`json
{"name":"dir_list","arguments":{"path":"."}}
\`\`\``,
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read all the files" }],
      tools: [{
        name: "dir.list",
        description: "List a directory",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      }],
    });

    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [
      { name: "dir.list", args: { path: "." } },
    ]);
  });
}

async function runMultipleFencedJsonFallback() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: `I'll inspect each project folder.

\`\`\`json
{"name":"dir_list","arguments":{"path":"data"}}
\`\`\`

\`\`\`json
{"name":"dir_list","arguments":{"path":"lib"}}
\`\`\`

\`\`\`json
{"name":"dir_list","arguments":{"path":"public"}}
\`\`\`

\`\`\`json
{"name":"dir_list","arguments":{"path":"test"}}
\`\`\``,
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read all the files" }],
      tools: [{
        name: "dir.list",
        description: "List a directory",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      }],
    });

    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [
      { name: "dir.list", args: { path: "data" } },
      { name: "dir.list", args: { path: "lib" } },
      { name: "dir.list", args: { path: "public" } },
      { name: "dir.list", args: { path: "test" } },
    ]);
  });
}

async function runQwenRecoveryJsonFallback() {
  const css = "body {\n  margin: 0;\n}\n";
  await withServer([
    {
      message: {
        role: "assistant",
        content: JSON.stringify({
          tool: "file.write",
          path: "public/styles.css",
          content: css,
        }),
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "qwen3.5:9b",
      messages: [{ role: "user", content: "BOUNDED RECOVERY EDIT TURN. Return file.write now." }],
      tools: [fileWriteDefinition()],
    });

    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [
      {
        name: "file.write",
        args: {
          path: "public/styles.css",
          contents: css,
        },
      },
    ]);
  });
}

async function runTaggedQwenToolCall() {
  const css = "body { color: white; }\n";
  await withServer([{ message: {
    role: "assistant",
    content: "<tool_call>" + JSON.stringify({
      name: "file_write",
      arguments: { path: "public/styles.css", content: css },
    }) + "</tool_call>",
  } }], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "qwen2.5-coder:14b",
      messages: [{ role: "user", content: "Write the CSS" }],
      tools: [fileWriteDefinition()],
    });
    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [{
      name: "file.write",
      args: { path: "public/styles.css", contents: css },
    }]);
  });
}

async function runNativeQwenContentAlias() {
  const css = "body { color: black; }\n";
  await withServer([{ message: {
    role: "assistant",
    content: "",
    tool_calls: [{
      function: {
        name: "file_write",
        arguments: { path: "public/styles.css", content: css },
      },
    }],
  } }], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "qwen2.5-coder:32b",
      messages: [{ role: "user", content: "Write the CSS" }],
      tools: [fileWriteDefinition()],
    });
    assert.deepStrictEqual(result.toolCalls, [{
      name: "file.write",
      args: { path: "public/styles.css", contents: css },
    }]);
  });
}

async function withOpenAIServer(run) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "qwen2.5-coder:14b" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        assert.strictEqual(parsed.model, "qwen2.5-coder:14b");
        assert.ok(Array.isArray(parsed.tools));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "call_1",
                type: "function",
                function: {
                  name: "file_read",
                  arguments: JSON.stringify({ path: "server.js" }),
                },
              }],
            },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run("http://127.0.0.1:" + address.port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runOpenAICompatibleProvider() {
  await withOpenAIServer(async (baseUrl) => {
    const provider = new OpenAICompatibleModelProvider({ baseUrl });
    const models = await provider.listModels({ strict: true });
    assert.deepStrictEqual(models.map((item) => item.id), ["qwen2.5-coder:14b"]);
    const result = await provider.complete({
      model: "qwen2.5-coder:14b",
      messages: [{ role: "user", content: "Read server.js" }],
      tools: [toolDefinition()],
    });
    assert.deepStrictEqual(result.toolCalls, [{ name: "file.read", args: { path: "server.js" } }]);
    assert.deepStrictEqual(result.usage, { promptTokens: 10, completionTokens: 5, total: 15 });
  });
}

async function runDirectCapabilityJsonFallback() {
  const note = "The secret CodeMe test animal is otter.";
  await withServer([
    {
      message: {
        role: "assistant",
        content: [
          "```json",
          JSON.stringify({ name: "knowledge.lookup", arguments: { input: { note } } }),
          "```",
          "",
          "```json",
          JSON.stringify({ name: "knowledge.lookup", arguments: { input: { note } } }),
          "```",
        ].join("\n"),
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "qwen3.5:9b",
      messages: [{ role: "user", content: "Remember this project note using the external memory hub." }],
      tools: [capabilityInvokeDefinition()],
    });

    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [
      {
        name: "capability.invoke",
        args: {
          capability: "knowledge.lookup",
          input: { note },
        },
      },
    ]);
  });
}

async function runDirectCapabilityNativeFallback() {
  const note = "The secret CodeMe test animal is otter.";
  await withServer([
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: "knowledge.lookup",
              arguments: { input: { note } },
            },
          },
        ],
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "qwen3.5:9b",
      messages: [{ role: "user", content: "Remember this project note using the external memory hub." }],
      tools: [capabilityInvokeDefinition()],
    });

    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [
      {
        name: "capability.invoke",
        args: {
          capability: "knowledge.lookup",
          input: { note },
        },
      },
    ]);
  });
}

async function runRejectsUnofferedQwenShorthand() {
  const raw = JSON.stringify({
    tool: "terminal.run",
    command: "rm -rf .",
  });
  await withServer([
    { message: { role: "assistant", content: raw } },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "qwen3.5:9b",
      messages: [{ role: "user", content: "Write the CSS file" }],
      tools: [fileWriteDefinition()],
    });

    assert.strictEqual(result.text, raw);
    assert.deepStrictEqual(result.toolCalls, []);
  });
}

async function runRejectsUnofferedTool() {
  const raw = JSON.stringify({
    name: "terminal_run",
    arguments: { command: "rm -rf ." },
  });
  await withServer([
    { message: { role: "assistant", content: raw } },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read server.js" }],
      tools: [toolDefinition()],
    });

    assert.strictEqual(result.text, raw);
    assert.deepStrictEqual(result.toolCalls, []);
  });
}

async function runRejectsInvalidArguments() {
  const raw = JSON.stringify({
    name: "file_read",
    arguments: { path: 42 },
  });
  await withServer([
    { message: { role: "assistant", content: raw } },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read server.js" }],
      tools: [toolDefinition()],
    });

    assert.strictEqual(result.text, raw);
    assert.deepStrictEqual(result.toolCalls, []);
  });
}

async function main() {
  await runNativeToolCall();
  await runJsonContentFallback();
  await runFencedJsonContentFallback();
  await runProseWrappedFencedJsonFallback();
  await runMultipleFencedJsonFallback();
  await runQwenRecoveryJsonFallback();
  await runTaggedQwenToolCall();
  await runNativeQwenContentAlias();
  await runOpenAICompatibleProvider();
  assert.strictEqual(contextWindowForModel("qwen3.5:9b"), 32768);
  assert.strictEqual(contextWindowForModel("qwen2.5-coder:14b"), 16384);
  assert.strictEqual(contextWindowForModel("qwen2.5-coder:32b"), 16384);
  assert.strictEqual(contextWindowForModel("qwen2.5-coder:32b", 8192), 8192);
  await runDirectCapabilityJsonFallback();
  await runDirectCapabilityNativeFallback();
  await runRejectsUnofferedQwenShorthand();
  await runRejectsUnofferedTool();
  await runRejectsInvalidArguments();
  console.log("model provider tool-call compatibility passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
