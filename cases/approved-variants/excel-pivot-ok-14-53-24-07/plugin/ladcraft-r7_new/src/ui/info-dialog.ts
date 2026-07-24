/**
 * Informational modal: explain a Ladcraft/plugin issue, no required actions.
 * User dismisses with OK or ×, then decides what to do in chat / catalog.
 */

export interface InfoDialogOptions {
  title: string;
  body: string;
  /** Short “what you can do” block (plain text, newlines OK). */
  hints?: string;
}

let openDialog: HTMLElement | null = null;

export function showInfoDialog(options: InfoDialogOptions): void {
  closeInfoDialog();

  const overlay = document.createElement("div");
  overlay.className = "lc-info-dialog-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "lc-info-dialog-title");

  const panel = document.createElement("div");
  panel.className = "lc-info-dialog";

  const header = document.createElement("div");
  header.className = "lc-info-dialog-header";

  const title = document.createElement("div");
  title.id = "lc-info-dialog-title";
  title.className = "lc-info-dialog-title";
  title.textContent = options.title;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "lc-info-dialog-close";
  closeBtn.setAttribute("aria-label", "Закрыть");
  closeBtn.textContent = "×";

  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "lc-info-dialog-body";
  body.textContent = options.body;

  panel.appendChild(header);
  panel.appendChild(body);

  if (options.hints?.trim()) {
    const hints = document.createElement("div");
    hints.className = "lc-info-dialog-hints";
    hints.textContent = options.hints.trim();
    panel.appendChild(hints);
  }

  const footer = document.createElement("div");
  footer.className = "lc-info-dialog-footer";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "lc-info-dialog-ok";
  ok.textContent = "Понятно";
  footer.appendChild(ok);
  panel.appendChild(footer);

  overlay.appendChild(panel);

  const dismiss = () => closeInfoDialog();
  closeBtn.addEventListener("click", dismiss);
  ok.addEventListener("click", dismiss);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) dismiss();
  });

  document.body.appendChild(overlay);
  openDialog = overlay;
  ok.focus();
}

export function closeInfoDialog(): void {
  if (!openDialog) return;
  openDialog.remove();
  openDialog = null;
}
