---
name: burnout_toolkit
description: >-
  Детерминированный инструментарий «спасения выгоревшего разработчика»: журнал
  сессии и инцидентов в sql-storage, крик души и разборы инцидентов в VFS,
  фиксация диагнозов, сборка «Плана спасения» и виджет-карточка состояния.
  Без LLM-рассуждений — только состояние, файлы и склейка; семантику ведут агенты.
version: 0.1.0
tags:
  - demo
  - burnout
  - sql-storage
  - vfs
  - widget
  - multi-agent
category: productivity
mcp_spec:
  tools:
    - name: start_rescue
    - name: log_incident
    - name: get_session
    - name: get_complaint
    - name: save_advice
    - name: check_notes
    - name: record_diagnosis
    - name: compose_rescue_plan
    - name: show_burnout_card
    - name: get_survival_tip
      environment:
        user:
          TOXICITY_LEVEL:
            title: "Тон советов (gentle | normal | roast)"
            format: "string"
          DEV_NAME:
            title: "Имя разработчика по умолчанию"
            format: "string"
    - name: roast_or_toast
  default_capabilities:
    required:
      - type: sql-storage
        scope: $USER
        operations:
          - get
          - create
          - runSQL
      - type: vfs
        scope: $USER
        operations:
          - readFile
          - writeFile
          - listDir
          - getFileMetadata
          - exists
          - mkdir
