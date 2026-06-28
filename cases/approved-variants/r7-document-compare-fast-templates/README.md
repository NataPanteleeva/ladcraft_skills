# fast templates — R7: сравнение документов

**Тег:** `fast-templates` (исторический)  
**Статус:** superseded для COMPARE — см. [`templates+compare`](../r7-document-compare-templates-compare/)  
**Исходный кейс:** [`cases/compare-r7`](../../compare-r7/)

## Суть варианта

Быстрая подгрузка списка шаблонов на первом ходе в плагине R7: агент вызывает **host bash** `ls -la /workspace/Templates/`, строит markdown-таблицу и не ждёт skill VFS (`startup_compare`, `listDir`).

На COMPARE шаблон уже выбран — **повторный** список шаблонов запрещён (в отличие от сырого агента «Сравнение 27», где на втором ходе список дублировался).

## Содержимое снимка

| Файл | Назначение |
|------|------------|
| [`agent/instruction`](agent/instruction) | Instruction агента (prod) |
| [`agent/prod.json`](agent/prod.json) | id агента и привязки навыков |
| [`skills/r7-compare-toolkit-start.md`](skills/r7-compare-toolkit-start.md) | Фрагмент SKILL: START / COMPARE / EXPORT |
| [`docs/fast-templates.md`](docs/fast-templates.md) | Краткое обоснование и чеклист |

Полный канон: [`cases/compare-r7/docs/approved-r7-document-compare.md`](../../compare-r7/docs/approved-r7-document-compare.md).

## Восстановление на prod

```bash
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  agent-patch wvccZ9WaZMDdCxfTyDGhh \
  --instruction-file cases/approved-variants/r7-document-compare-fast-templates/agent/instruction
```

Навык `r7-compare-toolkit` обновлять из живого кейса `cases/compare-r7/` (payload + `publish_skill_update.js`).

## Проверено

- R7 plugin, docKey `word:512af4d280eac2f7cc8e`
- Эталон скорости: агент «Сравнение 27» — `bash ls` ~15 с до таблицы шаблонов
- Отклонено: `startup_compare` на START (зависание / пустой список в R7)
