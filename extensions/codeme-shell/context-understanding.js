"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const IGNORE_DIRS = new Set([
  ".git", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache",
  "node_modules", "dist", "build", "coverage", "vendor", "out",
]);

const INTENTS = Object.freeze({
  run_project: [
    "run it", "run this", "run the site", "run the website", "run the app",
    "start it", "start the site", "start the website", "start the app",
    "launch it", "launch the site", "open it", "open the site",
    "preview it", "show me it", "show me the site", "let me see it",
    "serve it", "spin it up",
  ],
  verify_project: [
    "check it", "test it", "verify it", "see if it works", "make sure it works",
    "check the site", "test the website", "verify the app", "check what you built",
  ],
  continue_task: [
    "continue", "carry on", "keep going", "finish it", "finish that",
    "continue that", "continue it", "go on",
  ],
  inspect_project: [
    "look at it", "inspect it", "review it", "look at the site", "inspect the app",
  ],
});

const REFERENTIAL = /\b(it|that|this|same|what you (?:just )?(?:built|made|changed)|the (?:site|website|app|application|project|page|server))\b/i;
const EXPLICIT_TARGET = /\b(website|web site|site|web app|application|app|project|page|server|api|dashboard)\b/i;

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function words(value) {
  return new Set(
    clean(value).toLowerCase().match(/[a-z0-9]+/g) || [],
  );
}

function phraseScore(text, phrase) {
  const normalizedText = clean(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedPhrase = clean(phrase).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalizedText || !normalizedPhrase) return 0;
  if (normalizedText === normalizedPhrase) return 8;
  if (normalizedText.includes(normalizedPhrase) || normalizedPhrase.includes(normalizedText)) return 5;
  const a = words(normalizedText);
  const b = words(normalizedPhrase);
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.max(1, Math.min(a.size, b.size));
}

function classifyIntent(text) {
  const input = clean(text);
  const scores = [];
  for (const [intent, phrases] of Object.entries(INTENTS)) {
    let best = 0;
    for (const phrase of phrases) best = Math.max(best, phraseScore(input, phrase));
    scores.push({ intent, score: best });
  }
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0] || { intent: "unknown", score: 0 };
  if (top.score < 0.45) return { intent: "unknown", confidence: 0 };
  const confidence = top.score >= 5 ? 0.98 : Math.min(0.92, 0.55 + top.score * 0.2);
  return { intent: top.intent, confidence };
}

function safeReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function inferFramework(pkg, files) {
  const deps = {
    ...(pkg && pkg.dependencies || {}),
    ...(pkg && pkg.devDependencies || {}),
  };
  const names = Object.keys(deps);
  if (names.includes("next")) return "Next.js";
  if (names.includes("@angular/core")) return "Angular";
  if (names.includes("vue")) return names.includes("nuxt") ? "Nuxt" : "Vue";
  if (names.includes("svelte") || names.includes("@sveltejs/kit")) return "Svelte";
  if (names.includes("react")) return names.includes("vite") ? "React + Vite" : "React";
  if (names.includes("vite")) return "Vite";
  if (files.some((item) => /(^|\/)index\.html$/i.test(item))) return "static web";
  return "";
}

function scanFiles(root, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 3;
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : 180;
  const files = [];

  function visit(dir, depth) {
    if (depth > maxDepth || files.length >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) visit(abs, depth + 1);
      } else {
        files.push(rel);
      }
    }
  }

  if (root && fs.existsSync(root)) visit(root, 0);
  return files;
}

function repoMap(root) {
  const workspace = clean(root);
  if (!workspace || !fs.existsSync(workspace)) {
    return {
      root: workspace,
      name: workspace ? path.basename(workspace) : "",
      kind: "project",
      framework: "",
      runScript: "",
      runCommand: "",
      files: [],
      keyFiles: [],
    };
  }

  const pkg = safeReadJson(path.join(workspace, "package.json")) || {};
  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  const files = scanFiles(workspace);
  const framework = inferFramework(pkg, files);
  const web = Boolean(
    framework
    || files.some((item) => /(^|\/)(index\.html|src\/.*\.(jsx?|tsx?|vue|svelte)|app\/.*\.(jsx?|tsx?))$/i.test(item))
  );
  const priorities = web
    ? ["dev", "start", "preview", "serve"]
    : ["start", "dev", "run"];
  const runScript = priorities.find((name) => typeof scripts[name] === "string" && scripts[name].trim()) || "";
  const keyFiles = files.filter((item) => (
    /(^|\/)(package\.json|index\.html|vite\.config\.[^.]+|next\.config\.[^.]+)$/i.test(item)
    || /(^|\/)(src|app|pages|public)\//i.test(item)
  )).slice(0, 24);

  return {
    root: workspace,
    name: path.basename(workspace),
    kind: web ? "website" : "project",
    framework,
    runScript,
    runCommand: runScript ? "npm run " + runScript : "",
    files,
    keyFiles,
  };
}

function targetFromText(text, map) {
  const input = clean(text);
  const explicit = input.match(EXPLICIT_TARGET);
  if (explicit) {
    const value = explicit[1].toLowerCase();
    if (["website", "web site", "site", "web app", "page"].includes(value)) return "website";
    if (["application", "app"].includes(value)) return map.kind === "website" ? "website" : "application";
    return value;
  }
  return "";
}

