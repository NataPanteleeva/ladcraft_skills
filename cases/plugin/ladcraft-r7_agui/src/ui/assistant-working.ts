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

/** Draft / findings already usable — stop pretending the bubble is empty. */
const SUBSTANTIVE_ANSWER_RE =
  /(?:^\s*\*{0,2}черновик\s*:|\br7\.proposal\b|^\s*\|\s*№\s*\|)|(^\s*#{1,3}\s+\S)/im;

export function isAssistantWorkingPlaceholder(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (WORKING_PLACEHOLDERS.has(t)) return true;
  if (t.length <= 100 && WORKING_STATUS_RE.test(t)) return true;
  return false;
}

/** True when streamed text is already a usable answer (hide spinner overlay). */
export function isSubstantiveAssistantAnswer(text: string): boolean {
  const t = text.trim();
  if (!t || isAssistantWorkingPlaceholder(t)) return false;
  if (SUBSTANTIVE_ANSWER_RE.test(t)) return true;
  // Short analyze / rewrite bodies without Черновик marker.
  return t.length >= 80;
}

export function shouldShowAssistantSpinner(text: string, streaming: boolean): boolean {
  // Real draft already on screen — don't keep «Агент выполняет…» over it while
  // AG-UI run still waits for RUN_FINISHED (tools / long model turns).
  if (isSubstantiveAssistantAnswer(text)) return false;
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
