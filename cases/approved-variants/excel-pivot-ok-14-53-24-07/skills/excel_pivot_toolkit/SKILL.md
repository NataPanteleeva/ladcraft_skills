---
name: excel_pivot_toolkit
description: >-
  Аналитика .xlsx: сводная, фильтр/сорт, профиль, топ/KPI, сверка листов.
  Результат — файл в /session. Вставку в открытый Cell делает плагин (кнопки).
  cell_format — оформление шапки (whitelist). sheet_replace отключён.
version: 1.11.0
tags:
  - excel
  - xlsx
  - pivot
  - analytics
  - vfs
category: productivity
mcp_spec:
  tools:
    - name: list_workbooks
    - name: pick_working_source
    - name: inspect_workbook
    - name: build_pivot_table
    - name: profile_sheet
    - name: dedupe_rows
    - name: filter_export
    - name: select_columns
    - name: sort_rows
    - name: add_calculated_column
    - name: time_bucket
    - name: top_n_summary
    - name: compare_sheets
    - name: sheet_replace
    - name: cell_format
  default_capabilities:
    required:
      - type: vfs
        scope: $USER
        operations:
          - readFile
          - writeFile
          - listDir
          - exists
          - isFile
          - isDir
          - getFileMetadata
          - mkdir
          - cp
          - mv
