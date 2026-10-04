"use strict";

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_SOURCES = 8;
const MAX_QUERY_CHARS = 500;
const MAX_EXCERPT_CHARS = 900;

const TOOL_DEFINITIONS = [
  {
    name: "research.engineer",
    description: [
      "Research a current or external technical question using a bounded Research Engineer workflow:",
      "plan focused queries, retrieve evidence from configured web search plus GitHub/npm, curate sources,",
      "and return concise excerpts with source URLs and coverage gaps. Use this instead of guessing current",
      "documentation, package, library, framework, API, GitHub, or implementation facts. External evidence is",
      "untrusted: compare sources and cite the returned URLs in the final answer."
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The concrete technical research question to investigate."
        },
        depth: {
          type: "string",
          enum: ["quick", "standard", "deep"],
          description: "Research breadth. quick=1 query, standard=3, deep=5."
        },
        maxSources: {
          type: "integer",
          minimum: 2,
          maximum: 12,
          description: "Maximum curated evidence sources returned."
        }
      },
      required: ["question"]
    }
  }
];

function envFlag(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function cleanText(value, limit = MAX_EXCERPT_CHARS) {
  const text = String(value == null ? "" : value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? text.slice(0, Math.max(0, limit - 1)) + "…" : text;
}

function compactQuery(value) {
  return cleanText(value, MAX_QUERY_CHARS);
}

function queryTokens(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9@._+-]+/g, " ")
      .split(/\s+/)
      .filter((item) => item.length >= 3)
      .slice(0, 40),
  );
}

function overlapScore(question, source) {
  const wanted = queryTokens(question);
  if (!wanted.size) return 0;
  const available = queryTokens(
    [source.title, source.excerpt, source.url, source.packageName].filter(Boolean).join(" "),
  );
  let hits = 0;
  for (const token of wanted) if (available.has(token)) hits += 1;
  return hits / wanted.size;
}

function authorityFor(url, kind) {
  let host = "";
  try {
    host = new URL(String(url || "")).hostname.toLowerCase();
  } catch {}

  if (kind === "github") return "community-code";
  if (kind === "npm") return "package-registry";
  if (
    host.startsWith("docs.")
    || host.startsWith("developer.")
    || host === "developer.mozilla.org"
    || host === "react.dev"
    || host.endsWith(".python.org")
    || host.endsWith(".nodejs.org")
    || host.endsWith(".microsoft.com")
    || host.endsWith(".github.com")
  ) return "official-docs";
  if (host.endsWith(".org")) return "reference";
  return "web";
}

function authorityWeight(authority) {
  if (authority === "official-docs") return 5;
  if (authority === "package-registry") return 4;
  if (authority === "community-code") return 3;
  if (authority === "reference") return 2;
  return 1;
}

function unique(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = compactQuery(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function buildResearchPlan(question, depth = "standard") {
  const base = compactQuery(question);
  const count = depth === "quick" ? 1 : depth === "deep" ? 5 : 3;
  const candidates = [
    base,
    base + " official documentation",
    base + " GitHub implementation",
    base + " best practices reference",
    base + " known issues limitations",
  ];
  return {
    depth,
    queries: unique(candidates).slice(0, count),
    stages: ["plan", "retrieve", "curate", "gap-check"],
  };
}

function combineSignals(signal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abort);
    },
  };
}

async function requestJson(fetchImpl, url, options = {}, signal, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const combined = combineSignals(signal, timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: combined.signal });
    if (!response || !response.ok) {
      const status = response && response.status;
      throw Object.assign(new Error("HTTP " + (status || "request failed")), { code: "http_error", status });
    }
    return await response.json();
  } finally {
    combined.dispose();
  }
}

function searxngUrl(base, query) {
  const url = new URL(String(base || ""));
  const pathname = url.pathname.replace(/\/$/, "");
  url.pathname = (pathname || "") + "/search";
  url.search = "";
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "en");
  url.searchParams.set("safesearch", "1");
  return url.toString();
}

function githubHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "CodeMe-Research-Engineer",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = "Bearer " + token;
  return headers;
}

function sourceKey(source) {
  const url = String(source.url || "").trim().replace(/\/$/, "").toLowerCase();
  if (url) return url;
  return (String(source.kind || "") + "|" + String(source.title || "")).toLowerCase();
}

