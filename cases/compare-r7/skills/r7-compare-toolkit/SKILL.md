---
name: r7-compare-toolkit
description: >-
  Инструментарий R7 для сравнения документов: поиск r7-snapshot в session VFS с retry,
  список шаблонов workspace. Используй до doc-compare.
version: 1.2.1
tags:
  - document-compare
  - vfs
  - r7
category: productivity
mcp_spec:
  tools:
    - name: startup_compare
    - name: resolve_r7_document
    - name: list_session_files
    - name: read_r7_snapshot_text
    - name: list_templates
  default_capabilities:
    required:
      - type: vfs
        scope: $USER
        operations:
          - readFile
          - listDir
          - getFileMetadata
          - exists
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
        function getVfs(state) {
          const caps = asObject(state && state.capabilities);
          const vfs = caps ? caps.vfs : null;
          return vfs && typeof vfs === 'object' ? vfs : null;
        }
        function templatesDir() {
          return '/workspace/Templates';
        }
        function r7SessionDir() {
          return '/session/r7';
        }
        function sessionPath(fileName) {
          const name = typeof fileName === 'string' ? fileName.trim().replace(/^\/+/, '') : '';
          if (!name) return '';
          return '/session/' + name;
        }
        function sleepMs(ms) {
          const n = typeof ms === 'number' && ms > 0 ? ms : 0;
          if (!n) return Promise.resolve();
          return new Promise(function (resolve) {
            setTimeout(resolve, n);
          });
        }
        function sanitizeR7DocKey(docKey) {
          const raw = typeof docKey === 'string' ? docKey.trim() : '';
          if (!raw) return '';
          let s = raw.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
          s = s.replace(/^_+|_+$/g, '');
          if (s.length > 80) s = s.slice(0, 80);
          return s;
        }
        function r7SnapshotFileName(docKey) {
          const s = sanitizeR7DocKey(docKey);
          if (!s) return '';
          return 'r7-' + s + '.json';
        }
        function r7SnapshotPathFromDocKey(docKey) {
          const name = r7SnapshotFileName(docKey);
          if (!name) return '';
          return r7SessionDir() + '/' + name;
        }
        function normalizeSessionFilePath(pathValue) {
          const raw = typeof pathValue === 'string' ? pathValue.trim() : '';
          if (!raw) return '';
          if (raw.startsWith('/session/')) return raw;
          if (raw.startsWith('~/session/')) return '/' + raw.slice(2);
          if (raw.startsWith('session/')) return '/' + raw;
          return sessionPath(raw.replace(/^\/+/, ''));
        }
        const R7_SNAPSHOT_SCHEMA = 'r7-snapshot/v1';
        const R7_MIN_BODY_CHARS = 1;
        function extractR7BodyTextFromParsed(parsed) {
          if (!parsed || typeof parsed !== 'object') return '';
          const body = parsed.body;
          if (body && typeof body.text === 'string' && body.text.trim()) {
            return body.text;
          }
          if (Array.isArray(parsed.content)) {
            return parsed.content
              .map(function (p) { return String(p).trim(); })
              .filter(Boolean)
              .join('\n\n');
          }
          return '';
        }
        function tryParseR7SnapshotRaw(raw) {
          const trimmed = typeof raw === 'string' ? raw.trim().replace(/^\uFEFF/, '') : '';
          if (!trimmed) {
            return { ok: false, reason: 'empty_body', raw: raw || '' };
          }
          try {
            const parsed = JSON.parse(trimmed);
            const schema = parsed && parsed.schema ? String(parsed.schema) : '';
            if (schema !== R7_SNAPSHOT_SCHEMA) {
              return { ok: false, reason: 'bad_schema', raw: trimmed, schema: schema };
            }
            const bodyText = extractR7BodyTextFromParsed(parsed);
            if (!bodyText || bodyText.length < R7_MIN_BODY_CHARS) {
              return { ok: false, reason: 'empty_body', raw: trimmed, schema: schema, body_length: bodyText.length };
            }
            return {
              ok: true,
              reason: 'ready',
              raw: trimmed,
              schema: schema,
              body_text: bodyText,
              body_length: bodyText.length
            };
          } catch (e) {
            const jsonStart = trimmed.indexOf('{"schema"');
            if (jsonStart >= 0) {
              try {
                return tryParseR7SnapshotRaw(trimmed.slice(jsonStart));
              } catch (e2) {
                /* continue */
              }
            }
            if (trimmed.indexOf('{') !== 0 && trimmed.length >= R7_MIN_BODY_CHARS) {
              return {
                ok: true,
                reason: 'ready',
                raw: trimmed,
                schema: 'text/plain',
                body_text: trimmed,
                body_length: trimmed.length
              };
            }
            return { ok: false, reason: 'invalid_json', raw: trimmed };
          }
        }
        async function readR7SnapshotOriginal(vfs, filePath) {
          if (!vfs || !filePath || typeof vfs.readFile !== 'function') {
            return { ok: false, reason: 'not_found', raw: '' };
          }
          const readAttempts = [
            { source: 'original' },
            {},
            { source: 'parsed' }
          ];
          let lastRaw = '';
          for (let i = 0; i < readAttempts.length; i++) {
            const opts = readAttempts[i];
            let raw = '';
            try {
              raw = await vfs.readFile(filePath, opts);
            } catch (e) {
              continue;
            }
            if (typeof raw !== 'string' || !raw.trim()) continue;
            lastRaw = raw;
            const parsed = tryParseR7SnapshotRaw(raw);
            if (parsed.ok) return parsed;
          }
          if (typeof vfs.getFileMetadata === 'function') {
            try {
              const meta = await vfs.getFileMetadata(filePath);
              if (meta && typeof meta.content === 'string' && meta.content.trim()) {
                const parsed = tryParseR7SnapshotRaw(meta.content);
                if (parsed.ok) return parsed;
                lastRaw = meta.content;
              }
            } catch (e) {
              /* ignore */
            }
          }
          if (lastRaw) {
            const parsed = tryParseR7SnapshotRaw(lastRaw);
            if (!parsed.ok) return parsed;
            return parsed;
          }
          return { ok: false, reason: 'not_found', raw: '' };
        }
        async function vfsSnapshotReady(vfs, filePath) {
          const probe = await readR7SnapshotOriginal(vfs, filePath);
          return {
            ready: probe.ok === true,
            reason: probe.ok ? 'ready' : probe.reason,
            schema: probe.schema || '',
            body_length: typeof probe.body_length === 'number' ? probe.body_length : 0
          };
        }
        async function vfsPathExists(vfs, filePath) {
          const status = await vfsSnapshotReady(vfs, filePath);
          return status.ready === true;
        }
        async function scanR7SessionFiles(vfs) {
          const dirsToScan = [r7SessionDir(), '/session'];
          const seen = {};
          const files = [];
          if (!vfs || typeof vfs.listDir !== 'function') return files;

          for (let d = 0; d < dirsToScan.length; d++) {
            const dir = dirsToScan[d];
            let entries = [];
            try {
              const raw = await vfs.listDir(dir);
              entries = Array.isArray(raw) ? raw : [];
            } catch (e) {
              continue;
            }

            for (let i = 0; i < entries.length; i++) {
              const entry = entries[i];
              if (!entry || typeof entry !== 'object') continue;
              const name = typeof entry.name === 'string' ? entry.name : '';
              if (!name || name === '.' || name === '..') continue;
              const isDir = entry.isDirectory === true || entry.type === 'directory';
              if (isDir) continue;
              if (!name.endsWith('.json')) continue;

              const fullPath = dir.endsWith('/') ? dir + name : dir + '/' + name;
              if (seen[fullPath]) continue;
              seen[fullPath] = true;

              files.push({
                name: name,
                path: fullPath,
                kind: name.indexOf('r7-') === 0 ? 'r7_snapshot' : 'session_file'
              });
            }
          }

          files.sort(function (a, b) {
            return a.path.localeCompare(b.path, 'ru');
          });
          return files;
        }
