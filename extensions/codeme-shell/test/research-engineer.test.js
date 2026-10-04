"use strict";

const assert = require("assert");
const {
  ResearchEngineerProvider,
  buildResearchPlan,
  curateSources,
  researchGaps,
} = require("../research-engineer");

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

async function main() {
  const quick = buildResearchPlan("OpenHands agent loop architecture", "quick");
  assert.strictEqual(quick.queries.length, 1);
  const deep = buildResearchPlan("OpenHands agent loop architecture", "deep");
  assert.strictEqual(deep.queries.length, 5);
  assert.ok(deep.stages.includes("gap-check"));

  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("http://127.0.0.1:8080/search")) {
      return response({
        results: [
          {
            title: "OpenHands SDK agent architecture",
            url: "https://docs.openhands.dev/sdk/agent",
            content: "Event-driven agent loop with actions, observations and context management.",
          },
          {
            title: "OpenHands GitHub",
            url: "https://github.com/All-Hands-AI/OpenHands",
            content: "Open source software development agents.",
          },
        ],
      });
    }
    if (String(url).startsWith("https://api.github.com/search/repositories")) {
      return response({
        items: [
          {
            full_name: "All-Hands-AI/OpenHands",
            html_url: "https://github.com/All-Hands-AI/OpenHands",
            description: "AI-driven software development agents.",
            language: "Python",
            stargazers_count: 70000,
            updated_at: "2026-10-01T12:00:00Z",
          },
        ],
      });
    }
    if (String(url).startsWith("https://registry.npmjs.org/-/v1/search")) {
      return response({
        objects: [
          {
            package: {
              name: "openhands-client",
              version: "1.2.3",
              description: "Example client package",
              date: "2026-09-20T00:00:00Z",
              links: { npm: "https://www.npmjs.com/package/openhands-client" },
            },
          },
        ],
      });
    }
    throw new Error("unexpected URL " + url);
  };

  const provider = new ResearchEngineerProvider({
    fetch,
    enabled: true,
    searxngUrl: "http://127.0.0.1:8080",
    timeoutMs: 3000,
    maxSources: 6,
  });

  const definitions = provider.listTools();
  assert.strictEqual(definitions.length, 1);
  assert.strictEqual(definitions[0].name, "research.engineer");

  const result = await provider.call("research.engineer", {
    question: "What architecture does OpenHands use for its agent loop?",
    depth: "standard",
    maxSources: 5,
  });

  assert.strictEqual(result.ok, true, JSON.stringify(result, null, 2));
  assert.strictEqual(result.trusted, false);
  assert.strictEqual(result.data.architecture, "plan-retrieve-curate-gap-check");
  assert.ok(result.data.sources.length >= 2);
  assert.ok(result.data.sources.some((item) => item.backend === "searxng"));
  assert.ok(result.data.sources.some((item) => item.backend === "github"));
  assert.ok(calls.some((url) => url.includes("api.github.com/search/repositories")));
  assert.ok(calls.some((url) => url.includes("registry.npmjs.org")));

  const curated = curateSources("react documentation", [
    { kind: "web", title: "React docs", url: "https://react.dev/reference/react", excerpt: "React reference" },
    { kind: "web", title: "React docs duplicate", url: "https://react.dev/reference/react/", excerpt: "duplicate" },
    { kind: "web", title: "Blog", url: "https://example.com/react", excerpt: "React opinion" },
  ], 5);
  assert.strictEqual(curated.length, 2);
  assert.strictEqual(curated[0].authority, "official-docs");

  const gaps = researchGaps(
    [{ url: "https://example.com/a" }, { url: "https://example.com/b" }],
    { searxng: { ok: false }, github: { ok: true } },
  );
  assert.ok(gaps.some((item) => item.includes("thin")));
  assert.ok(gaps.some((item) => item.includes("diversity")));
  assert.ok(gaps.some((item) => item.includes("searxng")));

  const disabled = new ResearchEngineerProvider({ fetch, enabled: false });
  assert.deepStrictEqual(disabled.listTools(), []);

  console.log("ok native Research Engineer provider");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
