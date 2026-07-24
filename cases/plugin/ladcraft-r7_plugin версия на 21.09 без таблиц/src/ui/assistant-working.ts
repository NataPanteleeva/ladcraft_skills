import {
  STREAMING_TABLE_PLACEHOLDER,
  STREAMING_WORKING_PLACEHOLDER,
} from "../apply/content-extract";

const WORKING_PLACEHOLDERS = new Set([
  STREAMING_TABLE_PLACEHOLDER,
  STREAMING_WORKING_PLACEHOLDER,
]);

export function isAssistantWorkingPlaceholder(text: string): boolean {
  return WORKING_PLACEHOLDERS.has(text.trim());
}

export function shouldShowAssistantSpinner(text: string, streaming: boolean): boolean {
  if (!streaming) return isAssistantWorkingPlaceholder(text);
  return !text.trim() || isAssistantWorkingPlaceholder(text);
}

export function createAgentSpinner(): HTMLElement {
  const spinner = document.createElement("span");
  spinner.className = "agent-spinner";
  spinner.setAttribute("aria-hidden", "true");
  return spinner;
}

/** Spinner + label for in-progress assistant turns (stream or history placeholder). */
export function fillAssistantWorkingBody(body: HTMLElement, text: string): void {
  const row = document.createElement("div");
  row.className = "agent-working-row";
  row.appendChild(createAgentSpinner());
  const label = document.createElement("span");
  label.className = "agent-working-label";
  label.textContent = text.trim() || STREAMING_WORKING_PLACEHOLDER;
  row.appendChild(label);
  body.appendChild(row);
}
