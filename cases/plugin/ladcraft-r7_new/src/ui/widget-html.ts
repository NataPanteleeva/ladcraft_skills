import type { ChatWidget } from "./chat";

const WIDGET_SUBMIT = "ladcraft-r7-widget-submit";

/** Build srcdoc HTML with a postMessage bridge for Ladcraft widget templates. */
export function buildWidgetSrcDoc(html: string, interactive: boolean): string {
  const bridge = interactive
    ? `<script>
(function () {
  function submit(value) {
    if (value == null || value === "") return;
    var text = typeof value === "string" ? value : JSON.stringify(value);
    parent.postMessage({ type: "${WIDGET_SUBMIT}", value: text }, "*");
  }

  window.ladcraftWidget = { submit: submit, postMessage: submit };
  window.parentPostMessage = function (data) {
    if (typeof data === "string") submit(data);
    else if (data && typeof data.content === "string") submit(data.content);
    else if (data && data.value != null) submit(data.value);
    else submit(data);
  };

  document.addEventListener("submit", function (event) {
    event.preventDefault();
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    var data = new FormData(form);
    var parts = [];
    data.forEach(function (value, key) {
      if (String(value).trim()) parts.push(key + ": " + value);
    });
    if (!parts.length) {
      var checked = form.querySelector("input[type=radio]:checked, input[type=checkbox]:checked");
      if (checked instanceof HTMLInputElement && checked.value) submit(checked.value);
      return;
    }
    submit(parts.join("\\n"));
  }, true);

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!(target instanceof HTMLElement)) return;
    var button = target.closest("button,[data-widget-submit],[data-action=submit]");
    if (!button || button.getAttribute("type") === "submit") return;
    var form = button.closest("form");
    if (form) return;
    var label = button.textContent ? button.textContent.trim() : "";
    var value = button.getAttribute("data-value") || label;
    if (value) submit(value);
  }, true);

  function reportHeight() {
    var height = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
      80,
    );
    parent.postMessage({ type: "ladcraft-r7-widget-resize", height: height }, "*");
  }

  window.addEventListener("load", reportHeight);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(reportHeight).observe(document.documentElement);
  } else {
    setInterval(reportHeight, 500);
  }
})();
</script>`
    : "";

  const hasHtmlShell = /<html[\s>]/i.test(html);
  if (hasHtmlShell) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${bridge}`);
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body { margin: 0; padding: 8px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; color: #1f2937; }
button, input, select, textarea { font: inherit; }
</style>${bridge}</head><body>${html}</body></html>`;
}

/** Parse postMessage payloads from widget iframe. */
export function parseWidgetSubmitPayload(data: unknown): string | null {
  if (typeof data === "string" && data.trim()) return data.trim();

  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;

  if (record.type === WIDGET_SUBMIT && typeof record.value === "string") {
    return record.value.trim() || null;
  }

  const action = record.action ?? record.type;
  if (
    action === "submit" ||
    action === "widget_submit" ||
    action === "submitUserInput" ||
    action === "user_input"
  ) {
    const value =
      record.value ?? record.content ?? record.answer ?? record.payload ?? record.data;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value != null) return JSON.stringify(value);
  }

  return null;
}

/** Mount widget HTML inside a sandboxed iframe. */
export function renderWidgetHtml(
  widget: ChatWidget,
  onSubmit: (value: string) => void,
): HTMLElement {
  const host = document.createElement("div");
  host.className = `widget-host${widget.interactive ? "" : " widget-settled"}`;

  if (widget.name) {
    const title = document.createElement("div");
    title.className = "widget-title";
    title.textContent = widget.name;
    host.appendChild(title);
  }

  const iframe = document.createElement("iframe");
  iframe.className = "widget-frame";
  iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.srcdoc = buildWidgetSrcDoc(widget.html, widget.interactive);
  iframe.style.height = "120px";

  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;

    const resize = event.data as { type?: string; height?: number };
    if (resize?.type === "ladcraft-r7-widget-resize" && typeof resize.height === "number") {
      iframe.style.height = `${Math.min(resize.height + 8, 480)}px`;
      return;
    }

    if (!widget.interactive) return;
    const value = parseWidgetSubmitPayload(event.data);
    if (!value) return;

    window.removeEventListener("message", onMessage);
    onSubmit(value);
  };

  window.addEventListener("message", onMessage);
  host.appendChild(iframe);
  return host;
}