general:
  lib:
    - runtime: python@3
      code: |
        import base64
        import io
        import math
        import re
        from collections import defaultdict

        def as_dict(value):
            return value if isinstance(value, dict) else None

        def get_string(source, key):
            obj = as_dict(source)
            if not obj:
                return ""
            value = obj.get(key)
            return value if isinstance(value, str) else ""

        def get_array(source, key):
            obj = as_dict(source)
            if not obj:
                return []
            value = obj.get(key)
            return value if isinstance(value, list) else []

        def get_vfs(state):
            caps = as_dict(state.get("capabilities") if isinstance(state, dict) else getattr(state, "capabilities", None))
            if caps is None and hasattr(state, "capabilities"):
                caps = as_dict(state.capabilities)
            if not caps:
                return None
            vfs = caps.get("vfs") if isinstance(caps, dict) else getattr(caps, "vfs", None)
            if vfs is None:
                return None
            if not callable(getattr(vfs, "readFile", None)) or not callable(getattr(vfs, "writeFile", None)):
                return None
            return vfs

        def looks_like_zip(data):
            return isinstance(data, (bytes, bytearray)) and len(data) >= 2 and data[0] == 0x50 and data[1] == 0x4B

        def decode_workbook_bytes(raw):
            if isinstance(raw, memoryview):
                raw = raw.tobytes()
            if isinstance(raw, bytearray):
                raw = bytes(raw)
            if isinstance(raw, bytes):
                return raw
            if isinstance(raw, dict) and raw.get("type") == "Buffer" and isinstance(raw.get("data"), list):
                return bytes(raw["data"])
            if not isinstance(raw, str):
                raise ValueError("VFS вернул неподдерживаемый тип содержимого workbook")
            if len(raw) >= 2 and ord(raw[0]) == 0x50 and ord(raw[1]) == 0x4B:
                return raw.encode("latin-1")
            compact = re.sub(r"\s+", "", raw)
            if re.fullmatch(r"[A-Za-z0-9+/=]+", compact or "") and len(compact) >= 8:
                try:
                    b64 = base64.b64decode(compact)
                    if looks_like_zip(b64):
                        return b64
                except Exception:
                    pass
            binary = raw.encode("latin-1")
            if looks_like_zip(binary):
                return binary
            raise ValueError("Не удалось декодировать .xlsx как ZIP/PK (binary/base64)")

        async def read_workbook_bytes(vfs, file_path):
            raw = None
            last_error = None
            try:
                raw = await vfs.readFile(file_path, {"source": "original"})
            except Exception as err:
                last_error = err
            if raw is None:
                try:
                    raw = await vfs.readFile(file_path)
                except Exception as err:
                    last_error = err
            if raw is None:
                message = str(last_error) if last_error else "пусто"
                raise ValueError("Не удалось прочитать файл: " + file_path + " (" + message + ")")
            return decode_workbook_bytes(raw)

        async def write_workbook_bytes(vfs, file_path, data):
            import os
            import tempfile

            payload = bytes(data)
            if not looks_like_zip(payload):
                raise ValueError("Внутренняя ошибка: payload не похож на .xlsx (нет PK)")

            expected = len(payload)
            modes_tried = []

            async def stored_size(path):
                if callable(getattr(vfs, "getFileMetadata", None)):
                    try:
                        meta = await vfs.getFileMetadata(path)
                        if isinstance(meta, dict):
                            for key in ("size_bytes", "size", "length", "byteLength"):
                                if isinstance(meta.get(key), (int, float)):
                                    return int(meta.get(key))
                            nested = meta.get("file") or meta.get("data") or {}
                            if isinstance(nested, dict):
                                for key in ("size_bytes", "size", "length"):
                                    if isinstance(nested.get(key), (int, float)):
                                        return int(nested.get(key))
                    except Exception:
                        pass
                # FS probe
                try:
                    return os.path.getsize(path)
                except Exception:
                    return None

            async def verify_binary_storage(path, mode_name):
                """
                VFS readFile(string) маскирует UTF-8 порчу: latin-1 roundtrip
                'чинит' байты в памяти, но download/R7 видят битый файл.
                Поэтому сверяем размер на хранилище с len(payload).
                """
                size = await stored_size(path)
                if size is None:
                    # Fallback: FS raw read
                    try:
                        with open(path, "rb") as fh:
                            raw = fh.read()
                        if raw == payload:
                            return True, size
                        modes_tried.append(mode_name + ":fs-mismatch:" + str(len(raw)))
                        return False, len(raw)
                    except Exception as err:
                        modes_tried.append(mode_name + ":no-size:" + str(err))
                        return False, None
                if size != expected:
                    modes_tried.append(mode_name + ":size " + str(size) + "!=" + str(expected))
                    return False, size
                # Extra: openpyxl on FS bytes if readable
                try:
                    with open(path, "rb") as fh:
                        raw = fh.read()
                    from openpyxl import load_workbook
                    load_workbook(io.BytesIO(raw))
                except Exception:
                    pass
                return True, size

            def fs_candidates(path):
                out = [path]
                if path.startswith("/"):
                    out.append("~" + path)
                    out.append(os.path.expanduser("~" + path))
                if path.startswith("/session/"):
                    rel = path[len("/session/") :]
                    out.extend(
                        [
                            os.path.join("/session", rel),
                            os.path.join(os.path.expanduser("~/session"), rel),
                            os.path.join("/var/ladcraft/session", rel),
                            os.path.join("/tmp/session", rel),
                        ]
                    )
                # unique preserve order
                seen = {}
                uniq = []
                for item in out:
                    if item and item not in seen:
                        seen[item] = True
                        uniq.append(item)
                return uniq

            # 1) Прямая бинарная запись в FS (единственный надёжный канал для R7)
            for cand in fs_candidates(file_path):
                try:
                    parent = os.path.dirname(cand)
                    if parent and parent not in (".", "/"):
                        os.makedirs(parent, exist_ok=True)
                    with open(cand, "wb") as fh:
                        fh.write(payload)
                    with open(cand, "rb") as fh:
                        raw = fh.read()
                    if raw != payload:
                        modes_tried.append("fs:" + cand + ":mismatch")
                        continue
                    from openpyxl import load_workbook

                    load_workbook(io.BytesIO(raw))
                    # Если писали не в канонический VFS-путь — скопируем через vfs.cp/write
                    if cand != file_path and callable(getattr(vfs, "cp", None)):
                        try:
                            await vfs.cp(cand, file_path)
                        except Exception:
                            pass
                    ok, _size = await verify_binary_storage(file_path, "fs")
                    if ok or raw == payload:
                        # Если канонический path недоступен по meta, но FS запись по cand==file_path ок
                        if cand == file_path or ok:
                            return "fs"
                        # Запись во временный FS + попытка прокинуть bytes через vfs
                        modes_tried.append("fs-alt-ok:" + cand)
                        # keep alt path content; try vfs write strategies below using payload
                    else:
                        modes_tried.append("fs:" + cand + ":meta-fail")
                except Exception as err:
                    modes_tried.append("fs:" + cand + ":" + str(err))

            # 1b) tempfile + cp в target
            try:
                tmp_dir = "/session/.tmp"
                try:
                    os.makedirs(tmp_dir, exist_ok=True)
                    tmp_path = os.path.join(tmp_dir, "_excel_pivot_out.xlsx")
                except Exception:
                    fd, tmp_path = tempfile.mkstemp(suffix=".xlsx")
                    os.close(fd)
                with open(tmp_path, "wb") as fh:
                    fh.write(payload)
                if callable(getattr(vfs, "cp", None)):
                    await vfs.cp(tmp_path, file_path)
                    ok, _size = await verify_binary_storage(file_path, "tmp+cp")
                    if ok:
                        return "tmp+cp"
                if callable(getattr(vfs, "mv", None)):
                    await vfs.mv(tmp_path, file_path)
                    ok, _size = await verify_binary_storage(file_path, "tmp+mv")
                    if ok:
                        return "tmp+mv"
                modes_tried.append("tmp+cp/mv:meta-fail")
            except Exception as err:
                modes_tried.append("tmp:" + str(err))

            # 2) bytes / bytearray / Buffer-shape через writeFile
            byte_variants = [
                ("bytes", payload),
                ("bytearray", bytearray(payload)),
                ("buffer-dict", {"type": "Buffer", "data": list(payload)}),
                ("int-list", list(payload)),
            ]
            for name, value in byte_variants:
                try:
                    await vfs.writeFile(file_path, value)
                    ok, _size = await verify_binary_storage(file_path, name)
                    if ok:
                        return name
                except Exception as err:
                    modes_tried.append(name + ":" + str(err))

            # 3) base64 + encoding option (если runtime умеет декодировать при записи)
            b64 = base64.b64encode(payload).decode("ascii")
            option_variants = [
                ("b64-opt", b64, {"encoding": "base64"}),
                ("b64-opt2", b64, {"contentEncoding": "base64"}),
                ("b64-opt3", b64, {"encoding": "base64", "binary": True}),
                ("b64-opt4", payload.decode("latin-1"), {"encoding": "binary"}),
                ("b64-opt5", payload.decode("latin-1"), {"binary": True}),
            ]
            for name, value, opts in option_variants:
                try:
                    await vfs.writeFile(file_path, value, opts)
                    ok, _size = await verify_binary_storage(file_path, name)
                    if ok:
                        return name
                except TypeError:
                    modes_tried.append(name + ":no-options")
                except Exception as err:
                    modes_tried.append(name + ":" + str(err))

            # 4) Явно ЗАПРЕЩАЕМ latin-1 string без проверки размера:
            #    она даёт «ok» при readFile, но R7/Excel получают UTF-8-битый ZIP.
            try:
                await vfs.writeFile(file_path, payload.decode("latin-1"))
                ok, size = await verify_binary_storage(file_path, "binary-string")
                if ok:
                    return "binary-string"
                modes_tried.append(
                    "binary-string:rejected-corrupt-for-R7(size=" + str(size) + ")"
                )
            except Exception as err:
                modes_tried.append("binary-string:" + str(err))

            raise ValueError(
                "Не удалось записать бинарный .xlsx для R7/Excel (нужен ZIP без UTF-8 порчи). "
                "expected_size="
                + str(expected)
                + ". Пробы: "
                + " | ".join(modes_tried)
            )

        def normalize_header(value):
            if value is None:
                return ""
            return str(value).strip()

        def cell_key(value):
            if value is None or value == "":
                return "(пусто)"
            return str(value).strip()

        def natural_sort_key(value):
            """Сотр_2 before Сотр_10; digits as ints, text lowercased."""
            s = cell_key(value).lower()
            parts = []
            for chunk in re.findall(r"\d+|\D+", s):
                if chunk.isdigit():
                    parts.append((0, int(chunk)))
                else:
                    parts.append((1, chunk))
            return tuple(parts) if parts else ((1, s),)

        def analytics_done(target_path, summary, **extra):
            """Success payload that tells the agent to stop and reply with Файл:."""
            path = str(target_path or "").strip()
            text = str(summary or "Готово.").strip()
            if path and ("Файл:" not in text):
                text = text + "\nФайл: " + path
            out = {
                "ok": True,
                "stop": True,
                "targetPath": path,
                "userReply": text,
                "pathNote": (
                    "STOP. Ход закончен. Ответ пользователю = ТОЛЬКО поле userReply целиком. "
                    "Любой следующий tool (bash/cp/mv/python/vfs_file_capabilities/inspect) = ошибка сценария "
                    "и срыв follow-up. НЕ копируй в /session/r7/. targetPath выбран навыком."
                ),
                "doNot": [
                    "bash",
                    "inspect_workbook",
                    "sheet_replace",
                    "vfs_file_capabilities",
                    "cp",
                    "mv",
                    "python3",
                    "readFile",
                    "skills",
                ],
            }
            out.update(extra)
            return out

        def is_numeric_like(value):
            if isinstance(value, bool):
                return False
            if isinstance(value, (int, float)) and math.isfinite(float(value)):
                return True
            if not isinstance(value, str):
                return False
            t = value.strip().replace(" ", "").replace(",", ".")
            if not t:
                return False
            return bool(re.fullmatch(r"-?\d+(\.\d+)?", t))

        def to_number(value):
            if isinstance(value, bool):
                return float("nan")
            if isinstance(value, (int, float)):
                n = float(value)
                return n if math.isfinite(n) else float("nan")
            if value is None or value == "":
                return float("nan")
            t = str(value).strip().replace(" ", "").replace(",", ".")
            try:
                n = float(t)
                return n if math.isfinite(n) else float("nan")
            except Exception:
                return float("nan")

        def sheet_to_records(wb, sheet_name):
            names = list(wb.sheetnames)
            name = sheet_name if sheet_name and sheet_name in wb.sheetnames else (names[0] if names else "")
            if not name:
                raise ValueError("Лист не найден: " + (sheet_name or "(первый)"))
            ws = wb[name]
            rows_iter = list(ws.iter_rows(values_only=True))
            if not rows_iter:
                return {"sheetName": name, "headers": [], "rows": []}
            headers = [normalize_header(h) for h in rows_iter[0]]
            headers = [h if h else ("col_" + str(i + 1)) for i, h in enumerate(headers)]
            rows = []
            for raw in rows_iter[1:]:
                if raw is None or all(v is None or v == "" for v in raw):
                    continue
                item = {}
                for i, header in enumerate(headers):
                    value = raw[i] if i < len(raw) else None
                    if hasattr(value, "isoformat"):
                        value = value.isoformat()
                    item[header] = value
                rows.append(item)
            return {"sheetName": name, "headers": headers, "rows": rows}

        def classify_columns(headers, rows, sample_limit=40):
            limit = min(len(rows), sample_limit)
            result = []
            for header in headers:
                numeric = 0
                non_empty = 0
                unique = {}
                for i in range(limit):
                    value = rows[i].get(header)
                    if value is None or value == "":
                        continue
                    non_empty += 1
                    unique[cell_key(value)] = True
                    if is_numeric_like(value):
                        numeric += 1
                unique_count = len(unique)
                numeric_ratio = (numeric / non_empty) if non_empty else 0.0
                kind = "categorical"
                if numeric_ratio >= 0.8:
                    kind = "numeric"
                elif unique_count > max(20, int(limit * 0.7)):
                    kind = "id_or_text"
                result.append({
                    "name": header,
                    "kind": kind,
                    "uniqueSample": unique_count,
                    "numericRatio": round(numeric_ratio, 2),
                })
            return result

        def suggest_pivot(columns):
            categoricals = [c for c in columns if c["kind"] == "categorical"]
            numerics = [c for c in columns if c["kind"] == "numeric"]
            row_fields = [c["name"] for c in categoricals[: min(2, len(categoricals))]]
            column_fields = []
            for c in categoricals:
                if c["name"] not in row_fields:
                    column_fields = [c["name"]]
                    break
            if len(row_fields) >= 2 and column_fields:
                row_fields = row_fields[:1]
            preferred = ["Сумма", "Факт", "Бюджет", "Оклад", "Премия", "Количество", "Amount", "Sum", "Total"]
            value_field = ""
            for name in preferred:
                hit = next((c for c in numerics if c["name"] == name), None)
                if hit:
                    value_field = hit["name"]
                    break
            if not value_field and numerics:
                value_field = numerics[-1]["name"]
            aggregation = "sum" if value_field else "count"
            if not value_field and categoricals:
                value_field = categoricals[0]["name"]
            return {
                "rowFields": row_fields,
                "columnFields": column_fields,
                "valueField": value_field,
                "aggregation": aggregation,
            }

        def aggregate(values, mode):
            if not values:
                return None
            if mode == "count":
                return len(values)
            total = sum(values)
            if mode == "sum":
                return total
            if mode == "avg":
                return total / len(values)
            if mode == "min":
                return min(values)
            if mode == "max":
                return max(values)
            return total

        def round_smart(value):
            if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
                return value
            if float(value).is_integer():
                return int(value)
            return round(float(value), 2)

        def build_pivot_aoa(rows, options):
            row_fields = options.get("rowFields") or []
            column_fields = options.get("columnFields") or []
            value_field = options.get("valueField") or ""
            aggregation = str(options.get("aggregation") or "sum").lower()
            column_field = column_fields[0] if column_fields else ""
            if not row_fields:
                raise ValueError("Нужен хотя бы один rowFields")
            if not value_field:
                raise ValueError("valueField обязателен")

            groups = {}
            col_set = {}
            for row in rows:
                row_key_parts = [cell_key(row.get(field)) for field in row_fields]
                row_key = "\u0001".join(row_key_parts)
                col_key = cell_key(row.get(column_field)) if column_field else "__value__"
                if column_field:
                    col_set[col_key] = True
                if row_key not in groups:
                    groups[row_key] = {"parts": row_key_parts, "cols": {}}
                if col_key not in groups[row_key]["cols"]:
                    groups[row_key]["cols"][col_key] = []
                if aggregation == "count":
                    groups[row_key]["cols"][col_key].append(1.0)
                else:
                    n = to_number(row.get(value_field))
                    if math.isfinite(n):
                        groups[row_key]["cols"][col_key].append(n)

            col_keys = sorted(col_set.keys(), key=lambda x: x) if column_field else ["__value__"]
            header = list(row_fields)
            if column_field:
                header.extend(col_keys)
                header.append("Итого")
            else:
                header.append(value_field + " (" + aggregation + ")")

            body = []
            col_totals = {k: [] for k in col_keys}
            for row_key in sorted(groups.keys(), key=lambda x: x):
                g = groups[row_key]
                line = list(g["parts"])
                row_values = []
                for key in col_keys:
                    agg = aggregate(g["cols"].get(key) or [], aggregation)
                    cell = None if agg is None else round_smart(agg)
                    line.append(cell)
                    if agg is not None:
                        row_values.append(agg)
                        col_totals[key].append(agg)
                if column_field:
                    mode = "sum" if aggregation == "count" else aggregation
                    row_total = aggregate(row_values, mode)
                    line.append(None if row_total is None else round_smart(row_total))
                body.append(line)

            aoa = [header] + body
            if column_field and body:
                total_line = ["Итого"] + ([""] * (len(row_fields) - 1))
                mode = "sum" if aggregation == "count" else aggregation
                grand = []
                for key in col_keys:
                    agg = aggregate(col_totals[key], mode)
                    total_line.append(None if agg is None else round_smart(agg))
                    if agg is not None:
                        grand.append(agg)
                grand_total = aggregate(grand, mode)
                total_line.append(None if grand_total is None else round_smart(grand_total))
                aoa.append(total_line)

            return {
                "aoa": aoa,
                "rowCount": len(body),
                "columnCount": len(header),
                "columnKeys": col_keys if column_field else [],
                "aggregation": aggregation,
                "valueField": value_field,
            }

        def stem_from_path(path):
            name = str(path or "").rstrip("/").split("/")[-1]
            lower = name.lower()
            for ext in (".xlsx", ".xlsm", ".xls"):
                if lower.endswith(ext):
                    return name[: -len(ext)] or "result"
            return name or "result"

        def default_target_path(source_path, suffix):
            stem = stem_from_path(source_path)
            src = str(source_path or "").replace("\\", "/")
            if stem.lower().startswith("r7-") or "/session/r7/" in src.lower():
                stem = suffix
            # ASCII-only filenames — Cyrillic paths break some VFS/plugin downloads.
            safe = re.sub(r"[^a-zA-Z0-9\-]+", "_", str(stem or suffix))[:40].strip("_") or suffix
            suf = re.sub(r"[^a-zA-Z0-9\-]+", "_", str(suffix or "result"))[:24].strip("_") or "result"
            return "/session/" + safe + "_" + suf + ".xlsx"

        def normalize_result_path(target_path, source_path, suffix):
            # Ignore model targetPath entirely — agents pass /session/r7/… then try bash cp/mv
            # to "fix" the rewrite. Always choose a stable /session ASCII path.
            _ = target_path
            return default_target_path(source_path, suffix)

        def records_to_aoa(headers, rows):
            aoa = [list(headers)]
            for row in rows:
                aoa.append([row.get(h) for h in headers])
            return aoa

        async def write_aoa_workbook(vfs, target_path, sheets_aoa, source_path=None):
            """
            sheets_aoa: list of {name, aoa}. Replaces named sheets; creates book if needed.
            If target_path == source_path, starts from source bytes.
            """
            from openpyxl import Workbook, load_workbook
            from openpyxl.utils import get_column_letter

            created_new = False
            if source_path and target_path == source_path:
                buf = await read_workbook_bytes(vfs, source_path)
                wb = load_workbook(io.BytesIO(buf), data_only=False)
            else:
                exists = False
                if callable(getattr(vfs, "exists", None)):
                    try:
                        exists = bool(await vfs.exists(target_path))
                    except Exception:
                        exists = False
                if exists:
                    buf = await read_workbook_bytes(vfs, target_path)
                    wb = load_workbook(io.BytesIO(buf), data_only=False)
                else:
                    wb = Workbook()
                    created_new = True
                    wb.remove(wb.active)

            for item in sheets_aoa:
                name = str(item.get("name") or "Результат")[:31]
                aoa = item.get("aoa") or []
                if name in wb.sheetnames:
                    del wb[name]
                ws = wb.create_sheet(title=name)
                for r_idx, row in enumerate(aoa, start=1):
                    for c_idx, value in enumerate(row, start=1):
                        ws.cell(row=r_idx, column=c_idx, value=value)
                width = max(1, len(aoa[0]) if aoa else 1)
                for col in range(1, width + 1):
                    ws.column_dimensions[get_column_letter(col)].width = 16

            out = io.BytesIO()
            wb.save(out)
            payload = out.getvalue()
            write_mode = await write_workbook_bytes(vfs, target_path, payload)
            stored = None
            if callable(getattr(vfs, "getFileMetadata", None)):
                try:
                    meta = await vfs.getFileMetadata(target_path)
                    if isinstance(meta, dict):
                        stored = meta.get("size_bytes") or meta.get("size")
                except Exception:
                    stored = None
            return {
                "writeMode": write_mode + ("+created" if created_new else "+updated"),
                "expectedBytes": len(payload),
                "storedBytes": stored,
            }

        def parse_cell_date(value):
            from datetime import datetime, date
            if isinstance(value, datetime):
                return value.date()
            if isinstance(value, date):
                return value
            if value is None or value == "":
                return None
            text = str(value).strip()
            for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
                try:
                    return datetime.strptime(text[:19], fmt).date()
                except Exception:
                    continue
            try:
                return datetime.fromisoformat(text.replace("Z", "")).date()
            except Exception:
                return None

        def year_month_label(value):
            d = parse_cell_date(value)
            if d is None:
                text = str(value or "").strip()
                if len(text) >= 7 and text[4] == "-":
                    return text[:7]
                return ""
            return str(d.year) + "-" + str(d.month).zfill(2)

        def match_one_filter(row, rule):
            if not isinstance(rule, dict):
                return True
            field = str(rule.get("field") or "").strip()
            op = str(rule.get("op") or "eq").strip().lower()
            expected = rule.get("value")
            actual = row.get(field)
            if op == "eq":
                return cell_key(actual) == cell_key(expected)
            if op == "ne":
                return cell_key(actual) != cell_key(expected)
            if op == "contains":
                return str(expected or "").lower() in str(actual or "").lower()
            if op == "in":
                values = expected if isinstance(expected, list) else [expected]
                keys = [cell_key(v) for v in values]
                return cell_key(actual) in keys
            if op == "month":
                d = parse_cell_date(actual)
                if d is None:
                    return False
                try:
                    want = int(str(expected).strip())
                except Exception:
                    return False
                return d.month == want
            if op == "year_month":
                return year_month_label(actual) == str(expected or "").strip()[:7]
            if op == "gt":
                return to_number(actual) > to_number(expected)
            if op == "gte":
                return to_number(actual) >= to_number(expected)
            if op == "lt":
                return to_number(actual) < to_number(expected)
            if op == "lte":
                return to_number(actual) <= to_number(expected)
            if op == "empty":
                return actual is None or actual == ""
            if op == "not_empty":
                return actual is not None and actual != ""
            return True

        def row_matches_filters(row, filters, match_any=False):
            if not filters:
                return True
            rules = [r for r in filters if isinstance(r, dict)]
            if not rules:
                return True
            if match_any:
                return any(match_one_filter(row, rule) for rule in rules)
            return all(match_one_filter(row, rule) for rule in rules)

        def is_excel_name(name):
            lower = str(name or "").lower()
            return lower.endswith(".xlsx") or lower.endswith(".xlsm") or lower.endswith(".xls")

        def join_path(base, name):
            if not base or base == "/":
                return "/" + name
            return str(base).rstrip("/") + "/" + name

        async def list_excel_in_dir(vfs, dir_path, out, depth):
            if depth > 3:
                return
            if not callable(getattr(vfs, "listDir", None)):
                return
            try:
                entries = await vfs.listDir(dir_path)
            except Exception:
                return
            if isinstance(entries, list):
                lst = entries
            elif isinstance(entries, dict):
                lst = entries.get("entries") or entries.get("items") or []
            else:
                lst = []
            for item in lst:
                name = ""
                full_path = ""
                is_directory = False
                if isinstance(item, str):
                    name = item
                    full_path = join_path(dir_path, item)
                elif isinstance(item, dict):
                    raw_name = str(item.get("name") or item.get("path") or "")
                    name = raw_name.split("/")[-1] if raw_name else ""
                    full_path = str(item.get("path") or join_path(dir_path, name))
                    is_directory = bool(item.get("isDir") or item.get("isDirectory") or item.get("type") in ("dir", "directory"))
                if not name:
                    continue
                if is_directory or ("." not in name and not is_excel_name(name)):
                    if callable(getattr(vfs, "isDir", None)):
                        try:
                            if await vfs.isDir(full_path):
                                await list_excel_in_dir(vfs, full_path, out, depth + 1)
                                continue
                        except Exception:
                            pass
                    elif is_directory:
                        await list_excel_in_dir(vfs, full_path, out, depth + 1)
                        continue
                if is_excel_name(name):
                    out.append({"path": full_path, "name": name, "root": dir_path})
