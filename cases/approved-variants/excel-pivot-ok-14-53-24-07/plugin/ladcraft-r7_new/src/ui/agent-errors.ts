import type { HistoryMessage } from "../eai/session";
import { showInfoDialog } from "./info-dialog";

export interface LadcraftChatError {
  id: string;
  code: string;
  message: string;
}

function errorPayload(item: HistoryMessage): { code: string; message: string } | null {
  const raw = (item as HistoryMessage & { error?: unknown }).error;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const message =
      (typeof obj.message === "string" && obj.message.trim()) ||
      (typeof item.content === "string" && item.content.trim()) ||
      "";
    const code =
      (typeof obj.code === "string" && obj.code.trim()) ||
      (item.kind === "error" ? "AGENT_ERROR" : "ERROR");
    if (message) return { code, message };
  }
  const status = (item.status || "").toLowerCase();
  const content = (item.content || "").trim();
  if (
    (item.role === "system" && (item.kind === "error" || /не удалось/i.test(content))) ||
    status === "failed" ||
    status === "error"
  ) {
    if (content) {
      return { code: "AGENT_ERROR", message: content };
    }
  }
  return null;
}

/** Collect Ladcraft server-side errors from session history (newest last). */
export function collectLadcraftChatErrors(items: HistoryMessage[]): LadcraftChatError[] {
  const out: LadcraftChatError[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const payload = errorPayload(item);
    if (!payload) continue;
    const id = item.id || `${payload.code}:${payload.message}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, code: payload.code, message: payload.message });
  }
  return out;
}

export function explainLadcraftChatError(err: LadcraftChatError): {
  title: string;
  body: string;
  hints: string;
} {
  const msg = err.message.trim();
  const modelFail = /не удалось получить ответ от модели/i.test(msg);

  if (modelFail || err.code === "AGENT_ERROR") {
    return {
      title: "Сбой ответа агента",
      body:
        "Сервер Ladcraft не завершил ответ модели (таймаут, лимит или внутренняя ошибка). " +
        "Часть шагов могла уже выполниться — смотрите сообщения выше в чате плагина.",
      hints:
        "Что можно сделать:\n" +
        "• повторить запрос в этом чате;\n" +
        "• открыть тот же чат на сайте Ladcraft и сверить историю;\n" +
        "• позже обновить навык/агента в каталоге, если ошибка повторяется.\n\n" +
        "Сейчас ничего обязательного делать не нужно — закройте окно и решите, как продолжить.",
    };
  }

  return {
    title: "Ошибка Ladcraft",
    body: msg || "Произошла ошибка при работе агента.",
    hints:
      "Что можно сделать:\n" +
      "• повторить запрос;\n" +
      "• проверить чат на сайте Ladcraft;\n" +
      "• при повторении — обновить навык/агента позже.\n\n" +
      "Окно можно просто закрыть.",
  };
}

/** Show at most one new error dialog per sync (tracked by caller via lastShownId). */
export function maybeShowLadcraftErrorDialog(
  errors: LadcraftChatError[],
  lastShownId: string | null,
): string | null {
  if (!errors.length) return lastShownId;
  const latest = errors[errors.length - 1];
  if (latest.id === lastShownId) return lastShownId;
  const explained = explainLadcraftChatError(latest);
  showInfoDialog(explained);
  return latest.id;
}
