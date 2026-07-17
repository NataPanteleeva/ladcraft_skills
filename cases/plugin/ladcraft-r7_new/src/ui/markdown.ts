import { markdownToHtml } from "../markdown/html";

/** Render assistant message text with basic markdown formatting. */
export function renderMarkdown(text: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "message-md";
  paintMarkdownBody(root, text);
  return root;
}

/** Paint markdown into an existing chat message body node. */
export function paintMarkdownBody(target: HTMLElement, text: string): void {
  target.innerHTML = markdownToHtml(text);
}
