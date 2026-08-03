/** Simple clickable list when Ladcraft widget_html is not in history API. */

export function renderWidgetChoiceList(
  choices: string[],
  onSelect: (value: string) => void,
): HTMLElement {
  const host = document.createElement("div");
  host.className = "widget-choice-list";

  const title = document.createElement("div");
  title.className = "widget-choice-title";
  title.textContent = "Выберите вариант:";
  host.appendChild(title);

  const list = document.createElement("ul");
  list.className = "widget-choice-items";

  for (const choice of choices) {
    const item = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "widget-choice-btn";
    btn.textContent = formatChoiceLabel(choice);
    btn.onclick = () => onSelect(stripChoiceArtifacts(choice));
    item.appendChild(btn);
    list.appendChild(item);
  }

  host.appendChild(list);
  return host;
}

/** Hide markdown bold / spurious `.md` from option buttons. */
export function formatChoiceLabel(choice: string): string {
  return stripChoiceArtifacts(choice).replace(/\*\*/g, "").trim();
}

/**
 * Remove compare-template false suffix (long analytics line + `.md`)
 * and surrounding fences.
 */
export function stripChoiceArtifacts(choice: string): string {
  let s = String(choice || "").trim().replace(/^`+|`+$/g, "");
  if (/\.md$/i.test(s) && (s.length > 48 || /\*\*|—/.test(s) || /\s/.test(s))) {
    s = s.replace(/\.md$/i, "");
  }
  return s.trim();
}