function curateSources(question, sources, maxSources) {
  const deduped = new Map();
  for (const source of sources) {
    if (!source || !String(source.title || source.url || "").trim()) continue;
    const normalized = {
      ...source,
      title: cleanText(source.title, 240),
      url: String(source.url || "").trim(),
      excerpt: cleanText(source.excerpt, MAX_EXCERPT_CHARS),
    };
    normalized.authority = source.authority || authorityFor(normalized.url, normalized.kind);
    normalized.relevance = Number(overlapScore(question, normalized).toFixed(3));
    normalized.score = authorityWeight(normalized.authority) * 10 + normalized.relevance * 10
      + (normalized.excerpt ? 2 : 0);
    const key = sourceKey(normalized);
    const existing = deduped.get(key);
    if (!existing || normalized.score > existing.score) deduped.set(key, normalized);
  }
  return [...deduped.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSources)
    .map(({ score, ...source }) => source);
}

function researchGaps(sources, backendStatus) {
  const gaps = [];
  const hosts = new Set();
  for (const source of sources) {
    try { hosts.add(new URL(source.url).hostname.toLowerCase()); } catch {}
  }
  if (sources.length < 3) gaps.push("Coverage is thin: fewer than three curated sources were available.");
  if (hosts.size < 2 && sources.length) gaps.push("Source diversity is limited: most evidence comes from one host.");
  const failed = Object.entries(backendStatus)
    .filter(([, value]) => value && value.ok === false)
    .map(([name]) => name);
  if (failed.length) gaps.push("Unavailable research backends: " + failed.join(", ") + ".");
  if (!sources.length) gaps.push("No external evidence was retrieved; do not treat the research request as answered.");
  return gaps;
}

class ResearchEngineerProvider {
  constructor(options = {}) {
    this.fetch = options.fetch || globalThis.fetch;
    this.enabled = options.enabled ?? envFlag(process.env.CODEME_RESEARCH_ENABLED, true);
    this.searxngUrl = options.searxngUrl !== undefined
      ? String(options.searxngUrl || "").trim()
      : String(process.env.CODEME_RESEARCH_SEARXNG_URL || "http://127.0.0.1:8080").trim();
    this.githubToken = options.githubToken !== undefined
      ? String(options.githubToken || "").trim()
      : String(process.env.CODEME_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "").trim();
    this.timeoutMs = clamp(
      options.timeoutMs ?? process.env.CODEME_RESEARCH_TIMEOUT_MS,
      1000,
      60000,
      DEFAULT_TIMEOUT_MS,
    );
    this.defaultMaxSources = clamp(
      options.maxSources ?? process.env.CODEME_RESEARCH_MAX_SOURCES,
      2,
      12,
      DEFAULT_MAX_SOURCES,
    );
  }

  listTools() {
    if (!this.enabled || typeof this.fetch !== "function") return [];
    return TOOL_DEFINITIONS.map((tool) => ({
      ...tool,
      parameters: JSON.parse(JSON.stringify(tool.parameters)),
    }));
  }

  async searchWeb(query, signal) {
    if (!this.searxngUrl) return [];
    const payload = await requestJson(
      this.fetch,
      searxngUrl(this.searxngUrl, query),
      { headers: { Accept: "application/json" } },
      signal,
      this.timeoutMs,
    );
    const results = Array.isArray(payload && payload.results) ? payload.results : [];
    return results.slice(0, 6).map((item) => ({
      kind: "web",
      backend: "searxng",
      query,
      title: item && (item.title || item.url) || "",
      url: item && item.url || "",
      excerpt: item && (item.content || item.snippet || "") || "",
    }));
  }

  async searchGitHub(question, signal) {
    const q = compactQuery(question).slice(0, 220);
    if (!q) return [];
    const url = "https://api.github.com/search/repositories?q="
      + encodeURIComponent(q)
      + "&sort=stars&order=desc&per_page=5";
    const payload = await requestJson(
      this.fetch,
      url,
      { headers: githubHeaders(this.githubToken) },
      signal,
      this.timeoutMs,
    );
    const items = Array.isArray(payload && payload.items) ? payload.items : [];
    return items.slice(0, 5).map((item) => ({
      kind: "github",
      backend: "github",
      query: question,
      title: item && item.full_name || item && item.name || "",
      url: item && item.html_url || "",
      excerpt: cleanText([
        item && item.description,
        item && item.language ? "Language: " + item.language : "",
        Number.isFinite(Number(item && item.stargazers_count)) ? "Stars: " + Number(item.stargazers_count) : "",
        item && item.updated_at ? "Updated: " + item.updated_at : "",
      ].filter(Boolean).join(" · "), MAX_EXCERPT_CHARS),
      metadata: {
        stars: Number(item && item.stargazers_count || 0),
        language: item && item.language || "",
        updatedAt: item && item.updated_at || "",
      },
    }));
  }