---

# Excel Pivot Toolkit

Навык читает произвольные `.xlsx` из workspace/session и пишет результат **в книгу Excel** (отдельный файл или лист), не затирая исходные данные без явного `targetPath = sourcePath`.

Рантайм tools: `python@3` + `openpyxl`. Версия **1.11.0**.

## Протокол агента (обязательный)

1. Источник: `workbook_path` из контекста (или `pick_working_source`). Refine → только явный `last_result_path`.  
2. **Happy-path:** сорт/фильтр с ясной колонкой → сразу `sort_rows` / `filter_export` (**без** `vfs_file_capabilities`, без inspect).  
3. **Маршрут:** сорт → `sort_rows`; фильтр/вынеси → `filter_export`; KPI/сумма → filter/`top_n_summary`/`build_pivot_table`; сводная → `inspect`→`build_pivot_table`; шапка → `cell_format`; «какую аналитику» → текст без tools.  
4. `targetPath` **не передавай** (игнорируется; путь ASCII `/session/…`).  
5. `ok`/`stop`/`userReply` → ответ = **только** `userReply`. **Любой** следующий tool = ошибка сценария (platform abort + зависание follow-up).  
6. **Запрещено всегда:** host `bash`/`python`, `vfs_file_capabilities`, `readFile`, `cp`/`mv`, `sheet_replace`, запись в `/session/r7/`.  
7. Вставка в открытый лист — кнопки плагина. Новый user turn = новый Intent (доуточнения нормальны).

