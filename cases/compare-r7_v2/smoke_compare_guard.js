"use strict";

/**
 * COMPARE-turn transport guards (ADR-006).
 * @param {object[]} toolCalls - tool_calls from assistant messages in one turn
 * @returns {{ ok: boolean, errors: object[], bashTemplateHead: boolean, bashSessionHead: boolean, bashCount: number }}
 */
function assertCompareTransport(toolCalls, toolBatches) {
  const errors = [];
  let bashCount = 0;
  let bashTemplateHead = false;
  let bashSessionHead = false;
  let persistCount = 0;

  const batches = Array.isArray(toolBatches) && toolBatches.length
    ? toolBatches
    : [toolCalls];

  for (const batch of batches) {
    let batchHasBash = false;
    let batchHasPersist = false;
    for (const tc of batch) {
      const name = tc.name || "";
      if (name === "bash") batchHasBash = true;
      if (name === "r7_persist_compare_report") batchHasPersist = true;
    }
    if (batchHasBash && batchHasPersist) {
      errors.push({ reason: "persist_parallel_with_bash" });
    }
  }

  for (const tc of toolCalls) {
    const name = tc.name || "";
    const cmd = String((tc.arguments && tc.arguments.command) || tc.command || "");

    if (name === "compare_documents" || name === "read_r7_snapshot_text" || name === "startup_compare") {
      errors.push({ reason: "forbidden_skill_tool", name });
    }

    if (name === "r7_persist_compare_report") {
      persistCount++;
    }

    if (name === "bash") {
      bashCount++;
      if (/python|<<'PY'/.test(cmd)) errors.push({ reason: "python", command: cmd.slice(0, 100) });
      if (/\bwc\b/.test(cmd)) errors.push({ reason: "wc", command: cmd.slice(0, 100) });
      if (/\bfind\b/.test(cmd)) errors.push({ reason: "find", command: cmd.slice(0, 100) });
      if (/\.tool_results/.test(cmd)) errors.push({ reason: "tool_results_probe", command: cmd.slice(0, 100) });
      if (cmd.includes("/session/r7/") && /\bcat\b/.test(cmd) && !/\|\s*head/.test(cmd)) {
        errors.push({ reason: "cat_on_B_without_pipe_head", command: cmd.slice(0, 100) });
      }
      if (cmd.includes("Templates/") && cmd.includes("head")) bashTemplateHead = true;
      if (cmd.includes("/session/r7/") && cmd.includes("head") && !cmd.includes("8000")) bashSessionHead = true;
    }
  }

  if (bashCount > 2) {
    errors.push({ reason: "too_many_bash_on_compare_turn", bashCount });
  }
  if (persistCount > 1) {
    errors.push({ reason: "too_many_persist_on_compare_turn", persistCount });
  }
  if (persistCount < 1) {
    errors.push({ reason: "missing_persist_on_compare_turn", persistCount });
  }

  let persistOkCount = 0;
  for (const tc of toolCalls) {
    if (tc.name !== "r7_persist_compare_report") continue;
    if (tc.success === true || tc.status === "completed") persistOkCount++;
  }
  if (persistCount > 0 && persistOkCount < 1) {
    errors.push({ reason: "persist_failed", persistCount, persistOkCount });
  }

  return {
    ok: errors.length === 0 && bashTemplateHead && bashSessionHead,
    errors,
    bashTemplateHead,
    bashSessionHead,
    bashCount,
    persistCount,
  };
}

/**
 * Tool calls grouped by assistant message (one batch per message).
 */
function collectCompareTurnToolBatches(history, afterUserIndex) {
  const items = Array.isArray(history) ? history : history.data || history;
  const batches = [];
  for (let i = afterUserIndex + 1; i < items.length; i++) {
    const m = items[i];
    if (m.role === "user") break;
    if (!m.tool_calls || !m.tool_calls.length) continue;
    batches.push(m.tool_calls);
  }
  return batches;
}

/**
 * Tool calls from assistant messages after user message at afterIndex until next user message.
 */
function collectCompareTurnToolCalls(history, afterUserIndex) {
  return collectCompareTurnToolBatches(history, afterUserIndex).flat();
}

function findNthUserIndex(history, n) {
  const items = Array.isArray(history) ? history : history.data || history;
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].role === "user") {
      count++;
      if (count === n) return i;
    }
  }
  return -1;
}

/**
 * Poll until START turn (user #1) completes with ls + activate.
 */
