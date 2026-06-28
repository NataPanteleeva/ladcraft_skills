---
name: r7-compare-toolkit
description: >-
  R7 compare-r7: bash head A+B на COMPARE, LLM-отчёт + r7.task. Read-tools не вызывать.
version: 4.0.0
tags:
  - document-compare
  - vfs
  - r7
category: productivity
mcp_spec:
  tools: []
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
        function sanitizeSnapshotBasename(name) {
          let base = String(name || '').trim();
          if (!base) return '';
          base = base.replace(/^\/+/, '');
          base = base.replace(/\s+\./g, '.');
          base = base.replace(/\. json/gi, '.json');
          base = base.replace(/\s+/g, '');
          return base;
        }
        function normalizeSessionFilePath(pathValue) {
          let raw = typeof pathValue === 'string' ? pathValue.trim() : '';
          if (!raw) return '';
          if (raw.startsWith('~/session/')) raw = '/' + raw.slice(2);
          if (raw.startsWith('session/')) raw = '/' + raw;
          let fileName = '';
          if (raw.startsWith('/session/')) {
            const parts = raw.split('/').filter(Boolean);
            fileName = sanitizeSnapshotBasename(parts[parts.length - 1] || '');
            if (!fileName) return '';
            if (fileName.indexOf('r7-') === 0) {
              return r7SessionDir() + '/' + fileName;
            }
            const dirPrefix = parts.length > 1 ? '/' + parts.slice(0, parts.length - 1).join('/') : '/session';
            return dirPrefix + '/' + fileName;
          }
          fileName = sanitizeSnapshotBasename(raw.replace(/^\/+/, ''));
          if (!fileName) return '';
          if (fileName.indexOf('r7-') === 0) {
            return r7SessionDir() + '/' + fileName;
          }
          return '/session/' + fileName;
        }
        function docKeyFromSessionFile(sessionFile) {
          const norm = normalizeSessionFilePath(sessionFile);
          if (!norm) return '';
          const parts = norm.split('/');
          const name = sanitizeSnapshotBasename(parts[parts.length - 1] || '');
          if (name.indexOf('r7-') !== 0 || name.indexOf('.json') !== name.length - 5) return '';
          const inner = name.slice(3, -5);
          const sep = inner.indexOf('_');
          if (sep <= 0) return '';
          return inner.slice(0, sep) + ':' + inner.slice(sep + 1);
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
        function coerceVfsReadToString(raw) {
          if (typeof raw === 'string') return raw;
          if (raw == null) return '';
          if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
            return raw.toString('utf8');
          }
          if (raw instanceof Uint8Array) {
            try {
              return new TextDecoder('utf-8').decode(raw);
            } catch (e) {
              return '';
            }
          }
          return String(raw);
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
            return { ok: false, reason: 'invalid_json', raw: trimmed };
          }
        }
        async function vfsWithTimeout(promise, timeoutMs) {
          const ms = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 3000;
          try {
            return await Promise.race([
              promise,
              new Promise(function (_, reject) {
                setTimeout(function () {
                  reject(new Error('vfs_timeout'));
                }, ms);
              })
            ]);
          } catch (e) {
            return null;
          }
        }
        async function vfsSnapshotStartupReady(vfs, filePath) {
          if (!vfs || !filePath) {
            return { ready: false, reason: 'not_found' };
          }
          if (typeof vfs.exists === 'function') {
            const exists = await vfsWithTimeout(vfs.exists(filePath), 3000);
            if (exists === true) {
              return { ready: true, reason: 'ready' };
            }
          }
          return { ready: false, reason: 'not_found' };
        }
        async function readR7SnapshotMetaFallback(vfs, filePath) {
          if (!vfs || !filePath || typeof vfs.getFileMetadata !== 'function') {
            return { ok: false, reason: 'not_found', raw: '' };
          }
          try {
            const meta = await vfsWithTimeout(vfs.getFileMetadata(filePath), 5000);
            if (!meta) {
              return { ok: false, reason: 'vfs_timeout', raw: '' };
            }
            if (meta && typeof meta.content === 'string' && meta.content.trim()) {
              return tryParseR7SnapshotRaw(meta.content);
            }
          } catch (e) {
            /* ignore */
          }
          return { ok: false, reason: 'not_found', raw: '' };
        }
        async function readR7SnapshotOriginal(vfs, filePath) {
          if (!vfs || !filePath || typeof vfs.readFile !== 'function') {
            return { ok: false, reason: 'not_found', raw: '' };
          }
          try {
            const raw = coerceVfsReadToString(await vfs.readFile(filePath, {}));
            if (raw && raw.trim()) {
              const parsed = tryParseR7SnapshotRaw(raw);
              if (parsed.ok) return parsed;
            }
          } catch (e) {
            /* ignore */
          }
          return readR7SnapshotMetaFallback(vfs, filePath);
        }
        async function readR7SnapshotWithTimeout(vfs, filePath, timeoutMs) {
          const ms = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 20000;
          if (!vfs || !filePath) {
            return { ok: false, reason: 'not_found', raw: '' };
          }
          const metaProbe = await readR7SnapshotMetaFallback(vfs, filePath);
          if (metaProbe.ok) return metaProbe;
          try {
            const probe = await Promise.race([
              readR7SnapshotOriginal(vfs, filePath),
              new Promise(function (_, reject) {
                setTimeout(function () {
                  reject(new Error('vfs_read_timeout'));
                }, ms);
              })
            ]);
            if (probe && probe.ok) return probe;
            return probe && probe.reason ? probe : { ok: false, reason: 'not_found', raw: '' };
          } catch (e) {
            if (String(e && e.message ? e.message : e) === 'vfs_read_timeout') {
              return { ok: false, reason: 'vfs_timeout', raw: '' };
            }
            return { ok: false, reason: 'not_found', raw: '' };
          }
        }
        async function readR7SnapshotFast(vfs, filePath, timeoutMs) {
          const ms = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 8000;
          if (!vfs || !filePath) {
            return { ok: false, reason: 'not_found', raw: '' };
          }
          const metaProbe = await readR7SnapshotMetaFallback(vfs, filePath);
          if (metaProbe.ok) return metaProbe;
          try {
            const probe = await Promise.race([
              readR7SnapshotOriginal(vfs, filePath),
              new Promise(function (_, reject) {
                setTimeout(function () {
                  reject(new Error('vfs_read_timeout'));
                }, ms);
              })
            ]);
            if (probe && probe.ok) return probe;
            return probe && probe.reason ? probe : { ok: false, reason: 'not_found', raw: '' };
          } catch (e) {
            if (String(e && e.message ? e.message : e) === 'vfs_read_timeout') {
              return { ok: false, reason: 'vfs_timeout', raw: '' };
            }
            return { ok: false, reason: 'not_found', raw: '' };
          }
        }
        async function listWorkspaceTemplates(vfs) {
          const dir = templatesDir();
          if (!vfs || typeof vfs.listDir !== 'function') return [];
          let entries = [];
          try {
            const raw = await vfsWithTimeout(vfs.listDir(dir), 2500);
            if (!raw) return [];
            entries = Array.isArray(raw) ? raw : [];
          } catch (e) {
            return [];
          }
          const templates = [];
          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (!entry || typeof entry !== 'object') continue;
            const name = typeof entry.name === 'string' ? entry.name : '';
            if (!name || name === '.' || name === '..') continue;
            const isDir = entry.isDirectory === true || entry.type === 'directory';
            if (isDir) continue;
            templates.push({ name: name, path: dir + '/' + name });
          }
          templates.sort(function (a, b) {
            return a.name.localeCompare(b.name, 'ru');
          });
          return templates;
        }
        async function readTemplateText(vfs, templateName, maxChars) {
          const rawName = String(templateName || '').trim();
          if (!rawName) {
            return { ok: false, error: 'template_name обязателен' };
          }
          const baseName = rawName.toLowerCase().endsWith('.md') ? rawName : rawName + '.md';
          const templatePath = templatesDir() + '/' + baseName;
          const limit = typeof maxChars === 'number' && maxChars > 0 ? maxChars : 150000;
          if (!vfs || typeof vfs.readFile !== 'function') {
            return { ok: false, error: 'VFS readFile недоступен', path: templatePath };
          }
          try {
            const raw = coerceVfsReadToString(await vfs.readFile(templatePath, {}));
            if (!raw || !raw.trim()) {
              return { ok: false, error: 'Шаблон пуст или не найден', path: templatePath };
            }
            return {
              ok: true,
              name: baseName,
              path: templatePath,
              text: raw.slice(0, limit),
              truncated: raw.length > limit
            };
          } catch (err) {
            return {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
              path: templatePath
            };
          }
        }
