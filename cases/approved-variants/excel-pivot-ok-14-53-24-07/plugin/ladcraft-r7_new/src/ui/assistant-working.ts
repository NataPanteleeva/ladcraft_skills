import {
  STREAMING_TABLE_PLACEHOLDER,
  STREAMING_WORKING_PLACEHOLDER,
} from "../apply/content-extract";

const WORKING_PLACEHOLDERS = new Set([
  STREAMING_TABLE_PLACEHOLDER,
  STREAMING_WORKING_PLACEHOLDER,
]);

/** Short agent/status lines that should keep the spinner (not final answer). */
const WORKING_STATUS_RE =
  /^(?:агент\s+выполняет|формулирую|думаю|анализирую|читаю|готовлю|обрабатываю|выполняю|ищу|строю|запускаю|ожидайте|подождите)\b/i;

export function isAssistantWorkingPlaceholder(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (WORKING_PLACEHOLDERS.has(t)) return true;
  if (t.length <= 100 && WORKING_STATUS_RE.test(t)) return true;
  return false;
}

export function shouldShowAssistantSpinner(text: string, streaming: boolean): boolean {
  // While the turn is live, always keep the spinner (CoT like «Формулирую…» must not hide it).
  if (streaming) return true;
  return isAssistantWorkingPlaceholder(text);
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
  const trimmed = text.trim();
  label.textContent =
    !trimmed || isAssistantWorkingPlaceholder(trimmed)
      ? trimmed || STREAMING_WORKING_PLACEHOLDER
      : STREAMING_WORKING_PLACEHOLDER;
  row.appendChild(label);
  body.appendChild(row);
}

/**
 * Live turn: spinner always; optional markdown under it when real answer text arrives.
 * Prefer updateStreamingAssistantText — kept for tests / callers.
 */
export function fillAssistantStreamingBody(body: HTMLElement, text: string): void {
  fillAssistantWorkingBody(body, text);
}
