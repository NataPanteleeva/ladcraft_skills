# Контракт вывода навыка (ladcraft-r7_new / LCA)

## Dual payload

Каждый черновик правок в чате = **человеческий markdown** + скрытый fence **`r7.proposal/v1`** (UI strips).

Плагин на одобрении берёт **proposal**. Fallback: **Черновик:** / structured summary / короткий applyable blob → тот же `paste_text` + MD→HTML (абзацы, `#`, таблицы, `**`).

## Primary: plugin intent (`intent-apply.ts`) — без хода к агенту

| Фраза пользователя | Proposal | Действие плагина |
|--------------------|----------|------------------|
| «вставь» / «в конец» / «да» | `kind=blob` | paste / paste_text (+ position) |
| «да» / «замени» / «замени абзац…» | `blob` + replace | replace_selection (нужно выделение) |
| «исправь все» / «исправь 1, 3» | `kind=findings` | search_replace × выбранные id |
| «да» / «запиши» | `kind=cell_map` | cell_paste |
| «да» / «добавь» | `kind=comment` | add_comment (нужно выделение) |
| «вставь» / «да» / replace | нет proposal, есть Черновик или structured summary | markdown-fallback + MD→HTML |
| «вставь текст» / «у курсора» / «вставь это» | нет proposal, есть insertable last reply | markdown-fallback + MD→HTML |
| bare «вставь» / approve | нет proposal и нет insertable draft | статус + forward агенту |

На этих фразах плагин **не** вызывает агента и **не** шлёт `r7.event`. Статус только в UI.

Короткое «да» после **findings** — **не** применяет; нужно «исправь все» / «исправь N».

## tool_calls (fallback)

| Сценарий | Канал |
|----------|--------|
| «замени X на Y» без proposal | `r7_search_replace` |
| proposal отсутствует / битый | отказ в UI или tools навыка |
| paste / replace / findings / cell | intent primary; tools — запасной |

## Пример blob

````markdown
**Черновик:**
текст

```r7.proposal
{"schema":"r7.proposal/v1","kind":"blob","op":"paste_text","text":"текст","defaultPosition":"cursor"}
```
````

## Оформление / разметка при вставке

- Саммари и черновики: **markdown** в `proposal.text`, `op:"paste_text"` (default). Плагин: MD→HTML → `PasteHtml`.
- Что восстанавливается из markdown:
  - абзацы (пустая строка = новый `<p>`);
  - заголовки `#` … `######`;
  - таблицы `| … |` + строка-разделитель `|---|`;
  - **жирный**, `` `код` ``, ссылки, `>` цитаты.
- Готовый HTML: `op:"paste"`, в `text` — HTML как есть (без MD-конвертации).
- Не класть markdown в `op:"paste"` — иначе `**` / `|` уйдут в документ буквально.
- Plain find/replace → search_replace.
- Перепись выделения → `replace_selection` (тот же MD→HTML, если нет HTML-тегов).
- Саммари → обязательный blob с **полным** `text`; для заголовков в Word навык должен писать `# Заголовок`, не только `**жирный**`.

Агент: [`cases/LCA/`](../../LCA/).
