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
    btn.textContent = choice;
    btn.onclick = () => onSelect(choice);
    item.appendChild(btn);
    list.appendChild(item);
  }

  host.appendChild(list);
  return host;
}
