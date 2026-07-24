async def handler(state, params):
    params = params if isinstance(params, dict) else {}
    vfs = get_vfs(state)
    if not vfs:
        return {"ok": False, "error": "VFS недоступен"}

    source_path = get_string(params, "sourcePath").strip()
    if not source_path:
        return {"ok": False, "error": "sourcePath обязателен"}
    source_sheet = get_string(params, "sourceSheet").strip()
    target_path = normalize_result_path(get_string(params, "targetPath").strip(), source_path, "filter")
    target_sheet = get_string(params, "targetSheet").strip() or "Фильтр"
    filters = get_array(params, "filters")
    match_any = bool(params.get("matchAny") is True or params.get("match_any") is True)
    # Optional projection — only when explicitly provided (keep all columns by default).
    columns = [str(x or "").strip() for x in get_array(params, "columns") if str(x or "").strip()]

    try:
        from openpyxl import load_workbook

        buffer = await read_workbook_bytes(vfs, source_path)
        wb = load_workbook(io.BytesIO(buffer), data_only=True)
        parsed = sheet_to_records(wb, source_sheet)
        headers = list(parsed["headers"])
        if columns:
            missing = [c for c in columns if c not in headers]
            if missing:
                return {
                    "ok": False,
                    "error": "Нет колонок: " + ", ".join(missing) + ". Есть: " + ", ".join(headers),
                    "sourcePath": source_path,
                }
            headers = columns
        before = len(parsed["rows"])
        rows = [
            row
            for row in parsed["rows"]
            if row_matches_filters(row, filters, match_any)
        ]
        if columns:
            rows = [{c: row.get(c) for c in headers} for row in rows]
        aoa = records_to_aoa(headers, rows)
        write_info = await write_aoa_workbook(
            vfs,
            target_path,
            [{"name": target_sheet, "aoa": aoa}],
            source_path if target_path == source_path else None,
        )
        summary = (
            "Фильтр применён: строк "
            + str(before)
            + " → "
            + str(len(rows))
            + "."
        )
        return analytics_done(
            target_path,
            summary,
            sourcePath=source_path,
            targetSheet=target_sheet,
            filters=filters,
            matchAny=match_any,
            columns=headers,
            rowCountBefore=before,
            rowCountAfter=len(rows),
            preview=aoa[: min(11, len(aoa))],
            **write_info,
        )
    except Exception as err:
        return {"ok": False, "error": str(err), "sourcePath": source_path}