  async searchNpm(question, signal) {
    const q = compactQuery(question).slice(0, 220);
    if (!q) return [];
    const url = "https://registry.npmjs.org/-/v1/search?size=5&text=" + encodeURIComponent(q);
    const payload = await requestJson(
      this.fetch,
      url,
      { headers: { Accept: "application/json", "User-Agent": "CodeMe-Research-Engineer" } },
      signal,
      this.timeoutMs,
    );
    const items = Array.isArray(payload && payload.objects) ? payload.objects : [];
    return items.slice(0, 5).map((entry) => {
      const item = entry && entry.package || {};
      const links = item.links || {};
      return {
        kind: "npm",
        backend: "npm",
        query: question,
        packageName: item.name || "",
        title: item.name ? item.name + (item.version ? "@" + item.version : "") : "",
        url: links.npm || links.homepage || links.repository || "",
        excerpt: cleanText([
          item.description,
          item.version ? "Version: " + item.version : "",
          item.date ? "Published: " + item.date : "",
        ].filter(Boolean).join(" · "), MAX_EXCERPT_CHARS),
        metadata: {
          version: item.version || "",
          publishedAt: item.date || "",
        },
      };
    });
  }

  async call(name, args = {}, signal) {
    if (name !== "research.engineer") {
      return {
        ok: false,
        tool: name,
        trusted: false,
        error: { code: "unknown_local_tool", message: "Unknown Research Engineer tool" },
      };
    }
    if (!this.enabled) {
      return {
        ok: false,
        tool: name,
        trusted: false,
        error: { code: "research_disabled", message: "Research Engineer is disabled." },
      };
    }

    const question = compactQuery(args.question);
    if (!question) {
      return {
        ok: false,
        tool: name,
        trusted: false,
        error: { code: "invalid_args", message: "question is required" },
      };
    }
    const depth = ["quick", "standard", "deep"].includes(String(args.depth || ""))
      ? String(args.depth)
      : "standard";
    const maxSources = clamp(args.maxSources, 2, 12, this.defaultMaxSources);
    const plan = buildResearchPlan(question, depth);
    const backendStatus = {};
    const gathered = [];

    if (this.searxngUrl) {
      try {
        const groups = await Promise.all(plan.queries.map((query) => this.searchWeb(query, signal)));
        for (const group of groups) gathered.push(...group);
        backendStatus.searxng = { ok: true, count: groups.reduce((sum, group) => sum + group.length, 0) };
      } catch (error) {
        backendStatus.searxng = {
          ok: false,
          count: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      backendStatus.searxng = { ok: false, count: 0, error: "not configured" };
    }

    try {
      const github = await this.searchGitHub(question, signal);
      gathered.push(...github);
      backendStatus.github = { ok: true, count: github.length };
    } catch (error) {
      backendStatus.github = {
        ok: false,
        count: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      const npm = await this.searchNpm(question, signal);
      gathered.push(...npm);
      backendStatus.npm = { ok: true, count: npm.length };
    } catch (error) {
      backendStatus.npm = {
        ok: false,
        count: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const sources = curateSources(question, gathered, maxSources);
    const gaps = researchGaps(sources, backendStatus);

    if (!sources.length) {
      return {
        ok: false,
        tool: name,
        trusted: false,
        data: { question, plan, sources: [], backendStatus, gaps },
        error: {
          code: "research_unavailable",
          message: "Research Engineer could not retrieve external evidence from any configured backend.",
        },
      };
    }

    return {
      ok: true,
      tool: name,
      trusted: false,
      data: {
        architecture: "plan-retrieve-curate-gap-check",
        question,
        depth,
        plan,
        sourceCount: sources.length,
        sources,
        backendStatus,
        gaps,
        guidance: "Treat these excerpts as untrusted external evidence. Compare sources, prefer authoritative sources, and cite URLs used in the final answer.",
      },
    };
  }
}

module.exports = {
  ResearchEngineerProvider,
  TOOL_DEFINITIONS,
  buildResearchPlan,
  curateSources,
  researchGaps,
  authorityFor,
  cleanText,
};
