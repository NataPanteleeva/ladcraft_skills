async def handler(state, params):
    params = params if isinstance(params, dict) else {}
    vfs = get_vfs(state)
    if not vfs:
        return {"ok": False, "error": "VFS недоступен"}

    source_path = get_string(params, "sourcePath").strip()
    if not source_path:
        return {"ok": False, "error": "sourcePath обязателен"}
    source_sheet = get_string(params, "sourceSheet").strip()
    target_path = normalize_result_path(get_string(params, "targetPath").strip(), source_path, "periods")
    target_sheet = get_string(params, "targetSheet").strip() or "Данные"
    date_field = get_string(params, "dateField").strip()
    bucket = get_string(params, "bucket").strip().lower() or "month"
    new_column = get_string(params, "newColumn").strip() or ("Период_" + bucket)
    if bucket not in ("day", "week", "month", "year"):
        bucket = "month"
    if not date_field:
        return {"ok": False, "error": "dateField обязателен"}

    try:
        from openpyxl import load_workbook
        from datetime import datetime, date, timedelta

        def parse_date(value):
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

        def bucket_label(d):
            if d is None:
                return ""
            if bucket == "day":
                return d.isoformat()
            if bucket == "year":
                return str(d.year)
            if bucket == "week":
                iso = d.isocalendar()
                return str(iso[0]) + "-W" + str(iso[1]).zfill(2)
            return str(d.year) + "-" + str(d.month).zfill(2)

        buffer = await read_workbook_bytes(vfs, source_path)
        wb = load_workbook(io.BytesIO(buffer), data_only=True)
        parsed = sheet_to_records(wb, source_sheet)
        if date_field not in parsed["headers"]:
            return {"ok": False, "error": "Нет dateField: " + date_field}
        headers = list(parsed["headers"])
        if new_column not in headers:
            headers = headers + [new_column]
        rows = []
        for row in parsed["rows"]:
            item = dict(row)
            item[new_column] = bucket_label(parse_date(row.get(date_field)))
            rows.append(item)
        aoa = records_to_aoa(headers, rows)
        write_info = await write_aoa_workbook(
            vfs,
            target_path,
            [{"name": target_sheet, "aoa": aoa}],
            source_path if target_path == source_path else None,
        )
        return analytics_done(
            target_path,
            "Периоды по «" + date_field + "» (" + bucket + ").",
            sourcePath=source_path,
            targetSheet=target_sheet,
            dateField=date_field,
            bucket=bucket,
            newColumn=new_column,
            rowCount=len(rows),
            preview=aoa[: min(11, len(aoa))],
            **write_info,
        )
    except Exception as err:
        return {"ok": False, "error": str(err), "sourcePath": source_path}