async function waitForStartTurnComplete(token, base, sessionId, timeoutMs) {
  const start = Date.now();
  const pollMs = 3000;
  while (Date.now() - start < timeoutMs) {
    const hist = await fetch(base + "/v1/agent/session/" + sessionId + "/history?page=1&size=99999", {
      headers: { Authorization: "Bearer " + token },
    }).then((r) => r.json());
    const items = hist.data || hist.result || hist;
    const userIdx = findNthUserIndex(items, 1);
    if (userIdx < 0) {
      await new Promise((r) => setTimeout(r, pollMs));
      continue;
    }
    const calls = collectCompareTurnToolCalls(items, userIdx);
    const hasLs = calls.some(
      (tc) =>
        tc.name === "bash" &&
        String((tc.arguments && tc.arguments.command) || tc.command || "").includes("Templates")
    );
    const hasActivate = calls.some(
      (tc) =>
        tc.name === "skills" &&
        /doc-compare-v2|r7-document-compare/.test(
          String((tc.arguments && tc.arguments.skill_ref) || tc.command || "")
        )
    );
    const text = collectTurnAssistantText(items, userIdx);
    if (hasLs && hasActivate && text.trim().length > 20) {
      return { ok: true, waited_ms: Date.now() - start, history: items };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ok: false, waited_ms: Date.now() - start };
}

/**
 * Poll history until assistant turn after nth user message has compare completion signals.
 * @param {number} userNumber - 1-based user message index (COMPARE = 2)
 */
async function waitForCompareTurnComplete(token, base, sessionId, userNumber, timeoutMs) {
  const start = Date.now();
  const pollMs = 5000;
  while (Date.now() - start < timeoutMs) {
    const hist = await fetch(base + "/v1/agent/session/" + sessionId + "/history?page=1&size=99999", {
      headers: { Authorization: "Bearer " + token },
    }).then((r) => r.json());
    const history = hist.data || hist.result || hist;
    const items = Array.isArray(history) ? history : history.data || history;
    const userIdx = findNthUserIndex(items, userNumber);
    if (userIdx < 0) {
      await new Promise((r) => setTimeout(r, pollMs));
      continue;
    }

    const text = collectTurnAssistantText(items, userIdx);
    const calls = collectCompareTurnToolCalls(items, userIdx);
    const batches = collectCompareTurnToolBatches(items, userIdx);
    const transport = assertCompareTransport(calls, batches);
    const closing = assertClosingPhrases(text);
    const hasR7Task = /```r7\.task/.test(text) || /deliver_inline/.test(text);

    let persistOkCount = 0;
    for (const tc of calls) {
      if (tc.name !== "r7_persist_compare_report") continue;
      if (tc.success === true || tc.status === "completed") persistOkCount++;
    }

    if (
      hasR7Task &&
      closing.ok &&
      transport.bashTemplateHead &&
      transport.bashSessionHead &&
      transport.bashCount <= 2
    ) {
      return { ok: true, waited_ms: Date.now() - start, history: items, text, transport, closing, userIdx };
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }
  const hist = await fetch(base + "/v1/agent/session/" + sessionId + "/history?page=1&size=99999", {
    headers: { Authorization: "Bearer " + token },
  }).then((r) => r.json());
  const history = hist.data || hist.result || hist;
  const items = Array.isArray(history) ? history : history.data || history;
  const userIdx = findNthUserIndex(items, userNumber);
  return {
    ok: false,
    waited_ms: Date.now() - start,
    history: items,
    userIdx,
    text: userIdx >= 0 ? collectTurnAssistantText(items, userIdx) : "",
    transport:
      userIdx >= 0
        ? assertCompareTransport(
            collectCompareTurnToolCalls(items, userIdx),
            collectCompareTurnToolBatches(items, userIdx)
          )
        : { ok: false, errors: [{ reason: "compare_user_missing" }] },
    closing: assertClosingPhrases(userIdx >= 0 ? collectTurnAssistantText(items, userIdx) : ""),
  };
}

/**
 * Assistant text for one turn (after user message until next user).
 */
function collectTurnAssistantText(history, afterUserIndex) {
  const items = Array.isArray(history) ? history : history.data || history;
  const parts = [];
  for (let i = afterUserIndex + 1; i < items.length; i++) {
    const m = items[i];
    if (m.role === "user") break;
    if (m.role === "assistant" && typeof m.content === "string" && m.content.trim()) {
      parts.push(m.content);
    }
  }
  return parts.join("\n");
}

/**
 * Intent-gated closing phrases (plugin UX contract).
 * @param {string} assistantText - full assistant text on COMPARE turn
 */
function assertClosingPhrases(assistantText) {
  const errors = [];
  const text = String(assistantText || "");

  if (/Хотите\s+(вставить|скачать)/i.test(text)) {
    errors.push({ reason: "forbidden_question_closing", match: "Хотите вставить/скачать" });
  }
  if (!/напишите:\s*(?:\*\*)?вставить/i.test(text)) {
    errors.push({ reason: "missing_insert_hint" });
  }
  if (!/напишите:\s*(?:\*\*)?скачать/i.test(text)) {
    errors.push({ reason: "missing_download_hint" });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * EXPORT turn: 1× r7_render_and_deliver_docx, no bash, no skills activate.
 */
function assertExportTransport(toolCalls) {
  const errors = [];
  let renderCount = 0;

  for (const tc of toolCalls) {
    const name = tc.name || "";
    const cmd = String((tc.arguments && tc.arguments.command) || tc.command || "");
    if (name === "r7_render_and_deliver_docx") renderCount++;
    if (name === "bash") {
      errors.push({ reason: "bash_on_export", command: cmd.slice(0, 80) });
    }
    if (name === "skills" || String(cmd).includes("activate")) {
      errors.push({ reason: "skills_activate_on_export", command: cmd.slice(0, 80) });
    }
  }

  if (renderCount !== 1) {
    errors.push({ reason: "export_render_count", renderCount });
  }

  return { ok: errors.length === 0, errors, renderCount };
}

module.exports = {
  assertCompareTransport,
  assertClosingPhrases,
  assertExportTransport,
  collectCompareTurnToolBatches,
  collectCompareTurnToolCalls,
  collectTurnAssistantText,
  findNthUserIndex,
  waitForStartTurnComplete,
  waitForCompareTurnComplete,
};