function recentTarget(thread, fallback) {
  const items = Array.isArray(thread) ? thread : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const text = clean(items[index] && (items[index].text || items[index].content));
    if (!text) continue;
    const match = text.match(EXPLICIT_TARGET);
    if (!match) continue;
    const value = match[1].toLowerCase();
    if (["website", "web site", "site", "web app", "page"].includes(value)) return "website";
    if (["application", "app"].includes(value)) return fallback === "website" ? "website" : "application";
    return value;
  }
  return fallback || "project";
}

function stateKey(root) {
  return crypto.createHash("sha256").update(clean(root) || "workspace").digest("hex").slice(0, 16);
}

class ContextUnderstanding {
  constructor(options = {}) {
    this.getRoot = typeof options.getRoot === "function" ? options.getRoot : () => "";
    this.storageDir = clean(options.storageDir);
  }

  fileFor(root) {
    if (!this.storageDir) return "";
    return path.join(this.storageDir, stateKey(root) + ".json");
  }

  load(root) {
    const file = this.fileFor(root);
    if (!file) return {};
    return safeReadJson(file) || {};
  }

  save(root, state) {
    const file = this.fileFor(root);
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
      fs.renameSync(tmp, file);
    } catch {
      // Context understanding is advisory; never block Composer on persistence.
    }
  }

  resolve(text, options = {}) {
    const input = clean(text);
    const root = clean(this.getRoot());
    const map = repoMap(root);
    const prior = this.load(root);
    const classification = classifyIntent(input);
    const explicitTarget = targetFromText(input, map);
    const reference = REFERENTIAL.test(input);
    const target = explicitTarget
      || (reference ? recentTarget(options.thread, prior.lastTarget || map.kind) : "")
      || prior.lastTarget
      || map.kind;

    let goal = input;
    let changed = false;
    let reason = "";

    if (classification.intent === "run_project" && (reference || explicitTarget || input.length <= 90)) {
      const noun = target === "website" || map.kind === "website" ? "website" : "project";
      const command = map.runCommand ? " using its configured " + map.runCommand + " script" : "";
      const framework = map.framework ? " (" + map.framework + ")" : "";
      goal =
        "Run the existing " + noun + " in the current workspace" + framework + command + ". "
        + "Reuse an existing CodeMe-owned process if one is already running. "
        + (noun === "website"
          ? "Then open or check the integrated preview and verify the site responds."
          : "Verify that the project starts successfully.")
        + " This instruction resolves the user's reference to the current project; do not rebuild it unless startup fails.";
      changed = true;
      reason = "resolved run intent and current-project reference";
    } else if (classification.intent === "verify_project" && (reference || explicitTarget || input.length <= 100)) {
      const noun = target === "website" || map.kind === "website" ? "website" : "project";
      goal =
        "Verify the existing " + noun + " in the current workspace. "
        + "Use the existing project state, run the appropriate checks/tests, and "
        + (noun === "website" ? "check the integrated browser preview and interactions." : "report any concrete failures.")
        + " Do not rebuild unrelated parts of the project.";
      changed = true;
      reason = "resolved verification intent and current-project reference";
    } else if (classification.intent === "continue_task" && (reference || input.length <= 60)) {
      goal =
        "Continue the most recent unfinished task from this conversation in the current workspace. "
        + "Preserve the user's previously stated requirements and decisions, inspect the latest project state, "
        + "and continue from the next incomplete step rather than restarting.";
      changed = true;
      reason = "resolved continuation reference";
    } else if (classification.intent === "inspect_project" && (reference || explicitTarget || input.length <= 90)) {
      goal =
        "Inspect the existing " + (target === "website" || map.kind === "website" ? "website" : "project")
        + " in the current workspace and answer from its current state. Read relevant files or runtime evidence before concluding.";
      changed = true;
      reason = "resolved inspection reference";
    }

    const snapshot = options.snapshot && typeof options.snapshot === "object" ? options.snapshot : {};
    const filesChanged = Array.isArray(snapshot.filesChanged) ? snapshot.filesChanged.slice(-20) : [];
    const nextState = {
      schemaVersion: 1,
      workspace: root,
      projectName: map.name,
      projectKind: map.kind,
      framework: map.framework,
      runCommand: map.runCommand,
      lastIntent: classification.intent,
      lastTarget: target || prior.lastTarget || map.kind,
      recentFiles: filesChanged.length ? filesChanged : (prior.recentFiles || []).slice(-20),
      lastUserText: input,
      lastResolvedGoal: changed ? goal : "",
      updatedAt: new Date().toISOString(),
    };
    this.save(root, nextState);

    return {
      original: input,
      goal,
      changed,
      reason,
      intent: classification.intent,
      confidence: classification.confidence,
      target,
      reference,
      repo: {
        name: map.name,
        kind: map.kind,
        framework: map.framework,
        runScript: map.runScript,
        runCommand: map.runCommand,
        keyFiles: map.keyFiles,
      },
      state: nextState,
    };
  }
}

module.exports = {
  ContextUnderstanding,
  classifyIntent,
  repoMap,
  recentTarget,
};
