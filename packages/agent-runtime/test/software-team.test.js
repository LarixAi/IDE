"use strict";

const assert = require("assert");
const test = require("node:test");

const {
  selectProfile,
  createSoftwareTeamPlan,
  softwareTeamContext,
} = require("../software-team");

test("full product builds get the complete software-team role sequence", () => {
  const goal = "Build a car dealership website with accounts, bidding, payments, admin and a database.";
  const workspace = { state: "empty", frameworks: [] };
  const plan = createSoftwareTeamPlan({ goal, workspace });

  assert.equal(selectProfile(goal, workspace, plan.decision), "full");
  assert.equal(plan.enabled, true);
  assert.deepEqual(
    plan.roles.map((role) => role.id),
    ["product_manager", "software_architect", "project_manager", "engineer", "reviewer"],
  );

  const context = softwareTeamContext(plan);
  assert.match(context, /existing CodeMe\/OpenHands-style execution loop/);
  assert.match(context, /Product Manager/);
  assert.match(context, /Software Architect/);
  assert.match(context, /QA \/ Reviewer/);
  assert.match(context, /Full-build handoff/);
});

test("existing web changes use a compact architect-engineer-reviewer handoff", () => {
  const goal = "Fix the login form on this React website.";
  const workspace = { state: "project", frameworks: ["react"] };
  const plan = createSoftwareTeamPlan({ goal, workspace });

  assert.equal(plan.profile, "compact");
  assert.deepEqual(
    plan.roles.map((role) => role.id),
    ["software_architect", "engineer", "reviewer"],
  );
  assert.match(softwareTeamContext(plan), /Existing-project handoff/);
});

test("non-product utility tasks do not add the software-team prompt layer", () => {
  const plan = createSoftwareTeamPlan({
    goal: "Rename this local text file.",
    workspace: { state: "project" },
  });

  assert.equal(plan.enabled, false);
  assert.equal(plan.profile, "none");
  assert.equal(softwareTeamContext(plan), "");
});
