"use strict";

const { condenseMessages } = require("../context-condenser");

function compressContext(messages, options = {}) {
  return condenseMessages(messages, {
    maxChars: options.maxChars || 56000,
    triggerRatio: options.triggerRatio,
    targetRatio: options.targetRatio,
    keepRecent: options.keepRecent,
    maxItemChars: options.maxItemChars,
  });
}

module.exports = {
  compressContext,
};
