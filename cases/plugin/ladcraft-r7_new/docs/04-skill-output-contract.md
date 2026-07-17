# Контракт вывода навыка (ladcraft-r7_new / LCA)

## Dual payload

Каждый черновик правок в чате = **человеческий markdown** + скрытый fence **`r7.proposal/v1`** (UI strips, как `r7.event`).

Плагин на одобрении берёт **proposal**, не «всё окно». Fallback: секция **Черновик:** без proposal.

## Primary: plugin intent (`intent-apply.ts`)

| Фраза пользователя | Proposal | Действие плагина |
|--------------------|----------|------------------|
| «вставь» / «в конец» / «да» | `kind=blob` | paste / paste_text (+ position) |
| «да» / «замени» | `blob` + `preferReplaceSelection` | replace_selection (нужно выделение) |
| «исправь все» / «исправь 1, 3» | `kind=findings` | search_replace × выбранные id |
| «да» / «запиши» | `kind=cell_map` | cell_paste |
| «да» / «добавь» | `kind=comment` | add_comment (нужно выделение) |

Агент на этих фразах: **краткий ack, без write-tools** (anti double-apply).

Короткое «да» после **findings** — **не** применяет; нужно «исправь все» / «исправь N».

## tool_calls (fallback)

| Сценарий | Канал |
|----------|--------|
| «замени X на Y» без proposal | `r7_search_replace` |
| proposal отсутствует / битый | tools или отказ |
| paste / replace / findings / cell | intent primary; tools — запасной |

## Пример findings

````markdown
| № | Было | Стало |
| 1 | … | … |

Что дальше? — **исправь все** / **исправь 1, 3**

```r7.proposal
{"schema":"r7.proposal/v1","kind":"findings","revision":1,"items":[{"id":1,"op":"search_replace","search":"…","replace":"…"}]}
```
````

## Пример blob

````markdown
**Черновик:**
текст

```r7.proposal
{"schema":"r7.proposal/v1","kind":"blob","op":"paste_text","text":"текст","defaultPosition":"cursor"}
```
````

## После apply: `r7.event`

Плагин шлёт скрытый `apply_result`. Агент: не re-apply; не дублируй таблицы.

## Оформление

- Plain find/replace → search_replace (глобальный по документу; `search` делай уникальным).
- HTML / перепись выделения → replace_selection / paste.

Агент: [`cases/LCA/`](../../LCA/).
