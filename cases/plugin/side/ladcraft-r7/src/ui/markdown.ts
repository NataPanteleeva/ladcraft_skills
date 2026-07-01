import { markdownToHtml } from "../markdown/html";

/** Render assistant message text with basic markdown formatting. */
export function renderMarkdown(text: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "message-body";
  root.innerHTML = markdownToHtml(text);
  return root;
}
