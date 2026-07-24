async def handler(state, params):
    params = params if isinstance(params, dict) else {}
    vfs = get_vfs(state)
    if not vfs:
        return {"ok": False, "error": "VFS недоступен"}

    source_path = get_string(params, "sourcePath").strip()
    if not source_path:
        return {"ok": False, "error": "sourcePath обязателен"}
    source_sheet = get_string(params, "sourceSheet").strip()
    target_path = normalize_result_path(get_string(params, "targetPath").strip(), source_path, "columns")
    target_sheet = get_string(params, "targetSheet").strip() or "Данные"
    columns = [str(x or "").strip() for x in get_array(params, "columns") if str(x or "").strip()]
    if not columns:
        return {"ok": False, "error": "columns обязателен (непустой список)"}

    try:
        from openpyxl import load_workbook

        buffer = await read_workbook_bytes(vfs, source_path)
        wb = load_workbook(io.BytesIO(buffer), data_only=True)
        parsed = sheet_to_records(wb, source_sheet)
        missing = [c for c in columns if c not in parsed["headers"]]
        if missing:
            return {
                "ok": False,
                "error": "Нет колонок: " + ", ".join(missing) + ". Есть: " + ", ".join(parsed["headers"]),
            }
        rows = [{c: row.get(c) for c in columns} for row in parsed["rows"]]
        aoa = records_to_aoa(columns, rows)
        write_info = await write_aoa_workbook(
            vfs,
            target_path,
            [{"name": target_sheet, "aoa": aoa}],
            source_path if target_path == source_path else None,
        )
        return analytics_done(
            target_path,
            "Выбраны колонки: " + ", ".join(columns) + ".",
            sourcePath=source_path,
            targetSheet=target_sheet,
            columns=columns,
            rowCount=len(rows),
            preview=aoa[: min(11, len(aoa))],
            **write_info,
        )
    except Exception as err:
        return {"ok": False, "error": str(err), "sourcePath": source_path}
