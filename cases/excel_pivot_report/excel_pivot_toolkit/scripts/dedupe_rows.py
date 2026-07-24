async def handler(state, params):
    params = params if isinstance(params, dict) else {}
    vfs = get_vfs(state)
    if not vfs:
        return {"ok": False, "error": "VFS недоступен"}

    source_path = get_string(params, "sourcePath").strip()
    if not source_path:
        return {"ok": False, "error": "sourcePath обязателен"}
    source_sheet = get_string(params, "sourceSheet").strip()
    target_path = normalize_result_path(get_string(params, "targetPath").strip(), source_path, "deduped")
    target_sheet = get_string(params, "targetSheet").strip() or "Данные"
    key_fields = [str(x or "").strip() for x in get_array(params, "keyFields") if str(x or "").strip()]
    keep = get_string(params, "keep").strip().lower() or "first"
    if keep not in ("first", "last"):
        keep = "first"
    normalize = params.get("normalizeHeaders")
    do_norm = True if normalize is None else bool(normalize)

    try:
        from openpyxl import load_workbook

        buffer = await read_workbook_bytes(vfs, source_path)
        wb = load_workbook(io.BytesIO(buffer), data_only=True)
        parsed = sheet_to_records(wb, source_sheet)
        headers = list(parsed["headers"])
        rows = list(parsed["rows"])
        before = len(rows)

        if do_norm:
            new_headers = []
            rename = {}
            used = {}
            for h in headers:
                base = re.sub(r"\s+", " ", str(h or "").strip())
                if not base:
                    base = "col"
                key = base
                n = 2
                while key in used:
                    key = base + "_" + str(n)
                    n += 1
                used[key] = True
                rename[h] = key
                new_headers.append(key)
            rows = [{rename[h]: row.get(h) for h in headers} for row in rows]
            headers = new_headers

        removed = 0
        if key_fields:
            missing = [f for f in key_fields if f not in headers]
            if missing:
                return {"ok": False, "error": "Неизвестные keyFields: " + ", ".join(missing)}
            if keep == "first":
                seen = {}
                out_rows = []
                for row in rows:
                    key = "\u0001".join(cell_key(row.get(f)) for f in key_fields)
                    if key in seen:
                        removed += 1
                        continue
                    seen[key] = True
                    out_rows.append(row)
                rows = out_rows
            else:
                seen = {}
                out_rows = []
                for row in reversed(rows):
                    key = "\u0001".join(cell_key(row.get(f)) for f in key_fields)
                    if key in seen:
                        removed += 1
                        continue
                    seen[key] = True
                    out_rows.append(row)
                rows = list(reversed(out_rows))

        aoa = records_to_aoa(headers, rows)
        write_info = await write_aoa_workbook(
            vfs,
            target_path,
            [{"name": target_sheet, "aoa": aoa}],
            source_path if target_path == source_path else None,
        )
        return analytics_done(
            target_path,
            "Дубликаты удалены: было "
            + str(before)
            + ", стало "
            + str(len(rows))
            + ", снято "
            + str(removed)
            + ".",
            sourcePath=source_path,
            targetSheet=target_sheet,
            headers=headers,
            rowCountBefore=before,
            rowCountAfter=len(rows),
            removedDuplicates=removed,
            keyFields=key_fields,
            preview=aoa[: min(11, len(aoa))],
            **write_info,
        )
    except Exception as err:
        return {"ok": False, "error": str(err), "sourcePath": source_path}
