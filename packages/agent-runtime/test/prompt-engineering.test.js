"use strict";

const assert = require("node:assert/strict");
const {
  CODE_PROMPT_PROTOCOL,
  PLAN_PROMPT_PROTOCOL,
  ASK_PROMPT_PROTOCOL,
} = require("../prompt-engineering");
const {
  PIPELINE_SYSTEM_INSTRUCTIONS,
  PLAN_SYSTEM_INSTRUCTIONS,
  ASK_SYSTEM_INSTRUCTIONS,
} = require("../pipeline-instructions");

assert.match(CODE_PROMPT_PROTOCOL, /acceptance criteria/i);
assert.match(CODE_PROMPT_PROTOCOL, /HTTP 200/i);
assert.match(CODE_PROMPT_PROTOCOL, /blocked\/incomplete/i);
assert.match(CODE_PROMPT_PROTOCOL, /exact observation/i);
assert.match(PLAN_PROMPT_PROTOCOL, /observable acceptance criteria/i);
assert.match(ASK_PROMPT_PROTOCOL, /verified facts/i);

assert.match(PIPELINE_SYSTEM_INSTRUCTIONS, /Execution contract:/);
assert.match(PLAN_SYSTEM_INSTRUCTIONS, /Planning contract:/);
assert.match(ASK_SYSTEM_INSTRUCTIONS, /Answering contract:/);

console.log("prompt engineering contract tests passed");
