"use strict";

const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function collectMessages(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.messages)) return payload.messages;
  if (payload.data && Array.isArray(payload.data)) return payload.data;
  return [];
}

function hasCompletedWidgetTool(message) {
  const calls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  return calls.some(
    (call) => call && call.name === "r7_show_compare_actions_widget" && call.status === "completed"
  );
}

function hasCompletedTool(message, toolName) {
  const calls = Array.isArray(message.toolCalls)
    ? message.toolCalls
    : Array.isArray(message.tool_calls)
      ? message.tool_calls
      : [];
  return calls.some((call) => {
    if (!call) return false;
    const name = String(call.name || call.tool_name || "");
    const status = String(call.status || "").toLowerCase();
    return name === toolName && status === "completed";
  });
}

function hasWidgetPayload(message) {
  if (!message || typeof message !== "object") return false;
  if (message.kind === "widget") return true;
  if (typeof message.widgetHtml === "string" && message.widgetHtml.trim()) return true;
  if (typeof message.widget_html === "string" && message.widget_html.trim()) return true;
  return false;
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: node analyze_widget_history.js <history.json>");
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), input);
  const payload = readJson(filePath);
  const messages = collectMessages(payload);

  let widgetToolCompleted = 0;
  let widgetMessages = 0;
  let pseudoInvokeLines = 0;
  let endTurnLines = 0;
  let compareReports = 0;
  let fallbackEligible = 0;

  for (const message of messages) {
    if (hasCompletedWidgetTool(message)) widgetToolCompleted += 1;
    if (hasWidgetPayload(message)) widgetMessages += 1;
    const content = typeof message.content === "string" ? message.content : "";
    if (/##\s*Результаты сравнения|Расхождений:\s*\d+/i.test(content)) {
      compareReports += 1;
      if (
        hasCompletedTool(message, "r7_show_compare_actions_widget") &&
        !hasWidgetPayload(message)
      ) {
        fallbackEligible += 1;
      }
    }
    if (content.includes("<invoke") || content.includes("<tool_call") || content.includes("minimax:tool_call")) {
      pseudoInvokeLines += 1;
    }
    if (content.includes("<end_turn>")) endTurnLines += 1;
  }

  const ok = widgetToolCompleted > 0 && widgetMessages > 0;
  const report = {
    ok,
    file: filePath,
    messages: messages.length,
    widget_tool_completed: widgetToolCompleted,
    widget_messages: widgetMessages,
    compare_reports: compareReports,
    fallback_eligible_reports: fallbackEligible,
    pseudo_invoke_messages: pseudoInvokeLines,
    end_turn_messages: endTurnLines,
    note: ok
      ? "History contains completed widget tool call and widget payload."
      : "Missing widget payload in history. If widget tool was completed, runtime/history emission is broken.",
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
