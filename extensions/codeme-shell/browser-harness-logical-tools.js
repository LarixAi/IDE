"use strict";

const LOGICAL_BROWSER_TOOLS = new Set(["browser.check", "browser.interact"]);

function failure(tool, code, message, data) {
  return {
    ok: false,
    tool,
    error: { code, message },
    ...(data ? { data } : {}),
  };
}

function success(tool, data) {
  return { ok: true, tool, data };
}

function parseOutput(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return text;
}

function harnessData(result) {
  return result && result.data && typeof result.data === "object" ? result.data : {};
}

function harnessOutput(result) {
  return parseOutput(harnessData(result).output);
}

function ownedPreviewUrl(status) {
  if (!status || status.status !== "running") return "";
  return String(status.url || status.origin || "").trim();
}

async function callHarness(browserHarness, action, args = {}) {
  if (!browserHarness || typeof browserHarness.call !== "function") {
    return failure("browser.harness", "browser_harness_unavailable", "Browser Harness is not connected to the CodeMe browser adapter.");
  }
  if (typeof browserHarness.listTools === "function") {
    try { await browserHarness.listTools(); } catch (error) {
      return failure(
        "browser.harness",
        "browser_harness_unavailable",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return browserHarness.call("browser.harness", { action, args });
}

async function currentOwnedPreview(host) {
  if (!host || typeof host.processStatus !== "function") {
    return { ok: false, code: "preview_status_unavailable", message: "CodeMe preview status is unavailable." };
  }
  try {
    const status = await host.processStatus();
    const url = ownedPreviewUrl(status);
    if (!url) {
      return {
        ok: false,
        code: "preview_not_running",
        message: "No CodeMe-owned preview is running. Call process.start first.",
        status,
      };
    }
    return { ok: true, url, status };
  } catch (error) {
    return {
      ok: false,
      code: "preview_status_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function openPreview(browserHarness, url) {
  const goto = await callHarness(browserHarness, "goto", { url });
  if (!goto || goto.ok === false) return goto;
  const waited = await callHarness(browserHarness, "wait_for_load", { timeout: 15 });
  if (!waited || waited.ok === false) return waited;
  return { ok: true };
}

function domProbeExpression(selector, expectedText) {
  const selectorJson = JSON.stringify(String(selector || ""));
  const expectedJson = JSON.stringify(String(expectedText || ""));
  return `(() => {
    const selector = ${selectorJson};
    const expected = ${expectedJson};
    const selected = selector ? document.querySelector(selector) : document.body;
    const bodyText = String(document.body && document.body.innerText || "");
    const selectedText = String(selected && (selected.innerText || selected.textContent || selected.value) || "");
    const haystack = selector ? selectedText : bodyText;
    return {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      bodyPresent: Boolean(document.body),
      selectorFound: selector ? Boolean(selected) : true,
      selectedText: selectedText.slice(0, 12000),
      bodyText: bodyText.slice(0, 20000),
      expectedTextMatched: expected ? haystack.includes(expected) : true
    };
  })()`;
}

function clickExpression(selector, targetText) {
  const selectorJson = JSON.stringify(String(selector || ""));
  const targetJson = JSON.stringify(String(targetText || ""));
  return `(() => {
    const selector = ${selectorJson};
    const target = ${targetJson}.trim().toLowerCase();
    let el = selector ? document.querySelector(selector) : null;
    if (!el && target) {
      const candidates = Array.from(document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]'));
      el = candidates.find((node) => {
        const label = String(node.innerText || node.textContent || node.value || node.getAttribute('aria-label') || '').trim().toLowerCase();
        return label === target || label.includes(target);
      }) || null;
    }
    if (!el) return { ok: false, reason: 'target_not_found' };
    const before = String(document.body && document.body.innerText || "").slice(0, 12000);
    el.click();
    return {
      ok: true,
      tag: el.tagName,
      text: String(el.innerText || el.textContent || el.value || '').slice(0, 1000),
      before
    };
  })()`;
}

async function js(browserHarness, expression) {
  const result = await callHarness(browserHarness, "js", { expression });
  if (!result || result.ok === false) return result;
  return {
    ok: true,
    result,
    value: harnessOutput(result),
  };
}

async function browserCheck({ host, browserHarness }, args = {}) {
  const preview = await currentOwnedPreview(host);
  if (!preview.ok) return failure("browser.check", preview.code, preview.message, { session: preview.status || null });

  const opened = await openPreview(browserHarness, preview.url);
  if (!opened || opened.ok === false) {
    return failure(
      "browser.check",
      "browser_harness_navigation_failed",
      String(opened && opened.error && opened.error.message || "Browser Harness could not open the CodeMe preview."),
      { url: preview.url, engine: "browser-harness" },
    );
  }

  const probed = await js(browserHarness, domProbeExpression(args.selector, args.expectedText));
  if (!probed || probed.ok === false) {
    return failure(
      "browser.check",
      "browser_harness_observation_failed",
      String(probed && probed.error && probed.error.message || "Browser Harness could not inspect the rendered page."),
      { url: preview.url, engine: "browser-harness" },
    );
  }

  const observed = probed.value && typeof probed.value === "object" ? probed.value : {};
  if (observed.bodyPresent === false) {
    return failure("browser.check", "browser_body_missing", "The page loaded without a document body.", {
      url: preview.url,
      engine: "browser-harness",
      observation: observed,
    });
  }
  if (args.selector && observed.selectorFound !== true) {
    return failure("browser.check", "browser_selector_missing", "The requested selector was not found: " + args.selector, {
      url: preview.url,
      engine: "browser-harness",
      observation: observed,
    });
  }
  if (args.expectedText && observed.expectedTextMatched !== true) {
    return failure("browser.check", "browser_text_missing", "The expected rendered text was not found: " + args.expectedText, {
      url: preview.url,
      engine: "browser-harness",
      observation: observed,
    });
  }

  return success("browser.check", {
    available: true,
    url: String(observed.url || preview.url),
    title: String(observed.title || ""),
    renderedText: String(args.selector ? observed.selectedText || "" : observed.bodyText || ""),
    expectedText: String(args.expectedText || ""),
    expectedTextMatched: args.expectedText ? observed.expectedTextMatched === true : true,
    selector: String(args.selector || ""),
    selectorFound: args.selector ? observed.selectorFound === true : true,
    readyState: String(observed.readyState || ""),
    engine: "browser-harness",
    session: preview.status,
  });
}

async function assertText(browserHarness, step) {
  const probed = await js(browserHarness, domProbeExpression(step.selector, step.expectedText));
  if (!probed || probed.ok === false) return probed;
  const observed = probed.value && typeof probed.value === "object" ? probed.value : {};
  if (step.selector && observed.selectorFound !== true) {
    return failure("browser.interact", "browser_selector_missing", "The requested selector was not found: " + step.selector);
  }
  if (step.expectedText && observed.expectedTextMatched !== true) {
    return failure("browser.interact", "browser_text_missing", "The expected rendered text was not found: " + step.expectedText);
  }
  return { ok: true, observed };
}

async function performStep(browserHarness, step = {}) {
  const action = String(step.action || "");
  if (action === "fill") {
    const selector = String(step.selector || "");
    if (!selector) return failure("browser.interact", "browser_selector_required", "fill requires a selector.");
    const result = await callHarness(browserHarness, "fill", {
      selector,
      text: String(step.value || ""),
      clear_first: true,
    });
    if (!result || result.ok === false) return result;
    return { ok: true, afterText: String(step.value || "") };
  }

  if (action === "click") {
    const clicked = await js(browserHarness, clickExpression(step.selector, step.targetText));
    if (!clicked || clicked.ok === false) return clicked;
    const value = clicked.value && typeof clicked.value === "object" ? clicked.value : {};
    if (value.ok === false) {
      return failure(
        "browser.interact",
        "browser_target_missing",
        "The requested click target was not found.",
      );
    }
    await callHarness(browserHarness, "wait", { seconds: 0.35 });
    const after = await js(browserHarness, domProbeExpression("", ""));
    const afterObserved = after && after.ok && after.value && typeof after.value === "object" ? after.value : {};
    return {
      ok: true,
      beforeText: String(value.before || ""),
      afterText: String(afterObserved.bodyText || ""),
      targetText: String(step.targetText || value.text || ""),
      url: String(afterObserved.url || ""),
    };
  }

  if (action === "assertText") {
    const asserted = await assertText(browserHarness, step);
    if (!asserted || asserted.ok === false) return asserted;
    return {
      ok: true,
      afterText: String(
        step.selector
          ? asserted.observed.selectedText || ""
          : asserted.observed.bodyText || "",
      ),
      expectedText: String(step.expectedText || ""),
      matched: true,
      url: String(asserted.observed.url || ""),
    };
  }

  return failure("browser.interact", "browser_action_unsupported", "Unsupported browser interaction action: " + action);
}

async function browserInteract({ host, browserHarness }, args = {}) {
  const preview = await currentOwnedPreview(host);
  if (!preview.ok) return failure("browser.interact", preview.code, preview.message, { session: preview.status || null });

  const opened = await openPreview(browserHarness, preview.url);
  if (!opened || opened.ok === false) {
    return failure(
      "browser.interact",
      "browser_harness_navigation_failed",
      String(opened && opened.error && opened.error.message || "Browser Harness could not open the CodeMe preview."),
      { url: preview.url, engine: "browser-harness" },
    );
  }

  const steps = String(args.action || "") === "sequence"
    ? (Array.isArray(args.steps) ? args.steps : [])
    : [args];

  if (!steps.length) {
    return failure("browser.interact", "browser_steps_required", "sequence requires at least one browser interaction step.");
  }

  const evidence = [];
  for (const step of steps.slice(0, 12)) {
    const result = await performStep(browserHarness, step);
    if (!result || result.ok === false) {
      const message = String(
        result && result.error && result.error.message
          || "Browser Harness interaction failed.",
      );
      return failure(
        "browser.interact",
        result && result.error && result.error.code || "browser_harness_interaction_failed",
        message,
        { url: preview.url, engine: "browser-harness", evidence },
      );
    }
    evidence.push({
      action: String(step.action || ""),
      selector: String(step.selector || ""),
      targetText: String(step.targetText || ""),
      expectedText: String(step.expectedText || ""),
      ...result,
    });
  }

  const last = evidence[evidence.length - 1] || {};
  return success("browser.interact", {
    available: true,
    action: String(args.action || ""),
    url: String(last.url || preview.url),
    targetText: String(last.targetText || args.targetText || ""),
    expectedText: String(last.expectedText || args.expectedText || ""),
    beforeText: String(last.beforeText || ""),
    afterText: String(last.afterText || ""),
    matched: last.matched !== false,
    steps: evidence,
    engine: "browser-harness",
    session: preview.status,
  });
}

async function callLogicalBrowserTool(context, name, args = {}) {
  if (!LOGICAL_BROWSER_TOOLS.has(name)) {
    return failure(name, "unknown_browser_tool", "Unknown logical browser tool " + name);
  }
  if (name === "browser.check") return browserCheck(context, args);
  return browserInteract(context, args);
}

module.exports = {
  LOGICAL_BROWSER_TOOLS,
  browserCheck,
  browserInteract,
  callLogicalBrowserTool,
  domProbeExpression,
  clickExpression,
  ownedPreviewUrl,
  parseOutput,
};