Все analytics tools возвращают `analytics_done` (`stop` + `userReply` + `doNot`).

## Инструменты

### Базовые
- `list_workbooks` — `.xlsx` в `/session/r7`, `/session`, `/workspace`; `preferred` если один файл в r7.
- `pick_working_source` — по умолчанию открытая книга (`workbookPath`); KPI/`lastResult` только по явному выбору; иначе `needsUser` + `options`.
- `inspect_workbook` — листы, заголовки, sample, `suggestedPivot` (перед сводной; **не** после успешного sort/filter).
- `build_pivot_table` — сводная на лист `Сводная` (или заданный).

### Качество (1–2)
- `profile_sheet` — null%, unique, min/max, топы; опционально дубли по `keyFields`.
- `dedupe_rows` — дубликаты `keep=first|last` + `normalizeHeaders`.

### Нарезка (3–4)
- `filter_export` — **обязан** `filters:[{field,op,value}]`, напр. Город/`eq`/Москва → `/session/*_filter.xlsx`. Без filters вызов падает. После ok — стоп.  
- `select_columns` — проекция (**только** по явной просьбе урезать колонки).  
- `sort_rows` — `sortBy` / `sortField` → `/session/*_sort.xlsx`. Текст+цифры — **natural order** (не делай calc-колонку и не пиши python). После ok — стоп.  
- `add_calculated_column` — только явный расчёт (`Оклад*0.1` и т.п.). **Не** для сортировки `Сотр_N`.
- `time_bucket` — период day|week|month|year по `dateField`.
- `top_n_summary` — листы `Топ` и `KPI`.

