async def handler(state, params):
    params = params if isinstance(params, dict) else {}
    vfs = get_vfs(state)
    if not vfs:
        return {"ok": False, "error": "VFS недоступен"}

    source_path = get_string(params, "sourcePath").strip()
    if not source_path:
        return {"ok": False, "error": "sourcePath обязателен"}
    source_sheet = get_string(params, "sourceSheet").strip()
    target_path = normalize_result_path(get_string(params, "targetPath").strip(), source_path, "profile")
    target_sheet = get_string(params, "targetSheet").strip() or "Профиль"
    key_fields = [str(x or "").strip() for x in get_array(params, "keyFields") if str(x or "").strip()]
    top_n = 5
    raw_top = params.get("topN")
    if isinstance(raw_top, (int, float)) and math.isfinite(float(raw_top)):
        top_n = max(1, min(20, int(round(float(raw_top)))))

    try:
        from openpyxl import load_workbook
        from collections import Counter

        buffer = await read_workbook_bytes(vfs, source_path)
        wb = load_workbook(io.BytesIO(buffer), data_only=True)
        parsed = sheet_to_records(wb, source_sheet)
        headers = parsed["headers"]
        rows = parsed["rows"]
        n = len(rows)

        aoa = [["Колонка", "nonEmpty", "nullPct", "unique", "kind", "min", "max", "topValues"]]
        columns_out = []
        for header in headers:
            values = [row.get(header) for row in rows]
            non_empty = [v for v in values if v is not None and v != ""]
            null_pct = round(100.0 * (n - len(non_empty)) / n, 1) if n else 0.0
            uniq = {}
            for v in non_empty:
                uniq[cell_key(v)] = v
            nums = [to_number(v) for v in non_empty]
            nums = [x for x in nums if math.isfinite(x)]
            kind = "numeric" if nums and len(nums) >= max(1, int(0.8 * len(non_empty))) else "text"
            mn = round_smart(min(nums)) if nums else None
            mx = round_smart(max(nums)) if nums else None
            counts = Counter(cell_key(v) for v in non_empty)
            top = []
            for key, cnt in counts.most_common(top_n):
                sample = next((v for v in non_empty if cell_key(v) == key), key)
                top.append({"value": sample, "count": cnt})
            top_str = "; ".join(str(t["value"]) + "(" + str(t["count"]) + ")" for t in top)
            aoa.append([header, len(non_empty), null_pct, len(uniq), kind, mn, mx, top_str])
            columns_out.append({
                "name": header,
                "nonEmpty": len(non_empty),
                "nullPct": null_pct,
                "unique": len(uniq),
                "kind": kind,
                "min": mn,
                "max": mx,
                "topValues": top,
            })

        dup_count = 0
        if key_fields:
            seen = {}
            for row in rows:
                key = "\u0001".join(cell_key(row.get(f)) for f in key_fields)
                if key in seen:
                    dup_count += 1
                else:
                    seen[key] = True
            aoa.append([])
            aoa.append(["keyFields", ", ".join(key_fields), "duplicateRows", dup_count])

        write_info = await write_aoa_workbook(
            vfs,
            target_path,
            [{"name": target_sheet, "aoa": aoa}],
            source_path if target_path == source_path else None,
        )
        return analytics_done(
            target_path,
            "Профиль листа «" + str(parsed["sheetName"]) + "»: " + str(n) + " строк.",
            sourcePath=source_path,
            targetSheet=target_sheet,
            sheet=parsed["sheetName"],
            rowCount=n,
            columns=columns_out,
            duplicateRows=dup_count if key_fields else None,
            preview=aoa[: min(12, len(aoa))],
            **write_info,
        )
    except Exception as err:
        return {"ok": False, "error": str(err), "sourcePath": source_path}