---

Навык инфраструктуры для сценария **R7 doc-compare**.

## Когда вызывать

| Этап | Tool |
|------|------|
| **Первое сообщение** | **`startup_compare`** — один вызов, готовый `greeting_markdown` |
| **Чтение документа B** | **`read_r7_snapshot_text`** — body.text через skill VFS (не bash) |
| Диагностика session | `list_session_files` |
| По отдельности (не на старте) | `resolve_r7_document`, `list_templates` |

**Имена tools — буквально:** `list_templates` (не `list_emplates`, не `list templates`).

## startup_compare (старт сессии)

**Не читай snapshot перед вызовом** — достаточно path из `mentioned.files`.

```
startup_compare({ "session_file": "/session/r7/r7-word_….json" })
```

`doc_key` опционален (выводится из имени файла `r7-word_ID.json` → `word:ID`).

Ответ: `greeting_markdown` — **выведи в чат дословно один раз**. Сохрани `session_file`.

Сравнение — навык **doc-compare**. Выгрузка DOCX — **r7-docx-render** + **r7-export-compare**.

## read_r7_snapshot_text (чтение B)

Единственный надёжный способ прочитать snapshot из `/session/r7/` (bash-mount может отдавать пустой файл).

```
read_r7_snapshot_text({ "session_file": "/session/r7/r7-word_….json", "limit_chars": 80000 })
```

Ответ: `text` (body.text, усечённый), `schema`, `session_file`. При `ok: false` — `reason`: `not_found` | `empty_body` | `bad_schema` | `invalid_json`.
