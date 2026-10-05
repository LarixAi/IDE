"use strict";

const { ReadOnlyToolProvider } = require("../../packages/agent-runtime/tool-registry");

const RESEARCH_TOOL = "research.engineer";

class ResearchModeToolProvider extends ReadOnlyToolProvider {
  constructor(host, researchEngineer) {
    super(host);
    this.researchEngineer = researchEngineer || null;
  }

  definitions() {
    const base = super.definitions();
    const research = this.researchEngineer && typeof this.researchEngineer.listTools === "function"
      ? this.researchEngineer.listTools()
      : [];
    const tools = Array.isArray(research) ? research : [];
    return base.concat(
      tools
        .filter((tool) => tool && tool.name === RESEARCH_TOOL)
        .map((tool) => ({
          ...tool,
          description: "Primary Research mode tool. Call this before answering questions that benefit from current or external evidence. " + String(tool.description || ""),
        })),
    );
  }

  async call(name, args = {}) {
    if (name === RESEARCH_TOOL) {
      if (!this.researchEngineer || typeof this.researchEngineer.call !== "function") {
        return {
          ok: false,
          tool: name,
          trusted: false,
          error: { code: "research_unavailable", message: "Research Engineer is not available." },
        };
      }
      return this.researchEngineer.call(name, args);
    }
    return super.call(name, args);
  }
}

module.exports = { ResearchModeToolProvider, RESEARCH_TOOL };