general:
  lib:
    - runtime: nodejs@24
      code: |
        function asObject(value) {
          return value && typeof value === 'object' ? value : null;
        }
        function getString(source, key) {
          const object = asObject(source);
          if (!object) return '';
          const value = object[key];
          return typeof value === 'string' ? value : '';
        }
        function getNumber(source, key) {
          const object = asObject(source);
          if (!object) return 0;
          const value = object[key];
          return typeof value === 'number' && Number.isFinite(value) ? value : 0;
        }
        function getArray(source, key) {
          const object = asObject(source);
          if (!object) return [];
          const value = object[key];
          return Array.isArray(value) ? value : [];
        }
        function clampInt(value, min, max) {
          let n = Math.round(typeof value === 'number' && Number.isFinite(value) ? value : 0);
          if (n < min) n = min;
          if (n > max) n = max;
          return n;
        }
        function sqlEsc(value) {
          return String(value === null || value === undefined ? '' : value).replace(/'/g, "''");
        }
        function genId(prefix) {
          return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        }
        function slug(value) {
          return String(value || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
        }
        function complaintPath(rescueId) {
          return '/user/burnout/' + rescueId + '/complaint.json';
        }
        function notePath(rescueId, incidentId) {
          return '/user/burnout/' + rescueId + '/notes/' + incidentId + '.md';
        }
        function outDir(rescueId) {
          return '/workspace/burnout/' + rescueId;
        }
        function getSqlStorage(state) {
          const capabilities = asObject(state) ? asObject(state.capabilities) : null;
          const sql = capabilities ? capabilities['sql-storage'] : null;
          if (sql && typeof sql.get === 'function' && typeof sql.runSQL === 'function') return sql;
          return null;
        }
        function getVfs(state) {
          const capabilities = asObject(state) ? asObject(state.capabilities) : null;
          const vfs = capabilities ? capabilities.vfs : null;
          if (vfs && typeof vfs.writeFile === 'function') return vfs;
          return null;
        }
        function readStorageId(response) {
          const result = asObject(response) ? asObject(response.result) : null;
          return result && typeof result.storage_id === 'string' ? result.storage_id : '';
        }
        async function sqlStorageId(sql) {
          let id = '';
          try { id = readStorageId(await sql.get()); } catch (e) { id = ''; }
          if (id) return id;
          if (typeof sql.create === 'function') {
            try { id = readStorageId(await sql.create()); } catch (e) { id = ''; }
            if (id) return id;
            try { id = readStorageId(await sql.get()); } catch (e) { id = ''; }
          }
          return id;
        }
        async function ensureSchema(sql, storageId) {
          await sql.runSQL(storageId, 'CREATE TABLE IF NOT EXISTS rescue_session (\n  id TEXT PRIMARY KEY,\n  dev_name TEXT,\n  vibe TEXT,\n  fatigue INTEGER DEFAULT 0,\n  caffeine INTEGER DEFAULT 0,\n  status TEXT DEFAULT \'open\',\n  created_at TIMESTAMPTZ DEFAULT NOW()\n)');
          await sql.runSQL(storageId, 'CREATE TABLE IF NOT EXISTS incidents (\n  id SERIAL PRIMARY KEY,\n  rescue_id TEXT,\n  incident_id TEXT,\n  kind TEXT,\n  title TEXT,\n  ord INTEGER,\n  severity TEXT,\n  status TEXT DEFAULT \'open\',\n  note_path TEXT,\n  updated_at TIMESTAMPTZ DEFAULT NOW()\n)');
          await sql.runSQL(storageId, 'CREATE TABLE IF NOT EXISTS diagnoses (\n  id SERIAL PRIMARY KEY,\n  rescue_id TEXT,\n  incident_id TEXT,\n  verdict TEXT,\n  severity TEXT,\n  advice TEXT,\n  created_at TIMESTAMPTZ DEFAULT NOW()\n)');
        }
        function extractRows(response) {
          const root = asObject(response);
          if (!root) return Array.isArray(response) ? response : [];
          const candidates = [root.rows, root.records, root.data];
          const result = asObject(root.result);
          if (result) {
            candidates.push(result.rows, result.records, result.data);
            if (Array.isArray(result)) candidates.push(result);
          }
          if (Array.isArray(root.result)) candidates.push(root.result);
          for (let i = 0; i < candidates.length; i++) {
            if (Array.isArray(candidates[i])) return candidates[i];
          }
          return [];
        }
---

# Burnout toolkit

Детерминированный инструментарий демо-кейса **«Спасатель выгоревшего разработчика»**. Навык не
рассуждает: он хранит состояние «спасения» и собирает результат. Семантику (разбор крика души на
инциденты, тексты разборов, диагнозы) формируют агент-оркестратор `burnout_orchestrator_agent` и
агент-воркер `burnout_worker_agent`, которые вызывают эти инструменты.

Паттерн повторяет проверенный `contract_toolkit`: **decompose → разбор части → compose**, с
изоляцией по инцидентам и координацией через общий слой `/user`.

## Состояние (sql-storage, PostgreSQL, scope `$USER`)

Журнал спасения ведёт **оркестратор**:

- `rescue_session(id, dev_name, vibe, fatigue, caffeine, status, created_at)` — одна запись на запуск.
- `incidents(id, rescue_id, incident_id, kind, title, ord, severity, status, note_path, updated_at)`
  — отдельные «страдания» разработчика и их статусы.
- `diagnoses(id, rescue_id, incident_id, verdict, severity, advice, created_at)` — диагнозы/советы по инцидентам.

Схема создаётся идемпотентно (`CREATE TABLE IF NOT EXISTS`) при первом вызове любого инструмента.

## VFS-раскладка (где что лежит)

Политика scope (канон Ladcraft): **`/user`** — межагентский обмен (общий долгоживущий слой агентов
одного пользователя; в UI не виден); **`/workspace`** — файлы, которые **всегда видны пользователю**
(панель «Файлы агента»); **`/session`** — только для конкретного прогона (вход).

- **Крик души (канон входа)** → `/user/burnout/{rescue_id}/complaint.json`. Пишется один раз в
  `start_rescue(complaint=...)`; воркер читает его через `get_complaint` (одни и те же данные на
  каждый инцидент — без дрейфа контекста).
- **Разборы инцидентов (межагентские черновики)** → `/user/burnout/{rescue_id}/notes/{incident_id}.md`.
  Путь детерминирован и известен из журнала (`note_path` в `start_rescue`). Воркер пишет по переданному
  `path` (`save_advice(path=..., text=...)`). `compose_rescue_plan` читает по `note_path` из журнала.
- **Готовый результат (виден пользователю)** → `/workspace/burnout/{rescue_id}/rescue_plan.md` и
  `pep_talk.md`. `compose_rescue_plan` пишет именно сюда.

## Инструменты

1. `start_rescue` — создать сессию, зарегистрировать инциденты (decompose) и записать `complaint.json`.
   Возвращает `rescue_id`, `complaint_path` и для каждого инцидента `note_path`. *(sql-storage + VFS)*
2. `log_incident` — добавить один инцидент в журнал. *(sql-storage)*
3. `get_session` — прочитать сессию, инциденты и диагнозы (recovery/обзор). *(read-only)*
4. `get_complaint` — **(воркер)** прочитать канонический крик души из `complaint.json`. *(read-only VFS)*
5. `save_advice` — **(воркер)** записать разбор инцидента по точному `path`. *(VFS write)*
6. `check_notes` — **(оркестратор)** по факту файлов вернуть `present`/`missing` инциденты. *(read-only VFS)*
7. `record_diagnosis` — зафиксировать диагноз/совет по инциденту и проставить severity. *(sql-storage)*
8. `compose_rescue_plan` — собрать «План спасения» из разборов по порядку + мотивационный pep talk. *(VFS)*
9. `show_burnout_card` — данные для EJS-виджета `burnoutCard` (усталость/кофеин/прогресс/статус). *(widget)*
10. `get_survival_tip` — совет дня с учётом `environment.user` (`TOXICITY_LEVEL`, `DEV_NAME`). *(environment.user)*
11. `roast_or_toast` — «прожарить или похвалить» разработчика. *(runtime `python@3`)*

## Контракт side effects

- `start_rescue` реально пишет журнал в `sql-storage` и `complaint.json` в VFS.
- `save_advice` реально пишет файл разбора в общий слой `/user/burnout/...` (по `path`).
- `compose_rescue_plan` реально читает разборы из `/user/burnout/...` и пишет план + pep talk в
  `/workspace/burnout/...` (видно пользователю в «Файлы агента»).
- `get_session` / `get_complaint` / `check_notes` — только чтение (VFS/SQL).
- `show_burnout_card` / `get_survival_tip` / `roast_or_toast` — чистые вычисления без побочных записей.
- Инструменты не подменяют запись «красивым» текстом в ответе.
