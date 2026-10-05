"use strict";

const { decideProject, projectDecisionContext } = require("./project-decision");

const ROLE_LIBRARY = Object.freeze({
  product_manager: Object.freeze({
    id: "product_manager",
    label: "Product Manager",
    objective: "Turn the user's request into product outcomes, user journeys, feature requirements, and observable acceptance criteria without shrinking the original scope.",
  }),
  software_architect: Object.freeze({
    id: "software_architect",
    label: "Software Architect",
    objective: "Inspect the existing project, preserve its architecture when present, and define the smallest coherent technical design for pages, components, state, data, APIs, auth, integrations, and dependencies.",
  }),
  project_manager: Object.freeze({
    id: "project_manager",
    label: "Project Manager",
    objective: "Order the work into dependency-aware implementation slices and keep the next action tied to an unmet acceptance criterion.",
  }),
  engineer: Object.freeze({
    id: "engineer",
    label: "Engineer",
    objective: "Implement the plan with CodeMe's existing tools and agent loop, using repository evidence instead of assumptions and making complete working changes rather than placeholders.",
  }),
  reviewer: Object.freeze({
    id: "reviewer",
    label: "QA / Reviewer",
    objective: "Reconcile the finished work against the original request and acceptance criteria, then require diagnostics, tests, browser checks, and interaction checks that prove the requested behavior.",
  }),
});

const COMPLEX_PRODUCT_SIGNAL = /\b(auth|authentication|login|accounts?|payments?|checkout|database|api|backend|admin|dashboard|booking|bidding|orders?|roles?|permissions?|upload|notifications?|realtime|real-time|multi[- ]page|full[- ]stack)\b/i;
const PRODUCT_SURFACE_SIGNAL = /\b(website|web\s*site|web\s*app|application|app|portal|dashboard|store|shop|marketplace|dealership|booking|frontend|front-end|backend|back-end|api)\b/i;
const BUILD_SIGNAL = /\b(build|create|make|develop|implement|design|redesign|add|feature|system)\b/i;

function isEmptyWorkspace(workspace) {
  return String(workspace && workspace.state || "").toLowerCase() === "empty";
}

function selectProfile(goal, workspace = {}, decision) {
  const text = String(goal || "");
  const resolved = decision || decideProject(text, workspace);

  if (!PRODUCT_SURFACE_SIGNAL.test(text) && !COMPLEX_PRODUCT_SIGNAL.test(text)) {
    return "none";
  }

  if (
    isEmptyWorkspace(workspace)
    || resolved.kind === "full_stack"
    || (BUILD_SIGNAL.test(text) && COMPLEX_PRODUCT_SIGNAL.test(text))
  ) {
    return "full";
  }

  return "compact";
}

function roleIdsForProfile(profile) {
  if (profile === "full") {
    return [
      "product_manager",
      "software_architect",
      "project_manager",
      "engineer",
      "reviewer",
    ];
  }
  if (profile === "compact") {
    return ["software_architect", "engineer", "reviewer"];
  }
  return [];
}

function createSoftwareTeamPlan(input = {}) {
  const goal = String(input.goal || "");
  const workspace = input.workspace && typeof input.workspace === "object" ? input.workspace : {};
  const decision = input.decision || decideProject(goal, workspace);
  const profile = input.profile || selectProfile(goal, workspace, decision);
  const roleIds = roleIdsForProfile(profile);
  const roles = roleIds.map((id) => ROLE_LIBRARY[id]);

  return {
    enabled: roles.length > 0,
    profile,
    decision,
    roles,
    source: "metagpt-inspired",
    loopPolicy: "existing-codeme-loop-only",
  };
}

function softwareTeamContext(plan) {
  if (!plan || !plan.enabled || !Array.isArray(plan.roles) || plan.roles.length === 0) return "";

  const lines = [
    "SOFTWARE TEAM SOP (MetaGPT-inspired planning layer; keep the existing CodeMe/OpenHands-style execution loop):",
    "- This is a sequence of responsibilities inside the current run, not a second autonomous agent loop and not a requirement to spawn multiple models.",
    "- Keep the user's original objective and tracked requirements authoritative across every role handoff.",
    "- Do not produce long role-play narration. Convert each role's work into concise implementation decisions, acceptance criteria, and the next tool action.",
    "- Repository contents and tool observations override assumptions. Existing architecture should be preserved unless the user explicitly asks to replace it.",
    "- Research Engineer may be used when a technical choice depends on current external evidence; low-level file and terminal work stays in the CodeMe loop.",
    "- Finish only after the reviewer responsibility has evidence for the requested behavior.",
    projectDecisionContext(plan.decision),
    "",
    "Role sequence:",
  ];

  plan.roles.forEach((role, index) => {
    lines.push((index + 1) + ". " + role.label + " — " + role.objective);
  });

  if (plan.profile === "full") {
    lines.push(
      "",
      "Full-build handoff:",
      "- Product Manager: identify users, journeys, required features, constraints, and acceptance criteria.",
      "- Software Architect: inspect the workspace first; define the implementation shape, data boundaries, routes/APIs, dependencies, and risks.",
      "- Project Manager: order the implementation so the smallest vertical slice works end-to-end before secondary polish.",
      "- Engineer: implement with native CodeMe tools and repair from exact observations.",
      "- QA / Reviewer: verify the original product request end-to-end, including real browser behavior where relevant.",
    );
  } else {
    lines.push(
      "",
      "Existing-project handoff:",
      "- Software Architect: understand the current structure and identify the smallest safe change.",
      "- Engineer: implement that change without unnecessary rewrites.",
      "- QA / Reviewer: verify the requested behavior after the latest edit.",
    );
  }

  return lines.join("\n");
}

module.exports = {
  ROLE_LIBRARY,
  selectProfile,
  createSoftwareTeamPlan,
  softwareTeamContext,
};
