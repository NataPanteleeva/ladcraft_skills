# r7-compare-docs

Агент сравнения R7: логика «Сравнение 27», transport через **Р7-Диск** (`r7-disk-ref`) вместо VFS snapshot.

## Отличие от compare-s27

| | Сравнение 27 | r7-compare-docs |
|---|--------------|-----------------|
| Шаблоны A | bash `ls /workspace/Templates/` | `r7_list_disk_templates` |
| Документ B | VFS snapshot + bash `head` | `r7_fetch_disk_document` |
| Плагин | `vfs-snapshot` | `disk-ref` (см. план плагина) |
| DOCX на ПК | `r7-docx-render` | **нет** |
| DOCX на диск | `r7-save-compare-disk-s27` | `r7-save-compare-disk-s27` |

## Структура

```
cases/r7-compare-docs/
├── agent/instruction
├── docs/
│   ├── r7-disk-ref-contract.md
│   └── architecture.md
├── r7-compare-disk/          # transport-навык
├── skill-catalog.json
├── publish_and_bind.js
└── README.md
```

## Навыки агента (3)

1. `r7-compare-disk` — list + fetch template + fetch document
2. `r7-report-actions-s27` — insert / download md (reuse compare-s27 prod)
3. `r7-save-compare-disk-s27` — save docx на Р7-Диск (reuse compare-s27 prod)

## Установка r7-compare-disk

При установке задайте только:

- `R7_DISK_BASE_URL`
- `R7_DISK_LOGIN` / `R7_DISK_PASSWORD`

`templates` — папка в **«Мои документы»** (латиница, регистр не важен). Навык находит её автоматически; плагин передаёт только `document_id` и `file_name` в supplement.

## Публикация

```bash
node cases/r7-compare-docs/publish_and_bind.js
```

Создаёт агента `r7-compare-docs` (если ещё нет), публикует transport-навык, привязывает helper-навыки, патчит instruction.

Prod id агента — в [`agent/.from-server.json`](agent/.from-server.json) после первого publish.

## Контракт plugin

[`docs/r7-disk-ref-contract.md`](docs/r7-disk-ref-contract.md) — `mentioned.files[0].file_id = "r7-disk:{document_id}"`.

## Связанные планы

- Агент: `C:\Users\user1\.cursor\plans\r7-compare-docs_agent_fe312cd5.plan.md`
- Плагин: `C:\Users\user1\.cursor\plans\ladcraft-r7_disk-ref_plugin_81a97bf0.plan.md`
