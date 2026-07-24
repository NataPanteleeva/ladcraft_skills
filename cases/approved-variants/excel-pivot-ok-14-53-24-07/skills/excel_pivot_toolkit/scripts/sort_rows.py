async def handler(state, params):
    params = params if isinstance(params, dict) else {}
    vfs = get_vfs(state)
    if not vfs:
        return {"ok": False, "error": "VFS недоступен"}

    source_path = get_string(params, "sourcePath").strip()
    if not source_path:
        return {"ok": False, "error": "sourcePath обязателен"}
    source_sheet = get_string(params, "sourceSheet").strip()
    target_path = normalize_result_path(
        get_string(params, "targetPath").strip(),
        source_path,
        "sort",
    )
    target_sheet = get_string(params, "targetSheet").strip() or "Данные"
    sort_by = [str(x or "").strip() for x in get_array(params, "sortBy") if str(x or "").strip()]
    if not sort_by:
        one = get_string(params, "sortField").strip()
        if one:
            sort_by = [one]
    ascending = params.get("ascending")
    asc = True if ascending is None else bool(ascending)

    try:
        from openpyxl import load_workbook

        buffer = await read_workbook_bytes(vfs, source_path)
        wb = load_workbook(io.BytesIO(buffer), data_only=True)
        parsed = sheet_to_records(wb, source_sheet)
        headers = parsed["headers"]
        if not sort_by:
            return {"ok": False, "error": "sortBy или sortField обязателен"}
        missing = [f for f in sort_by if f not in headers]
        if missing:
            return {"ok": False, "error": "Нет полей сортировки: " + ", ".join(missing)}

        def sort_key(row):
            parts = []
            for field in sort_by:
                val = row.get(field)
                num = to_number(val)
                if math.isfinite(num):
                    parts.append((0, num, ""))
                else:
                    # Natural order: Сотр_1 < Сотр_2 < Сотр_10 (not lexicographic).
                    parts.append((1, 0.0, natural_sort_key(val)))
            return parts

        rows = sorted(parsed["rows"], key=sort_key, reverse=not asc)
        aoa = records_to_aoa(headers, rows)
        write_info = await write_aoa_workbook(
            vfs,
            target_path,
            [{"name": target_sheet, "aoa": aoa}],
            source_path if target_path == source_path else None,
        )
        summary = "Таблица отсортирована по: " + ", ".join(sort_by) + "."
        return analytics_done(
            target_path,
            summary,
            sourcePath=source_path,
            targetSheet=target_sheet,
            sortBy=sort_by,
            ascending=asc,
            rowCount=len(rows),
            preview=aoa[: min(11, len(aoa))],
            **write_info,
        )
    except Exception as err:
        return {"ok": False, "error": str(err), "sourcePath": source_path}