### Сверка листов
- `compare_sheets` — два листа **одной** книги (`sheetA`/`sheetB`, `keyFields`, `mode`: `diff` | `join` | `reconcile`).

### Открытый R7 Cell
- `sheet_replace` — **отключён** (всегда `ok: false`). Вставка в лист = кнопки плагина.
- `cell_format` — оформление открытого листа (whitelist ниже); плагин auto-apply.

## Возможности Cell apply (жёсткий контракт)

### `cell_format` — можно
| Поле | Смысл |
|------|--------|
| `headerBold` | жирный **первой строки** таблицы (ряд 1, A1:…1), не столбец A |
| `bold` | жирный всего target |
| `italic` | курсив |
| `fontName`, `fontSize` | шрифт и размер |
| `fontColorRgb`, `fillRgb` | цвет текста / заливка `[R,G,B]` |
| `underline` | подчёркивание |
| `headerFillRgb` | заливка **первой строки** (шапка), не первого столбца |
| `bordersOutline: true` | одна тонкая **внешняя** рамка (без выбора толщины) |

### `cell_format` — нельзя (сказать клиенту сразу, не крутить tools)
- Толщина границ («1 пт», «0,5 пт»), отдельно внешние/внутренние линии сетки.
- Ключи `borderAll`, `borderInside`, `borderOutside`, `borders`, `lineStyle`.
- Merge, числовые форматы, условное форматирование, автофильтр, ширина/высота колонок/строк.