---

## Справочник (канон кейса)

Перед правкой агента или `r7-compare-toolkit` читай: **[`docs/approved-r7-document-compare.md`](../docs/approved-r7-document-compare.md)** — одобренный START (bash-список шаблонов) и COMPARE.

## START

Список шаблонов на START даёт **агент через bash** (`ls -la /workspace/Templates/`), не этот навык.

**2 tool параллельно** (иначе R7 обрывает run):
1. `bash` → `ls -la /workspace/Templates/`
2. `skills activate r7-compare-toolkit`

Таблица в ответе: `| № | Название шаблона | Размер |`. Сохрани `session_file` из `mentioned.files`.

Запрещено на START: `startup_compare`; find; cat; python; doc-compare; повторный ls.

## COMPARE

Шаблон **уже выбран** — **не** показывай список шаблонов, **не** `ls` Templates.

**1 batch — 2 bash параллельно**, затем **сразу** финальный ответ (**без** дополнительных tool):

```
head -c 150000 "/workspace/Templates/{шаблон}.md"
head -c 200000 "<session_file из mentioned.files>"
```

Альтернатива A: `cat "/workspace/Templates/{шаблон}.md" | head -c 150000`

Из вывода B извлеки **`body.text`** из JSON (`r7-snapshot/v1`). Не вызывай load_compare_pair, prepare_compare, python3, pipe cat|python.

При обрезке — укажи в отчёте disclaimer (анализ по доступной части).

По текстам A и B — LLM-сравнение по смыслу. Игнорируй сдвиги нумерации и колонку «наличие». Типы: ⚠️ критичное, 📝 опечатка, Δ отличие.

**Выход в чат:** резюме + таблица до **10** критичных строк + «**Расхождений: N**» (N = полное число).
Если критичных больше 10 — «… и ещё K (полный список в CompareReport)».

**CompareReport** (`sections` — все расхождения) — в блоке `r7.task` (не `json`):

```r7.task
[{"type":"deliver_inline","data":{"fileName":"compare-report.json","mimeType":"application/json","encoding":"utf8","content":"<CompareReport одной строкой>","actions":[]}}]
```

CompareReport: `schema: doc-compare/v1`, `chatMarkdown` = видимый markdown.

## EXPORT

docx — `r7_render_and_deliver_docx` (report из r7.task).
