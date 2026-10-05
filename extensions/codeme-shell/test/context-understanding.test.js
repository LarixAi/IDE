"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ContextUnderstanding,
  classifyIntent,
  repoMap,
} = require("../context-understanding");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-context-"));
const root = path.join(tmp, "dealership");
const storage = path.join(tmp, "state");
fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
  scripts: { dev: "vite --host 127.0.0.1" },
  dependencies: { react: "^19.0.0", vite: "^7.0.0" },
}, null, 2));
fs.writeFileSync(path.join(root, "src", "App.jsx"), "export default function App(){return <main>Cars</main>}");

const map = repoMap(root);
assert.strictEqual(map.kind, "website");
assert.strictEqual(map.framework, "React + Vite");
assert.strictEqual(map.runCommand, "npm run dev");
assert.ok(map.keyFiles.includes("package.json"));

const intent = classifyIntent("let me see it");
assert.strictEqual(intent.intent, "run_project");
assert.ok(intent.confidence > 0.8);

const resolver = new ContextUnderstanding({
  getRoot: () => root,
  storageDir: storage,
});

const first = resolver.resolve("Build a dealership website", {
  thread: [],
  snapshot: { filesChanged: ["src/App.jsx"] },
});
assert.strictEqual(first.changed, false);
assert.strictEqual(first.target, "website");

const run = resolver.resolve("run it", {
  thread: [
    { role: "user", text: "Build a dealership website" },
    { role: "assistant", text: "Created the dealership website." },
  ],
  snapshot: { filesChanged: ["src/App.jsx"] },
});
assert.strictEqual(run.changed, true);
assert.strictEqual(run.intent, "run_project");
assert.strictEqual(run.target, "website");
assert.match(run.goal, /Run the existing website/);
assert.match(run.goal, /npm run dev/);
assert.match(run.goal, /integrated preview/);
assert.match(run.goal, /do not rebuild/i);

const verify = resolver.resolve("check that", {
  thread: [
    { role: "user", text: "Build a dealership website" },
    { role: "assistant", text: "Created the dealership website." },
  ],
  snapshot: {},
});
assert.strictEqual(verify.changed, true);
assert.strictEqual(verify.intent, "verify_project");
assert.match(verify.goal, /Verify the existing website/);

const continueTask = resolver.resolve("carry on", {
  thread: [{ role: "user", text: "Add login to the website" }],
  snapshot: {},
});
assert.strictEqual(continueTask.changed, true);
assert.strictEqual(continueTask.intent, "continue_task");
assert.match(continueTask.goal, /most recent unfinished task/);

const question = resolver.resolve("what does this error mean?", {
  thread: [{ role: "assistant", text: "The website returned an error." }],
  snapshot: {},
});
assert.strictEqual(question.changed, false);

const secondResolver = new ContextUnderstanding({
  getRoot: () => root,
  storageDir: storage,
});
const persisted = secondResolver.load(root);
assert.strictEqual(persisted.projectKind, "website");
assert.ok(persisted.updatedAt);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok context understanding resolves semantic intent, references, repo state, and persistence");