### `sheet_replace`
- Tool **отключён**. Открытый лист меняет плагин (кнопка **Заменить**).

### Поведение при частичном/невозможном запросе (обязательно)
1. Сделай **только** то, что в whitelist (например `headerBold: true`, опционально `bordersOutline: true`).
2. В **одном** коротком ответе: что сделано / что **нельзя** + «сделайте вручную в R7 Cell».
3. **Запрещено** после отказа: повторять `cell_format` с выдуманными ключами; host `bash`/`python3`; `cp`/`mv`; `sheet_replace`.
4. Если tool вернул `ok: false` с `rejectedKeys` — **стоп**, без второго круга.

### Ответ клиенту
- Только короткий итог. Без планов и «сейчас вызову tool».
- После analytics: обязательно `Файл: /session/….xlsx`.
- После `cell_format` **не** предлагай кнопки XLSX/Лист/Вставить/Заменить.


## Ограничения

- Не выдумывать колонки: только из `inspect_workbook` / заголовков tool.
- Итог analytics = реальный `.xlsx` через vfs навыка.
- **Не** host `bash` / `python3` / openpyxl вне tools.
- Не читать `r7-snapshot` JSON как таблицу.
- Бинарное чтение: `source: "original"`; запись только ZIP/PK bytes.
- Сверка двух **файлов** с диска — другой агент.
- Не обещай то, чего нет в whitelist `cell_format`.
