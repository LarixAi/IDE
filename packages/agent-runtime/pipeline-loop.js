"use strict";

// Compatibility shim only. The single canonical model/agent loop lives in agent-loop.js.
// Keep this module temporarily for older tests or integrations that still require pipeline-loop.
module.exports = require("./agent-loop");
